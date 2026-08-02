/**
 * Pure helper: whether the current sync connection is on a "settled" transport.
 *
 * Extracted from SyncConnectionContext so it can be unit-tested without
 * rendering the provider (same pattern as connectionStatusHelper).
 *
 * Rationale:
 * During pairing, the app first connects over plaintext ws:// to perform the
 * handshake and learn the server's WSS upgrade details (port + cert). Auto-
 * syncing on that provisional connection is wrong for two reasons:
 *   1. Sensitive sync data (character profiles, entities, messages) would be
 *      sent/received over unencrypted ws:// before the TLS decision is made.
 *   2. The subsequent ws→wss upgrade tears the connection down mid-sync,
 *      orphaning the SyncService session (the "sync already in progress"
 *      stuck-state bug).
 *
 * A connection is "settled" (safe to sync on) when it is the FINAL,
 * user-confirmed transport:
 *  - cloud / secure / insecure-ssl are always final transports (TLS in use)
 *  - unencrypted (ws://) is only final if the user explicitly persisted that
 *    security mode as their choice
 *
 * @param connMode       The mode of the live sync connection
 *                       (ConnectionManager.ConnectionInfo.mode), or undefined
 *                       if there is no connection info yet.
 * @param persistedMode  The user's persisted security mode
 *                       (ConnectionStateManager.getSecurityMode()), or null if
 *                       none chosen yet.
 */
export function isSyncTransportSettled(
  connMode: 'unencrypted' | 'secure' | 'insecure-ssl' | 'cloud' | undefined,
  persistedMode: string | null,
): boolean {
  // No connection info → nothing to sync on yet.
  if (!connMode) {
    return false;
  }

  // TLS transports (including cloud's broker route) are always final.
  if (connMode === 'cloud' || connMode === 'secure' || connMode === 'insecure-ssl') {
    return true;
  }

  // Plaintext ws:// is settled ONLY if the user explicitly confirmed it as
  // their security mode. Otherwise it is the provisional handshake connection
  // and sync must be deferred until the TLS upgrade (or an explicit choice).
  if (connMode === 'unencrypted') {
    return persistedMode === 'unencrypted';
  }

  // Defensive: unknown connection mode → treat as unsettled.
  return false;
}
