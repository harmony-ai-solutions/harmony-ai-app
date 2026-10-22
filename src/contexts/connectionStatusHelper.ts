/**
 * Pure helper for deriving connection status display info and chat-usable predicate.
 *
 * Extracted from SyncConnectionContext so it can be unit-tested without
 * rendering the provider (same pattern as Phase 9).
 *
 * ── Task 3-4 ─────────────────────────────────────────────────────────────
 * After the TS sync/cloud stack deletion the app connects ONLY to the embedded
 * engine (loopback WS + local management API). The former cloud-session
 * (`CloudSessionStatus`) and self-hosted pairing branches are gone; the status
 * is a straight function of the local engine connection.
 */
import type { SyncSource } from '../services/ConnectionStateManager';

export type ConnectionStatusLabel =
  | 'connected'
  | 'connecting'
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
  /** Which source is active (`selfhosted` = the embedded/local engine). */
  mode: SyncSource;
}

/**
 * Compute the engine connection status for the current state.
 *
 * @param mode          Current source (kept for API compatibility; the embedded
 *                      engine reports `selfhosted`).
 * @param isPaired      Whether the engine connection is available.
 * @param isConnected   Whether the engine WebSocket is currently open.
 * @param isReconnecting Whether a reconnect is scheduled/in-flight.
 */
export function computeConnectionStatus(
  mode: SyncSource,
  isPaired: boolean,
  isConnected: boolean,
  isReconnecting: boolean,
): ConnectionStatusInfo {
  if (!isPaired) {
    return { textKey: 'notPaired', color: '#f44336', variant: 'error', mode };
  }
  if (isConnected) {
    return { textKey: 'connected', color: '#4CAF50', variant: 'success', mode };
  }
  if (isReconnecting) {
    return { textKey: 'reconnecting', color: '#ff9800', variant: 'warning', mode };
  }
  return { textKey: 'disconnected', color: '#9692b0', variant: 'muted', mode };
}

/**
 * Whether the current state allows the conversation list and chat to render
 * meaningfully. With the embedded engine the app is self-contained — chat is
 * usable as soon as the engine connection is available.
 */
export function canUseChatForMode(
  _mode: SyncSource,
  isPaired: boolean,
): boolean {
  return isPaired;
}
