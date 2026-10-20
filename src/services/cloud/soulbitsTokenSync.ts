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
 *     fresh token takes effect immediately. It ALSO arms the engine-connect
 *     heal: every truthy engine connection re-pushes the currently cached
 *     token once (see {@link syncCurrentToken}). Returns a stop() that removes
 *     both subscriptions.
 *   - `syncCurrentToken()` one-shot refresh using the currently cached token
 *     (the "safety net on app start" — wired to engine readiness). It never
 *     writes a token the app already knows is expired.
 *   - `injectSoulbitsToken()` seeds the api_key when a NEW soulbitscloud
 *     provider config is created via the module-config UI. Existing configs
 *     (updates) are never touched — their token is maintained by the bulk
 *     refresh. Standalone mode (no cloud token) keeps the user-entered key.
 *
 * READINESS DEFERRAL (cold-start boot race): with a cached sign-in,
 * `auth:changed` fires ~180 ms BEFORE the engine management API connects, so
 * the first bulk update throws `Engine is not connected — …` (see
 * `requireEngineConnection()`). Rather than dropping the refresh (which left the
 * engine's soulbitscloud row holding an EXPIRED PASETO → TTS 401 `token
 * expired`), the refresh is parked on the next engine-ready event and retried
 * with the LATEST pending token. A not-connected error against a LIVE
 * connection is a genuine write failure and still propagates.
 */

import AuthService from '../auth/AuthService';
import { updateAllSoulbitsCloudApiKeys } from '../../database/repositories';
import { createLogger } from '../../utils/logger';
import { getEngineConnection, onEngineConnectionChange } from '../engine/EngineService';
import {
  createEngineReadinessDeferral,
  shouldDeferForEngineReadiness,
} from '../engine/engineReadiness';

const log = createLogger('[SoulbitsTokenSync]');

// ── Types ───────────────────────────────────────────────────────────────

export interface InjectSoulbitsTokenOptions {
  providerType: string;
  isCreate: boolean;
  providerConfig: Record<string, any>;
}

// ── Readiness state ─────────────────────────────────────────────────────

/**
 * The token waiting for the engine after a deferred bulk update. A newer
 * `auth:changed` overwrites it, so the retry always writes the LATEST PASETO
 * (one armed deferral, latest token wins).
 */
let pendingPaseto: string | null = null;

/** The single armed readiness retry for the bulk api-key refresh. */
const refreshDeferral = createEngineReadinessDeferral(error => {
  log.warn('Deferred soulbitscloud api-key refresh failed:', error);
});

// ── Subscription ────────────────────────────────────────────────────────

/**
 * Subscribe to `auth:changed` (login/register/refresh) and propagate the new
 * PASETO into every non-deleted soulbitscloud provider row, then trigger an
 * engine sync so the refreshed token takes effect immediately (the DB update
 * alone only bumps `updated_at` — the engine learns about it via a sync).
 *
 * Also subscribes to engine readiness: each truthy connection runs
 * {@link syncCurrentToken} once (concurrent duplicate runs are suppressed), so a
 * cold start whose first refresh was deferred — or whose engine row still
 * carries an older token — heals as soon as the management API is up.
 *
 * @returns stop() that removes BOTH the auth:changed handler and the
 *   engine-connection subscription.
 */
export function startSoulbitsTokenSync(): () => void {
  const handler = (paseto: string) =>
    refreshAllAndSync(paseto).catch((error: unknown) => {
      log.warn('Failed to refresh soulbitscloud api keys:', error);
    });

  AuthService.on('auth:changed', handler);

  // Engine-connect heal: one in-flight run at a time (a connection burst must
  // not duplicate the write).
  let healInFlight = false;
  const heal = () => {
    if (healInFlight) return;
    healInFlight = true;
    void syncCurrentToken()
      .catch((error: unknown) => log.warn('Engine-connect token heal failed:', error))
      .finally(() => {
        healInFlight = false;
      });
  };

  // Already ready (e.g. the engine connected before this subscription): heal now.
  if (getEngineConnection()) heal();
  const unsubscribeConnection = onEngineConnectionChange(connection => {
    if (connection) heal();
  });

  return () => {
    AuthService.off('auth:changed', handler);
    unsubscribeConnection();
  };
}

// ── One-shot refresh ────────────────────────────────────────────────────

/**
 * Refresh all soulbitscloud rows with the currently cached PASETO, if one
 * exists, and trigger an engine sync. No-op in standalone mode (no cloud
 * token cached).
 *
 * Expiry guard: an already-expired cached token is SKIPPED — writing it would
 * seed the engine with dead credentials. AuthService's refresh emits
 * `auth:changed` with a fresh token, which the readiness-aware path in
 * {@link refreshAllAndSync} then writes.
 */
export async function syncCurrentToken(): Promise<void> {
  try {
    const paseto = await AuthService.getToken();
    if (!paseto) return;

    const expiresAt = safeExpiresAt();
    if (expiresAt > 0 && Date.now() >= expiresAt) {
      log.info('Cached cloud token is expired — skipping the token heal');
      return;
    }

    await refreshAllAndSync(paseto);
  } catch {
    // No cloud token cached — standalone mode. Not an error.
  }
}

/** Cached PASETO expiry (epoch ms), or 0 when unknown/unavailable. */
function safeExpiresAt(): number {
  try {
    return AuthService.getTokenExpiresAt();
  } catch {
    return 0;
  }
}

/**
 * Shared refresh path: bulk-update all soulbitscloud rows with the new token.
 * The update is a DIRECT LOCAL WRITE through the management-API client (task
 * 2-5) — there is no separate engine-sync step (the legacy
 * `SyncService.initiateSync()` push is gone with the sync stack).
 *
 * Boot race: when the engine management API is not up yet, the refresh is
 * deferred to the next engine-ready event (latest pending token wins) instead
 * of being dropped. Only a not-connected failure against a STILL-DOWN engine is
 * deferred; any other failure (including not-connected with a live connection)
 * propagates to the caller.
 */
async function refreshAllAndSync(paseto: string): Promise<void> {
  pendingPaseto = paseto;
  try {
    await updateAllSoulbitsCloudApiKeys(paseto);
    // A direct write supersedes any retry armed by an earlier boot race.
    pendingPaseto = null;
    refreshDeferral.cancel();
  } catch (error) {
    if (!shouldDeferForEngineReadiness(error)) throw error;

    log.info(
      'Engine not connected yet — deferring soulbitscloud api-key refresh until the engine is ready',
    );
    refreshDeferral.arm(async () => {
      const token = pendingPaseto;
      if (!token) return;
      await updateAllSoulbitsCloudApiKeys(token);
      pendingPaseto = null;
    });
  }
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
