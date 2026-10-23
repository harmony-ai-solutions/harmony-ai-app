/**
 * RelayAuthRecovery — the app's ONE honest path for giving the embedded engine
 * a relay credential the Soulbits Cloud relay will actually accept.
 *
 * Background (2026-10-22/23 production incidents): the relay token the engine
 * holds is the account PASETO — a ≤1h credential the app snapshots into the
 * engine's sync-client config. When it expires, the relay rejects the dial
 * (close 4001) and the engine reports `auth_needed`. The app's only fix is to
 * refresh the PASETO and write it back. Two incidents shaped this module:
 *
 *   - 2026-10-22: the old recovery re-PUT the SAME stale token after a silent
 *     no-op refresh while logging "relay auth refreshed" — the relay kept
 *     rejecting every dial for minutes. Hence the **verify-before-PUT
 *     discipline** below: a token that is empty, unchanged by the refresh,
 *     already applied, or already expired is NEVER written.
 *   - 2026-10-23: the recovery only ran while the Desktop Sync screen was
 *     open, so an overnight expiry left sync dead until the user visited it.
 *     Hence the shared service: the screen, the app-foreground self-heal
 *     (`relayAuthForegroundHeal`) and the token-rotation re-inject
 *     (`relayTokenRotationReinject`) all funnel through the gates here.
 *
 * Nothing here starts, stops or restarts the engine, and nothing here touches
 * entities, providers or any other cloud-auth consumer: a broken relay token
 * only affects the sync transport, so the fix is scoped to the sync config.
 *
 * Entry points (all single-flight — concurrent callers share one attempt, so a
 * foreground heal racing a screen recovery can never double-PUT):
 *
 *   - {@link recoverRelayAuth} — the `auth_needed` recovery: refresh the PASETO,
 *     verify it is genuinely fresh, then PUT it.
 *   - {@link reinjectRotatedRelayToken} — the proactive path: a successful
 *     refresh already rotated the PASETO, so verify the CURRENT token and PUT it
 *     without refreshing again (a second refresh would rotate twice for one
 *     recovery). The same gates make it idempotent.
 *
 * "Last applied token" is module state (not a per-screen ref): a token the
 * engine already accepted must never be re-sent, no matter which surface or
 * remount asks next.
 */

import { engineApiClient } from '../engine/EngineApiClient';
import type { SyncClientStatusDto } from '../engine/EngineApiClient';
import AuthService from '../auth/AuthService';
import { createLogger } from '../../utils/logger';

const log = createLogger('[RelayAuthRecovery]');

// ── Types ───────────────────────────────────────────────────────────────

/**
 * The honest outcome of an attempt:
 *   - `recovered`  → a verified fresh token was accepted by the engine (one PUT);
 *   - `failed`     → no PUT happened (transient refresh error, or a token that
 *                    failed a freshness gate, or the engine rejected the write);
 *   - `signed_out` → the refresh token was rejected (or none is stored); only
 *                    re-signing in helps.
 */
export type RelayAuthRecoveryOutcome = 'recovered' | 'failed' | 'signed_out';

/** The two callers' copy: the recovery (refresh first) vs the rotation re-inject. */
type VerifiedPutCopy = {
  empty: string;
  unchanged: string;
  alreadyApplied: string;
  expired: string;
  rejected: string;
  applied: string;
};

const RECOVERY_COPY: VerifiedPutCopy = {
  empty: 'relay auth recovery skipped: refresh produced an empty token',
  unchanged: 'relay auth recovery skipped: the token is unchanged after the refresh',
  alreadyApplied: 'relay auth recovery skipped: this token is already applied to the engine',
  expired: 'relay auth recovery skipped: the refreshed token is already expired',
  rejected: 'relay auth recovery failed: relay token update rejected:',
  applied: 'relay auth refreshed',
};

const ROTATION_COPY: VerifiedPutCopy = {
  empty: 'relay auth re-inject skipped: the rotated token is empty',
  unchanged: 'relay auth re-inject skipped: the token did not change',
  alreadyApplied: 'relay auth re-inject skipped: this token is already applied to the engine',
  expired: 'relay auth re-inject skipped: the rotated token is already expired',
  rejected: 'relay auth re-inject failed: relay token update rejected:',
  applied: 'relay auth token re-injected after rotation',
};

// ── Module state ────────────────────────────────────────────────────────

/** The last relay token this app successfully PUT to the engine. */
let lastAppliedRelayToken: string | null = null;

/** The single attempt in flight, shared by every concurrent caller. */
let inFlight: Promise<RelayAuthRecoveryOutcome> | null = null;

// ── Predicates (single source of truth for every surface) ────────────────

/**
 * True when the engine reports the relay rejected its bearer. The engine
 * surfaces this in TWO places and both must be honoured:
 *   - `state: 'auth_needed'` (the client role's own state), and
 *   - `relay.auth_needed` (a relay bridge that disconnected for auth).
 * An older engine may report only one of them.
 */
export function needsRelayAuth(
  status: Pick<SyncClientStatusDto, 'state' | 'relay'>,
): boolean {
  return status.state === 'auth_needed' || status.relay?.auth_needed === true;
}

/**
 * True when this engine actually uses the cloud relay (sync enabled AND the
 * relay transport selected). A LAN-only or disabled client has no relay token
 * to keep fresh, so the proactive rotation re-inject stays out of its way.
 */
export function isRelaySyncConfigured(
  status: Pick<SyncClientStatusDto, 'config'>,
): boolean {
  return status.config?.enabled === true && status.config?.transport === 'relay';
}

/** The last token this app applied to the engine (null until one is accepted). */
export function getLastAppliedRelayToken(): string | null {
  return lastAppliedRelayToken;
}

// ── Single-flight wrapper ───────────────────────────────────────────────

/**
 * Run ONE attempt at a time. A concurrent caller (the screen's recovery racing
 * a foreground heal, or the rotation hook firing inside the recovery's own
 * refresh) joins the in-flight attempt instead of starting a second one — the
 * only way a single fresh token can never be PUT twice.
 */
function singleFlight(
  run: () => Promise<RelayAuthRecoveryOutcome>,
): Promise<RelayAuthRecoveryOutcome> {
  if (inFlight) return inFlight;

  const attempt = (async () => run())();
  inFlight = attempt;

  const clear = () => {
    if (inFlight === attempt) inFlight = null;
  };
  void attempt.then(clear, clear);

  return attempt;
}

// ── The verified PUT (the sacred gate) ──────────────────────────────────

/**
 * PUT `token` ONLY when it is genuinely fresh: non-empty, different from the
 * token captured before the refresh, not the token the engine already has, and
 * not already expired. Every gate failure is a `failed` outcome with an honest
 * log — never a write.
 */
async function putVerifiedToken(
  token: string,
  previousToken: string | null,
  copy: VerifiedPutCopy,
): Promise<RelayAuthRecoveryOutcome> {
  if (!token) {
    log.warn(copy.empty);
    return 'failed';
  }
  if (previousToken !== null && token === previousToken) {
    log.warn(copy.unchanged);
    return 'failed';
  }
  if (token === lastAppliedRelayToken) {
    log.warn(copy.alreadyApplied);
    return 'failed';
  }
  // AuthService exposes the cached PASETO expiry (`getTokenExpiresAt` /
  // `isTokenExpired`, derived from `expires_at`). Unknown expiry (0) is not
  // treated as expired — only a known-past expiry blocks the PUT.
  if (AuthService.isTokenExpired?.() === true) {
    log.warn(copy.expired);
    return 'failed';
  }

  try {
    await engineApiClient.updateSyncClientConfig({ relay_token: token });
    lastAppliedRelayToken = token;
    // The success log belongs to the VERIFIED path only, on the same code path
    // as the write — the pre-incident version logged it unconditionally.
    log.info(copy.applied);
    return 'recovered';
  } catch (e: any) {
    log.warn(copy.rejected, e?.message ?? String(e));
    return 'failed';
  }
}

/** Read the current PASETO, or null when it cannot be obtained. */
async function currentToken(): Promise<string | null> {
  try {
    const token = await AuthService.getToken();
    return token || null;
  } catch {
    return null;
  }
}

// ── Entry point 1: the auth_needed recovery ─────────────────────────────

/**
 * Recover a relay token the engine's relay has rejected (`auth_needed`):
 * refresh the account PASETO and re-PUT it **only** after verifying it is
 * genuinely fresh. Returns the honest outcome so the caller can tell the truth.
 */
export function recoverRelayAuth(): Promise<RelayAuthRecoveryOutcome> {
  return singleFlight(async () => {
    // Read the credential the engine currently holds BEFORE refreshing. This
    // also warms AuthService's cache (loading the refresh token from Keychain
    // on a cold start) so the refresh below cannot spuriously report a
    // terminal failure just because nothing had been read yet.
    let previousToken: string | null = null;
    try {
      previousToken = await AuthService.getToken();
    } catch {
      // No stored credential at all — the refresh cannot help; it returns
      // false below (no refresh token) and the terminal path handles it.
    }

    let refreshed: boolean;
    try {
      refreshed = await AuthService.refresh();
    } catch (e: any) {
      // TRANSIENT (network / 5xx): the credentials may still be valid, so do
      // not claim the sign-in expired — but never PUT the unverified token.
      log.warn('relay auth recovery failed: refresh error:', e?.message ?? String(e));
      return 'failed';
    }

    if (!refreshed) {
      // TERMINAL: the refresh token was rejected (or none is stored).
      log.warn('relay auth recovery failed: cloud sign-in expired (refresh rejected)');
      return 'signed_out';
    }

    let token: string;
    try {
      token = await AuthService.getToken();
    } catch (e: any) {
      log.warn(
        'relay auth recovery failed: no cloud token after refresh:',
        e?.message ?? String(e),
      );
      return 'signed_out';
    }

    return putVerifiedToken(token, previousToken, RECOVERY_COPY);
  });
}

// ── Entry point 2: the proactive rotation re-inject ─────────────────────

/**
 * Re-inject a PASETO that AuthService already rotated (a successful refresh).
 * No refresh happens here — the credential is new by construction — so this is
 * the same verify-before-PUT gate applied to the CURRENT token: empty,
 * already-applied (same as what the engine has) and already-expired tokens are
 * never written. That makes a repeated/duplicated `auth:changed` harmless.
 *
 * @param token the rotated PASETO from the event; when omitted it is read from
 *              AuthService (the same value the rotate just cached).
 */
export function reinjectRotatedRelayToken(
  token?: string,
): Promise<RelayAuthRecoveryOutcome> {
  return singleFlight(async () => {
    // An explicitly supplied (possibly empty) token is judged as-is by the
    // gates below; only an omitted one is read back from AuthService.
    let rotated: string;
    if (token === undefined) {
      const cached = await currentToken();
      if (!cached) {
        log.warn('relay auth re-inject failed: no cloud token after rotation');
        return 'signed_out';
      }
      rotated = cached;
    } else {
      rotated = token;
    }
    return putVerifiedToken(rotated, null, ROTATION_COPY);
  });
}

// ── Test support ────────────────────────────────────────────────────────

/**
 * Forget the module state (the applied token + any in-flight attempt) so suites
 * start from a cold app. Test-only — never called by production code.
 */
export function resetRelayAuthRecoveryForTests(): void {
  lastAppliedRelayToken = null;
  inFlight = null;
}
