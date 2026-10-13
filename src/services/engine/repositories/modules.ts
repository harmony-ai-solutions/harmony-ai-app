/**
 * Module configs — management-API-backed repository adapter (task 3-2 reads,
 * task 3-4 relink: composite↔flat mapper + writes; owner ruling 2).
 *
 * The engine's module-config read/write shape is **composite**:
 *   `{ id, name, provider, <providerType>: { …resolved provider config… }, … }`
 * (one nested field per provider family; module-level scalar fields are
 * top-level). The app's domain models are **flat** (`provider_config_id` +
 * module scalars). This adapter maps both ways:
 *
 *   - read  → flat (`provider_config_id` = the nested provider config's `id`)
 *   - write → `{ name, config }` where `config` is the composite, with the
 *             nested provider config resolved from `provider_config_id` via
 *             `GET /api/providers/:id`.
 *
 * NOTE (engine contract): `POST /api/module-configs/:module` creates a NEW
 * provider config from the nested config (the engine owns a 1:1
 * module→provider relationship). The app's separately-created provider config
 * is therefore superseded on create; reads thereafter report the engine-minted
 * provider_config_id.
 */

import type {
  BackendConfig,
  CognitionConfig,
  ImaginationConfig,
  MovementConfig,
  RAGConfig,
  STTConfig,
  TTSConfig,
  VisionConfig,
} from '../../../database/models';
import { engineApiClient } from '../EngineApiClient';
import { EngineApiError } from '../EngineApiClient';

type Composite = Record<string, any>;

function coerceDeleted(cfg: Composite): Date | null {
  return typeof cfg.deleted_at === 'string' ? new Date(cfg.deleted_at) : null;
}

/** Composite engine config → the app's flat module row. */
function compositeToFlat(module: string, c: Composite): Composite {
  const provider: string = c.provider ?? '';
  const nested: Composite | undefined = provider ? c[provider] : undefined;
  const flat: Composite = {
    id: c.id ?? '',
    name: c.name ?? '',
    provider,
    provider_config_id: nested?.id ?? null,
    deleted_at: coerceDeleted(c),
  };
  switch (module) {
    case 'cognition':
      flat.max_cognition_events = c.maxcognitionevents ?? null;
      flat.generate_expressions = c.generateexpressions ?? null;
      break;
    case 'movement':
      flat.startup_sync_timeout = c.startupsynctimeout ?? null;
      flat.execution_threshold = c.executionthreshold ?? null;
      break;
    case 'rag':
      flat.embedding_concurrency = c.chromem?.embeddingconcurrency ?? null;
      break;
    case 'tts':
      flat.output_type = c.outputtype ?? null;
      flat.words_to_replace =
        typeof c.wordstoreplace === 'string'
          ? c.wordstoreplace
          : JSON.stringify(c.wordstoreplace ?? {});
      flat.vocalize_nonverbal = c.vocalizenonverbal ? 1 : 0;
      break;
    case 'vision':
      flat.resolution_width = c.resolutionwidth ?? 0;
      flat.resolution_height = c.resolutionheight ?? 0;
      break;
    case 'stt': {
      const sr = c.streamrecording ?? {};
      flat.main_stream_time_millis = sr.mainstreamtimemillis ?? null;
      flat.transition_stream_time_millis = sr.transitionstreamtimemillis ?? null;
      flat.max_buffer_count = sr.maxbuffercount ?? null;
      const tx = c.transcription ?? {};
      flat.transcription_provider = tx.provider ?? '';
      flat.transcription_provider_config_id = tx.provider ? tx[tx.provider]?.id ?? null : null;
      const vad = c.vad ?? {};
      flat.vad_provider = vad.provider ?? '';
      flat.vad_provider_config_id = vad.provider ? vad[provider0(vad)]?.id ?? null : null;
      break;
    }
    default:
      break;
  }
  return flat;
}

/** The VAD nested key equals its provider name (identity map). */
function provider0(vad: Composite): string {
  return vad.provider ?? '';
}

/** Resolve the nested provider config for a flat row's provider_config_id. */
async function resolveProviderConfig(id: string | null | undefined): Promise<Composite | null> {
  if (!id) return null;
  try {
    const res = await engineApiClient.getProvider(id);
    const cfg = res.config as Composite | null;
    if (!cfg) return null;
    const { deleted_at: _d, ...rest } = cfg;
    return rest;
  } catch (e) {
    if (e instanceof EngineApiError && e.isNotFound) return null;
    throw e;
  }
}

/** Flat app module row → the engine's `{name, config}` write body. */
async function flatToWriteBody(
  module: string,
  flat: Composite,
): Promise<{ name: string; config: Composite }> {
  const provider: string = flat.provider ?? '';
  const config: Composite = { name: flat.name ?? '', provider };

  const nested = await resolveProviderConfig(flat.provider_config_id);
  if (nested && provider) config[provider] = nested;

  switch (module) {
    case 'cognition':
      config.maxcognitionevents = flat.max_cognition_events ?? 0;
      config.generateexpressions = !!flat.generate_expressions;
      break;
    case 'movement':
      config.startupsynctimeout = flat.startup_sync_timeout ?? 0;
      config.executionthreshold = flat.execution_threshold ?? 0;
      break;
    case 'rag':
      config.chromem = { embeddingconcurrency: flat.embedding_concurrency ?? 0 };
      break;
    case 'tts':
      config.outputtype = flat.output_type ?? '';
      config.wordstoreplace =
        typeof flat.words_to_replace === 'string' && flat.words_to_replace
          ? safeParse(flat.words_to_replace)
          : {};
      config.vocalizenonverbal = !!flat.vocalize_nonverbal;
      break;
    case 'vision':
      config.resolutionwidth = flat.resolution_width ?? 0;
      config.resolutionheight = flat.resolution_height ?? 0;
      break;
    case 'stt': {
      config.streamrecording = {
        mainstreamtimemillis: flat.main_stream_time_millis ?? 0,
        transitionstreamtimemillis: flat.transition_stream_time_millis ?? 0,
        maxbuffercount: flat.max_buffer_count ?? 0,
      };
      const txNested = await resolveProviderConfig(flat.transcription_provider_config_id);
      const tx: Composite = { provider: flat.transcription_provider ?? '' };
      if (txNested && flat.transcription_provider) tx[flat.transcription_provider] = txNested;
      config.transcription = tx;
      const vadNested = await resolveProviderConfig(flat.vad_provider_config_id);
      const vad: Composite = { provider: flat.vad_provider ?? '' };
      if (vadNested && flat.vad_provider) vad[flat.vad_provider] = vadNested;
      config.vad = vad;
      break;
    }
    default:
      break;
  }
  return { name: flat.name ?? '', config };
}

function safeParse(json: string): Record<string, string> {
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

// ── Read factory ─────────────────────────────────────────────────────────

function makeModuleReads<T>(module: string) {
  const getAll = async (_includeDeleted = false): Promise<T[]> =>
    ((await engineApiClient.listModuleConfigs(module)) as Composite[]).map(
      c => compositeToFlat(module, c) as unknown as T,
    );
  return {
    get: async (id: string, _includeDeleted = false): Promise<T | null> => {
      try {
        return compositeToFlat(module, (await engineApiClient.getModuleConfig(module, id)) as Composite) as unknown as T;
      } catch (e) {
        if (e instanceof EngineApiError && e.isNotFound) return null;
        throw e;
      }
    },
    getAll,
    getByName: async (name: string, _includeDeleted = false): Promise<T | null> =>
      (await getAll()).find(c => (c as { name?: string }).name === name) ?? null,
  };
}

// ── Write factory ────────────────────────────────────────────────────────

/**
 * In-use derivation: the engine has no in-use read; a module config is "in use"
 * when any live entity's resolved module mapping references its id.
 */
async function moduleInUse(module: string, id: string): Promise<boolean> {
  try {
    const map = await engineApiClient.listEntities();
    for (const entityId of Object.keys(map)) {
      const cfg = await engineApiClient.getEntityConfig(entityId);
      const modules = (cfg.modules ?? {}) as Record<string, { id?: string } | undefined>;
      if (modules[module]?.id === id) return true;
    }
  } catch {
    // Best-effort — the engine delete route remains the authoritative guard.
  }
  return false;
}

function makeModuleApi<T extends { id: string; name: string }>(module: string) {
  return {
    create: async (config: Omit<T, 'id' | 'deleted_at'>): Promise<string> => {
      const body = await flatToWriteBody(module, config as Composite);
      const res = await engineApiClient.createModuleConfig(module, body);
      return res.id;
    },
    update: async (config: T): Promise<void> => {
      const body = await flatToWriteBody(module, config as Composite);
      await engineApiClient.updateModuleConfig(module, config.id, body);
    },
    delete: async (id: string): Promise<void> => {
      if (await moduleInUse(module, id)) {
        throw new Error(`${module} config ${id} is in use and cannot be soft deleted`);
      }
      await engineApiClient.deleteModuleConfig(module, id);
    },
    isInUse: (id: string): Promise<boolean> => moduleInUse(module, id),
  };
}

// ── Backend ──────────────────────────────────────────────────────────────

const backendReads = makeModuleReads<BackendConfig>('backend');
export const getBackendConfig = backendReads.get;
export const getAllBackendConfigs = backendReads.getAll;
export const getBackendConfigByName = backendReads.getByName;
const backendApi = makeModuleApi<BackendConfig>('backend');
export const createBackendConfig = backendApi.create;
export const updateBackendConfig = backendApi.update;
export const deleteBackendConfig = backendApi.delete;
export const isBackendConfigInUse = backendApi.isInUse;

// ── Cognition ────────────────────────────────────────────────────────────

const cognitionReads = makeModuleReads<CognitionConfig>('cognition');
export const getCognitionConfig = cognitionReads.get;
export const getAllCognitionConfigs = cognitionReads.getAll;
export const getCognitionConfigByName = cognitionReads.getByName;
const cognitionApi = makeModuleApi<CognitionConfig>('cognition');
export const createCognitionConfig = cognitionApi.create;
export const updateCognitionConfig = cognitionApi.update;
export const deleteCognitionConfig = cognitionApi.delete;
export const isCognitionConfigInUse = cognitionApi.isInUse;

// ── Movement ─────────────────────────────────────────────────────────────

const movementReads = makeModuleReads<MovementConfig>('movement');
export const getMovementConfig = movementReads.get;
export const getAllMovementConfigs = movementReads.getAll;
export const getMovementConfigByName = movementReads.getByName;
const movementApi = makeModuleApi<MovementConfig>('movement');
export const createMovementConfig = movementApi.create;
export const updateMovementConfig = movementApi.update;
export const deleteMovementConfig = movementApi.delete;
export const isMovementConfigInUse = movementApi.isInUse;

// ── RAG ──────────────────────────────────────────────────────────────────

const ragReads = makeModuleReads<RAGConfig>('rag');
export const getRAGConfig = ragReads.get;
export const getAllRAGConfigs = ragReads.getAll;
export const getRAGConfigByName = ragReads.getByName;
const ragApi = makeModuleApi<RAGConfig>('rag');
export const createRAGConfig = ragApi.create;
export const updateRAGConfig = ragApi.update;
export const deleteRAGConfig = ragApi.delete;
export const isRAGConfigInUse = ragApi.isInUse;

// ── STT ──────────────────────────────────────────────────────────────────

const sttReads = makeModuleReads<STTConfig>('stt');
export const getSTTConfig = sttReads.get;
export const getAllSTTConfigs = sttReads.getAll;
export const getSTTConfigByName = sttReads.getByName;
const sttApi = makeModuleApi<STTConfig>('stt');
export const createSTTConfig = sttApi.create;
export const updateSTTConfig = sttApi.update;
export const deleteSTTConfig = sttApi.delete;
export const isSTTConfigInUse = sttApi.isInUse;

// ── TTS ──────────────────────────────────────────────────────────────────

const ttsReads = makeModuleReads<TTSConfig>('tts');
export const getTTSConfig = ttsReads.get;
export const getAllTTSConfigs = ttsReads.getAll;
export const getTTSConfigByName = ttsReads.getByName;
const ttsApi = makeModuleApi<TTSConfig>('tts');
export const createTTSConfig = ttsApi.create;
export const updateTTSConfig = ttsApi.update;
export const deleteTTSConfig = ttsApi.delete;
export const isTTSConfigInUse = ttsApi.isInUse;

// ── Vision ───────────────────────────────────────────────────────────────

const visionReads = makeModuleReads<VisionConfig>('vision');
export const getVisionConfig = visionReads.get;
export const getAllVisionConfigs = visionReads.getAll;
export const getVisionConfigByName = visionReads.getByName;
const visionApi = makeModuleApi<VisionConfig>('vision');
export const createVisionConfig = visionApi.create;
export const updateVisionConfig = visionApi.update;
export const deleteVisionConfig = visionApi.delete;
export const isVisionConfigInUse = visionApi.isInUse;

// ── Imagination ──────────────────────────────────────────────────────────

const imaginationReads = makeModuleReads<ImaginationConfig>('imagination');
export const getImaginationConfig = imaginationReads.get;
export const getAllImaginationConfigs = imaginationReads.getAll;
export const getImaginationConfigByName = imaginationReads.getByName;
const imaginationApi = makeModuleApi<ImaginationConfig>('imagination');
export const createImaginationConfig = imaginationApi.create;
export const updateImaginationConfig = imaginationApi.update;
export const deleteImaginationConfig = imaginationApi.delete;
export const isImaginationConfigInUse = imaginationApi.isInUse;
