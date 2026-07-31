/**
 * Soulbits Token Sync — keeps stored soulbitscloud provider configs in sync
 * with the app-side cloud PASETO.
 *
 * In cloud mode the session PASETO is the credential for the Soulbits
 * inference API. The engine seeds its own default soulbitscloud row with the
 * token; this module mirrors that on the app side:
 *
 *   - `startSoulbitsTokenSync()` subscribes to AuthService `auth:changed`
 *     (emitted on login, register AND refresh), bulk-updates the api_key of
 *     every non-deleted soulbitscloud row AND triggers an engine sync so the
 *     fresh token takes effect immediately. Returns a stop() to unsubscribe.
 *   - `syncCurrentToken()` one-shot refresh using the currently cached token
 *     (safety net on app start).
 *   - `injectSoulbitsToken()` seeds the api_key when a NEW soulbitscloud
 *     provider config is created via the module-config UI. Existing configs
 *     (updates) are never touched — their token is maintained by the bulk
 *     refresh. Standalone mode (no cloud token) keeps the user-entered key.
 */

import AuthService from '../auth/AuthService';
import SyncService from '../SyncService';
import { updateAllSoulbitsCloudApiKeys } from '../../database/repositories/providers/SoulbitsCloudProviderConfigRepository';
import { createLogger } from '../../utils/logger';

const log = createLogger('[SoulbitsTokenSync]');

// ── Types ───────────────────────────────────────────────────────────────

export interface InjectSoulbitsTokenOptions {
  providerType: string;
  isCreate: boolean;
  providerConfig: Record<string, any>;
}

// ── Subscription ────────────────────────────────────────────────────────

/**
 * Subscribe to `auth:changed` (login/register/refresh) and propagate the new
 * PASETO into every non-deleted soulbitscloud provider row, then trigger an
 * engine sync so the refreshed token takes effect immediately (the DB update
 * alone only bumps `updated_at` — the engine learns about it via a sync).
 *
 * `initiateSync()` is safe to call any time: it self-guards when a sync is
 * already in progress or the connection is unavailable.
 *
 * @returns stop() that removes the exact handler.
 */
export function startSoulbitsTokenSync(): () => void {
  const handler = (paseto: string) =>
    refreshAllAndSync(paseto).catch((error: unknown) => {
      log.warn('Failed to refresh soulbitscloud api keys:', error);
    });

  AuthService.on('auth:changed', handler);
  return () => {
    AuthService.off('auth:changed', handler);
  };
}

// ── One-shot refresh ────────────────────────────────────────────────────

/**
 * Refresh all soulbitscloud rows with the currently cached PASETO, if one
 * exists, and trigger an engine sync. No-op in standalone mode (no cloud
 * token cached).
 */
export async function syncCurrentToken(): Promise<void> {
  try {
    const paseto = await AuthService.getToken();
    if (paseto) {
      await refreshAllAndSync(paseto);
    }
  } catch {
    // No cloud token cached — standalone mode. Not an error.
  }
}

/**
 * Shared refresh path: bulk-update all soulbitscloud rows with the new token,
 * then push the change to the engine via a background sync.
 */
async function refreshAllAndSync(paseto: string): Promise<void> {
  await updateAllSoulbitsCloudApiKeys(paseto);
  await SyncService.initiateSync().catch((error: unknown) => {
    // Sync failure is non-critical — the connect-time auto-sync will pick up
    // the updated rows on the next connection. Log and move on.
    log.warn('Failed to sync soulbitscloud token refresh to engine:', error);
  });
}

// ── Create-time injection ───────────────────────────────────────────────

/**
 * Seed the current cloud PASETO as api_key when creating a NEW soulbitscloud
 * provider config. Returns a copy of `providerConfig` with api_key injected.
 *
 * Rules:
 *  - Only `soulbitscloud` provider type.
 *  - Only on CREATE (`isCreate === true`); updates keep the stored token.
 *  - Only when a cloud token exists; standalone keeps the user-entered key.
 */
export async function injectSoulbitsToken(
  opts: InjectSoulbitsTokenOptions,
): Promise<Record<string, any>> {
  const { providerType, isCreate, providerConfig } = opts;

  if (providerType !== 'soulbitscloud' || !isCreate) {
    return providerConfig;
  }

  try {
    const paseto = await AuthService.getToken();
    if (paseto) {
      return { ...providerConfig, api_key: paseto };
    }
  } catch {
    // No cloud token — standalone mode. Keep the user-entered key.
  }

  return providerConfig;
}
