/**
 * CloudSessionService — broker spawn / claim / disconnect only.
 *
 * Orchestrates the broker side of a cloud session:
 *   - `POST /v1/session/connect`  — spawns / claims the per-user HL task
 *   - `POST /v1/session/disconnect` — triggers the broker's 5-min grace + snapshot
 *
 * This service does NOT open WebSocket connections.  WS connections remain owned
 * by SyncConnectionContext (sync) and EntitySessionService (entity); Phase 6-3
 * routes those to cloud URLs once `status === 'ready'`.
 *
 * Singleton — use `cloudSessionService` (the exported instance).
 */

import EventEmitter from 'eventemitter3';
import AuthService from '../auth/AuthService';
import { authFetch } from '../auth/authFetch';
import { AUTH_ENDPOINTS } from '../../config/cloud';
import { createLogger } from '../../utils/logger';

const log = createLogger('[CloudSession]');

// ── Types ─────────────────────────────────────────────────────────────────

export type CloudSessionStatus = 'idle' | 'spawning' | 'ready' | 'error';

interface CloudSessionEvents {
  'status': (status: CloudSessionStatus) => void;
}

// ── Service ───────────────────────────────────────────────────────────────

export class CloudSessionService extends EventEmitter<CloudSessionEvents> {
  private static instance: CloudSessionService;

  private status: CloudSessionStatus = 'idle';
  private sessionId: string | null = null;
  private proxyEndpoint: string | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  private constructor() {
    super();
  }

  // ── Singleton ───────────────────────────────────────────────────────────

  static getInstance(): CloudSessionService {
    if (!CloudSessionService.instance) {
      CloudSessionService.instance = new CloudSessionService();
    }
    return CloudSessionService.instance;
  }

  // ── Accessors ───────────────────────────────────────────────────────────

  getStatus(): CloudSessionStatus {
    return this.status;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  // ── Connect (spawn / claim) ─────────────────────────────────────────────

  /**
   * Spawn or claim the per-user HL task via the session broker.
   *
   * Idempotent — safe to call multiple times once `status === 'ready'`.
   * Does NOT open any WebSocket connections (existing services own their WS).
   *
   * @throws {Error} if the broker returns a non-OK status.
   */
  async connect(): Promise<void> {
    if (this.status === 'ready' && this.sessionId) {
      return; // already connected
    }

    this.status = 'spawning';
    this.emit('status', this.status);
    log.info('Requesting cloud session from broker');

    try {
      const res = await authFetch(AUTH_ENDPOINTS.sessionConnect, {
        method: 'POST',
      });

      if (!res.ok) {
        this.status = 'error';
        this.emit('status', this.status);
        throw new Error(`session/connect ${res.status}`);
      }

      const body = await res.json();
      this.sessionId = body.session_id;
      this.proxyEndpoint = body.proxy_endpoint;

      // The WS upgrade itself is the readiness signal — there is no explicit
      // one from the broker.  Existing services will retry the WS upgrade with
      // backoff until success (~30-35s for warm pool; longer for cold start).
      this.status = 'ready';
      this.emit('status', this.status);
      this.scheduleProactiveRefresh();
      log.info(`Cloud session ready: ${this.sessionId}`);
    } catch (e) {
      // Only flip to 'error' if we haven't already in the !res.ok branch.
      if (this.status === 'spawning') {
        this.status = 'error';
        this.emit('status', this.status);
      }
      throw e;
    }
  }
  
  // ── Proactive PASETO refresh ────────────────────────────────────────────

  /**
   * Schedule a token refresh 10 min before the current PASETO expires.
   * Reschedules after each successful refresh against the new token's expiry.
   * Minimum 30s delay to avoid pathological near-expiry scheduling.
   */
  private scheduleProactiveRefresh(): void {
    if (this.refreshTimer) { clearTimeout(this.refreshTimer); this.refreshTimer = null; }
    const expMs = AuthService.getTokenExpiresAt();
    if (!expMs) return; // no token / unknown expiry → can't schedule
    const fireMs = expMs - 10 * 60 * 1000;                 // 10 min before expiry
    const delayMs = Math.max(fireMs - Date.now(), 30 * 1000); // min 30s grace
    this.refreshTimer = setTimeout(async () => {
      try {
        const ok = await AuthService.refresh();
        if (ok) {
          this.scheduleProactiveRefresh(); // reschedule against the NEW token's expiry
        } else {
          log.warn('proactive refresh returned false; reactive layer will catch on next reconnect');
        }
      } catch (e) {
        log.warn('proactive refresh threw; reactive layer will catch on next reconnect', e);
      }
    }, delayMs);
    log.info(`Proactive refresh scheduled in ${Math.round(delayMs / 1000)}s`);
  }

  private stopProactiveRefresh(): void {
    if (this.refreshTimer) { clearTimeout(this.refreshTimer); this.refreshTimer = null; }
  }

  // ── Disconnect (grace period + snapshot) ────────────────────────────────

  /**
   * Trigger the broker's grace-period + snapshot flow.
   *
   * Safe to call multiple times — when `sessionId` is null (self-hosted mode
   * or already disconnected) this is a no-op that resets to 'idle'.
   *
   * Best-effort: if the RPC fails the session state is still reset locally
   * so the app can reconnect fresh later.
   */
  async disconnect(): Promise<void> {
    const sid = this.sessionId;
    if (!sid) {
      this.status = 'idle';
      this.emit('status', this.status);
      return;
    }

    try {
      await authFetch(AUTH_ENDPOINTS.sessionDisconnect, {
        method: 'POST',
        body: JSON.stringify({ session_id: sid }),
        headers: { 'Content-Type': 'application/json' },
      });
      log.info(`Cloud session ${sid} disconnect accepted (grace period started)`);
    } catch (e) {
      log.warn('Cloud disconnect failed (best-effort)', e);
    } finally {
      this.stopProactiveRefresh();
      this.sessionId = null;
      this.proxyEndpoint = null;
      this.status = 'idle';
      this.emit('status', this.status);
    }
  }
}

// ── Singleton export ──────────────────────────────────────────────────────

export const cloudSessionService = CloudSessionService.getInstance();
export default cloudSessionService;
