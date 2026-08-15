/**
 * CloudSessionService — broker session lifecycle (async provisioning).
 *
 * Orchestrates asynchronous session provisioning via `POST /v1/session/connect`,
 * delegating the entire poll state machine to the typed client's
 * `session.connectPoll()` (which sends `device_id`, handles the D-DEV-04
 * authorization gate, and owns the retry/timeout budget):
 *   - `connect()`  requests a session and resolves when the broker says `ready`.
 *   - `disconnect()` triggers the broker's 5-min grace + snapshot flow.
 *
 * Key design decisions:
 *   - **No `active` status** (decision 2). WS connectivity is tracked by
 *     `useSyncConnection().isConnected` at the sync-context layer.
 *     `status === 'ready'` means "broker says routable".
 *   - **No `phase` field** (decision 3). The provisioning sub-phase is an
 *     internal broker debug signal, not exposed to the client.
 *   - **Server-owned atomicity.** The broker keys sessions by userID and
 *     redirects concurrent requests to the same session. The app never forces
 *     a new session during provisioning.
 *
 * Singleton — use `cloudSessionService` (the exported instance).
 */

import EventEmitter from 'eventemitter3';
import { DeviceAuthRequiredError as ClientDeviceAuthRequiredError } from '@harmony-ai-solutions/soulbits-api-client';
import AuthService from '../auth/AuthService';
import { buildSoulbitsClient } from './soulbitsClient';
import { getDeviceId } from './DeviceIdProvider';
import { createLogger } from '../../utils/logger';

const log = createLogger('[CloudSession]');

/**
 * Absolute timeout bound for the client's `connectPoll` loop (ms).
 */
const CONNECT_POLL_TIMEOUT_MS = 180_000;

/**
 * Thrown when POST /v1/session/connect returns 403
 * {"error":"device_authorization_required"} (D-DEV-01). NOT a generic failure:
 * the UI must prompt for the emailed 6-digit code (DeviceAuthModal), then
 * retry connect. `CloudSessionService` sets `status === 'deviceAuthRequired'`
 * before throwing so the UI layer can present the modal from any connect path.
 */
export class DeviceAuthRequiredError extends Error {
  constructor() {
    super('cloud session refused: device authorization required');
    this.name = 'DeviceAuthRequiredError';
  }
}

// ── Types ─────────────────────────────────────────────────────────────────

export type CloudSessionStatus =
  | 'idle'          // no session / disconnected
  | 'requesting'    // initial POST /connect in flight
  | 'provisioning'  // broker returned 202 provisioning; polling
  | 'ready'         // broker returned ready; WS dial pending (WS connectivity
                    // tracked separately by useSyncConnection().isConnected)
  | 'deviceAuthRequired' // broker returned 403 device_authorization_required;
                         // the user must complete the email-code flow (D-DEV-01)
  | 'failed';       // broker returned 503 failed, or max polls exceeded

/**
 * Richer event payload so the UI (Phase 9) can show failure reason + elapsed.
 * NO `phase` field (decision 3 — internal broker debug signal only).
 */
export interface CloudSessionInfo {
  sessionId?: string;
  proxyEndpoint?: string;
  retryAfterMs?: number;
  failureReason?: string;
  readyAt?: number;   // wall-clock ms when 'ready' transitioned
  requestedAt?: number;
}

interface CloudSessionEvents {
  'status': (status: CloudSessionStatus, info?: CloudSessionInfo) => void;
}

// ── Service ───────────────────────────────────────────────────────────────

export class CloudSessionService extends EventEmitter<CloudSessionEvents> {
  private static instance: CloudSessionService;

  private status: CloudSessionStatus = 'idle';
  private sessionId: string | null = null;
  private proxyEndpoint: string | null = null;
  /** Wall-clock ms when the session last became 'ready'. */
  private readyAt: number | null = null;
  /** Wall-clock ms when the session was first requested in the current poll. */
  private requestedAt: number | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  /** Re-entrancy guard — non-null while a connect loop is in-flight. */
  private _connectPromise: Promise<void> | null = null;
  /** Set to `true` by `disconnect()` to cancel an in-flight poll loop. */
  private _cancelled = false;

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

  /** Wall-clock ms when the session last became 'ready', or null. */
  getReadyAt(): number | null {
    return this.readyAt;
  }

  // ── Connect (request + poll) ────────────────────────────────────────────

  /**
   * Request a cloud session and wait until it is 'ready' (or 'failed').
   *
   * Idempotent:
   *   - If already `ready` → returns immediately (unless `opts.force` is set).
   *   - If a request/poll is already in flight → returns the shared promise.
   *   - Otherwise → runs `session.connectPoll` (client-owned polling with an
   *     absolute timeout) and resolves when the broker returns 200 `ready`.
   *
   * @param opts.force When true, bypasses the cached `ready` short-circuit and
   *   forces a fresh broker round-trip. Used by the WS-failure re-provisioning
   *   path in SyncConnectionContext: if the broker says `ready` but the proxy
   *   keeps 404ing (e.g., Valkey state mismatch, stale session), the cached
   *   `ready` would otherwise make this call a no-op and the app would loop
   *   forever on the same broken session.
   *
   * @throws {Error} if the session fails (503, broker `failed`, timeout).
   * @throws {DeviceAuthRequiredError} on 403 device_authorization_required —
   *   the user must complete the email-code flow, then retry with force.
   */
  async connect(opts?: { force?: boolean }): Promise<void> {
    if (!opts?.force && this.status === 'ready') {
      return;
    }
    if (
      (this.status === 'requesting' || this.status === 'provisioning') &&
      this._connectPromise
    ) {
      return this._connectPromise;
    }
    this.setStatus('requesting');
    this._connectPromise = this._runConnectLoop();
    return this._connectPromise;
  }

  /**
   * Internal connect flow — single execution via `_connectPromise`.
   *
   * Delegates the entire provisioning state machine (initial POST /connect,
   * 202 → `retry_after_ms` backoff polling, 403 device-authorization gate, and
   * terminal 503/`failed` handling) to the typed client's `session.connectPoll`.
   * This replaces the hand-rolled fetch+loop workaround: the client now sends
   * `device_id` itself and owns the poll budget (absolute `timeoutMs`).
   *
   * A 403 `{"error":"device_authorization_required"}` surfaces as the client's
   * `DeviceAuthRequiredError` — NOT a failure. It is re-thrown as the app-local
   * `DeviceAuthRequiredError` after setting `status === 'deviceAuthRequired'`
   * so the UI presents the 6-digit code modal (D-DEV-01).
   */
  private async _runConnectLoop(): Promise<void> {
    this._cancelled = false; // reset on entry — a prior disconnect() may have set this
    const requestedAt = Date.now();
    this.requestedAt = requestedAt;

    try {
      const paseto = await AuthService.getToken();
      const client = buildSoulbitsClient({ paseto });
      const deviceId = await getDeviceId();

      const result = await client.session.connectPoll(
        undefined, // version — broker selects the default HL image
        { timeoutMs: CONNECT_POLL_TIMEOUT_MS },
        deviceId,  // device_id for the D-DEV-04 authorization gate
      );

      // disconnect() may have cancelled mid-poll; don't clobber the idle state
      if (this._cancelled) {
        throw new Error('connect cancelled');
      }

      // Session is ready (or 'active' from a recovered grace_period session)
      this.sessionId = result.session_id ?? null;
      this.proxyEndpoint = result.proxy_endpoint ?? null;
      this.readyAt = Date.now();
      this.setStatus('ready', {
        sessionId: this.sessionId ?? undefined,
        proxyEndpoint: this.proxyEndpoint ?? undefined,
        readyAt: this.readyAt,
      });
      this.scheduleProactiveRefresh();
      log.info(`Cloud session ready: ${this.sessionId}`);
    } catch (e) {
      // disconnect() may have cancelled and reset to idle; don't overwrite.
      // AuthExpiredError (terminal refresh failure) is surfaced as 'failed'
      // here — AuthService.invalidate() has already emitted 'auth:expired' so
      // the AuthContext logs out in parallel.
      if (e instanceof ClientDeviceAuthRequiredError) {
        // 403 device_authorization_required — NOT a failure. The device must
        // complete the emailed 6-digit code flow before the broker provisions
        // a session (D-DEV-01). Set the status (the UI's single source of
        // truth) and re-throw the app-local typed error so callers have a
        // stable, app-owned contract to catch.
        this.setStatus('deviceAuthRequired');
        throw new DeviceAuthRequiredError();
      }
      if (!this._cancelled && this.status !== 'failed') {
        const reason = e instanceof Error ? e.message : String(e);
        this.setStatus('failed', { failureReason: reason, requestedAt });
      }
      const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      log.warn(`Cloud session connect failed: ${detail}`);
      throw e;
    } finally {
      this._connectPromise = null;
    }
  }

  /**
   * Core status transition helper — updates `this.status` and emits the event
   * with optional info payload.
   */
  private setStatus(status: CloudSessionStatus, info?: CloudSessionInfo): void {
    this.status = status;
    if (status === 'failed' || status === 'idle') {
      this.readyAt = null;
    }
    this.emit('status', status, info);
  }

  // ── Proactive PASETO refresh ────────────────────────────────────────────

  /**
   * Schedule a token refresh 10 min before the current PASETO expires.
   * Reschedules after each successful refresh against the new token's expiry.
   * Minimum 30s delay to avoid pathological near-expiry scheduling.
   */
  private scheduleProactiveRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    const expMs = AuthService.getTokenExpiresAt();
    if (!expMs) return;                       // no token / unknown expiry
    const fireMs = expMs - 10 * 60 * 1000;   // 10 min before expiry
    const delayMs = Math.max(fireMs - Date.now(), 30 * 1000);
    this.refreshTimer = setTimeout(async () => {
      try {
        const ok = await AuthService.refresh();
        if (ok) {
          this.scheduleProactiveRefresh();
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
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  // ── Disconnect ──────────────────────────────────────────────────────────

  /**
   * Cancel any in-flight provisioning and trigger the broker's grace-period.
   *
   * 1. Cancels the poll loop (`_cancelled = true`).
   * 2. Resets local state to `idle` immediately.
   * 3. Best-effort POST /disconnect to the broker.
   */
  async disconnect(): Promise<void> {
    // 1. Cancel any in-flight poll loop
    this._cancelled = true;
    this.stopProactiveRefresh();

    const sid = this.sessionId;

    // 2. Reset local state immediately (don't wait for the RPC)
    this.sessionId = null;
    this.proxyEndpoint = null;
    this.readyAt = null;
    this.requestedAt = null;
    this.status = 'idle';
    this.emit('status', this.status);
    this._connectPromise = null; // ensure new connect() starts fresh

    // 3. Best-effort broker notification (via the Soulbits client).
    // A 401 here is not retried — disconnect is best-effort and the session is
    // already released locally; the broker's own abandoned-session sweeper covers
    // the case where this RPC never lands.
    if (sid) {
      try {
        const paseto = await AuthService.getToken();
        await buildSoulbitsClient({ paseto }).session.disconnect(sid);
        log.info(`Cloud session ${sid} disconnect accepted (grace period started)`);
      } catch (e) {
        log.warn('Cloud disconnect failed (best-effort)', e);
      }
    }
  }
}

// ── Singleton export ──────────────────────────────────────────────────────

export const cloudSessionService = CloudSessionService.getInstance();
export default cloudSessionService;
