/**
 * syncCloudTypes — pairing-payload parser + account-hint matcher (plan 7-3).
 */

import {
  parseSyncPairingPayload,
  accountHintMatches,
  SyncPairingParseError,
} from '../syncCloudTypes';

describe('parseSyncPairingPayload', () => {
  it('parses the canonical JSON payload', () => {
    const payload = parseSyncPairingPayload(
      JSON.stringify({
        relay_url: 'wss://sync.soulbits.app/v1/sync/ws',
        pairing_token: 'tok-123',
        account_hint: 'user@example.com',
      }),
    );
    expect(payload).toEqual({
      relay_url: 'wss://sync.soulbits.app/v1/sync/ws',
      pairing_token: 'tok-123',
      account_hint: 'user@example.com',
    });
  });

  it('parses a query-style string fallback', () => {
    const payload = parseSyncPairingPayload(
      'relay_url=wss%3A%2F%2Fsync.test%2Fv1%2Fsync%2Fws&pairing_token=t&account_hint=u',
    );
    expect(payload.relay_url).toBe('wss://sync.test/v1/sync/ws');
    expect(payload.pairing_token).toBe('t');
    expect(payload.account_hint).toBe('u');
  });

  it('tolerates a missing account_hint', () => {
    const payload = parseSyncPairingPayload(
      JSON.stringify({ relay_url: 'wss://x/v1/sync/ws', pairing_token: 't' }),
    );
    expect(payload.account_hint).toBe('');
  });

  it('rejects an empty code', () => {
    expect(() => parseSyncPairingPayload('')).toThrow(SyncPairingParseError);
  });

  it('rejects malformed JSON', () => {
    expect(() => parseSyncPairingPayload('{not json')).toThrow(SyncPairingParseError);
  });

  it('rejects a payload missing relay_url or pairing_token', () => {
    expect(() =>
      parseSyncPairingPayload(JSON.stringify({ relay_url: 'wss://x/v1/sync/ws' })),
    ).toThrow(SyncPairingParseError);
  });
});

describe('accountHintMatches', () => {
  it('matches case-insensitively against any signed-in identifier', () => {
    expect(accountHintMatches('User@Example.com', ['user@example.com'])).toBe(true);
    expect(accountHintMatches('other@example.com', ['user@example.com', 'uid-1'])).toBe(false);
  });

  it('treats a blank hint as unconstrained', () => {
    expect(accountHintMatches('', [])).toBe(true);
  });
});
