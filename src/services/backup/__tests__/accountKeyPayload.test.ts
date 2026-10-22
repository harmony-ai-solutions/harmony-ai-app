/**
 * accountKeyPayload codec tests (owner ruling 2026-10-17). Pins the v1 payload
 * shape, the legacy raw-DEK fallback, and the empty/garbage inputs.
 */

import {
  encodeAccountKeyPayload,
  decodeAccountKeyPayload,
} from '../accountKeyPayload';

describe('accountKeyPayload', () => {
  it('round-trips the v1 payload (DEK + code)', () => {
    const dek = 'ZGVrLWJhc2U2NA==';
    const code = 'a'.repeat(64);
    const blob = encodeAccountKeyPayload(dek, code);
    expect(decodeAccountKeyPayload(blob)).toEqual({ dekBase64: dek, code });
  });

  it('omits the code when empty (decode yields no code)', () => {
    const blob = encodeAccountKeyPayload('ZGVr', '');
    const decoded = decodeAccountKeyPayload(blob);
    expect(decoded?.dekBase64).toBe('ZGVr');
    expect(decoded?.code).toBeUndefined();
  });

  it('decodes the LEGACY raw-base64 DEK (no code)', () => {
    // A legacy blob IS the base64 DEK itself.
    const decoded = decodeAccountKeyPayload('ZGVr');
    expect(decoded).toEqual({ dekBase64: 'ZGVr' });
  });

  it('falls back to the legacy shape for non-JSON base64', () => {
    const decoded = decodeAccountKeyPayload('RUtF');
    expect(decoded).toEqual({ dekBase64: 'RUtF' });
  });

  it('returns null for an empty / whitespace blob', () => {
    expect(decodeAccountKeyPayload('')).toBeNull();
    expect(decodeAccountKeyPayload('   ')).toBeNull();
  });

  it('treats a JSON blob without v:1 as the legacy shape', () => {
    // base64 of `{"foo":"bar"}` — not a v1 payload.
    const blob = Buffer.from(JSON.stringify({ foo: 'bar' }), 'utf8').toString('base64');
    const decoded = decodeAccountKeyPayload(blob);
    expect(decoded).toEqual({ dekBase64: blob });
  });
});
