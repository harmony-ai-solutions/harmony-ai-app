/**
 * Providers — management-API-backed repository adapter (task 3-2 reads, task
 * 3-4 writes).
 *
 * Read surface backed by `GET /api/providers` (grouped by type) and
 * `GET /api/providers/:id`. The engine returns the canonical `*Sync` models
 * (snake_case) which line up with the app's provider config models; only
 * `deleted_at` needs coercion (JSON string → `Date | null`).
 *
 * Write surface (3-4 engine follow-up) backed by the standalone provider CRUD
 * routes — 1:1 with the app's 13-repo model:
 *   - create → `POST /api/providers` `{provider, config}` (engine mints the id;
 *     the response `config.id` is returned, matching the SQLite signature).
 *   - update → `PUT /api/providers/:id` `{config}` (partial merge).
 *   - delete → `DELETE /api/providers/:id`; a live reference yields 409
 *     `provider_in_use`, translated to the same in-use error the SQLite repo
 *     threw.
 *
 * `isProviderConfigInUse` has no dedicated engine read; it is derived
 * client-side from the module-config list reads (best-effort), while the DELETE
 * 409 remains the authoritative guard.
 */

import type {
  AnthropicProviderConfig,
  ComfyUIProviderConfig,
  ElevenLabsProviderConfig,
  GoogleProviderConfig,
  SoulvoiceProviderConfig,
  LocalAIProviderConfig,
  MistralProviderConfig,
  OllamaProviderConfig,
  OpenAICompatibleProviderConfig,
  OpenAIProviderConfig,
  OpenRouterProviderConfig,
  SoulbitsCloudProviderConfig,
  XAIProviderConfig,
} from '../../../database/models';
import { engineApiClient } from '../EngineApiClient';
import { EngineApiError } from '../EngineApiClient';
import { CLOUD_HOSTS } from '../../../config/cloud';

function coerce<T>(config: T): T {
  const obj = config as Record<string, unknown>;
  if (obj && typeof obj.deleted_at === 'string') {
    obj.deleted_at = new Date(obj.deleted_at as string);
  }
  return config;
}

async function listType<T>(type: string): Promise<T[]> {
  const res = await engineApiClient.listProviders(type);
  return ((res.providers?.[type] ?? []) as T[]).map(coerce);
}

async function getOne<T>(id: string): Promise<T | null> {
  try {
    const res = await engineApiClient.getProvider(id);
    return coerce(res.config as T);
  } catch (e) {
    if (e instanceof EngineApiError && e.isNotFound) return null;
    throw e;
  }
}

function byName<T>(list: T[], name: string): T | null {
  return list.find(c => (c as { name?: string }).name === name) ?? null;
}

/** Wire body: the config minus its `deleted_at` bookkeeping column. */
function toWireConfig<T>(config: T): Record<string, unknown> {
  const { deleted_at: _deletedAt, ...rest } = config as Record<string, unknown>;
  return rest;
}

/** Wire body for create: also drop the client-side `id` (engine mints it). */
function toWireCreateConfig<T>(config: T): Record<string, unknown> {
  const { id: _id, deleted_at: _deletedAt, ...rest } = config as Record<string, unknown>;
  return rest;
}

/** Translate a provider DELETE failure into the SQLite repo's error surface. */
function translateDeleteError(e: unknown, id: string): Error {
  if (e instanceof EngineApiError) {
    if (e.status === 409) {
      return new Error(
        `Provider config ${id} is in use and cannot be soft deleted`,
      );
    }
    if (e.isNotFound) {
      return new Error(`Provider config not found: ${id}`);
    }
  }
  return e instanceof Error ? e : new Error(String(e));
}

// ── In-use derivation (best-effort; the DELETE 409 is authoritative) ───────

const MODULE_TYPES = [
  'backend',
  'cognition',
  'movement',
  'rag',
  'stt',
  'tts',
  'vision',
  'imagination',
] as const;

/**
 * Derive whether a provider config is referenced by any live module config by
 * scanning the module-config list reads. The engine module-config read inlines
 * the resolved provider config under a `<provider>` key, so a reference is
 * `cfg.provider === providerName && cfg[providerName].id === id` (plus the flat
 * `provider_config_id` when present). Best-effort: any read failure returns
 * false and the DELETE 409 stays the authoritative guard.
 */
export async function isProviderConfigInUse(
  providerName: string,
  id: string,
): Promise<boolean> {
  for (const module of MODULE_TYPES) {
    try {
      const configs = (await engineApiClient.listModuleConfigs(module)) as Array<
        Record<string, unknown>
      >;
      for (const cfg of configs) {
        if (!cfg || typeof cfg !== 'object') continue;
        const nested = cfg[providerName] as { id?: string } | undefined;
        const flatMatch = cfg.provider_config_id === id;
        const nestedMatch = nested?.id === id;
        const providerMatches =
          cfg.provider === providerName ||
          cfg.transcription_provider === providerName ||
          cfg.vad_provider === providerName;
        if (providerMatches && (flatMatch || nestedMatch)) return true;
      }
    } catch {
      // Best-effort — a read failure must not make the check throw.
    }
  }
  return false;
}

/**
 * Build the read + write functions for one provider type. The write signatures
 * mirror the SQLite repositories exactly (create → new id; update → void;
 * delete → void; isInUse → boolean).
 */
function makeProviderApi<T extends { id: string }>(type: string) {
  return {
    get: (id: string, _includeDeleted = false): Promise<T | null> => getOne<T>(id),
    getAll: (_includeDeleted = false): Promise<T[]> => listType<T>(type),
    getByName: async (name: string, _includeDeleted = false): Promise<T | null> =>
      byName(await listType<T>(type), name),

    create: async (config: Omit<T, 'id' | 'deleted_at'>): Promise<string> => {
      const res = await engineApiClient.createProvider(type, toWireCreateConfig(config));
      const created = res.config as { id?: string } | null | undefined;
      if (!created || typeof created.id !== 'string' || created.id === '') {
        throw new Error(
          `Engine did not return an id for the new ${type} provider config`,
        );
      }
      return created.id;
    },

    update: async (config: T): Promise<void> => {
      await engineApiClient.updateProvider(config.id, toWireConfig(config));
    },

    delete: async (id: string): Promise<void> => {
      try {
        await engineApiClient.deleteProvider(id);
      } catch (e) {
        throw translateDeleteError(e, id);
      }
    },

    isInUse: (id: string): Promise<boolean> => isProviderConfigInUse(type, id),
  };
}

const anthropic = makeProviderApi<AnthropicProviderConfig>('anthropic');
export const getAnthropicProviderConfig = anthropic.get;
export const getAllAnthropicProviderConfigs = anthropic.getAll;
export const getAnthropicProviderConfigByName = anthropic.getByName;
export const createAnthropicProviderConfig = anthropic.create;
export const updateAnthropicProviderConfig = anthropic.update;
export const deleteAnthropicProviderConfig = anthropic.delete;
export const isAnthropicProviderConfigInUse = anthropic.isInUse;

const comfyui = makeProviderApi<ComfyUIProviderConfig>('comfyui');
export const getComfyUIProviderConfig = comfyui.get;
export const getAllComfyUIProviderConfigs = comfyui.getAll;
export const getComfyUIProviderConfigByName = comfyui.getByName;
export const createComfyUIProviderConfig = comfyui.create;
export const updateComfyUIProviderConfig = comfyui.update;
export const deleteComfyUIProviderConfig = comfyui.delete;
export const isComfyUIProviderConfigInUse = comfyui.isInUse;

const elevenlabs = makeProviderApi<ElevenLabsProviderConfig>('elevenlabs');
export const getElevenLabsProviderConfig = elevenlabs.get;
export const getAllElevenLabsProviderConfigs = elevenlabs.getAll;
export const getElevenLabsProviderConfigByName = elevenlabs.getByName;
export const createElevenLabsProviderConfig = elevenlabs.create;
export const updateElevenLabsProviderConfig = elevenlabs.update;
export const deleteElevenLabsProviderConfig = elevenlabs.delete;
export const isElevenLabsProviderConfigInUse = elevenlabs.isInUse;

const google = makeProviderApi<GoogleProviderConfig>('google');
export const getGoogleProviderConfig = google.get;
export const getAllGoogleProviderConfigs = google.getAll;
export const getGoogleProviderConfigByName = google.getByName;
export const createGoogleProviderConfig = google.create;
export const updateGoogleProviderConfig = google.update;
export const deleteGoogleProviderConfig = google.delete;
export const isGoogleProviderConfigInUse = google.isInUse;

const soulvoice = makeProviderApi<SoulvoiceProviderConfig>('soulvoice');
export const getSoulvoiceProviderConfig = soulvoice.get;
export const getAllSoulvoiceProviderConfigs = soulvoice.getAll;
export const getSoulvoiceProviderConfigByName = soulvoice.getByName;
export const createSoulvoiceProviderConfig = soulvoice.create;
export const updateSoulvoiceProviderConfig = soulvoice.update;
export const deleteSoulvoiceProviderConfig = soulvoice.delete;
export const isSoulvoiceProviderConfigInUse = soulvoice.isInUse;

const localai = makeProviderApi<LocalAIProviderConfig>('localai');
export const getLocalAIProviderConfig = localai.get;
export const getAllLocalAIProviderConfigs = localai.getAll;
export const getLocalAIProviderConfigByName = localai.getByName;
export const createLocalAIProviderConfig = localai.create;
export const updateLocalAIProviderConfig = localai.update;
export const deleteLocalAIProviderConfig = localai.delete;
export const isLocalAIProviderConfigInUse = localai.isInUse;

const mistral = makeProviderApi<MistralProviderConfig>('mistral');
export const getMistralProviderConfig = mistral.get;
export const getAllMistralProviderConfigs = mistral.getAll;
export const getMistralProviderConfigByName = mistral.getByName;
export const createMistralProviderConfig = mistral.create;
export const updateMistralProviderConfig = mistral.update;
export const deleteMistralProviderConfig = mistral.delete;
export const isMistralProviderConfigInUse = mistral.isInUse;

const ollama = makeProviderApi<OllamaProviderConfig>('ollama');
export const getOllamaProviderConfig = ollama.get;
export const getAllOllamaProviderConfigs = ollama.getAll;
export const getOllamaProviderConfigByName = ollama.getByName;
export const createOllamaProviderConfig = ollama.create;
export const updateOllamaProviderConfig = ollama.update;
export const deleteOllamaProviderConfig = ollama.delete;
export const isOllamaProviderConfigInUse = ollama.isInUse;

const openai = makeProviderApi<OpenAIProviderConfig>('openai');
export const getOpenAIProviderConfig = openai.get;
export const getAllOpenAIProviderConfigs = openai.getAll;
export const getOpenAIProviderConfigByName = openai.getByName;
export const createOpenAIProviderConfig = openai.create;
export const updateOpenAIProviderConfig = openai.update;
export const deleteOpenAIProviderConfig = openai.delete;
export const isOpenAIProviderConfigInUse = openai.isInUse;

const openaicompatible = makeProviderApi<OpenAICompatibleProviderConfig>('openaicompatible');
export const getOpenAICompatibleProviderConfig = openaicompatible.get;
export const getAllOpenAICompatibleProviderConfigs = openaicompatible.getAll;
export const getOpenAICompatibleProviderConfigByName = openaicompatible.getByName;
export const createOpenAICompatibleProviderConfig = openaicompatible.create;
export const updateOpenAICompatibleProviderConfig = openaicompatible.update;
export const deleteOpenAICompatibleProviderConfig = openaicompatible.delete;
export const isOpenAICompatibleProviderConfigInUse = openaicompatible.isInUse;

const openrouter = makeProviderApi<OpenRouterProviderConfig>('openrouter');
export const getOpenRouterProviderConfig = openrouter.get;
export const getAllOpenRouterProviderConfigs = openrouter.getAll;
export const getOpenRouterProviderConfigByName = openrouter.getByName;
export const createOpenRouterProviderConfig = openrouter.create;
export const updateOpenRouterProviderConfig = openrouter.update;
export const deleteOpenRouterProviderConfig = openrouter.delete;
export const isOpenRouterProviderConfigInUse = openrouter.isInUse;

const soulbitscloud = makeProviderApi<SoulbitsCloudProviderConfig>('soulbitscloud');
export const getSoulbitsCloudProviderConfig = soulbitscloud.get;
export const getAllSoulbitsCloudProviderConfigs = soulbitscloud.getAll;
export const getSoulbitsCloudProviderConfigByName = soulbitscloud.getByName;
export const createSoulbitsCloudProviderConfig = soulbitscloud.create;
export const updateSoulbitsCloudProviderConfig = soulbitscloud.update;
export const deleteSoulbitsCloudProviderConfig = soulbitscloud.delete;
export const isSoulbitsCloudProviderConfigInUse = soulbitscloud.isInUse;

const xai = makeProviderApi<XAIProviderConfig>('xai');
export const getXAIProviderConfig = xai.get;
export const getAllXAIProviderConfigs = xai.getAll;
export const getXAIProviderConfigByName = xai.getByName;
export const createXAIProviderConfig = xai.create;
export const updateXAIProviderConfig = xai.update;
export const deleteXAIProviderConfig = xai.delete;
export const isXAIProviderConfigInUse = xai.isInUse;

/**
 * Bulk-refresh the api_key on every live `soulbitscloud` provider config — the
 * on-device equivalent of the SQLite repo's `updateAllSoulbitsCloudApiKeys`
 * (backs the cloud-mode token seed + rotation). The engine mirrors its own
 * cloud-mode `RefreshAllActiveTokens` behind `POST /api/providers/
 * soulbitscloud/refresh-token`.
 */
export async function updateAllSoulbitsCloudApiKeys(paseto: string): Promise<void> {
  // Pass the active flavor's inference host so every refresh also corrects each
  // row's base_url (rows created from the old prod default would otherwise stay
  // permanently prod on beta/dev builds).
  await engineApiClient.refreshSoulbitsCloudProviderConfigs(paseto, CLOUD_HOSTS.inference);
}
