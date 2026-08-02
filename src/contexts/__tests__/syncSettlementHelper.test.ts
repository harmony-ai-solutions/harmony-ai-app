/**
 * Unit tests for isSyncTransportSettled — the pure "settled connection" gate.
 *
 * Extracted from SyncConnectionContext so it can be unit-tested without
 * rendering the provider (same pattern as connectionStatusHelper / Phase 9).
 *
 * The gate enforces that a sync is only auto-started once the connection is on
 * a FINAL, user-confirmed transport:
 *  - cloud / secure / insecure-ssl are always final transports
 *  - unencrypted (ws://) is only final if the user explicitly persisted it
 *
 * This prevents sensitive data being pushed/received over the provisional
 * plaintext ws:// handshake connection before the TLS upgrade decision.
 */
import {
  isSyncTransportSettled,
  shouldShowConnectionErrorToast,
  shouldShowConnectionErrorToastForConnection,
} from '../syncSettlementHelper';

describe('isSyncTransportSettled', () => {
  describe('cloud transport', () => {
    it('is always settled regardless of persisted security mode', () => {
      expect(isSyncTransportSettled('cloud', null)).toBe(true);
      expect(isSyncTransportSettled('cloud', 'secure')).toBe(true);
      expect(isSyncTransportSettled('cloud', 'insecure-ssl')).toBe(true);
      expect(isSyncTransportSettled('cloud', 'unencrypted')).toBe(true);
    });
  });

  describe('secure (verified TLS) transport', () => {
    it('is settled regardless of persisted mode', () => {
      expect(isSyncTransportSettled('secure', null)).toBe(true);
      expect(isSyncTransportSettled('secure', 'secure')).toBe(true);
      expect(isSyncTransportSettled('secure', 'unencrypted')).toBe(true);
    });
  });

  describe('insecure-ssl (self-signed TLS) transport', () => {
    it('is settled regardless of persisted mode', () => {
      expect(isSyncTransportSettled('insecure-ssl', null)).toBe(true);
      expect(isSyncTransportSettled('insecure-ssl', 'insecure-ssl')).toBe(true);
      expect(isSyncTransportSettled('insecure-ssl', 'secure')).toBe(true);
    });
  });

  describe('unencrypted (plaintext ws://) transport', () => {
    it('is NOT settled when no security mode persisted yet (provisional handshake connection)', () => {
      expect(isSyncTransportSettled('unencrypted', null)).toBe(false);
    });

    it('is NOT settled when persisted mode is secure (upgrade pending)', () => {
      expect(isSyncTransportSettled('unencrypted', 'secure')).toBe(false);
    });

    it('is NOT settled when persisted mode is insecure-ssl', () => {
      expect(isSyncTransportSettled('unencrypted', 'insecure-ssl')).toBe(false);
    });

    it('IS settled when user explicitly persisted unencrypted mode', () => {
      expect(isSyncTransportSettled('unencrypted', 'unencrypted')).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('is not settled when there is no connection info (undefined mode)', () => {
      expect(isSyncTransportSettled(undefined, null)).toBe(false);
      expect(isSyncTransportSettled(undefined, 'secure')).toBe(false);
    });

    it('is not settled for unknown/unexpected connection modes', () => {
      // @ts-expect-error testing defensive handling of unexpected values
      expect(isSyncTransportSettled('bogus', null)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// shouldShowConnectionErrorToast
// ---------------------------------------------------------------------------
// Suppresses misleading connection-error toasts that are byproducts of the
// expected handshake / cert-decision flow during pairing. A toast may only
// show when ALL of these hold:
//   - the transport is settled (not the provisional ws:// handshake connection)
//   - no cert-verification decision is pending (the cert modal is the UX)
//   - not reconnecting / no reconnect retries (only the first failure may toast)
describe('shouldShowConnectionErrorToast', () => {
  const settledIdle = {
    isTransportSettled: true,
    isReconnecting: false,
    reconnectAttempt: 0,
    isCertFlowActive: false,
  };

  it('is true on a settled transport with no cert flow and no reconnect', () => {
    expect(shouldShowConnectionErrorToast(settledIdle)).toBe(true);
  });

  it('is NEVER true on the provisional (unsettled) handshake connection', () => {
    // Unsettled even with everything else "quiet" — the ws:// handshake
    // connection errors are expected byproducts during pairing.
    expect(
      shouldShowConnectionErrorToast({ ...settledIdle, isTransportSettled: false }),
    ).toBe(false);
    // Unsettled + every other condition true must still be false.
    expect(
      shouldShowConnectionErrorToast({
        ...settledIdle,
        isTransportSettled: false,
        isReconnecting: true,
        reconnectAttempt: 3,
        isCertFlowActive: true,
      }),
    ).toBe(false);
  });

  it('is NEVER true while a cert-verification decision is pending', () => {
    // Settled transport (e.g. the failed TLS attempt itself is 'secure') but
    // the cert modal / decision is the intended UX — no toast.
    expect(
      shouldShowConnectionErrorToast({ ...settledIdle, isCertFlowActive: true }),
    ).toBe(false);
  });

  it('is NEVER true for the secure-attempt failure inside the handshake-accepted flow', () => {
    // ConnectionSetupScreen.handleHandshakeAccepted → attemptSecureConnection
    // rethrows a non-cert failure after HANDSHAKE_ACCEPT. During pairing no
    // security mode has been chosen yet (hasSelectedSecurityModeRef = false),
    // so the cert flow is active and there is no settled transport — the
    // "Failed to establish connection" toast must NOT show. This is the exact
    // parameter set the screen passes to the gate.
    expect(
      shouldShowConnectionErrorToast({
        isTransportSettled: false, // no settled transport — the wss attempt just failed
        isReconnecting: false,
        reconnectAttempt: 0,
        isCertFlowActive: true, // fresh pairing: no security mode chosen yet
      }),
    ).toBe(false);
  });

  it('is NEVER true while a reconnect is in flight', () => {
    expect(
      shouldShowConnectionErrorToast({ ...settledIdle, isReconnecting: true }),
    ).toBe(false);
    // Reconnecting beats everything, even an unsettled transport + cert flow.
    expect(
      shouldShowConnectionErrorToast({
        ...settledIdle,
        isReconnecting: true,
        isTransportSettled: false,
        isCertFlowActive: true,
      }),
    ).toBe(false);
  });

  it('is NEVER true once reconnect attempts have started (backoff loop)', () => {
    // Only the very first failure (attempt 0) may toast; retries are silent.
    expect(
      shouldShowConnectionErrorToast({ ...settledIdle, reconnectAttempt: 1 }),
    ).toBe(false);
    expect(
      shouldShowConnectionErrorToast({ ...settledIdle, reconnectAttempt: 5 }),
    ).toBe(false);
  });

  it('returns true again once the connection has settled after a reconnect', () => {
    // After a successful reconnect the attempt counter resets to 0 and
    // isReconnecting flips back to false — a fresh failure may toast again.
    expect(shouldShowConnectionErrorToast(settledIdle)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// shouldShowConnectionErrorToastForConnection
// ---------------------------------------------------------------------------
// Async wrapper used by SyncConnectionContext and ConnectionSetupScreen: it
// collapses the previously copy+pasted "resolve the live connection's settled
// transport + run the gate" wiring into a single call. The caller injects the
// connection-info + persisted-mode getters so this file stays pure (no RN
// module imports) and unit-testable.
describe('shouldShowConnectionErrorToastForConnection', () => {
  const quiet = {
    isReconnecting: false,
    reconnectAttempt: 0,
    isCertFlowActive: false,
  };

  it('returns true on a settled TLS connection with no cert flow and no reconnect', async () => {
    await expect(
      shouldShowConnectionErrorToastForConnection({
        ...quiet,
        getConnectionInfo: () => ({ mode: 'secure' }),
        getSecurityMode: async () => 'secure',
      }),
    ).resolves.toBe(true);
  });

  it('is false when the live connection is the provisional unencrypted handshake', async () => {
    // No persisted security mode → ws:// is provisional → unsettled → no toast.
    await expect(
      shouldShowConnectionErrorToastForConnection({
        ...quiet,
        getConnectionInfo: () => ({ mode: 'unencrypted' }),
        getSecurityMode: async () => null,
      }),
    ).resolves.toBe(false);
  });

  it('treats a persisted unencrypted mode as settled (user explicitly chose it)', async () => {
    await expect(
      shouldShowConnectionErrorToastForConnection({
        ...quiet,
        getConnectionInfo: () => ({ mode: 'unencrypted' }),
        getSecurityMode: async () => 'unencrypted',
      }),
    ).resolves.toBe(true);
  });

  it('is false while a cert decision is pending even on a settled TLS connection', async () => {
    await expect(
      shouldShowConnectionErrorToastForConnection({
        ...quiet,
        isCertFlowActive: true,
        getConnectionInfo: () => ({ mode: 'insecure-ssl' }),
        getSecurityMode: async () => 'insecure-ssl',
      }),
    ).resolves.toBe(false);
  });

  it('is false during the reconnect backoff loop', async () => {
    await expect(
      shouldShowConnectionErrorToastForConnection({
        isReconnecting: true,
        reconnectAttempt: 2,
        isCertFlowActive: false,
        getConnectionInfo: () => ({ mode: 'secure' }),
        getSecurityMode: async () => 'secure',
      }),
    ).resolves.toBe(false);
  });

  it('uses the LIVE connection info even when the persisted mode differs', async () => {
    // Live connection is cloud (always settled) despite a persisted 'unencrypted'.
    await expect(
      shouldShowConnectionErrorToastForConnection({
        ...quiet,
        getConnectionInfo: () => ({ mode: 'cloud' }),
        getSecurityMode: async () => 'unencrypted',
      }),
    ).resolves.toBe(true);
  });
});
