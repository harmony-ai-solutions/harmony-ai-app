/**
 * Module configs — management-API-backed repository adapter (provider-registry
 * 6-1; the 6-1 interim adapter retired in 6-3; originally task 3-2 reads, task
 * 3-4 relink).
 *
 * The engine's module-config **read** stays COMPOSITE:
 *   `{ id, name, provider, provider_account_id, <providerType>: { …merged account
 *      + overlay config… }, … }` (one nested field per provider family; the
 *   merged provider object carries the account id under its top-level `id`).
 * The engine's **write** shape is FLAT (3-2): `{name, provider,
 * provider_account_id, capability_json, …module fields}` (stt carries two slots
 * under `transcription`/`vad`). The app's domain models are flat too — the
 * account FK + the capability overlay alongside the module scalars.
 *
 *   - read  → flat (`provider_account_id` = the nested merged object's `id`;
 *             `capability_json` = the merged object minus the account fields —
 *             see `accountFieldSchemas.capabilityOverlayOf`)
 *   - write → flat `{name, provider, provider_account_id, capability_json, …}`.
 *             The capability overlay is taken straight from the flat row (the
 *             module-config form edits it directly — 6-3 removed the adapter's
 *             pending-capability stash).
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
import type { ModuleConfigWriteDto } from '../EngineApiClient';
import { capabilityOverlayOf } from '../../../constants/accountFieldSchemas';

type Composite = Record<string, any>;

function coerceDeleted(cfg: Composite): Date | null {
  return typeof cfg.deleted_at === 'string' ? new Date(cfg.deleted_at) : null;
}

/** Parse a capability overlay (JSON string or object) into a plain object. */
function parseCapability(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') return { ...(value as Record<string, unknown>) };
  if (typeof value === 'string' && value.trim() !== '') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

/** JSON-stringify a capability overlay (stable `'{}'` for empty). */
function capabilityJsonString(value: unknown): string {
  const overlay = parseCapability(value);
  return Object.keys(overlay).length > 0 ? JSON.stringify(overlay) : '{}';
}

/** Composite engine config → the app's flat module row. */
function compositeToFlat(module: string, c: Composite): Composite {
  const provider: string = c.provider ?? '';
  const nested: Composite | undefined = provider ? c[provider] : undefined;
  const accountId = nested?.id ?? c.provider_account_id ?? null;
  const flat: Composite = {
    id: c.id ?? '',
    name: c.name ?? '',
    provider,
    provider_account_id: accountId,
    capability_json: capabilityJsonString(capabilityOverlayOf(provider, nested ?? {})),
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
      const txNested = tx.provider ? tx[tx.provider] : undefined;
      flat.transcription_provider_account_id = txNested?.id ?? tx.provider_account_id ?? null;
      flat.transcription_capability_json = capabilityJsonString(
        capabilityOverlayOf(tx.provider ?? '', txNested ?? {}),
      );
      const vad = c.vad ?? {};
      flat.vad_provider = vad.provider ?? '';
      const vadNested = vad.provider ? vad[vad.provider] : undefined;
      flat.vad_provider_account_id = vadNested?.id ?? vad.provider_account_id ?? null;
      flat.vad_capability_json = capabilityJsonString(
        capabilityOverlayOf(vad.provider ?? '', vadNested ?? {}),
      );
      break;
    }
    default:
      break;
  }
  return flat;
}

/** Flat app module row → the engine's flat `{name, provider, …}` write body. */
function flatToWriteBody(module: string, flat: Composite): ModuleConfigWriteDto {
  const provider: string = flat.provider ?? '';
  const accountId: string | null = flat.provider_account_id ?? null;
  const capability = parseCapability(flat.capability_json);

  const body: ModuleConfigWriteDto = { name: flat.name ?? '', provider };
  if (accountId) body.provider_account_id = accountId;
  if (Object.keys(capability).length > 0) body.capability_json = capability;

  switch (module) {
    case 'cognition':
      body.maxcognitionevents = flat.max_cognition_events ?? 0;
      body.generateexpressions = !!flat.generate_expressions;
      break;
    case 'movement':
      body.startupsynctimeout = flat.startup_sync_timeout ?? 0;
      body.executionthreshold = flat.execution_threshold ?? 0;
      break;
    case 'rag':
      body.chromem = { embeddingconcurrency: flat.embedding_concurrency ?? 0 };
      break;
    case 'tts':
      body.outputtype = flat.output_type ?? '';
      body.wordstoreplace =
        typeof flat.words_to_replace === 'string' && flat.words_to_replace
          ? safeParse(flat.words_to_replace)
          : {};
      body.vocalizenonverbal = !!flat.vocalize_nonverbal;
      break;
    case 'vision':
      body.resolutionwidth = flat.resolution_width ?? 0;
      body.resolutionheight = flat.resolution_height ?? 0;
      break;
    case 'stt': {
      body.streamrecording = {
        mainstreamtimemillis: flat.main_stream_time_millis ?? 0,
        transitionstreamtimemillis: flat.transition_stream_time_millis ?? 0,
        maxbuffercount: flat.max_buffer_count ?? 0,
      };
      const txAccountId: string | null = flat.transcription_provider_account_id ?? null;
      const tx: Composite = { provider: flat.transcription_provider ?? '' };
      if (txAccountId) tx.provider_account_id = txAccountId;
      const txCap = parseCapability(flat.transcription_capability_json);
      if (Object.keys(txCap).length > 0) tx.capability_json = txCap;
      body.transcription = tx;

      const vadAccountId: string | null = flat.vad_provider_account_id ?? null;
      const vad: Composite = { provider: flat.vad_provider ?? '' };
      if (vadAccountId) vad.provider_account_id = vadAccountId;
      const vadCap = parseCapability(flat.vad_capability_json);
      if (Object.keys(vadCap).length > 0) vad.capability_json = vadCap;
      body.vad = vad;
      break;
    }
    default:
      break;
  }
  return body;
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
      const body = flatToWriteBody(module, config as Composite);
      const res = await engineApiClient.createModuleConfig(module, body);
      return res.id;
    },
    update: async (config: T): Promise<void> => {
      const body = flatToWriteBody(module, config as Composite);
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
