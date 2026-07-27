/**
 * Pure helper for deriving connection status display info and chat-usable predicate.
 *
 * Extracted from SyncConnectionContext so it can be unit-tested without
 * rendering the provider (same pattern as Phase 9).
 */
import type { CloudSessionStatus } from '../services/cloud/CloudSessionService';
import type { SyncSource } from '../services/ConnectionStateManager';

export type ConnectionStatusLabel =
  | 'connected'
  | 'connecting'
  | 'preparing'
  | 'offline'
  | 'reconnecting'
  | 'disconnected'
  | 'notPaired';

export interface ConnectionStatusInfo {
  /** i18n-friendly label key for the current connection state. */
  textKey: ConnectionStatusLabel;
  /** Default hex colour (theme-aware screens may override via `variant`). */
  color: string;
  /** Semantic variant for themed colour resolution. */
  variant: 'success' | 'warning' | 'error' | 'muted';
  /** Which sync mode is active. */
  mode: SyncSource;
}

/**
 * Compute a mode-aware connection status for the current state.
 *
 * @param mode        'cloud' or 'selfhosted' (from ConnectionStateManager.getCurrentSource())
 * @param cloudStatus Cloud session status (only meaningful when mode === 'cloud')
 * @param isPaired    Self-hosted pairing state
 * @param isConnected  Whether the sync WebSocket is currently open
 * @param isReconnecting Whether a reconnect is scheduled/in-flight
 */
export function computeConnectionStatus(
  mode: SyncSource,
  cloudStatus: CloudSessionStatus,
  isPaired: boolean,
  isConnected: boolean,
  isReconnecting: boolean,
): ConnectionStatusInfo {
  if (mode === 'cloud') {
    switch (cloudStatus) {
      case 'ready':
        if (isConnected) {
          return {
            textKey: 'connected',
            color: '#4CAF50',
            variant: 'success',
            mode: 'cloud',
          };
        }
        return {
          textKey: 'connecting',
          color: '#ff9800',
          variant: 'warning',
          mode: 'cloud',
        };
      case 'provisioning':
      case 'requesting':
        return {
          textKey: 'preparing',
          color: '#ff9800',
          variant: 'warning',
          mode: 'cloud',
        };
      case 'failed':
        return {
          textKey: 'offline',
          color: '#f44336',
          variant: 'error',
          mode: 'cloud',
        };
      case 'idle':
      default:
        return {
          textKey: 'offline',
          color: '#9692b0',
          variant: 'muted',
          mode: 'cloud',
        };
    }
  }

  // ── Self-hosted ────────────────────────────────────────────────────────
  if (!isPaired) {
    return {
      textKey: 'notPaired',
      color: '#f44336',
      variant: 'error',
      mode: 'selfhosted',
    };
  }
  if (isConnected) {
    return {
      textKey: 'connected',
      color: '#4CAF50',
      variant: 'success',
      mode: 'selfhosted',
    };
  }
  if (isReconnecting) {
    return {
      textKey: 'reconnecting',
      color: '#ff9800',
      variant: 'warning',
      mode: 'selfhosted',
    };
  }
  return {
    textKey: 'disconnected',
    color: '#9692b0',
    variant: 'muted',
    mode: 'selfhosted',
  };
}

/**
 * Whether the current mode + state allows the conversation list and chat to
 * render meaningfully.
 *
 * - **cloud:** cloud session is `ready` (broker-routable; local SQLite data
 *   exists at that point).
 * - **self-hosted:** device is paired (conversations exist locally once paired).
 */
export function canUseChatForMode(
  mode: SyncSource,
  cloudStatus: CloudSessionStatus,
  isPaired: boolean,
): boolean {
  if (mode === 'cloud') {
    return cloudStatus === 'ready';
  }
  return isPaired;
}
