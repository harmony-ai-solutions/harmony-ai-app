/**
 * Loopback-token URL helper (7-11 pattern).
 *
 * The embedded engine's app-facing sockets are dialed over loopback and
 * authenticated with the per-process loopback token the sidecar publishes in
 * its readiness payload, carried as a `token` query parameter (React Native
 * WebSockets cannot set arbitrary custom headers). A URL carrying a non-empty
 * `token` param is therefore self-authenticating, and the connection wrappers
 * must NOT block it on the (now producerless) `soulbits_jwt` key.
 */

/** True when the URL carries a non-empty `token` query parameter. */
export function hasLoopbackTokenQueryParam(url: string): boolean {
  const queryStart = url.indexOf('?');
  if (queryStart === -1) return false;
  for (const pair of url.slice(queryStart + 1).split('&')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    if (pair.slice(0, eq) === 'token' && pair.slice(eq + 1).length > 0) {
      return true;
    }
  }
  return false;
}

/**
 * Append the loopback token as a `token` query parameter, respecting any query
 * string already on the URL. No-op for an empty URL or token (the loopback path
 * is disabled when the sidecar published no token).
 */
export function appendLoopbackToken(url: string, token: string): string {
  if (!url || !token) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}token=${encodeURIComponent(token)}`;
}
