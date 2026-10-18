// 6-3 removes this adapter.
/**
 * legacyProviderAdapter — the interim per-type provider-config shim
 * (provider-registry 6-1). Retired by 6-3.
 *
 * The ModuleConfigEditScreen (and the VoiceInputSettingsScreen write path) still
 * consume the OLD flat per-type provider API — `get<Type>ProviderConfig`,
 * `create<Type>ProviderConfig`, … for all FOUR VERBS × 13 types. This adapter
 * maps those calls onto the new shared-account surface in `providers.ts`:
 *
 *   - Reads: `GET /api/providers/:id` (3-2's merged account+overlay guarantee)
 *     → the old flat shape. The list read returns account-shaped rows (the
 *     overlay is not recoverable from the list until 6-3).
 *   - Writes: the flat config is SPLIT into the account fields (`name`,
 *     `api_key`, `base_url`/`endpoint` + typed `extra`) and the capability
 *     overlay. The account is written via the accounts API; the capability
 *     overlay is stashed in {@link setPendingCapability} keyed by the account id
 *     so the subsequent module-config write (see `modules.ts`) can emit it as
 *     `capability_json` (accounts do not store capability fields).
 *
 * The split key set mirrors the engine's `accountFieldJSONNames`
 * (`database/controllers/provider_field_split.go`).
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
import { engineApiClient, EngineApiError } from '../EngineApiClient';
import type { ProviderAccountWriteDto } from '../EngineApiClient';
import {
  createAccount,
  updateAccount,
  deleteAccount,
  isAccountInUse,
} from './providers';

type Flat = Record<string, unknown>;

/** Keys that belong to the shared ACCOUNT (everything else is capability). */
const ACCOUNT_FIELD_KEYS = new Set([
  'id',
  'name',
  'api_key',
  'base_url',
  'endpoint', // soulvoice → account base_url
  'created_at',
  'updated_at',
  'deleted_at',
  'auth', // comfyui / openaicompatible account extra
  'comfyui_mode', // comfyui account extra
  'fingerprint', // openaicompatible account extra
]);

/** Account-level extras routed into the account `extra` blob. */
const ACCOUNT_EXTRA_KEYS = ['auth', 'comfyui_mode', 'fingerprint'] as const;

/** Coerce the engine's `deleted_at` RFC3339 string to `Date | null`. */
function coerce<T>(config: T): T {
  const obj = config as Record<string, unknown>;
  if (obj && typeof obj.deleted_at === 'string') {
    obj.deleted_at = new Date(obj.deleted_at as string);
  }
  return config;
}

/**
 * Split a flat provider config into the account write body and the capability
 * overlay. The account carries `name`, `api_key`, `base_url` (or soulvoice's
 * `endpoint`) and the typed `extra` keys; the capability overlay is every other
 * field.
 */
export function splitProviderConfig(
  _type: string,
  config: Flat,
): { account: ProviderAccountWriteDto; capability: Flat } {
  const account: ProviderAccountWriteDto = {
    name: typeof config.name === 'string' ? config.name : '',
    api_key: typeof config.api_key === 'string' ? config.api_key : '',
  };
  const baseURL =
    typeof config.base_url === 'string'
      ? config.base_url
      : typeof config.endpoint === 'string'
        ? config.endpoint
        : '';
  if (baseURL) account.base_url = baseURL;

  const extra: Flat = {};
  for (const key of ACCOUNT_EXTRA_KEYS) {
    if (config[key] !== undefined && config[key] !== null && config[key] !== '') {
      extra[key] = config[key];
    }
  }
  if (Object.keys(extra).length > 0) account.extra = extra;

  const capability: Flat = {};
  for (const [key, value] of Object.entries(config)) {
    if (ACCOUNT_FIELD_KEYS.has(key)) continue;
    capability[key] = value;
  }
  return { account, capability };
}

/** Strip the account fields from a merged provider object → capability overlay. */
export function capabilityFieldsOf(config: Flat): Flat {
  const capability: Flat = {};
  for (const [key, value] of Object.entries(config)) {
    if (ACCOUNT_FIELD_KEYS.has(key)) continue;
    capability[key] = value;
  }
  return capability;
}

// ── Pending capability stash (create/update → module write bridge) ─────────
// The screen writes the provider config FIRST, then the module config with only
// the account id. Since accounts do not store capability fields, the overlay is
// stashed here keyed by the account id so `modules.ts` can emit it as
// `capability_json`. Session-scoped; harmless if a module write never follows.

const pendingCapability = new Map<string, Flat>();

export function setPendingCapability(accountId: string, capability: Flat): void {
  if (accountId) pendingCapability.set(accountId, capability);
}

export function getPendingCapability(accountId: string): Flat | undefined {
  return pendingCapability.get(accountId);
}

/** Test seam — drop all stashed overlays. */
export function resetPendingCapabilities(): void {
  pendingCapability.clear();
}

// ── Per-type legacy API factory ─────────────────────────────────────────────

/**
 * Build the read + write functions for one provider type. The write signatures
 * mirror the retired SQLite repositories exactly (create → new id; update →
 * void; delete → void; isInUse → boolean).
 */
function makeLegacyProviderApi<T extends { id: string }>(type: string) {
  const getAll = async (): Promise<T[]> => {
    const res = await engineApiClient.listProviders(type);
    return ((res.providers?.[type] ?? []) as unknown as T[]).map(coerce);
  };
  return {
    get: async (id: string, _includeDeleted = false): Promise<T | null> => {
      try {
        const res = await engineApiClient.getProvider(id);
        return coerce(res.config as T);
      } catch (e) {
        if (e instanceof EngineApiError && e.isNotFound) return null;
        throw e;
      }
    },
    getAll: (_includeDeleted = false): Promise<T[]> => getAll(),
    getByName: async (name: string, _includeDeleted = false): Promise<T | null> =>
      (await getAll()).find(c => (c as { name?: string }).name === name) ?? null,

    create: async (config: Omit<T, 'id' | 'deleted_at'>): Promise<string> => {
      const { account, capability } = splitProviderConfig(type, config as Flat);
      const id = await createAccount(type, account);
      setPendingCapability(id, capability);
      return id;
    },

    update: async (config: T): Promise<void> => {
      const { account, capability } = splitProviderConfig(type, config as Flat);
      await updateAccount(config.id, account);
      setPendingCapability(config.id, capability);
    },

    delete: async (id: string): Promise<void> => {
      await deleteAccount(id);
    },

    isInUse: (id: string): Promise<boolean> => isAccountInUse(id),
  };
}

const anthropic = makeLegacyProviderApi<AnthropicProviderConfig>('anthropic');
export const getAnthropicProviderConfig = anthropic.get;
export const getAllAnthropicProviderConfigs = anthropic.getAll;
export const getAnthropicProviderConfigByName = anthropic.getByName;
export const createAnthropicProviderConfig = anthropic.create;
export const updateAnthropicProviderConfig = anthropic.update;
export const deleteAnthropicProviderConfig = anthropic.delete;
export const isAnthropicProviderConfigInUse = anthropic.isInUse;

const comfyui = makeLegacyProviderApi<ComfyUIProviderConfig>('comfyui');
export const getComfyUIProviderConfig = comfyui.get;
export const getAllComfyUIProviderConfigs = comfyui.getAll;
export const getComfyUIProviderConfigByName = comfyui.getByName;
export const createComfyUIProviderConfig = comfyui.create;
export const updateComfyUIProviderConfig = comfyui.update;
export const deleteComfyUIProviderConfig = comfyui.delete;
export const isComfyUIProviderConfigInUse = comfyui.isInUse;

const elevenlabs = makeLegacyProviderApi<ElevenLabsProviderConfig>('elevenlabs');
export const getElevenLabsProviderConfig = elevenlabs.get;
export const getAllElevenLabsProviderConfigs = elevenlabs.getAll;
export const getElevenLabsProviderConfigByName = elevenlabs.getByName;
export const createElevenLabsProviderConfig = elevenlabs.create;
export const updateElevenLabsProviderConfig = elevenlabs.update;
export const deleteElevenLabsProviderConfig = elevenlabs.delete;
export const isElevenLabsProviderConfigInUse = elevenlabs.isInUse;

const google = makeLegacyProviderApi<GoogleProviderConfig>('google');
export const getGoogleProviderConfig = google.get;
export const getAllGoogleProviderConfigs = google.getAll;
export const getGoogleProviderConfigByName = google.getByName;
export const createGoogleProviderConfig = google.create;
export const updateGoogleProviderConfig = google.update;
export const deleteGoogleProviderConfig = google.delete;
export const isGoogleProviderConfigInUse = google.isInUse;

const soulvoice = makeLegacyProviderApi<SoulvoiceProviderConfig>('soulvoice');
export const getSoulvoiceProviderConfig = soulvoice.get;
export const getAllSoulvoiceProviderConfigs = soulvoice.getAll;
export const getSoulvoiceProviderConfigByName = soulvoice.getByName;
export const createSoulvoiceProviderConfig = soulvoice.create;
export const updateSoulvoiceProviderConfig = soulvoice.update;
export const deleteSoulvoiceProviderConfig = soulvoice.delete;
export const isSoulvoiceProviderConfigInUse = soulvoice.isInUse;

const localai = makeLegacyProviderApi<LocalAIProviderConfig>('localai');
export const getLocalAIProviderConfig = localai.get;
export const getAllLocalAIProviderConfigs = localai.getAll;
export const getLocalAIProviderConfigByName = localai.getByName;
export const createLocalAIProviderConfig = localai.create;
export const updateLocalAIProviderConfig = localai.update;
export const deleteLocalAIProviderConfig = localai.delete;
export const isLocalAIProviderConfigInUse = localai.isInUse;

const mistral = makeLegacyProviderApi<MistralProviderConfig>('mistral');
export const getMistralProviderConfig = mistral.get;
export const getAllMistralProviderConfigs = mistral.getAll;
export const getMistralProviderConfigByName = mistral.getByName;
export const createMistralProviderConfig = mistral.create;
export const updateMistralProviderConfig = mistral.update;
export const deleteMistralProviderConfig = mistral.delete;
export const isMistralProviderConfigInUse = mistral.isInUse;

const ollama = makeLegacyProviderApi<OllamaProviderConfig>('ollama');
export const getOllamaProviderConfig = ollama.get;
export const getAllOllamaProviderConfigs = ollama.getAll;
export const getOllamaProviderConfigByName = ollama.getByName;
export const createOllamaProviderConfig = ollama.create;
export const updateOllamaProviderConfig = ollama.update;
export const deleteOllamaProviderConfig = ollama.delete;
export const isOllamaProviderConfigInUse = ollama.isInUse;

const openai = makeLegacyProviderApi<OpenAIProviderConfig>('openai');
export const getOpenAIProviderConfig = openai.get;
export const getAllOpenAIProviderConfigs = openai.getAll;
export const getOpenAIProviderConfigByName = openai.getByName;
export const createOpenAIProviderConfig = openai.create;
export const updateOpenAIProviderConfig = openai.update;
export const deleteOpenAIProviderConfig = openai.delete;
export const isOpenAIProviderConfigInUse = openai.isInUse;

const openaicompatible = makeLegacyProviderApi<OpenAICompatibleProviderConfig>('openaicompatible');
export const getOpenAICompatibleProviderConfig = openaicompatible.get;
export const getAllOpenAICompatibleProviderConfigs = openaicompatible.getAll;
export const getOpenAICompatibleProviderConfigByName = openaicompatible.getByName;
export const createOpenAICompatibleProviderConfig = openaicompatible.create;
export const updateOpenAICompatibleProviderConfig = openaicompatible.update;
export const deleteOpenAICompatibleProviderConfig = openaicompatible.delete;
export const isOpenAICompatibleProviderConfigInUse = openaicompatible.isInUse;

const openrouter = makeLegacyProviderApi<OpenRouterProviderConfig>('openrouter');
export const getOpenRouterProviderConfig = openrouter.get;
export const getAllOpenRouterProviderConfigs = openrouter.getAll;
export const getOpenRouterProviderConfigByName = openrouter.getByName;
export const createOpenRouterProviderConfig = openrouter.create;
export const updateOpenRouterProviderConfig = openrouter.update;
export const deleteOpenRouterProviderConfig = openrouter.delete;
export const isOpenRouterProviderConfigInUse = openrouter.isInUse;

const soulbitscloud = makeLegacyProviderApi<SoulbitsCloudProviderConfig>('soulbitscloud');
export const getSoulbitsCloudProviderConfig = soulbitscloud.get;
export const getAllSoulbitsCloudProviderConfigs = soulbitscloud.getAll;
export const getSoulbitsCloudProviderConfigByName = soulbitscloud.getByName;
export const createSoulbitsCloudProviderConfig = soulbitscloud.create;
export const updateSoulbitsCloudProviderConfig = soulbitscloud.update;
export const deleteSoulbitsCloudProviderConfig = soulbitscloud.delete;
export const isSoulbitsCloudProviderConfigInUse = soulbitscloud.isInUse;

const xai = makeLegacyProviderApi<XAIProviderConfig>('xai');
export const getXAIProviderConfig = xai.get;
export const getAllXAIProviderConfigs = xai.getAll;
export const getXAIProviderConfigByName = xai.getByName;
export const createXAIProviderConfig = xai.create;
export const updateXAIProviderConfig = xai.update;
export const deleteXAIProviderConfig = xai.delete;
export const isXAIProviderConfigInUse = xai.isInUse;
