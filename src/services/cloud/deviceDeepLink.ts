/**
 * deviceDeepLink — parse + validate the app's `soulbits://` deep links.
 *
 * Two hosts are recognised:
 *
 *   - `device-auth` (D-DEV-01, Phase 4-1) — the portal device-approve page
 *     fires `soulbits://device-auth?code=<6-digit>` on mobile.
 *   - `connect-return` (Option B portal sign-in, owner-ruled 2026-10-17) — the
 *     portal `/connect` success page fires `soulbits://connect-return` on
 *     mobile to foreground the app so its poll fires immediately. It carries
 *     NO secrets/params; the app redeems through its own authenticated poll.
 *
 * The app receives them via React Native `Linking` (cold-start
 * `getInitialURL()` or warm `url` events).
 *
 * Parse contract (strict):
 *   - scheme must be `soulbits` (case-insensitive — the OS lowercases it on
 *     Android, but iOS may deliver it as typed).
 *   - host must be exactly `device-auth` (with a `/^\d{6}$/` `code`) or
 *     `connect-return` (no required params).
 *   - extra query params are tolerated (e.g. analytics/utm tags).
 *
 * Anything else → `null` (caller treats as a stale/unrelated link and no-ops).
 */

export interface DeviceDeepLink {
  /** The validated 6-digit authorization code. */
  code: string;
}

/**
 * The validated `soulbits://connect-return` deep link (Option B portal
 * sign-in). It carries NO parameters by design — the app still redeems its
 * token pair through its own secret-authenticated poll, so the link is a pure
 * "foreground the app" signal.
 */
export interface ConnectReturnDeepLink {
  host: 'connect-return';
}

const DEVICE_AUTH_HOST = 'device-auth';
const CONNECT_RETURN_HOST = 'connect-return';
const DEVICE_AUTH_SCHEME = 'soulbits';
const CODE_PATTERN = /^\d{6}$/;

/**
 * Split a custom-scheme URL into its lowercased scheme + host (up to the first
 * `/` or `?`). Returns null when the URL is not a `scheme://host…` shape.
 * Manual parsing (rather than the URL constructor) keeps this dependency-free
 * and robust across RN/Node for a custom non-web scheme.
 */
function splitSchemeHost(url: string): { scheme: string; host: string } | null {
  if (typeof url !== 'string' || url.length === 0) {
    return null;
  }
  const schemeSep = url.indexOf('://');
  if (schemeSep <= 0) {
    return null;
  }
  const scheme = url.slice(0, schemeSep).toLowerCase();
  const rest = url.slice(schemeSep + 3);
  const pathStart = rest.indexOf('/');
  const queryStart = rest.indexOf('?');
  const hostEnd = Math.min(
    pathStart === -1 ? rest.length : pathStart,
    queryStart === -1 ? rest.length : queryStart,
  );
  return { scheme, host: rest.slice(0, hostEnd) };
}

/**
 * Parse a deep-link URL into a validated {@link DeviceDeepLink}, or `null` when
 * the link is not a device-auth link (wrong scheme/host) or its code is
 * malformed. Strict on scheme+host+code; lenient on extra query params.
 */
export function parseDeviceDeepLink(url: string): DeviceDeepLink | null {
  const split = splitSchemeHost(url);
  if (!split || split.scheme !== DEVICE_AUTH_SCHEME || split.host !== DEVICE_AUTH_HOST) {
    return null;
  }

  const queryStart = url.indexOf('?');
  const query = queryStart === -1 ? '' : url.slice(queryStart + 1);
  const params = new URLSearchParams(query);
  const code = params.get('code');
  if (!code || !CODE_PATTERN.test(code)) {
    return null;
  }

  return { code };
}

/**
 * Parse a `soulbits://connect-return` deep link (Option B portal sign-in).
 * Strict on scheme + host, and carries no required params — the link is a pure
 * foreground signal (see {@link ConnectReturnDeepLink}). Returns `null` for any
 * other link so callers can no-op stale/unrelated URLs.
 */
export function parseConnectReturnDeepLink(url: string): ConnectReturnDeepLink | null {
  const split = splitSchemeHost(url);
  if (!split || split.scheme !== DEVICE_AUTH_SCHEME || split.host !== CONNECT_RETURN_HOST) {
    return null;
  }
  return { host: 'connect-return' };
}
