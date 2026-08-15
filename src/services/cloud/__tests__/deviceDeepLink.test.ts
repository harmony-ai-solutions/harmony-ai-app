/**
 * parseDeviceDeepLink tests (D-DEV-01, Phase 4-1).
 *
 * Covers the strict parse contract:
 *   - valid `soulbits://device-auth?code=123456` → { code }
 *   - wrong host / wrong scheme → null
 *   - non-6-digit code → null
 *   - extra query params tolerated
 *   - uppercase scheme tolerated (Android lowercases; iOS may not)
 */

import { parseDeviceDeepLink } from '../deviceDeepLink';

describe('parseDeviceDeepLink', () => {
  it('parses a valid device-auth deep link', () => {
    expect(parseDeviceDeepLink('soulbits://device-auth?code=123456')).toEqual({
      code: '123456',
    });
  });

  it('rejects a link with the wrong host', () => {
    expect(parseDeviceDeepLink('soulbits://other-host?code=123456')).toBeNull();
    expect(parseDeviceDeepLink('soulbits://device-auth.evil.com?code=123456')).toBeNull();
  });

  it('rejects a link with the wrong scheme', () => {
    expect(parseDeviceDeepLink('https://device-auth?code=123456')).toBeNull();
    expect(parseDeviceDeepLink('soulbitsx://device-auth?code=123456')).toBeNull();
  });

  it('rejects a non-6-digit code', () => {
    expect(parseDeviceDeepLink('soulbits://device-auth?code=12345')).toBeNull();
    expect(parseDeviceDeepLink('soulbits://device-auth?code=1234567')).toBeNull();
    expect(parseDeviceDeepLink('soulbits://device-auth?code=abcdef')).toBeNull();
    expect(parseDeviceDeepLink('soulbits://device-auth?code=')).toBeNull();
  });

  it('tolerates extra query params alongside the code', () => {
    expect(
      parseDeviceDeepLink(
        'soulbits://device-auth?code=123456&utm_source=email&device=iphone',
      ),
    ).toEqual({ code: '123456' });
  });

  it('tolerates an uppercase scheme (case-insensitive scheme match)', () => {
    expect(parseDeviceDeepLink('SOULBITS://device-auth?code=123456')).toEqual({
      code: '123456',
    });
    expect(parseDeviceDeepLink('Soulbits://device-auth?code=123456')).toEqual({
      code: '123456',
    });
  });

  it('returns null for empty / non-URL input', () => {
    expect(parseDeviceDeepLink('')).toBeNull();
    expect(parseDeviceDeepLink('not a url')).toBeNull();
  });
});
