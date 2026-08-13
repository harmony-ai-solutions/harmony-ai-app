/**
 * CloudSessionService — broker session lifecycle (async provisioning).
 *
 * Orchestrates asynchronous session provisioning via `POST /v1/session/connect`:
 *   - `connect()`  sends the initial request, polls while the broker provisions
 *                  the ECS task, and resolves when the session is `ready`.
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
import type { components } from '@harmony-ai-solutions/soulbits-api-client';
import AuthService from '../auth/AuthService';
import { buildSoulbitsClient } from './soulbitsClient';
import { getDeviceId } from './DeviceIdProvider';
import { CLOUD_HOSTS } from '../../config/cloud';
import {
  DEFAULT_CLOUD_RETRY_MS,
  MAX_PROVISIONING_ATTEMPTS,
} from '../../config/cloud';
import { createLogger } from '../../utils/logger';

const log = createLogger('[CloudSession]');

/**
 * Thrown when POST /v1/session/connect returns 403
 * {"error":"device_authorization_required"} (D-DEV-01). NOT a generic failure:
 * the UI must prompt for the emailed 6-digit code (DeviceAuthModal), then
 * retry connect. `CloudSessionService` emits `'device-auth-required'` before
 * throwing so the UI layer can present the modal from any connect path.
 */
export class DeviceAuthRequiredError extends Error {
  constructor() {
    super('cloud session refused: device authorization required');
    this.name = 'DeviceAuthRequiredError';
  }
}

/**
 * Wire schema for POST /v1/session/connect — returned on 200 (ready|active),
 * 202 (provisioning) and 503 (failed). The latter lands in the openapi-fetch
 * `error` slot, so `_bodyOf` reads from `data ?? error` to stay uniform.
 */
type SessionConnectResponse = components['schemas']['SessionConnectResponse'];

/** Normalised shape of one `session.connect()` round-trip (openapi-fetch style). */
interface ConnectResult {
  data?: SessionConnectResponse;
  error?: unknown;
  response: Response;
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
  /**
   * Emitted when connect returns 403 device_authorization_required (D-DEV-01).
   * The UI shows the 6-digit email-code modal; on verify success it must call
   * connect({ force: true }) again.
   */
  'device-auth-required': () => void;
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
   * Request a cloud session and poll until it is 'ready' (or 'failed').
   *
   * Idempotent:
   *   - If already `ready` → returns immediately (unless `opts.force` is set).
   *   - If a request/poll is already in flight → returns the shared promise.
   *   - Otherwise → POSTs `/connect`, polls at the broker's `retry_after_ms`,
   *     and resolves when the broker returns 200 with status `ready`.
   *
   * @param opts.force When true, bypasses the cached `ready` short-circuit and
   *   forces a fresh broker round-trip. Used by the WS-failure re-provisioning
   *   path in SyncConnectionContext: if the broker says `ready` but the proxy
   *   keeps 404ing (e.g., Valkey state mismatch, stale session), the cached
   *   `ready` would otherwise make this call a no-op and the app would loop
   *   forever on the same broken session.
   *
   * @throws {Error} if the session fails (503, broker `failed`, timeout).
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
   * Internal poll loop — single execution via `_connectPromise`.
   *
   * Sends POST /connect (via the Soulbits client), then loops while the broker
   * returns 202 / status === 'provisioning'. Respects `retry_after_ms` with a
   * 500ms floor. Exits when the broker returns 200 (ready), 503 (failed), or the
   * max poll count is exceeded.
   *
   * The actual round-trip (incl. the 401 → AuthService.refresh → retry) lives in
   * `_doConnect`; this method owns only the polling state machine.
   */
  private async _runConnectLoop(): Promise<void> {
    this._cancelled = false; // reset on entry — a prior disconnect() may have set this
    const requestedAt = Date.now();
    this.requestedAt = requestedAt;

    try {
      let result = await this._doConnect();
      let attempts = 0;

      // Poll while the broker reports provisioning
      while (this._isProvisioning(result)) {
        attempts++;
        if (attempts > MAX_PROVISIONING_ATTEMPTS) {
          this.setStatus('failed', {
            failureReason: `provisioning timed out after ${MAX_PROVISIONING_ATTEMPTS} polls`,
            requestedAt,
          });
          throw new Error('cloud session provisioning timed out');
        }

        const body = this._bodyOf(result);
        const delay = Math.max(
          body.retry_after_ms ?? DEFAULT_CLOUD_RETRY_MS,
          500, // floor — never hammer the broker
        );
        this.setStatus('provisioning', {
          sessionId: body.session_id,
          retryAfterMs: delay,
          requestedAt,
        });

        await this._sleep(delay);
        if (this._cancelled) {
          throw new Error('connect cancelled');
        }

        result = await this._doConnect();
      }

      const body = this._bodyOf(result);

      // ── Terminal response handling ──────────────────────────────────────
      // D-DEV-01: 403 {"error":"device_authorization_required"} — the broker
      // refuses to provision for an unauthorized device. Emit the event that
      // drives the DeviceAuthModal and throw the typed error (NOT a generic
      // failure). The catch below maps it to the 'deviceAuthRequired' status.
      if (
        result.response.status === 403 &&
        (result.error as { error?: string } | undefined)?.error ===
          'device_authorization_required'
      ) {
        log.warn('Cloud session refused: device authorization required');
        this.emit('device-auth-required');
        throw new DeviceAuthRequiredError();
      }

      if (result.response.status === 503 || body.status === 'failed') {
        const reason = body.failure_reason ?? `HTTP ${result.response.status}`;
        this.setStatus('failed', { failureReason: reason, requestedAt });
        throw new Error(`cloud session failed: ${reason}`);
      }

      // Non-ok status that isn't 503 (safety net — protocol violation)
      if (!result.response.ok) {
        const reason = `HTTP ${result.response.status}`;
        this.setStatus('failed', { failureReason: reason, requestedAt });
        throw new Error(`cloud session failed: ${reason}`);
      }

      // Session is ready (or 'active' from a recovered grace_period session)
      this.sessionId = body.session_id ?? null;
      this.proxyEndpoint = body.proxy_endpoint ?? null;
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
      if (e instanceof DeviceAuthRequiredError) {
        // 403 device_authorization_required — NOT a failure. The device must
        // complete the emailed 6-digit code flow before the broker provisions
        // a session (D-DEV-01). The 'device-auth-required' event (emitted by
        // _doConnect) drives the DeviceAuthModal; after verify the caller
        // retries connect({ force: true }).
        this.setStatus('deviceAuthRequired');
        throw e;
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
   * One `session.connect()` round-trip, with a single transparent PASETO
   * refresh on 401 (handled inside `AuthService.fetch`).
   *
   * The connect POST is issued via the app's existing authenticated HTTP
   * client (AuthService.fetch — PASETO Bearer + 401-refresh-retry), NOT the
   * published soulbits-api-client's `session.connect(version)` convenience,
   * because the broker's device-authorization gate (D-DEV-04) reads
   * `device_id` from the request body and the published client only sends
   * `{version}`. The response is normalized to the openapi-fetch
   * `{ data, error, response }` shape `_runConnectLoop` already consumes.
   *
   * A 403 `{"error":"device_authorization_required"}` is NOT a generic
   * failure: `_runConnectLoop` emits `'device-auth-required'` and throws
   * `DeviceAuthRequiredError` so the UI presents the 6-digit code modal
   * (D-DEV-01).
   */
  private async _doConnect(): Promise<ConnectResult> {
    const deviceId = await getDeviceId();
    const res = await AuthService.fetch(`${CLOUD_HOSTS.session}/v1/session/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: deviceId }),
    });

    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // Empty/non-JSON body — leave null; callers tolerate it.
    }
    return {
      data: res.ok ? (body as SessionConnectResponse) : undefined,
      error: res.ok ? undefined : body,
      response: res,
    };
  }

  /**
   * Returns `true` while the loop should keep polling.
   * - HTTP 202 (Accepted) → still provisioning.
   * - body.status === 'provisioning' (defensive — even on a non-202 status).
   */
  private _isProvisioning(result: ConnectResult): boolean {
    return result.response.status === 202 || this._bodyOf(result).status === 'provisioning';
  }

  /**
   * Extract the SessionConnectResponse body from an openapi-fetch result.
   * openapi-fetch places 2xx bodies in `data` and non-2xx bodies (incl. the 503
   * `failed` response, which is itself a SessionConnectResponse) in `error`;
   * reading `data ?? error` keeps the loop agnostic to which slot was used.
   */
  private _bodyOf(result: ConnectResult): Partial<SessionConnectResponse> {
    return (result.data ?? result.error ?? {}) as Partial<SessionConnectResponse>;
  }

  /** Async sleep — wrapped so tests can mock it. */
  private _sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
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
