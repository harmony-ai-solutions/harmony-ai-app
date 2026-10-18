/**
 * Seeding ensure-flow (provider-registry 6-4, plan §5 amended / §11 A8–A11).
 *
 * The ENGINE is the structural seeder on EMPTY databases (3-1's reworked
 * `createDefaultData`: one soulbitscloud account with an EMPTY api_key + one
 * default config per seedable module type, STT transcription AND VAD slots,
 * `qwen-35-9b` chat default, `silero-vad` VAD, imagination skipped). This module
 * owns what the engine cannot: the app-side **ensure-flow**.
 *
 * `ensureSeededDefaults()` runs on every cloud authentication AND
 * re-authentication / token renewal (plan §11 A9) and does two things:
 *
 *   1. **Token first (NEVER flag-gated).** Ensure the soulbitscloud account
 *      exists and carries the CURRENT PASETO —
 *      `{api_key: <PASETO>, base_url: CLOUD_HOSTS.inference}` — updating it when
 *      present (which subsumes token rotation). `updateAllSoulbitsCloudApiKeys`
 *      stays the bulk-refresh path; the engine-side refresh-token route and
 *      cloud-mode refresh remain authoritative for their own surfaces — all
 *      converge on the single account row post-3-2.
 *   2. **Gap-fill (flag-gated per account).** Per module type (7; imagination
 *      skipped — skip-when-no-model) AND per STT slot (transcription, VAD), if
 *      the user has ZERO configs of that type/slot → create
 *      `Soulbits Cloud (default)` referencing the account, selecting the model
 *      from the gateway's `meta.model_type` + `meta.min_tier` (4-12/5-1), with
 *      the existing `SOULBITS_FALLBACK_MODELS` constants as the offline
 *      fallback (ids per research/soulbitscloud.md §8.3, aligned with the
 *      engine seeder per A10). Existing configs are NEVER overwritten. On fresh
 *      installs the engine seeder already created everything, so this no-ops by
 *      design.
 *
 * The gap-fill scan is gated by the persisted guard `seeding_done_v1:<accountId>`
 * (AsyncStorage — app convention): it re-runs only when the guard is absent
 * (first run for the account) or the soulbitscloud account changed. Failures log
 * via `createLogger` and never block sign-in.
 */

import i18n from 'i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import AuthService from '../auth/AuthService';
import { CLOUD_HOSTS } from '../../config/cloud';
import { engineApiClient } from '../engine/EngineApiClient';
import type { ModelInfoDto } from '../engine/EngineApiClient';
import { createLogger } from '../../utils/logger';
import {
  listAccounts,
  createAccount,
  updateAccount,
  getAllBackendConfigs,
  createBackendConfig,
  getAllCognitionConfigs,
  createCognitionConfig,
  getAllMovementConfigs,
  createMovementConfig,
  getAllRAGConfigs,
  createRAGConfig,
  getAllTTSConfigs,
  createTTSConfig,
  getAllVisionConfigs,
  createVisionConfig,
  getAllSTTConfigs,
  createSTTConfig,
} from '../../database/repositories';
import { capabilityDefaultsOf } from '../../constants/accountFieldSchemas';
import { MODULE_DEFAULTS, PROVIDER_DEFAULTS } from '../../constants/moduleDefaults';
import { getFallbackModelsForModule } from '../../constants/soulbitsModels';

const log = createLogger('[SeedingEnsure]');

const SOULBITS = 'soulbitscloud';

/** Persisted guard prefix — the gap-fill scan runs once per soulbitscloud account. */
const GUARD_PREFIX = 'seeding_done_v1:';

// ── Seed targets ────────────────────────────────────────────────────────

/** Non-STT module types the engine seeds (imagination is intentionally skipped). */
const MODULE_TARGETS = ['backend', 'cognition', 'movement', 'rag', 'tts', 'vision'] as const;

/** Module type → the gateway `meta.model_type` its default model must carry. */
const MODULE_MODEL_TYPE: Record<string, string> = {
  backend: 'llm',
  cognition: 'llm',
  movement: 'llm',
  vision: 'llm',
  rag: 'embeddings',
  tts: 'tts',
};

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Ensure the soulbitscloud account carries the current PASETO and gap-fill any
 * deleted default configs. Safe to call on every auth/re-auth trigger: the token
 * step always runs, the gap-fill scan is guard-gated. Never throws.
 *
 * @param pasetoOverride the PASETO carried by the `auth:changed` event; when
 *   omitted the cached token is read from {@link AuthService}.
 */
export async function ensureSeededDefaults(pasetoOverride?: string): Promise<void> {
  try {
    const paseto = pasetoOverride || (await readCachedToken());
    if (!paseto) {
      // Standalone mode (no cloud credential) — nothing to seed.
      return;
    }

    const accountId = await ensureSoulbitsAccount(paseto);
    if (!accountId) return;

    await gapFill(accountId, paseto);
  } catch (error) {
    // Never block sign-in on a seeding failure.
    log.warn('ensureSeededDefaults failed:', error);
  }
}

/**
 * Subscribe to `auth:changed` (login + hourly token renewal) AND run once
 * immediately for the bootstrap-authenticated path (cold start already signed
 * in). Returns a `stop()` that removes the exact handler.
 */
export function startSeedingEnsure(): () => void {
  const handler = (paseto: string) => {
    void ensureSeededDefaults(paseto).catch(() => undefined);
  };

  AuthService.on('auth:changed', handler);
  // Bootstrap path — a cold start may already be signed in with no event.
  void ensureSeededDefaults().catch(() => undefined);

  return () => {
    AuthService.off('auth:changed', handler);
  };
}

// ── Token-first step ────────────────────────────────────────────────────

/** The cached cloud PASETO, or null in standalone mode / on expiry. */
async function readCachedToken(): Promise<string | null> {
  try {
    const token = await AuthService.getToken();
    return token || null;
  } catch {
    return null;
  }
}

/**
 * Ensure the shared soulbitscloud account exists and carries the current PASETO
 * (`update-if-exists`, which subsumes rotation). Returns its id, or null when
 * neither an update nor a create succeeded.
 */
async function ensureSoulbitsAccount(paseto: string): Promise<string | null> {
  const accounts = (await listAccounts(SOULBITS)).filter(a => !a.deleted_at);

  if (accounts.length > 0) {
    for (const account of accounts) {
      await updateAccount(account.id, {
        api_key: paseto,
        base_url: CLOUD_HOSTS.inference,
      });
    }
    return accounts[0].id;
  }

  // Edge: the engine normally seeds this account on an empty DB. Create it if
  // it is somehow absent so the token + gap-fill have a target.
  return createAccount(SOULBITS, {
    name: i18n.t('providers:soulbitsAccountName'),
    api_key: paseto,
    base_url: CLOUD_HOSTS.inference,
  });
}

// ── Gap-fill step ───────────────────────────────────────────────────────

async function gapFill(accountId: string, paseto: string): Promise<void> {
  const guardKey = `${GUARD_PREFIX}${accountId}`;
  if (await readGuard(guardKey)) {
    // Already scanned for this account — never re-run (matches the doc's
    // one-shot-per-account guard; a changed account has a fresh, absent key).
    return;
  }

  // Determine what is missing BEFORE hitting the gateway, so a fresh install
  // (engine-seeded) performs no model discovery.
  const missingModules: string[] = [];
  for (const moduleType of MODULE_TARGETS) {
    if (!(await hasLiveConfig(moduleType))) missingModules.push(moduleType);
  }

  const sttLive = (await getAllSTTConfigs()).filter(c => !c.deleted_at);
  const hasTranscription = sttLive.some(c => (c.transcription_provider ?? '') !== '');
  const hasVad = sttLive.some(c => (c.vad_provider ?? '') !== '');
  const needStt = !hasTranscription || !hasVad;

  if (missingModules.length === 0 && !needStt) {
    await writeGuard(guardKey);
    return;
  }

  const models = await fetchGatewayModels(paseto);

  for (const moduleType of missingModules) {
    const model = selectModel(models, MODULE_MODEL_TYPE[moduleType], moduleType);
    if (!model) continue; // skip-when-no-model (imagination-style)
    await createDefaultModuleConfig(moduleType, accountId, model);
  }

  if (needStt) {
    const txModel = selectModel(models, 'stt', 'stt');
    const vadModel = selectModel(models, 'vad', 'vad');
    if (txModel || vadModel) {
      await createDefaultSTTConfig(accountId, txModel, vadModel);
    }
  }

  await writeGuard(guardKey);
}

/** True when at least one live config of the module type exists. */
async function hasLiveConfig(moduleType: string): Promise<boolean> {
  let configs: Array<{ deleted_at?: Date | null }>;
  switch (moduleType) {
    case 'backend':
      configs = await getAllBackendConfigs();
      break;
    case 'cognition':
      configs = await getAllCognitionConfigs();
      break;
    case 'movement':
      configs = await getAllMovementConfigs();
      break;
    case 'rag':
      configs = await getAllRAGConfigs();
      break;
    case 'tts':
      configs = await getAllTTSConfigs();
      break;
    case 'vision':
      configs = await getAllVisionConfigs();
      break;
    default:
      return false;
  }
  return configs.some(c => !c.deleted_at);
}

/**
 * Fetch the gateway's model catalog (the discovery recipe for soulbitscloud).
 * A transport failure or an engine-reported listing error degrades to `[]` so
 * the caller falls back to the static `SOULBITS_FALLBACK_MODELS` constants.
 */
async function fetchGatewayModels(paseto: string): Promise<ModelInfoDto[]> {
  try {
    const res = await engineApiClient.listProviderModels({
      type: SOULBITS,
      api_key: paseto,
      base_url: CLOUD_HOSTS.inference,
    });
    if (res?.error) return [];
    return res?.models ?? [];
  } catch (error) {
    log.warn('Gateway model fetch failed — using static fallbacks:', error);
    return [];
  }
}

/**
 * Select a default model id from the gateway metadata (`meta.model_type` +
 * `meta.min_tier`, 4-12/5-1), preferring the free tier, and fall back to the
 * app's static `SOULBITS_FALLBACK_MODELS` list when the gateway offers no match.
 */
function selectModel(
  models: ModelInfoDto[],
  expectedType: string,
  fallbackModule: string,
): string | null {
  const matching = models.filter(m => String(m.meta?.model_type ?? '') === expectedType);
  const free = matching.find(m => String(m.meta?.min_tier ?? '') === 'free');
  const chosen = free ?? matching[0];
  if (chosen?.id) return chosen.id;

  return getFallbackModelsForModule(fallbackModule)[0] ?? null;
}

// ── Default-config builders ─────────────────────────────────────────────

/** Localized default-config name ("Soulbits Cloud (default)"). */
function defaultConfigName(): string {
  return i18n.t('providers:defaultConfigName');
}

/** The soulbitscloud capability overlay with the selected model applied. */
function capabilityJson(model: string): string {
  const overlay = capabilityDefaultsOf(SOULBITS, PROVIDER_DEFAULTS[SOULBITS] ?? {});
  return JSON.stringify({ ...overlay, model });
}

/** Create `Soulbits Cloud (default)` for a single-provider module type. */
async function createDefaultModuleConfig(
  moduleType: string,
  accountId: string,
  model: string,
): Promise<void> {
  const name = defaultConfigName();
  const capability_json = capabilityJson(model);

  switch (moduleType) {
    case 'backend':
      await createBackendConfig({ name, provider: SOULBITS, provider_account_id: accountId, capability_json });
      return;
    case 'cognition':
      await createCognitionConfig({
        name,
        provider: SOULBITS,
        provider_account_id: accountId,
        capability_json,
        max_cognition_events: MODULE_DEFAULTS.cognition.max_cognition_events,
        generate_expressions: MODULE_DEFAULTS.cognition.generate_expressions,
      });
      return;
    case 'movement':
      await createMovementConfig({
        name,
        provider: SOULBITS,
        provider_account_id: accountId,
        capability_json,
        startup_sync_timeout: MODULE_DEFAULTS.movement.startup_sync_timeout,
        execution_threshold: MODULE_DEFAULTS.movement.execution_threshold,
      });
      return;
    case 'rag':
      await createRAGConfig({
        name,
        provider: SOULBITS,
        provider_account_id: accountId,
        capability_json,
        embedding_concurrency: MODULE_DEFAULTS.rag.embedding_concurrency,
      });
      return;
    case 'tts':
      await createTTSConfig({
        name,
        provider: SOULBITS,
        provider_account_id: accountId,
        capability_json,
        output_type: MODULE_DEFAULTS.tts.output_type,
        words_to_replace: MODULE_DEFAULTS.tts.words_to_replace,
        vocalize_nonverbal: MODULE_DEFAULTS.tts.vocalize_nonverbal,
      });
      return;
    case 'vision':
      await createVisionConfig({
        name,
        provider: SOULBITS,
        provider_account_id: accountId,
        capability_json,
        resolution_width: MODULE_DEFAULTS.vision.resolution_width,
        resolution_height: MODULE_DEFAULTS.vision.resolution_height,
      });
      return;
    default:
      return;
  }
}

/**
 * Create `Soulbits Cloud (default)` for the STT module with BOTH slots filled
 * (transcription + VAD, VAD = `silero-vad` per A8). Called when either slot is
 * uncovered; the existing configs are never touched.
 */
async function createDefaultSTTConfig(
  accountId: string,
  txModel: string | null,
  vadModel: string | null,
): Promise<void> {
  const name = defaultConfigName();
  const stt = MODULE_DEFAULTS.stt;

  await createSTTConfig({
    name,
    main_stream_time_millis: stt.main_stream_time_millis,
    transition_stream_time_millis: stt.transition_stream_time_millis,
    max_buffer_count: stt.max_buffer_count,
    transcription_provider: SOULBITS,
    transcription_provider_account_id: accountId,
    transcription_capability_json: capabilityJson(txModel ?? ''),
    vad_provider: SOULBITS,
    vad_provider_account_id: accountId,
    vad_capability_json: capabilityJson(vadModel ?? ''),
  });
}

// ── Persisted guard ─────────────────────────────────────────────────────

async function readGuard(key: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(key)) !== null;
  } catch {
    // A storage failure must not block the scan; treat as "not done".
    return false;
  }
}

async function writeGuard(key: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key, '1');
  } catch {
    // Best-effort — a failed write only means the scan re-runs next trigger.
  }
}
