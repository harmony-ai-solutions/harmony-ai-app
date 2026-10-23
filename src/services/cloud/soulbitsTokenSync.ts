/**
 * Soulbits Token Sync — keeps the embedded engine's `soulbitscloud` account
 * credential current.
 *
 * The credential is now a LONG-LIVED `sb_cloud_*` API key named
 * "Soulbits Engine", not the ≤1h account PASETO (2026-10-23 production
 * incident: a pinned PASETO in the engine row 401'd after an hour). This module
 * is the engine-side half of the ensure flow: {@link ensureCloudEngineKey}
 * resolves the key (reuse or mint) and writes the row only when it changed.
 *
 *   - `startSoulbitsTokenSync()` subscribes to AuthService `auth:changed`
 *     (login, register AND the hourly refresh) and runs the ensure flow. It
 *     ALSO arms the engine-connect heal: every truthy engine connection runs
 *     the ensure once (see {@link syncCurrentToken}), so a cold start whose
 *     first write was deferred — or whose row still carries an old credential —
 *     heals as soon as the management API is up. Returns a stop() that removes
 *     both subscriptions.
 *   - `syncCurrentToken()` one-shot ensure using the currently cached
 *     credential (the "safety net on app start"). Signed out → no-op.
 *   - `injectSoulbitsToken()` seeds the LAST-APPLIED engine key when a NEW
 *     soulbitscloud provider config is created via the module-config UI. It
 *     never injects the PASETO; if no key has been resolved yet it seeds an
 *     empty key (the ensure flow fills it on the next trigger). Standalone mode
 *     (no cloud credential) keeps the user-entered key.
 *
 * READINESS DEFERRAL (cold-start boot race): with a cached sign-in,
 * `auth:changed` fires ~180 ms BEFORE the engine management API connects, so
 * the first ensure throws `Engine is not connected — …` (see
 * `requireEngineConnection()`). Rather than dropping it, the attempt is parked
 * on the next engine-ready event and retried — the retry re-runs the ensure
 * flow, so it writes the latest resolved key (or reuses what the row already
 * holds). A not-connected error against a LIVE connection is a genuine write
 * failure and still propagates.
 */

import AuthService from '../auth/AuthService';
import { createLogger } from '../../utils/logger';
import { getEngineConnection, onEngineConnectionChange } from '../engine/EngineService';
import {
  createEngineReadinessDeferral,
  shouldDeferForEngineReadiness,
} from '../engine/engineReadiness';
import { ensureCloudEngineKey, getLastAppliedEngineKey } from './engineKeyEnsure';

const log = createLogger('[SoulbitsTokenSync]');

// ── Types ───────────────────────────────────────────────────────────────

export interface InjectSoulbitsTokenOptions {
  providerType: string;
  isCreate: boolean;
  providerConfig: Record<string, any>;
}

// ── Readiness state ─────────────────────────────────────────────────────

/** The single armed readiness retry for the engine-key ensure. */
const ensureDeferral = createEngineReadinessDeferral(error => {
  log.warn('Deferred Soulbits Engine api-key ensure failed:', error);
});

// ── Subscription ────────────────────────────────────────────────────────

/**
 * Subscribe to `auth:changed` (login/register/refresh) and ensure the engine's
 * `soulbitscloud` account carries the long-lived `Soulbits Engine` API key.
 *
 * Also subscribes to engine readiness: each truthy connection runs
 * {@link syncCurrentToken} once (concurrent duplicate runs are suppressed), so a
 * cold start whose first ensure was deferred — or whose engine row still
 * carries an older credential — heals as soon as the management API is up.
 *
 * @returns stop() that removes BOTH the auth:changed handler and the
 *   engine-connection subscription.
 */
export function startSoulbitsTokenSync(): () => void {
  const handler = () =>
    refreshAllAndSync().catch((error: unknown) => {
      log.warn('Failed to ensure the Soulbits Engine api key:', error);
    });

  AuthService.on('auth:changed', handler);

  // Engine-connect heal: one in-flight run at a time (a connection burst must
  // not duplicate the attempt).
  let healInFlight = false;
  const heal = () => {
    if (healInFlight) return;
    healInFlight = true;
    void syncCurrentToken()
      .catch((error: unknown) => log.warn('Engine-connect api-key heal failed:', error))
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
 * Ensure the engine key from the currently cached cloud credential. No-op in
 * standalone mode (no cloud credential). Never throws — this is the readiness
 * heal, and a failure is picked up by the next trigger.
 */
export async function syncCurrentToken(): Promise<void> {
  try {
    await refreshAllAndSync();
  } catch (error) {
    log.warn('Soulbits Engine api-key ensure failed:', error);
  }
}

/**
 * Shared ensure path: resolve the account's long-lived API key and write it to
 * the engine row only when it changed.
 *
 * Boot race: when the engine management API is not up yet, the attempt is
 * deferred to the next engine-ready event instead of being dropped. Only a
 * not-connected failure against a STILL-DOWN engine is deferred; any other
 * failure (including not-connected with a live connection) propagates to the
 * caller.
 */
async function refreshAllAndSync(): Promise<void> {
  try {
    const result = await ensureCloudEngineKey();

    if (result.status === 'applied') {
      log.info(`Soulbits Engine api key ${result.minted ? 'created and ' : ''}applied`);
    } else if (result.status === 'reused' || result.status === 'unchanged') {
      log.debug(`Soulbits Engine api key already current (${result.status})`);
    } else if (result.status === 'cap_reached') {
      log.warn('Soulbits Engine api key not applied: the account is at its key limit');
    }

    // A completed attempt supersedes any retry armed by an earlier boot race.
    ensureDeferral.cancel();
  } catch (error) {
    if (!shouldDeferForEngineReadiness(error)) throw error;

    log.info(
      'Engine not connected yet — deferring Soulbits Engine api-key ensure until the engine is ready',
    );
    ensureDeferral.arm(async () => {
      await ensureCloudEngineKey();
    });
  }
}

// ── Create-time injection ───────────────────────────────────────────────

/**
 * Seed the last-applied engine API key as api_key when creating a NEW
 * soulbitscloud provider config. Returns a copy of `providerConfig` with
 * api_key injected (possibly empty — the ensure flow fills it next trigger).
 *
 * Rules:
 *  - Only `soulbitscloud` provider type.
 *  - Only on CREATE (`isCreate === true`); updates keep the stored key.
 *  - Only when a cloud credential exists; standalone keeps the user-entered key.
 *  - The PASETO is NEVER injected — it is not a valid engine credential.
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
      return { ...providerConfig, api_key: getLastAppliedEngineKey() ?? '' };
    }
  } catch {
    // No cloud credential — standalone mode. Keep the user-entered key.
  }

  return providerConfig;
}
