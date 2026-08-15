/**
 * deviceDeepLink — parse + validate `soulbits://device-auth` deep links
 * (D-DEV-01, Phase 4-1).
 *
 * The portal device-approve page fires "Open in the app" links shaped like
 * `soulbits://device-auth?code=<6-digit>` on mobile. The app receives them via
 * React Native `Linking` (cold-start `getInitialURL()` or warm `url` events).
 *
 * Parse contract (strict):
 *   - scheme must be `soulbits` (case-insensitive — the OS lowercases it on
 *     Android, but iOS may deliver it as typed).
 *   - host must be exactly `device-auth`.
 *   - `code` query param must be `/^\d{6}$/`.
 *   - extra query params are tolerated (e.g. analytics/utm tags).
 *
 * Anything else → `null` (caller treats as a stale/unrelated link and no-ops).
 */

export interface DeviceDeepLink {
  /** The validated 6-digit authorization code. */
  code: string;
}

const DEVICE_AUTH_HOST = 'device-auth';
const DEVICE_AUTH_SCHEME = 'soulbits';
const CODE_PATTERN = /^\d{6}$/;

/**
 * Parse a deep-link URL into a validated {@link DeviceDeepLink}, or `null` when
 * the link is not a device-auth link (wrong scheme/host) or its code is
 * malformed. Strict on scheme+host+code; lenient on extra query params.
 */
export function parseDeviceDeepLink(url: string): DeviceDeepLink | null {
  if (typeof url !== 'string' || url.length === 0) {
    return null;
  }

  // Split on the first '://' — manual parsing (rather than the URL constructor)
  // keeps this dependency-free and robust across RN/Node environments for a
  // custom non-web scheme.
  const schemeSep = url.indexOf('://');
  if (schemeSep <= 0) {
    return null;
  }

  const scheme = url.slice(0, schemeSep).toLowerCase();
  if (scheme !== DEVICE_AUTH_SCHEME) {
    return null;
  }

  const rest = url.slice(schemeSep + 3);
  const pathStart = rest.indexOf('/');
  const queryStart = rest.indexOf('?');
  const hostEnd = Math.min(
    pathStart === -1 ? rest.length : pathStart,
    queryStart === -1 ? rest.length : queryStart,
  );
  const host = rest.slice(0, hostEnd);
  if (host !== DEVICE_AUTH_HOST) {
    return null;
  }

  const query = queryStart === -1 ? '' : rest.slice(queryStart + 1);
  const params = new URLSearchParams(query);
  const code = params.get('code');
  if (!code || !CODE_PATTERN.test(code)) {
    return null;
  }

  return { code };
}
