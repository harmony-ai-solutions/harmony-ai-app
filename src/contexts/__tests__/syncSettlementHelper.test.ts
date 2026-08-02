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
import { isSyncTransportSettled } from '../syncSettlementHelper';

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
