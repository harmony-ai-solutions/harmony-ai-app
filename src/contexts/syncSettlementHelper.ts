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
export type SyncConnectionMode = 'unencrypted' | 'secure' | 'insecure-ssl' | 'cloud';

export function isSyncTransportSettled(
  connMode: SyncConnectionMode | undefined,
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

/**
 * Pure gate: whether a connection-error toast is worth showing.
 *
 * During pairing/initial sync the app deliberately connects over plaintext
 * ws:// (provisional), performs the handshake, then upgrades to wss:// and
 * verifies the cert. During that phase TLS/cert/connection errors are
 * EXPECTED byproducts — the cert modal is the intended UX, not a toast.
 *
 * Semantics (encode exactly this):
 *  - NEVER show if `!isTransportSettled` (provisional handshake connection),
 *    except when the user explicitly persisted 'unencrypted' (that case
 *    already yields isTransportSettled=true).
 *  - NEVER show if `isCertFlowActive` (cert modal / cert decision pending is
 *    the intended UX, not a toast).
 *  - NEVER show if `isReconnecting || reconnectAttempt > 0` (avoid toast spam
 *    during the reconnect backoff loop — only the first failure may toast).
 *  - Otherwise true.
 *
 * Pure — no side effects. The callers (SyncConnectionContext,
 * ConnectionSetupScreen) compute the inputs and keep the toasts themselves.
 */
export function shouldShowConnectionErrorToast(params: {
  isTransportSettled: boolean; // result of isSyncTransportSettled
  isReconnecting: boolean;
  reconnectAttempt: number;
  isCertFlowActive: boolean; // true when a cert-verification decision is pending/in-progress
}): boolean {
  // Provisional handshake connection — expected errors, no toast.
  if (!params.isTransportSettled) {
    return false;
  }

  // Cert modal / decision is the intended UX for TLS failures.
  if (params.isCertFlowActive) {
    return false;
  }

  // Reconnect backoff loop — only the first failure may toast.
  if (params.isReconnecting || params.reconnectAttempt > 0) {
    return false;
  }

  return true;
}

/**
 * Async wrapper around shouldShowConnectionErrorToast for the UI layers.
 *
 * Collapses the previously copy+pasted wiring — resolve the live sync
 * connection's settled state via isSyncTransportSettled, then run the gate —
 * which existed identically in SyncConnectionContext (handleSyncError +
 * connect() catch) and ConnectionSetupScreen (handleConnectionError +
 * handleHandshakeAccepted catch).
 *
 * The connection-info and persisted-mode getters are injected so this file
 * stays free of RN module imports and remains trivially unit-testable.
 *
 * @param getConnectionInfo Resolves the live sync connection info
 *                          (ConnectionManager.getSyncConnection()).
 * @param getSecurityMode   Resolves the persisted security mode
 *                          (ConnectionStateManager.getSecurityMode()).
 */
export async function shouldShowConnectionErrorToastForConnection(params: {
  getConnectionInfo: () => { mode?: SyncConnectionMode } | null | undefined;
  getSecurityMode: () => Promise<string | null>;
  isReconnecting: boolean;
  reconnectAttempt: number;
  isCertFlowActive: boolean;
}): Promise<boolean> {
  const conn = params.getConnectionInfo();
  const persistedMode = await params.getSecurityMode();
  return shouldShowConnectionErrorToast({
    isTransportSettled: isSyncTransportSettled(conn?.mode, persistedMode),
    isReconnecting: params.isReconnecting,
    reconnectAttempt: params.reconnectAttempt,
    isCertFlowActive: params.isCertFlowActive,
  });
}
