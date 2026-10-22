/**
 * entityAccess — the store-variant ENTITY LOCK predicate (plan 7-14 V3).
 *
 * ## What "locked" means
 *
 * In a store build only the Soulbits Cloud provider is offered, so an entity
 * that is wired (through any of its module slots) to a provider that is NOT
 * `soulbitscloud` cannot be used. Per owner ruling 2 the entity is
 * visible-but-locked: it still syncs and appears everywhere, but new sessions
 * are refused and interaction affordances are suppressed.
 *
 * The lock is COMPUTED at runtime and NEVER persisted (design rule 2): a store
 * device must never write the synced `is_disabled` flag (which would disable
 * the entity on the owner's desktop / sideload devices). This module never
 * calls `setEntityDisabled` / `updateEntityFields({ is_disabled })`.
 *
 * ## The entity→module→provider model (see entityAccess doc in the V3 report)
 *
 *   entity (GET /api/entities → `modules` map of `{id}` per slot)
 *     → EntityModuleMapping (8 config ids: backend/cognition/imagination/
 *                            movement/rag/stt/tts/vision)
 *     → per-module config row (flat) whose `provider` (STT:
 *                                `transcription_provider` + `vad_provider`)
 *       names the provider TYPE
 *
 * An entity is LOCKED when ANY wired slot resolves to:
 *   - a provider type that is not `soulbitscloud` (e.g. `openai`, `soulvoice`), OR
 *   - a config id that cannot be resolved in the current module-config lists
 *     (the synced entity references a config this device doesn't have — the
 *     "missing config" case).
 *
 * Unwired slots (null config id) and configs whose provider is the engine's
 * `disabled` sentinel / empty (an intentionally-off module) do NOT lock.
 *
 * ## Full variant
 *
 * {@link isEntityLocked} / {@link getLockedEntityIds} short-circuit to
 * "unlocked" with ZERO data fetching when the build is not the store variant —
 * the full variant is byte-for-byte unchanged.
 *
 * ## Caching
 *
 * One batch pass loads every entity mapping + the 8 module-config lists (9
 * reads) and is cached briefly. Invalidate on relevant mutations via
 * {@link invalidateEntityAccessCache}. On a read error the pass fails OPEN
 * (no entity is locked) so a transient engine hiccup can never wrongly lock
 * the whole list; the engine remains the functional guard.
 */

import {
  getAllEntityModuleMappings,
  getAllBackendConfigs,
  getAllCognitionConfigs,
  getAllMovementConfigs,
  getAllRAGConfigs,
  getAllSTTConfigs,
  getAllTTSConfigs,
  getAllVisionConfigs,
  getAllImaginationConfigs,
} from '../../database/repositories';
import type { EntityModuleMapping } from '../../database/models';
import { isStoreVariant } from '../../config/appVariant';
import { STORE_PROVIDER_ID, moduleConfigProviderTypes } from './providerAvailability';
import { createLogger } from '../../utils/logger';

const log = createLogger('[EntityAccess]');

/** The 8 module slots and their config-id field on the mapping row. */
type MappingConfigIdField =
  | 'backend_config_id'
  | 'cognition_config_id'
  | 'imagination_config_id'
  | 'movement_config_id'
  | 'rag_config_id'
  | 'stt_config_id'
  | 'tts_config_id'
  | 'vision_config_id';

const MODULE_SLOTS: ReadonlyArray<{
  module: string;
  field: MappingConfigIdField;
}> = [
  { module: 'backend', field: 'backend_config_id' },
  { module: 'cognition', field: 'cognition_config_id' },
  { module: 'imagination', field: 'imagination_config_id' },
  { module: 'movement', field: 'movement_config_id' },
  { module: 'rag', field: 'rag_config_id' },
  { module: 'stt', field: 'stt_config_id' },
  { module: 'tts', field: 'tts_config_id' },
  { module: 'vision', field: 'vision_config_id' },
];

/** How long a computed lock set is reused before a fresh pass (ms). */
const CACHE_TTL_MS = 10_000;

interface LockCache {
  ids: Set<string>;
  at: number;
}

let cache: LockCache | null = null;
let inflight: Promise<Set<string>> | null = null;

const EMPTY_SET: ReadonlySet<string> = new Set<string>();

/**
 * Invalidate the cached lock set (call after any entity-mapping, module-config
 * or provider-config mutation so the next read reflects the change). Also
 * clears an in-flight pass so a stale computation cannot repopulate the cache.
 */
export function invalidateEntityAccessCache(): void {
  cache = null;
  inflight = null;
}

/** Test seam — alias of {@link invalidateEntityAccessCache}. */
export function resetEntityAccessCacheForTests(): void {
  invalidateEntityAccessCache();
}

/** Index a module-config list into the shared `${module}:${id}` → providers map. */
function indexModuleConfigs(
  index: Map<string, string[]>,
  module: string,
  configs: Array<Record<string, unknown>>,
): void {
  for (const config of configs) {
    const id = config?.id;
    if (typeof id !== 'string' || id === '') continue;
    index.set(`${module}:${id}`, moduleConfigProviderTypes(module, config));
  }
}

/** Load the module-config provider index (9 reads, one pass). */
async function loadProviderIndex(): Promise<Map<string, string[]>> {
  const [backend, cognition, movement, rag, stt, tts, vision, imagination] =
    await Promise.all([
      getAllBackendConfigs(),
      getAllCognitionConfigs(),
      getAllMovementConfigs(),
      getAllRAGConfigs(),
      getAllSTTConfigs(),
      getAllTTSConfigs(),
      getAllVisionConfigs(),
      getAllImaginationConfigs(),
    ]);
  const index = new Map<string, string[]>();
  indexModuleConfigs(index, 'backend', backend as unknown as Array<Record<string, unknown>>);
  indexModuleConfigs(index, 'cognition', cognition as unknown as Array<Record<string, unknown>>);
  indexModuleConfigs(index, 'movement', movement as unknown as Array<Record<string, unknown>>);
  indexModuleConfigs(index, 'rag', rag as unknown as Array<Record<string, unknown>>);
  indexModuleConfigs(index, 'stt', stt as unknown as Array<Record<string, unknown>>);
  indexModuleConfigs(index, 'tts', tts as unknown as Array<Record<string, unknown>>);
  indexModuleConfigs(index, 'vision', vision as unknown as Array<Record<string, unknown>>);
  indexModuleConfigs(index, 'imagination', imagination as unknown as Array<Record<string, unknown>>);
  return index;
}

/**
 * True when a single mapping references any non-cloud / unresolvable provider.
 * Exported for the unit tests (pure w.r.t. the provider index).
 */
export function isMappingLocked(
  mapping: EntityModuleMapping | null | undefined,
  providerIndex: Map<string, string[]>,
): boolean {
  if (!mapping) return false;
  for (const { module, field } of MODULE_SLOTS) {
    const configId = mapping[field] as string | null | undefined;
    if (!configId) continue; // unwired slot — nothing to lock
    const providers = providerIndex.get(`${module}:${configId}`);
    if (providers === undefined) return true; // config missing locally → unknown
    if (providers.some(p => p !== STORE_PROVIDER_ID)) return true;
  }
  return false;
}

/** Compute the locked-entity set in one batch pass (store variant only). */
async function computeLockedEntityIds(): Promise<Set<string>> {
  const [mappings, providerIndex] = await Promise.all([
    getAllEntityModuleMappings(),
    loadProviderIndex(),
  ]);
  const locked = new Set<string>();
  for (const [entityId, mapping] of Object.entries(mappings)) {
    if (isMappingLocked(mapping, providerIndex)) locked.add(entityId);
  }
  return locked;
}

/**
 * The set of store-locked entity ids (empty in the full variant — no fetch).
 * Cached for {@link CACHE_TTL_MS}; pass `force` to recompute now.
 */
export async function getLockedEntityIds(force = false): Promise<Set<string>> {
  if (!isStoreVariant()) return EMPTY_SET as Set<string>;
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.ids;
  }
  if (!force && inflight) return inflight;
  const pass = computeLockedEntityIds()
    .then(ids => {
      cache = { ids, at: Date.now() };
      if (inflight === pass) inflight = null;
      return ids;
    })
    .catch(err => {
      if (inflight === pass) inflight = null;
      // Fail OPEN — a read error must never lock the whole list.
      log.warn('Entity lock computation failed — treating all as unlocked:', err);
      return EMPTY_SET as Set<string>;
    });
  inflight = pass;
  return pass;
}

/**
 * True when an entity is locked in this build. Accepts an entity id or an
 * entity-like `{ id }`. Full variant → always false (zero data fetching).
 */
export async function isEntityLocked(
  entityOrId: string | { id: string },
): Promise<boolean> {
  if (!isStoreVariant()) return false;
  const id = typeof entityOrId === 'string' ? entityOrId : entityOrId?.id;
  if (!id) return false;
  const locked = await getLockedEntityIds();
  return locked.has(id);
}
