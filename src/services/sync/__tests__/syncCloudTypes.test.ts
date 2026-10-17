/**
 * syncCloudTypes — pairing-payload parser + account-hint matcher (plan 7-3).
 */

import {
  parseSyncPairingPayload,
  parseSyncPairingPayloadV2,
  accountHintMatches,
  maskedAccountHintMatches,
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

// ── Parser v2 (plan 7-15) ────────────────────────────────────────────────────

const LAN_PAYLOAD = {
  v: 1,
  kind: 'soulbits-lan',
  ws: '192.168.1.10:28080',
  wss: '192.168.1.10:28443',
  mode: 'secure',
  fingerprint: 'sha256:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89',
  dataset_id: 'engine-8f0a1b3c5d7e9f02',
  name: 'Studio-PC',
  secret: 'sekret-256',
  ttl: 300,
};

describe('parseSyncPairingPayloadV2', () => {
  it('parses the cloud shape as the cloud kind (back-compat)', () => {
    const route = parseSyncPairingPayloadV2(
      JSON.stringify({
        relay_url: 'wss://sync.soulbits.app/v1/sync/ws',
        pairing_token: 'tok-123',
        account_hint: 'user@example.com',
      }),
    );
    expect(route.kind).toBe('cloud');
    if (route.kind !== 'cloud') return;
    expect(route.payload).toEqual({
      relay_url: 'wss://sync.soulbits.app/v1/sync/ws',
      pairing_token: 'tok-123',
      account_hint: 'user@example.com',
    });
  });

  it('parses the query-style cloud fallback', () => {
    const route = parseSyncPairingPayloadV2('relay_url=wss%3A%2F%2Fx%2Fv1%2Fsync%2Fws&pairing_token=t');
    expect(route.kind).toBe('cloud');
  });

  it('parses a full LAN payload', () => {
    const route = parseSyncPairingPayloadV2(JSON.stringify(LAN_PAYLOAD));
    expect(route.kind).toBe('lan');
    if (route.kind !== 'lan') return;
    expect(route.payload).toEqual(LAN_PAYLOAD);
  });

  it('tolerates a LAN payload missing wss / fingerprint (no TLS endpoint)', () => {
    const { wss, fingerprint, ...rest } = LAN_PAYLOAD;
    const route = parseSyncPairingPayloadV2(JSON.stringify(rest));
    expect(route.kind).toBe('lan');
    if (route.kind !== 'lan') return;
    expect(route.payload.wss).toBeUndefined();
    expect(route.payload.fingerprint).toBeUndefined();
    expect(route.payload.enrollment).toBeUndefined();
    expect(route.payload.mode).toBe('secure');
  });

  it('parses the optional enrollment block when present', () => {
    const route = parseSyncPairingPayloadV2(
      JSON.stringify({
        ...LAN_PAYLOAD,
        enrollment: {
          relay_url: 'wss://sync.soulbits.app/v1/sync/ws',
          grant: 'grant-1',
          account_hint: 'u***@example.com',
        },
      }),
    );
    expect(route.kind).toBe('lan');
    if (route.kind !== 'lan') return;
    expect(route.payload.enrollment).toEqual({
      relay_url: 'wss://sync.soulbits.app/v1/sync/ws',
      grant: 'grant-1',
      account_hint: 'u***@example.com',
    });
  });

  it('drops a malformed enrollment block rather than failing the whole payload', () => {
    const route = parseSyncPairingPayloadV2(
      JSON.stringify({ ...LAN_PAYLOAD, enrollment: { account_hint: 'u***@example.com' } }),
    );
    expect(route.kind).toBe('lan');
    if (route.kind !== 'lan') return;
    expect(route.payload.enrollment).toBeUndefined();
  });

  it('rejects an unsupported LAN payload version', () => {
    expect(() =>
      parseSyncPairingPayloadV2(JSON.stringify({ ...LAN_PAYLOAD, v: 2 })),
    ).toThrow(SyncPairingParseError);
  });

  it('rejects a LAN payload missing required fields', () => {
    const { dataset_id, ...rest } = LAN_PAYLOAD;
    expect(() => parseSyncPairingPayloadV2(JSON.stringify(rest))).toThrow(SyncPairingParseError);
  });

  it('rejects an empty code', () => {
    expect(() => parseSyncPairingPayloadV2('')).toThrow(SyncPairingParseError);
  });

  it('keeps the legacy parser cloud-only (rejects a LAN payload)', () => {
    expect(() => parseSyncPairingPayload(JSON.stringify(LAN_PAYLOAD))).toThrow(
      SyncPairingParseError,
    );
  });
});

describe('maskedAccountHintMatches', () => {
  it('treats a blank hint as unconstrained', () => {
    expect(maskedAccountHintMatches('', [])).toBe(true);
  });

  it('delegates an unmasked hint to the exact matcher', () => {
    expect(maskedAccountHintMatches('User@Example.com', ['user@example.com'])).toBe(true);
    expect(maskedAccountHintMatches('other@example.com', ['user@example.com'])).toBe(false);
  });

  it('matches a masked hint by conservative prefix + suffix', () => {
    expect(maskedAccountHintMatches('u***@example.com', ['user@example.com'])).toBe(true);
    expect(maskedAccountHintMatches('u***@example.com', ['uid-1@example.com'])).toBe(true);
  });

  it('rejects a masked hint when the suffix differs', () => {
    expect(maskedAccountHintMatches('u***@example.com', ['user@other.com'])).toBe(false);
  });

  it('rejects a masked hint when the identifier is too short to contain both ends', () => {
    expect(maskedAccountHintMatches('u***@example.com', ['user@e.com'])).toBe(false);
  });
});
