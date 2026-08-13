/**
 * SoulbitsDefaultConfigService — "name-only" AI partner bootstrap.
 *
 * When a user creates an AI partner on the Create AI screen without touching
 * the Advanced section, this service transparently creates a full Soulbits
 * Cloud configuration in the background so chatting works out of the box:
 *
 *   - ONE SoulbitsCloud provider config per module (each carries the model
 *     appropriate for that module's purpose — LLM for backend/cognition/
 *     movement/vision, embeddings for RAG, TTS voices for tts, Whisper for
 *     stt, silero-vad for the STT VAD slot).
 *   - ONE module config per table (backend/cognition/movement/rag/tts/stt/
 *     vision/imagination) referencing the matching provider config.
 *
 * Every lookup is by name, so repeated calls are idempotent — running the
 * default bootstrap twice reuses the already-created rows instead of
 * duplicating them (module-config tables have a UNIQUE name constraint).
 *
 * The service never throws for "already exists": it checks-then-creates.
 * Failures are reported via the returned per-module result (null id), letting
 * the caller decide whether to proceed with partial defaults.
 */

import { PROVIDER_DEFAULTS } from '../constants/moduleDefaults';
import { getFallbackModelsForModule } from '../constants/soulbitsModels';
import { injectSoulbitsToken } from './cloud/soulbitsTokenSync';
import {
  createBackendConfig,
  getBackendConfigByName,
  createCognitionConfig,
  getCognitionConfigByName,
  createMovementConfig,
  getMovementConfigByName,
  createRAGConfig,
  getRAGConfigByName,
  createTTSConfig,
  getTTSConfigByName,
  createSTTConfig,
  getSTTConfigByName,
  createVisionConfig,
  getVisionConfigByName,
  createImaginationConfig,
  getImaginationConfigByName,
} from '../database/repositories/modules';
import {
  createSoulbitsCloudProviderConfig,
  getSoulbitsCloudProviderConfigByName,
} from '../database/repositories/providers/SoulbitsCloudProviderConfigRepository';
import type { SoulbitsCloudProviderConfig } from '../database/models';
import { createLogger } from '../utils/logger';

const log = createLogger('[SoulbitsDefaultConfigService]');

/** Base name shared by every auto-created module config. */
export const DEFAULT_CONFIG_NAME = 'Soulbits Cloud (default)';

/**
 * Provider-config name per module slot. Each module gets its OWN provider
 * config (matching how the module-config editor saves per-module providers)
 * so the model field is correct for that module's purpose.
 */
function providerNameFor(module: string): string {
  return `${DEFAULT_CONFIG_NAME} (${module})`;
}

/**
 * Default model per module slot. Mirrors the first entry of
 * `SOULBITS_FALLBACK_MODELS` for each module (the free-tier default);
 * `stt` gets the Whisper model and the VAD slot gets silero-vad.
 */
function defaultModelFor(module: string): string {
  const fallbacks = getFallbackModelsForModule(module);
  return fallbacks[0] ?? 'qwen-35-9b';
}

/** Per-module results of the default bootstrap (null = not created/enabled). */
export interface SoulbitsDefaultsResult {
  backendConfigId: string | null;
  cognitionConfigId: string | null;
  movementConfigId: string | null;
  ragConfigId: string | null;
  ttsConfigId: string | null;
  sttConfigId: string | null;
  visionConfigId: string | null;
  imaginationConfigId: string | null;
}

const EMPTY_RESULT: SoulbitsDefaultsResult = {
  backendConfigId: null,
  cognitionConfigId: null,
  movementConfigId: null,
  ragConfigId: null,
  ttsConfigId: null,
  sttConfigId: null,
  visionConfigId: null,
  imaginationConfigId: null,
};

/**
 * Create (or reuse) the SoulbitsCloud provider config for a module slot.
 * New rows are seeded with the current cloud PASETO as api_key via
 * `injectSoulbitsToken`. Returns the provider config id, or null on failure.
 */
async function ensureProviderConfig(
  module: string,
): Promise<string | null> {
  const name = providerNameFor(module);
  try {
    const existing = await getSoulbitsCloudProviderConfigByName(name);
    if (existing) return existing.id;

    const model = defaultModelFor(module);
    // Spread the provider defaults so every column the create function writes
    // is present, then override name/model. api_key is injected for new rows.
    const base = {
      ...PROVIDER_DEFAULTS.soulbitscloud,
      name,
      model,
    };
    const seeded = (await injectSoulbitsToken({
      providerType: 'soulbitscloud',
      isCreate: true,
      providerConfig: base,
    })) as Omit<SoulbitsCloudProviderConfig, 'id' | 'deleted_at'>;
    return await createSoulbitsCloudProviderConfig(seeded);
  } catch (err) {
    log.error(`Failed to ensure soulbitscloud provider config for ${module}:`, err);
    return null;
  }
}

/**
 * Create (or reuse) a module config for a standard (single-provider) module,
 * pointing it at the given soulbitscloud provider config.
 */
async function ensureStandardModuleConfig(
  module: 'backend' | 'cognition' | 'movement' | 'rag' | 'tts' | 'vision' | 'imagination',
  providerConfigId: string,
): Promise<string | null> {
  try {
    const existing = await getModuleConfigByName(module);
    if (existing) return existing.id;

    switch (module) {
      case 'backend':
        return await createBackendConfig({
          name: DEFAULT_CONFIG_NAME,
          provider: 'soulbitscloud',
          provider_config_id: providerConfigId,
        });
      case 'cognition':
        return await createCognitionConfig({
          name: DEFAULT_CONFIG_NAME,
          provider: 'soulbitscloud',
          provider_config_id: providerConfigId,
          max_cognition_events: 10,
          generate_expressions: 0,
        });
      case 'movement':
        return await createMovementConfig({
          name: DEFAULT_CONFIG_NAME,
          provider: 'soulbitscloud',
          provider_config_id: providerConfigId,
          startup_sync_timeout: 0,
          execution_threshold: 0,
        });
      case 'rag':
        return await createRAGConfig({
          name: DEFAULT_CONFIG_NAME,
          provider: 'soulbitscloud',
          provider_config_id: providerConfigId,
          embedding_concurrency: 0,
        });
      case 'tts':
        return await createTTSConfig({
          name: DEFAULT_CONFIG_NAME,
          provider: 'soulbitscloud',
          provider_config_id: providerConfigId,
          output_type: '',
          words_to_replace: '',
          vocalize_nonverbal: 0,
        });
      case 'vision':
        return await createVisionConfig({
          name: DEFAULT_CONFIG_NAME,
          provider: 'soulbitscloud',
          provider_config_id: providerConfigId,
          resolution_width: 1024,
          resolution_height: 1024,
        });
      case 'imagination':
        return await createImaginationConfig({
          name: DEFAULT_CONFIG_NAME,
          provider: 'soulbitscloud',
          provider_config_id: providerConfigId,
        });
    }
  } catch (err) {
    log.error(`Failed to ensure ${module} config:`, err);
    return null;
  }
}

/** Look up an existing module config row by the default name, per table. */
async function getModuleConfigByName(
  module: 'backend' | 'cognition' | 'movement' | 'rag' | 'tts' | 'vision' | 'imagination',
): Promise<{ id: string } | null> {
  switch (module) {
    case 'backend':
      return getBackendConfigByName(DEFAULT_CONFIG_NAME);
    case 'cognition':
      return getCognitionConfigByName(DEFAULT_CONFIG_NAME);
    case 'movement':
      return getMovementConfigByName(DEFAULT_CONFIG_NAME);
    case 'rag':
      return getRAGConfigByName(DEFAULT_CONFIG_NAME);
    case 'tts':
      return getTTSConfigByName(DEFAULT_CONFIG_NAME);
    case 'vision':
      return getVisionConfigByName(DEFAULT_CONFIG_NAME);
    case 'imagination':
      return getImaginationConfigByName(DEFAULT_CONFIG_NAME);
  }
}

/**
 * Create (or reuse) the STT module config. STT has TWO provider slots —
 * transcription (Whisper) and VAD (silero-vad) — each backed by its own
 * soulbitscloud provider config.
 */
async function ensureSTTConfig(
  transcriptionProviderConfigId: string,
  vadProviderConfigId: string,
): Promise<string | null> {
  try {
    const existing = await getSTTConfigByName(DEFAULT_CONFIG_NAME);
    if (existing) return existing.id;

    return await createSTTConfig({
      name: DEFAULT_CONFIG_NAME,
      main_stream_time_millis: 2000,
      transition_stream_time_millis: 1000,
      max_buffer_count: 5,
      transcription_provider: 'soulbitscloud',
      transcription_provider_config_id: transcriptionProviderConfigId,
      vad_provider: 'soulbitscloud',
      vad_provider_config_id: vadProviderConfigId,
    });
  } catch (err) {
    log.error('Failed to ensure stt config:', err);
    return null;
  }
}

/**
 * Bootstrap the full Soulbits Cloud default configuration for an AI partner.
 *
 * Idempotent: existing configs (matched by name) are reused. Any per-module
 * failure is isolated — the other modules still get created, and the failed
 * module returns null in the result so the caller can continue with partial
 * defaults (e.g. an offline app still gets a chat-capable backend config).
 */
export async function ensureSoulbitsDefaultConfigs(): Promise<SoulbitsDefaultsResult> {
  const result: SoulbitsDefaultsResult = { ...EMPTY_RESULT };

  // 1. Standard modules — each needs its own provider config.
  const standardModules = [
    'backend',
    'cognition',
    'movement',
    'rag',
    'tts',
    'vision',
    'imagination',
  ] as const;

  await Promise.all(
    standardModules.map(async module => {
      const providerId = await ensureProviderConfig(module);
      if (!providerId) return;
      const configId = await ensureStandardModuleConfig(module, providerId);
      if (!configId) return;
      switch (module) {
        case 'backend':
          result.backendConfigId = configId;
          break;
        case 'cognition':
          result.cognitionConfigId = configId;
          break;
        case 'movement':
          result.movementConfigId = configId;
          break;
        case 'rag':
          result.ragConfigId = configId;
          break;
        case 'tts':
          result.ttsConfigId = configId;
          break;
        case 'vision':
          result.visionConfigId = configId;
          break;
        case 'imagination':
          result.imaginationConfigId = configId;
          break;
      }
    }),
  );

  // 2. STT — transcription + VAD provider slots, then the module config.
  const [txProviderId, vadProviderId] = await Promise.all([
    ensureProviderConfig('stt'),
    ensureProviderConfig('vad'),
  ]);
  if (txProviderId && vadProviderId) {
    result.sttConfigId = await ensureSTTConfig(txProviderId, vadProviderId);
  }

  return result;
}
