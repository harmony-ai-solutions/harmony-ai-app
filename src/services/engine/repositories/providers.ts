/**
 * Providers — management-API-backed repository adapter (provider-registry 6-1).
 *
 * Re-targeted from the retired per-type `provider_config_*` surface to the
 * unified **provider_accounts** model (plan §3.1/§3.4, engine phase 3-2):
 *
 *   - `GET  /api/providers`        → accounts grouped by type, account-shaped
 *   - `GET  /api/providers/:id`    → the MERGED object (account + capability
 *                                    overlay, top-level `id`) when the account is
 *                                    referenced by a live module config, else the
 *                                    account-shaped row (3-2 app-compat guarantee)
 *   - `POST /api/providers`        → `{type, account}`; engine mints the id
 *   - `PUT  /api/providers/:id`    → `{account}` partial merge
 *   - `DELETE /api/providers/:id`  → 409 `provider_in_use` (+ `referencing_configs`)
 *                                    when a live module config references it
 *
 * The unified accounts surface is what the screens consume directly (6-3
 * removed the interim per-type `legacyProviderAdapter.ts`).
 *
 * `isAccountInUse` is best-effort (client-side derivation from the module-config
 * list reads); the DELETE 409 remains the authoritative guard.
 */

import type { ProviderAccount } from '../../../database/models';
import { engineApiClient } from '../EngineApiClient';
import { EngineApiError } from '../EngineApiClient';
import type { ProviderAccountWriteDto, ReferencingConfigDto } from '../EngineApiClient';
import { CLOUD_HOSTS } from '../../../config/cloud';

/**
 * Raised when a provider account cannot be soft-deleted because live module
 * configs still reference it. Carries the engine's `referencing_configs` list
 * (the `DELETE /api/providers/:id` 409 body) so callers can explain the usage.
 */
export class ProviderInUseError extends Error {
  readonly referencingConfigs: ReferencingConfigDto[];

  constructor(id: string, referencingConfigs: ReferencingConfigDto[]) {
    super(`Provider account ${id} is in use and cannot be soft deleted`);
    this.name = 'ProviderInUseError';
    this.referencingConfigs = referencingConfigs;
  }
}

/** Coerce the engine's RFC3339 timestamp strings to `Date | null`. */
function coerceDate(value: unknown): Date | null {
  return typeof value === 'string' ? new Date(value) : null;
}

/** Coerce one wire account row to the app's `ProviderAccount` domain shape. */
function coerceAccount(row: unknown): ProviderAccount {
  const obj = (row ?? {}) as Record<string, unknown>;
  return {
    id: String(obj.id ?? ''),
    type: String(obj.type ?? ''),
    name: String(obj.name ?? ''),
    api_key: String(obj.api_key ?? ''),
    base_url: String(obj.base_url ?? ''),
    extra: typeof obj.extra === 'string' ? obj.extra : JSON.stringify(obj.extra ?? {}),
    created_at: coerceDate(obj.created_at),
    updated_at: coerceDate(obj.updated_at),
    deleted_at: coerceDate(obj.deleted_at),
  };
}

/** Live accounts of one type (or every type when `type` is omitted). */
export async function listAccounts(type?: string): Promise<ProviderAccount[]> {
  const res = await engineApiClient.listProviders(type);
  if (type) return (res.providers?.[type] ?? []).map(coerceAccount);
  return Object.values(res.providers ?? {}).flat().map(coerceAccount);
}

/**
 * One provider account by id. `GET /api/providers/:id` returns the merged
 * account+overlay object when the account is referenced by a live module config,
 * else the account-shaped row; both are normalized onto the account fields here
 * (`type` recovered from the response's top-level `provider`).
 */
export async function getAccount(id: string): Promise<ProviderAccount | null> {
  try {
    const res = await engineApiClient.getProvider(id);
    const obj = (res.config ?? {}) as Record<string, unknown>;
    return coerceAccount({ ...obj, type: obj.type ?? res.provider, extra: obj.extra ?? '{}' });
  } catch (e) {
    if (e instanceof EngineApiError && e.isNotFound) return null;
    throw e;
  }
}

/** Create a shared provider account; returns the engine-minted id. */
export async function createAccount(
  type: string,
  account: ProviderAccountWriteDto,
): Promise<string> {
  const res = await engineApiClient.createProvider(type, account);
  const created = res.config as { id?: string } | null | undefined;
  if (!created || typeof created.id !== 'string' || created.id === '') {
    throw new Error(`Engine did not return an id for the new ${type} provider account`);
  }
  return created.id;
}

/** Partial account update (omitted fields keep their current values). */
export async function updateAccount(
  id: string,
  account: ProviderAccountWriteDto,
): Promise<void> {
  await engineApiClient.updateProvider(id, account);
}

/** Soft-delete a provider account; 409 → {@link ProviderInUseError}. */
export async function deleteAccount(id: string): Promise<void> {
  try {
    await engineApiClient.deleteProvider(id);
  } catch (e) {
    if (e instanceof EngineApiError) {
      if (e.status === 409) {
        const body = (e.body ?? {}) as { referencing_configs?: ReferencingConfigDto[] };
        throw new ProviderInUseError(id, body.referencing_configs ?? []);
      }
      if (e.isNotFound) {
        throw new Error(`Provider account not found: ${id}`);
      }
    }
    throw e instanceof Error ? e : new Error(String(e));
  }
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
 * Derive whether a provider account is referenced by any live module config by
 * scanning the module-config list reads. A reference is the flat
 * `provider_account_id` equal to the id, or the nested `<provider>` object's
 * `id`. Best-effort: any read failure returns false and the DELETE 409 stays the
 * authoritative guard.
 */
export async function isAccountInUse(id: string): Promise<boolean> {
  for (const module of MODULE_TYPES) {
    try {
      const configs = (await engineApiClient.listModuleConfigs(module)) as Array<
        Record<string, unknown>
      >;
      for (const cfg of configs) {
        if (!cfg || typeof cfg !== 'object') continue;
        if (cfg.provider_account_id === id) return true;
        if (module === 'stt') {
          if (
            cfg.transcription_provider_account_id === id ||
            cfg.vad_provider_account_id === id
          ) {
            return true;
          }
          const tx = cfg.transcription as Record<string, unknown> | undefined;
          const vad = cfg.vad as Record<string, unknown> | undefined;
          if (nestedMatches(tx, id) || nestedMatches(vad, id)) return true;
          continue;
        }
        const providerName = cfg.provider;
        if (typeof providerName === 'string') {
          const nested = cfg[providerName] as { id?: string } | undefined;
          if (nested?.id === id) return true;
        }
      }
    } catch {
      // Best-effort — a read failure must not make the check throw.
    }
  }
  return false;
}

/** True when a nested STT slot's `<provider>` object carries the account id. */
function nestedMatches(slot: Record<string, unknown> | undefined, id: string): boolean {
  if (!slot || typeof slot !== 'object') return false;
  if (slot.provider_account_id === id) return true;
  const providerName = slot.provider;
  if (typeof providerName !== 'string') return false;
  const nested = slot[providerName] as { id?: string } | undefined;
  return nested?.id === id;
}

/**
 * Bulk-refresh the api_key on every live `soulbitscloud` provider account — the
 * on-device equivalent of the SQLite repo's `updateAllSoulbitsCloudApiKeys`
 * (backs the cloud-mode token seed + rotation). With the unified registry this
 * degenerates to a one-account update; the engine mirrors its own cloud-mode
 * `RefreshAllActiveTokens` behind `POST /api/providers/soulbitscloud/
 * refresh-token`.
 */
export async function updateAllSoulbitsCloudApiKeys(paseto: string): Promise<void> {
  // Pass the active flavor's inference host so every refresh also corrects each
  // row's base_url (rows created from the old prod default would otherwise stay
  // permanently prod on beta/dev builds).
  await engineApiClient.refreshSoulbitsCloudProviderConfigs(paseto, CLOUD_HOSTS.inference);
}
