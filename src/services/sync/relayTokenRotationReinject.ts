/**
 * RelayTokenRotationReinject — proactive re-inject of a rotated cloud PASETO
 * into the engine's relay config (2026-10-23 incident follow-up).
 *
 * The relay token the engine holds is a SNAPSHOT of the account PASETO taken
 * when it was last written. AuthService rotates that PASETO (a successful
 * `refresh()` issues a new one), so the engine's snapshot silently ages out
 * even while the app is perfectly signed in — which is exactly how the
 * overnight expiry that killed sync on 2026-10-23 happened. Waiting for the
 * engine to report `auth_needed` means a dead transport first; re-injecting on
 * the rotation keeps it from ever going stale.
 *
 * Seam: AuthService's existing `auth:changed` event (emitted from the single
 * token-persistence path every login / refresh / enrollment / connect-session
 * redeem funnels through — no new AuthService behaviour, no change to any
 * refresh caller). A token equal to the one we last saw is not a rotation and
 * is ignored here; everything else goes through the shared
 * {@link reinjectRotatedRelayToken}, whose verify-before-PUT gates make a
 * duplicate event harmless:
 *
 *   - empty / already-expired tokens are never written;
 *   - a token the engine already has is never re-sent;
 *   - a recovery that is running right now (its own refresh emits
 *     `auth:changed`) owns the single in-flight attempt, so the same fresh
 *     token can never be PUT twice.
 *
 * Only engines actually using the cloud relay (sync enabled AND `relay`
 * transport) are touched, and only when the engine is running — a LAN-only or
 * disabled sync client has no relay credential to keep fresh.
 */

import AuthService from '../auth/AuthService';
import { engineApiClient } from '../engine/EngineApiClient';
import type { SyncClientStatusDto } from '../engine/EngineApiClient';
import { getEngineConnection } from '../engine/EngineService';
import {
  isRelaySyncConfigured,
  reinjectRotatedRelayToken,
  type RelayAuthRecoveryOutcome,
} from './relayAuthRecovery';
import { createLogger } from '../../utils/logger';

const log = createLogger('[RelayTokenRotation]');

export interface RelayTokenRotationDeps {
  /** The rotation source (defaults to AuthService's `auth:changed`). */
  subscribe?: (handler: (token: string) => void) => () => void;
  /** The engine status read (defaults to the shared engine client). */
  getStatus?: () => Promise<SyncClientStatusDto>;
  /** The engine-running probe (defaults to the live engine connection). */
  isEngineRunning?: () => boolean;
  /** The verified re-inject (defaults to the shared service). */
  reinject?: (token: string) => Promise<RelayAuthRecoveryOutcome>;
}

/** Singleton guard — one subscription per process. */
let attached = false;

/** Default seam: the existing `auth:changed` event (login + refresh + enroll). */
function defaultSubscribe(handler: (token: string) => void): () => void {
  AuthService.on('auth:changed', handler);
  return () => AuthService.off('auth:changed', handler);
}

/**
 * One re-inject attempt for a rotated token (exported so the trigger can be
 * tested without a real auth event). Resolves when done; never throws.
 */
export async function runRelayTokenRotationReinject(
  token: string,
  deps: RelayTokenRotationDeps = {},
): Promise<void> {
  const isEngineRunning = deps.isEngineRunning ?? (() => getEngineConnection() !== null);
  if (!isEngineRunning()) {
    log.debug('rotation re-inject skipped: engine not running');
    return;
  }

  const getStatus = deps.getStatus ?? (() => engineApiClient.getSyncClientStatus());
  let status: SyncClientStatusDto;
  try {
    status = await getStatus();
  } catch (e: any) {
    // Engine went away between the probe and the read — nothing to update.
    log.warn('rotation re-inject skipped: status read failed:', e?.message ?? String(e));
    return;
  }

  if (!isRelaySyncConfigured(status)) {
    log.debug('rotation re-inject skipped: cloud-relay sync is not enabled');
    return;
  }

  const reinject = deps.reinject ?? ((rotated: string) => reinjectRotatedRelayToken(rotated));
  let outcome: RelayAuthRecoveryOutcome;
  try {
    outcome = await reinject(token);
  } catch (e: any) {
    log.warn('rotation re-inject failed:', e?.message ?? String(e));
    return;
  }

  if (outcome === 'recovered') {
    log.info('relay token re-injected after a cloud sign-in rotation');
  } else {
    // Gates skip (already applied / expired) or the refresh is gone. Quiet by
    // design: the Desktop Sync banner + Settings chip are the honest surfaces.
    log.debug(`rotation re-inject did not write a token (${outcome})`);
  }
}

/**
 * Attach the rotation hook (idempotent). Boot code calls this once from the
 * auth provider, next to the other `auth:changed` consumers.
 *
 * @returns a stop() that removes the subscription (and re-arms attach).
 */
export function attachRelayTokenRotationReinject(
  deps: RelayTokenRotationDeps = {},
): () => void {
  if (attached) return () => {};
  attached = true;

  /** The last PASETO this hook saw — an equal token is not a rotation. */
  let lastObserved: string | null = null;

  const handler = (token: string) => {
    if (!token) return;
    if (token === lastObserved) return;
    lastObserved = token;
    void runRelayTokenRotationReinject(token, deps).catch((e: any) => {
      log.warn('rotation re-inject crashed:', e?.message ?? String(e));
    });
  };

  const unsubscribe = (deps.subscribe ?? defaultSubscribe)(handler);

  return () => {
    unsubscribe();
    attached = false;
  };
}

/** Test-only: forget that the hook was attached (allows re-attach). */
export function detachRelayTokenRotationReinjectForTests(): void {
  attached = false;
}
