/**
 * Entities — management-API-backed repository adapter (task 3-2 reads, task
 * 3-4 relink: entity writes + create-then-use-response).
 *
 * Read surface backed by `GET /api/entities` (map) / `GET /api/entities/:id`
 * (full config), with the additive 3-1b fields mapped into the domain `Entity`.
 *
 * Write surface (task 3-4, owner ruling 1):
 *   - create → `POST /api/entities` `{name, character_profile_id?, entity_type?,
 *     dedupe_id_if_taken: true}`. The ENGINE derives the id from `name` (rejects
 *     client `id`/`alias`), so the app is a **create-then-use-response** model:
 *     the returned `{id, alias}` is what callers navigate/link with.
 *   - update → `PUT /api/entities/:id` (character_profile_id, alias,
 *     lifecycle_config, is_disabled, is_muted).
 *   - delete → `DELETE /api/entities/:id` (persona cascade is engine-side).
 *   - duplicate → `POST /api/entities/:id/duplicate`.
 *
 * `is_muted` is ENGINE-AUTHORITATIVE (task 3-4): `PUT /api/entities/:id`
 * accepts optional `is_muted` (present → updates, absent → untouched; an
 * unknown id surfaces as 500, mirroring `is_disabled`), and reads carry
 * `is_muted` on the entity config. The former app-local AsyncStorage overlay
 * (`services/preferences/EntityMutePreference`) is DELETED — mute lives on the
 * engine entity and suppresses engine-side outreach/push delivery.
 */

import type { Entity, EntityModuleMapping } from '../../../database/models';
import { engineApiClient } from '../EngineApiClient';
import { EngineApiError } from '../EngineApiClient';
import { mapEntityConfig } from '../engineApiMappers';

/** Typed error for reserved display names (`user` / `deleted`). */
export class ReservedEntityNameError extends Error {
  constructor(name: string) {
    super(`"${name}" is a reserved name — rename the card and retry`);
    this.name = 'ReservedEntityNameError';
  }
}

/** Strip a trailing copy-suffix (e.g. " 02", "-03") from a name. */
export function stripCopySuffix(name: string): string {
  const trimmed = name.trim();
  const match = trimmed.match(/^(.*?)[\s-_]+(\d+)$/);
  if (!match) return trimmed;
  return match[1].trim();
}

export async function getEntity(
  id: string,
  _includeDeleted = false,
): Promise<Entity | null> {
  try {
    const cfg = await engineApiClient.getEntityConfig(id);
    return mapEntityConfig(id, cfg);
  } catch (e) {
    if (e instanceof EngineApiError && e.isNotFound) return null;
    throw e;
  }
}

export async function getAllEntities(_includeDeleted = false): Promise<Entity[]> {
  const map = await engineApiClient.listEntities();
  return Object.entries(map)
    .map(([id, cfg]) => mapEntityConfig(id, cfg))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export async function getEntityByCharacterProfileId(
  characterProfileId: string,
  _includeDeleted = false,
): Promise<Entity | null> {
  const map = await engineApiClient.listEntities();
  let best: Entity | null = null;
  for (const [id, cfg] of Object.entries(map)) {
    const profileId = cfg.character_profile_id ?? cfg.character_profile?.id ?? null;
    if (profileId !== characterProfileId) continue;
    const entity = mapEntityConfig(id, cfg);
    if (!best || entity.created_at.getTime() > best.created_at.getTime()) {
      best = entity;
    }
  }
  return best;
}

/** True when a NON-deleted user-type entity owns the profile (persona-owned). */
export async function isProfilePersonaOwned(profileId: string): Promise<boolean> {
  const map = await engineApiClient.listEntities();
  return Object.values(map).some(
    cfg => (cfg.entity_type ?? 'ai') === 'user' && cfg.character_profile_id === profileId,
  );
}

/**
 * Muted entity ids — ENGINE-AUTHORITATIVE (task 3-4). Derived from the entity
 * list's `is_muted` field (no app-local overlay).
 */
export async function getMutedEntityIds(): Promise<string[]> {
  const map = await engineApiClient.listEntities();
  const ids = new Set<string>();
  for (const [id, cfg] of Object.entries(map)) {
    if (cfg.is_muted) ids.add(id);
  }
  return [...ids];
}

export async function getDisabledEntityIds(): Promise<string[]> {
  const map = await engineApiClient.listEntities();
  return Object.entries(map)
    .filter(([, cfg]) => cfg.is_disabled)
    .map(([id]) => id);
}

// ── Entity module mappings (task 3-4) ────────────────────────────────────

/** Coerce a falsy/whitespace config id to null (mirrors the SQLite normalizer). */
function normalizeConfigId(id: string | null | undefined): string | null {
  if (id == null) return null;
  const trimmed = String(id).trim();
  return trimmed === '' ? null : trimmed;
}

/** Build the mapping row from an engine entity config's resolved `modules` map. */
function mappingFromModules(
  entityId: string,
  modules: Record<string, { id?: string } | undefined>,
): EntityModuleMapping {
  const idOf = (key: string): string | null => normalizeConfigId(modules[key]?.id);
  return {
    entity_id: entityId,
    backend_config_id: idOf('backend'),
    cognition_config_id: idOf('cognition'),
    imagination_config_id: idOf('imagination'),
    movement_config_id: idOf('movement'),
    rag_config_id: idOf('rag'),
    stt_config_id: idOf('stt'),
    tts_config_id: idOf('tts'),
    vision_config_id: idOf('vision'),
    deleted_at: null,
  };
}

/** Derive the mapping row from the engine entity config's resolved modules. */
export async function getEntityModuleMapping(
  entityId: string,
  _includeDeleted = false,
): Promise<EntityModuleMapping | null> {
  try {
    const cfg = await engineApiClient.getEntityConfig(entityId);
    const modules = (cfg.modules ?? {}) as Record<string, { id?: string } | undefined>;
    return mappingFromModules(entityId, modules);
  } catch (e) {
    if (e instanceof EngineApiError && e.isNotFound) return null;
    throw e;
  }
}

/**
 * Batch variant of {@link getEntityModuleMapping}: ONE `GET /api/entities` read
 * → a map of entity id → its 8-slot module mapping. Backs the store-variant
 * entity-lock predicate (plan 7-14 V3), which needs every entity's wiring
 * without an N-call fan-out. Deleted entities are already excluded by the map
 * read's domain semantics (the engine lists live entities).
 */
export async function getAllEntityModuleMappings(
  _includeDeleted = false,
): Promise<Record<string, EntityModuleMapping>> {
  const map = await engineApiClient.listEntities();
  const out: Record<string, EntityModuleMapping> = {};
  for (const [id, cfg] of Object.entries(map)) {
    const modules = (cfg.modules ?? {}) as Record<string, { id?: string } | undefined>;
    out[id] = mappingFromModules(id, modules);
  }
  return out;
}

/** PUT the full mapping set (the engine route is a full-row upsert). */
async function putMapping(mapping: Omit<EntityModuleMapping, 'deleted_at'>): Promise<void> {
  await engineApiClient.updateEntityMappings(mapping.entity_id, {
    backend_config_id: normalizeConfigId(mapping.backend_config_id),
    cognition_config_id: normalizeConfigId(mapping.cognition_config_id),
    imagination_config_id: normalizeConfigId(mapping.imagination_config_id),
    movement_config_id: normalizeConfigId(mapping.movement_config_id),
    rag_config_id: normalizeConfigId(mapping.rag_config_id),
    stt_config_id: normalizeConfigId(mapping.stt_config_id),
    tts_config_id: normalizeConfigId(mapping.tts_config_id),
    vision_config_id: normalizeConfigId(mapping.vision_config_id),
  });
}

export async function createEntityModuleMapping(
  mapping: EntityModuleMapping,
): Promise<void> {
  await putMapping(mapping);
}

export async function updateEntityModuleMapping(
  mapping: EntityModuleMapping,
): Promise<void> {
  await putMapping(mapping);
}

export async function createOrUpdateEntityModuleMapping(
  mapping: Omit<EntityModuleMapping, 'deleted_at'>,
): Promise<void> {
  await putMapping(mapping);
}

/** Clear every mapping slot (the engine has no per-mapping soft-delete). */
export async function deleteEntityModuleMapping(entityId: string): Promise<void> {
  await putMapping({
    entity_id: entityId,
    backend_config_id: null,
    cognition_config_id: null,
    imagination_config_id: null,
    movement_config_id: null,
    rag_config_id: null,
    stt_config_id: null,
    tts_config_id: null,
    vision_config_id: null,
  });
}

// ── Entity writes (task 3-4, owner ruling 1) ─────────────────────────────

/** Reconstruct a domain Entity from the engine's slim create/duplicate echo. */
function fromCreateEcho(
  echo: { id: string; alias: string; entity_type: string; character_profile_id?: string | null },
  lifecycleConfig: string | null = '{}',
): Entity {
  const now = new Date();
  return {
    id: echo.id,
    alias: echo.alias ?? '',
    character_profile_id: echo.character_profile_id ?? null,
    lifecycle_config: lifecycleConfig,
    rag_reindex_required: 1,
    entity_type: echo.entity_type ?? 'ai',
    is_muted: 0,
    is_disabled: 0,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
}

/**
 * Create an entity (create-then-use-response). The ENGINE mints the id from
 * `name`; `id`/`alias` are never sent. Returns the created Entity so callers
 * use the returned `id` for module mapping + navigation.
 */
export async function createEntity(
  input: { name: string; character_profile_id?: string | null; lifecycle_config?: string | null },
  opts: { entity_type?: string; is_muted?: number; is_disabled?: number } = {},
): Promise<Entity> {
  const name = input.name.trim();
  if (name.toLowerCase() === 'user' || name.toLowerCase() === 'deleted') {
    throw new ReservedEntityNameError(name);
  }
  const echo = await engineApiClient.createEntity({
    name,
    character_profile_id: input.character_profile_id ?? null,
    entity_type: opts.entity_type ?? 'ai',
    dedupe_id_if_taken: true,
  });
  const entity = fromCreateEcho(echo, input.lifecycle_config ?? '{}');
  if (opts.is_muted) await engineApiClient.updateEntity(entity.id, { is_muted: true });
  if (opts.is_disabled) await engineApiClient.updateEntity(entity.id, { is_disabled: true });
  return { ...entity, is_muted: opts.is_muted ?? 0, is_disabled: opts.is_disabled ?? 0 };
}

/** Update an entity (full row). `is_muted` rides the engine entity write. */
export async function updateEntity(entity: Entity): Promise<Entity> {
  await engineApiClient.updateEntity(entity.id, {
    character_profile_id: entity.character_profile_id ?? null,
    alias: entity.alias || '',
    lifecycle_config: entity.lifecycle_config ?? undefined,
    is_disabled: !!entity.is_disabled,
    is_muted: !!entity.is_muted,
  });
  return { ...entity, updated_at: new Date() };
}

/** Update specific fields on an entity (partial update). */
export async function updateEntityFields(
  id: string,
  fields: Partial<
    Pick<Entity, 'character_profile_id' | 'alias' | 'lifecycle_config' | 'rag_reindex_required' | 'is_muted' | 'is_disabled'>
  >,
): Promise<void> {
  const body: {
    character_profile_id?: string | null;
    alias?: string;
    lifecycle_config?: string;
    is_disabled?: boolean;
    is_muted?: boolean;
  } = {};
  if ('character_profile_id' in fields) body.character_profile_id = fields.character_profile_id ?? null;
  if ('alias' in fields) body.alias = fields.alias ?? '';
  if ('lifecycle_config' in fields) body.lifecycle_config = fields.lifecycle_config ?? undefined;
  if ('is_disabled' in fields) body.is_disabled = !!fields.is_disabled;
  if ('is_muted' in fields) body.is_muted = !!fields.is_muted;
  if (Object.keys(body).length > 0) {
    await engineApiClient.updateEntity(id, body);
  }
}

/**
 * Set an entity's muted flag (engine `PUT /api/entities/:id` `is_muted`).
 * Present → the engine updates `entities.is_muted` (suppresses engine-side
 * outreach/push delivery; lifecycle continues). An unknown id surfaces as a
 * 500 (no 404 branch on this route), which propagates as an EngineApiError.
 */
export async function setEntityMuted(id: string, muted: boolean): Promise<void> {
  await engineApiClient.updateEntity(id, { is_muted: muted });
}

/** Set an entity's disabled flag (engine `PUT /api/entities/:id`). */
export async function setEntityDisabled(id: string, disabled: boolean): Promise<void> {
  await engineApiClient.updateEntity(id, { is_disabled: disabled });
}

/** Soft-delete an entity (persona profile cascade is engine-side). */
export async function deleteEntity(id: string): Promise<void> {
  await engineApiClient.deleteEntity(id);
}

/**
 * Duplicate an AI partner (`POST /api/entities/:id/duplicate`). The engine
 * derives the new id/alias and copies mappings + lifecycle_config verbatim.
 */
export async function duplicateAIPartner(entityId: string): Promise<Entity> {
  const echo = await engineApiClient.duplicateEntity(entityId);
  const full = await getEntity(echo.id);
  return full ?? fromCreateEcho(echo);
}
