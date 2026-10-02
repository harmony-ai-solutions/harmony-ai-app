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
import {
  APIError,
  DeviceAuthRequiredError as ClientDeviceAuthRequiredError,
  SnapshotBusyError,
  type DataPurgePhase,
} from '@harmony-ai-solutions/soulbits-api-client';
import { AppState } from 'react-native';
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
 * Bounded retry budgets for the async purge state machine (see purgeCloudData).
 */
const SNAPSHOT_BUSY_MAX_TRIES = 10;        // SnapshotBusyError → wait retry_after_ms between tries
const SNAPSHOT_BUSY_RETRY_WAIT_MS = 3_000; // fallback when the 409 carries no retry_after_ms

// ── Async cloud-data purge (cloud-data-deletion.md §7) ────────────────────
/** Delay between status polls (± PURGE_POLL_JITTER_MS) once a purge is accepted. */
const PURGE_POLL_INTERVAL_MS = 3_000;
const PURGE_POLL_JITTER_MS = 500;
/** Wall-clock budget for one purge run (initiating + polling), from initiating. */
const PURGE_DEADLINE_MS = 15 * 60 * 1000;
/** POST /data/delete 503/network backoff sequence (≤ PURGE_INIT_MAX_TRIES tries). */
const PURGE_INIT_BACKOFF_MS = [2_000, 4_000, 8_000];
const PURGE_INIT_MAX_TRIES = 5;
/** Consecutive AuthService.refresh() failures before the purge fails on auth. */
const PURGE_AUTH_MAX_CONSECUTIVE_REFRESH_FAILURES = 3;
/** Per-run cap on 401→refresh→retry cycles. The 15-min deadline bounds slow
 *  loops but not a fast 401→refresh→401 spin, so budget it explicitly. */
const PURGE_AUTH_MAX_401_RETRIES = 5;
/** `none` statuses tolerated while polling a purge WE started (transient Redis
 *  state) before giving up. A cold attach treats `none` as idle instead. */
const PURGE_NONE_TRANSIENT_MAX = 3;
/** Consecutive failed status polls before the UI shows a reconnecting affordance. */
const PURGE_POLL_FAILURE_RECONNECT_THRESHOLD = 3;
/**
 * Post-deadline re-probe cadence. After the 15-min client deadline we stop
 * polling but KEEP the connect gate up; a slow single-GET re-probe (± jitter)
 * reconciles with the server so a purge that finishes AFTER our deadline
 * resolves on its own — without it the app would latch "your data is being
 * deleted" until a process restart. Stops once the run resolves (deleted /
 * failed / none-cleared) or a run is active again.
 */
const PURGE_REPROBE_INTERVAL_MS = 60_000;
const PURGE_REPROBE_JITTER_MS = 10_000;

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
  | 'failed'       // broker returned 503 failed, or max polls exceeded
  | 'purging';     // user-initiated cloud data purge in flight (Phase 6); no
                   // session can be requested while this is active.

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

// ── Async purge types (cloud-data-deletion.md §7) ─────────────────────────

/** Server-reported purge phase (client type re-exported for UI consumers). */
export type PurgePhase = DataPurgePhase;

/**
 * Sub-state of the purge state machine:
 *   idle → initiating → polling → deleted | failed | deadline
 * `deleted`/`failed` are terminal and unblock reconnecting; `deadline` means
 * we stopped polling after the 15-min wall-clock budget while the server may
 * still be purging — isPurging() stays TRUE (connect stays gated) and the UI
 * shows the "still deleting" info state.
 */
export type PurgeRunState =
  | 'idle'
  | 'initiating'
  | 'polling'
  | 'deleted'
  | 'failed'
  | 'deadline';

/** Emitted on every purge state transition / status poll while a run is active. */
export interface PurgeProgress {
  runState: 'initiating' | 'polling';
  /** Server-reported phase once polling (absent right after the POST). */
  phase?: PurgePhase;
  requestId: string | null;
  /** Sweeper resume attempts reported by the server (0 while initiating). */
  attempts: number;
  /** Wall-clock ms since the run started (drives the elapsed timer). */
  elapsedMs: number;
  /** True after ≥ PURGE_POLL_FAILURE_RECONNECT_THRESHOLD consecutive failed
   *  status polls (offline mid-purge). Polling continues — connectivity loss
   *  NEVER settles the purge. */
  reconnecting: boolean;
}

/** Full terminal payload — emitted exactly once per run via 'purge:terminal'. */
export interface PurgeTerminalPayload {
  outcome: 'deleted' | 'failed' | 'deadline';
  requestId: string | null;
  attempts: number;
  elapsedMs: number;
  // deleted / failed counters (server-reported)
  objectsDeleted?: number;
  versionsDeleted?: number;
  beatsRemoved?: number;
  dekDeleted?: boolean;
  /** Unix SECONDS (server clock) when the purge finished/gave up. */
  finishedAt?: number;
  /** Failure reason ('failed'), or undefined on success/deadline. */
  error?: string;
}

/** Result of {@link CloudSessionService.attachToRunningPurge}. */
export type PurgeAttachResult =
  | { kind: 'adopted'; progress: PurgeProgress }
  | { kind: 'terminal'; terminal: PurgeTerminalPayload }
  | { kind: 'none' };

interface CloudSessionEvents {
  'status': (status: CloudSessionStatus, info?: CloudSessionInfo) => void;
  /** Emitted when `purgeCloudData` completes successfully (cloud data deleted). */
  'purge:done': () => void;
  /** Emitted when `purgeCloudData` exhausts its retries or hits a terminal error.
   *  The session state is `idle`, NOT `failed` (the session itself didn't fail). */
  'purge:failed': (reason: string) => void;
  /** Emitted when a latched deadline run is reconciled away: a re-probe/attach
   *  GET reported `none` (the server-side run is gone — tombstone expired or
   *  cleared). Status → idle, connecting unblocks, UI resets to the idle card. */
  'purge:cleared': () => void;
  /** Async purge sub-state/progress (initiating, each in_progress poll, and
   *  poll-failure reconnecting affordance). */
  'purge:progress': (progress: PurgeProgress) => void;
  /** Full terminal payload — emitted once per run AFTER the legacy
   *  purge:done / purge:failed event (which stay for existing listeners). */
  'purge:terminal': (payload: PurgeTerminalPayload) => void;
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

  // ── Async purge state (cloud-data-deletion.md §7) ────────────────────────
  /** Sub-state of the purge machine — see {@link PurgeRunState}. */
  private purgeRunState: PurgeRunState = 'idle';
  /** Wall-clock ms when the current run started (deadline + elapsed base). */
  private purgeStartedAt: number | null = null;
  /** Server echo of the running purge (from the 202/200 POST or status poll). */
  private purgeRequestId: string | null = null;
  private purgeAttempts = 0;
  private purgePhase: PurgePhase | undefined;
  /** Last terminal result — kept in memory so re-renders / re-mounts can show
   *  the settled outcome without re-querying the broker. */
  private lastPurgeTerminal: PurgeTerminalPayload | null = null;
  /** Re-entrancy guard — non-null while a purge run (or adopted poll loop) is
   *  in flight. */
  private _purgePromise: Promise<void> | null = null;
  /** Re-entrancy guard for cold-start attaches (shared one-shot GET). */
  private _attachPromise: Promise<PurgeAttachResult> | null = null;
  // Poll-wait plumbing: the wait between polls is a cancellable timer so the
  // AppState listener can PAUSE it in the background and resume (with an
  // immediate fetch) on foreground.
  private purgeWaitTimer: ReturnType<typeof setTimeout> | null = null;
  private purgeWaitResolve: (() => void) | null = null;
  // Post-deadline re-probe plumbing: a single slow GET cadence that reconciles
  // a latched deadline with the server (cleared once resolved).
  private purgeReprobeTimer: ReturnType<typeof setTimeout> | null = null;
  private purgeAppStateSubscription: { remove: () => void } | null = null;

  private constructor() {
    super();
    this.setupPurgeAppStateListener();
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

  /**
   * Whether a user-initiated cloud data purge is currently in flight
   * (`status === 'purging'`). While true, auto-connect/reconnect must be
   * suppressed so nothing dials a session mid-purge (broker 409 is the
   * backstop; this flag is the app-side UX gate).
   *
   * Stays true through the `deadline` sub-state too: the server may still be
   * purging after we stopped polling, and connecting remains gated until the
   * server-side flag clears (the next broker round-trip says so).
   */
  isPurging(): boolean {
    return this.status === 'purging';
  }

  /** Sub-state of the async purge machine (idle when no run is active). */
  getPurgeRunState(): PurgeRunState {
    return this.purgeRunState;
  }

  /** Last settled purge result, or null. Kept for re-renders after terminal. */
  getLastPurgeTerminal(): PurgeTerminalPayload | null {
    return this.lastPurgeTerminal;
  }

  /** True while a purge run is actively initiating or polling. */
  private isPurgeActive(): boolean {
    return this.purgeRunState === 'initiating' || this.purgeRunState === 'polling';
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
    // Belt-and-braces gate: never request a session while a purge is running.
    // The broker would 409 anyway; this keeps app-internal callers honest.
    if (this.isPurging()) {
      throw new Error('purge in progress');
    }
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

  // ── Purge cloud data (async machine) ─────────────────────────────────────

  /**
   * Purge all cloud-side engine data for the signed-in user — ASYNC contract
   * (cloud-data-deletion.md §7): ONE initiating POST, then poll
   * `GET /v1/session/data/delete/status` until a terminal status or the
   * 15-minute deadline.
   *
   * Sub-states: idle → initiating → polling → deleted | failed | deadline.
   *
   * 1. `disconnect()` locally first (best-effort broker notify — the broker
   *    hard-kills the live session anyway once the purge runs).
   * 2. **initiating** — exactly ONE `deleteDataOrThrow('DELETE')`:
   *    - 202 (accepted) → polling with the echoed `request_id`.
   *    - 200 `in_progress` (concurrent call / another device already purging)
   *      → ADOPT: straight to polling, never re-POST.
   *    - 409 SnapshotBusyError → wait `retry_after_ms` (fallback 3s), ≤ 10 tries.
   *    - 503 / network → backoff 2s→4s→8s, ≤ 5 tries, then `purge:failed`.
   *    - 401 → `AuthService.refresh()` + rebuild client + retry (≤ 5 per run;
   *      3 consecutive refresh failures → `purge:failed` with an auth reason).
   * 3. **polling** — status every 3s ± 500ms jitter:
   *    - `in_progress` → `'purge:progress'` {phase, attempts, elapsedMs, …}.
   *    - `deleted` → status idle, emit legacy `'purge:done'` then
   *      `'purge:terminal'` (full counters).
   *    - `failed` → status idle, emit legacy `'purge:failed(reason)'` then
   *      `'purge:terminal'` (user unblocked; retry is safe).
   *    - `none` with a held request_id → transient; tolerated ≤ 3 consecutive
   *      polls, then settles as failed ("status lost").
   *    - 503/network on a poll → NEVER settles the purge; keeps polling and
   *      flags `reconnecting` after 3 consecutive failures.
   * 4. **deadline** — 15-min wall clock from initiating: stop polling, emit
   *    `'purge:terminal'` {outcome:'deadline'}; isPurging() stays TRUE
   *    (connect remains gated until the server-side flag clears).
   *
   * The promise never rejects for contract-level outcomes — failures are
   * emitted as events (legacy `'purge:failed'` + `'purge:terminal'`) so the
   * UI can offer "Retry deletion". Re-entrant calls while a run is active
   * share the in-flight run's promise.
   */
  async purgeCloudData(): Promise<void> {
    if (this.isPurgeActive() && this._purgePromise) {
      return this._purgePromise;
    }
    this._purgePromise = this._runPurge();
    return this._purgePromise;
  }

  /** Internal purge flow — single execution via `_purgePromise`. */
  private async _runPurge(): Promise<void> {
    // Fresh run: reset per-run state. Terminal state from a PREVIOUS run
    // (deleted/failed/deadline) is overwritten; lastPurgeTerminal is rebuilt
    // when this run settles. Any pending deadline re-probe is superseded.
    this._stopPurgeReProbe();
    this.purgeRunState = 'initiating';
    this.purgeStartedAt = Date.now();
    this.purgeRequestId = null;
    this.purgeAttempts = 0;
    this.purgePhase = undefined;
    this.lastPurgeTerminal = null;
    this.setStatus('purging');
    this.emitPurgeProgress();

    try {
      // 1. Release the current session locally + best-effort broker notify.
      //    disconnect() resets the status to 'idle' — re-assert 'purging'
      //    afterwards so isPurging() stays true for the whole run (the
      //    SyncConnectionContext suppression depends on it).
      await this.disconnect();
      this.setStatus('purging');

      // 2. Initiating — one POST (adopt on 200), then poll to terminal.
      await this._purgeInitiate();
      if (!this.isPurgeActive()) return; // deadline settled during initiating
      await this._purgePollLoop();
    } catch (e) {
      // _purgeInitiate throws for its bounded-retry exhaustions; anything else
      // here is an unexpected internal error — settle as failed either way.
      const reason = e instanceof Error ? e.message : String(e);
      log.warn(`Cloud data purge failed: ${reason}`);
      this._settlePurge('failed', { error: reason });
    } finally {
      this._purgePromise = null;
    }
  }

  /**
   * Initiating sub-state: exactly ONE deleteDataOrThrow with bounded retries
   * for the transient 409/503/401 cases. On 202/200 → polling (adopt).
   */
  private async _purgeInitiate(): Promise<void> {
    let snapshotBusyTries = 0;
    let initTries = 0;          // 503 / network attempts
    let auth401Retries = 0;
    let consecutiveRefreshFailures = 0;
    let client = await this._buildPurgeClient();

    while (true) {
      if (this._pastPurgeDeadline()) {
        log.warn('Cloud data purge hit its deadline while initiating');
        this._settlePurge('deadline');
        return;
      }

      let result: Awaited<ReturnType<typeof client.session.deleteDataOrThrow>>;
      try {
        result = await client.session.deleteDataOrThrow('DELETE');
      } catch (e) {
        if (e instanceof SnapshotBusyError) {
          snapshotBusyTries += 1;
          if (snapshotBusyTries >= SNAPSHOT_BUSY_MAX_TRIES) {
            throw new Error(
              `cloud data purge aborted: snapshot busy after ${snapshotBusyTries} attempts`,
            );
          }
          const waitMs = e.retryAfterMs ?? SNAPSHOT_BUSY_RETRY_WAIT_MS;
          log.info(`Purge snapshot busy (${snapshotBusyTries}/${SNAPSHOT_BUSY_MAX_TRIES}) — retrying in ${waitMs}ms`);
          await sleep(waitMs);
          continue;
        }
        if (isPurgeAuthError(e)) {
          // 401 → refresh + rebuild + retry once for this occurrence.
          auth401Retries += 1;
          if (auth401Retries > PURGE_AUTH_MAX_401_RETRIES) {
            throw new Error('cloud data purge failed: too many auth refresh retries');
          }
          const ok = await this._refreshForPurge();
          if (!ok) {
            consecutiveRefreshFailures += 1;
            if (consecutiveRefreshFailures >= PURGE_AUTH_MAX_CONSECUTIVE_REFRESH_FAILURES) {
              throw new Error('cloud data purge failed: authentication expired');
            }
          } else {
            consecutiveRefreshFailures = 0;
          }
          client = await this._buildPurgeClient();
          continue;
        }
        if (isPurgeTransientServerError(e)) {
          initTries += 1;
          if (initTries >= PURGE_INIT_MAX_TRIES) {
            throw new Error(
              `cloud data purge could not start: service unavailable after ${initTries} attempts`,
            );
          }
          const delay = PURGE_INIT_BACKOFF_MS[Math.min(initTries - 1, PURGE_INIT_BACKOFF_MS.length - 1)];
          log.info(`Purge start failed transiently (${initTries}/${PURGE_INIT_MAX_TRIES}) — retrying in ${delay}ms`);
          await sleep(delay);
          continue;
        }
        // ConfirmationRequiredError (we always send 'DELETE'), 4xx, etc. — terminal.
        throw e;
      }

      // 202 (fresh) or 200 in_progress (concurrent call / another device) —
      // ADOPT either way: go straight to polling, never re-POST.
      this.purgeRequestId = result.request_id ?? null;
      this.purgeRunState = 'polling';
      log.info(`Cloud data purge accepted (request ${this.purgeRequestId ?? 'n/a'}) — polling status`);
      this.emitPurgeProgress();
      return;
    }
  }

  /**
   * Polling sub-state: GET status every 3s ± 500ms jitter until a terminal
   * status or the 15-min deadline. Connectivity loss never settles the run —
   * it keeps polling and flags `reconnecting` in purge:progress instead.
   */
  private async _purgePollLoop(): Promise<void> {
    let consecutiveRefreshFailures = 0;
    let auth401Retries = 0;
    let noneTries = 0;
    let pollFailures = 0;
    let client = await this._buildPurgeClient();

    while (true) {
      if (this._pastPurgeDeadline()) {
        log.warn('Cloud data purge hit its 15-minute deadline — stopping polling (isPurging stays true)');
        this._settlePurge('deadline');
        return;
      }

      await this._waitPollInterval();
      // The wait may have been paused in the background for a long time.
      if (this._pastPurgeDeadline()) {
        log.warn('Cloud data purge hit its 15-minute deadline (across a background pause)');
        this._settlePurge('deadline');
        return;
      }

      let status: Awaited<ReturnType<typeof client.session.deleteStatusOrThrow>>;
      try {
        status = await client.session.deleteStatusOrThrow();
        pollFailures = 0;
      } catch (e) {
        if (isPurgeAuthError(e)) {
          auth401Retries += 1;
          if (auth401Retries > PURGE_AUTH_MAX_401_RETRIES) {
            throw new Error('cloud data purge failed: too many auth refresh retries');
          }
          const ok = await this._refreshForPurge();
          if (!ok) {
            consecutiveRefreshFailures += 1;
            if (consecutiveRefreshFailures >= PURGE_AUTH_MAX_CONSECUTIVE_REFRESH_FAILURES) {
              throw new Error('cloud data purge failed: authentication expired');
            }
          } else {
            consecutiveRefreshFailures = 0;
          }
          client = await this._buildPurgeClient();
          continue;
        }
        // Offline / 503 / rate-limit on a STATUS POLL → transient by design.
        // Keep polling until the deadline; never purge:failed for connectivity.
        pollFailures += 1;
        log.warn(`Purge status poll failed (${pollFailures} consecutive) — will retry`, e);
        this.emitPurgeProgress(pollFailures);
        continue;
      }

      switch (status.status) {
        case 'in_progress': {
          noneTries = 0;
          this.purgeRequestId = status.request_id;
          this.purgeAttempts = status.attempts ?? this.purgeAttempts;
          this.purgePhase = status.phase as PurgePhase | undefined;
          this.emitPurgeProgress();
          break; // next interval
        }
        case 'deleted': {
          this._settlePurge('deleted', {
            requestId: status.request_id ?? this.purgeRequestId,
            attempts: status.attempts ?? this.purgeAttempts,
            objectsDeleted: status.objects_deleted,
            versionsDeleted: status.versions_deleted,
            beatsRemoved: status.beats_removed,
            dekDeleted: status.dek_deleted,
            finishedAt: status.finished_at,
          });
          return;
        }
        case 'failed': {
          log.warn(`Cloud data purge failed server-side: ${status.error}`);
          this._settlePurge('failed', {
            requestId: status.request_id ?? this.purgeRequestId,
            attempts: status.attempts ?? this.purgeAttempts,
            error: status.error,
            objectsDeleted: status.objects_deleted,
            versionsDeleted: status.versions_deleted,
            beatsRemoved: status.beats_removed,
            dekDeleted: status.dek_deleted,
            finishedAt: status.finished_at,
          });
          return;
        }
        case 'none': {
          if (this.purgeRequestId) {
            // We saw a 202 this run — `none` is transient server state.
            noneTries += 1;
            if (noneTries > PURGE_NONE_TRANSIENT_MAX) {
              this._settlePurge('failed', {
                error: 'purge status lost (server reports none) — safe to retry',
              });
              return;
            }
            log.info(`Purge status transiently none (${noneTries}/${PURGE_NONE_TRANSIENT_MAX}) — keeping polling`);
            break;
          }
          // Unreachable in a normal run (initiating always 202/200s first);
          // treat a lost request as a retryable failure rather than hanging.
          this._settlePurge('failed', { error: 'purge request not found' });
          return;
        }
      }
    }
  }

  /**
   * Cold-start / other-device attach + deadline re-probe: ONE status GET, then
   * reconcile the local machine with the server:
   *   - active run → adopt (fresh 15-min deadline + poll loop);
   *   - deleted/failed → settle PROPERLY via `_settlePurge` (status → idle,
   *     legacy + terminal events fire → banner hides, gate clears, UI updates);
   *   - `none` while latched on deadline → clear the run (status idle +
   *     `purge:cleared`) so a server-side completion/cleanup after OUR deadline
   *     unblocks the app;
   *   - `none` otherwise → nothing.
   *
   * A latched `deadline` state deliberately FALLS THROUGH to the real GET —
   * replaying the deadline terminal forever would permanently block connecting
   * whenever the server finishes after our 15-min budget (reproduced live).
   * Only already-settled deleted/failed results replay from memory.
   *
   * Read-only — never POSTs, never connects a session. Safe to call on mount /
   * focus / re-probe from SyncSettingsScreen, SyncConnectionContext and the
   * internal re-probe cadence (share-one-shot via `_attachPromise`; an
   * already-active run short-circuits to its progress).
   */
  async attachToRunningPurge(): Promise<PurgeAttachResult> {
    // Already running (or adopted) → report live progress, no extra GET.
    if (this.isPurgeActive()) {
      return { kind: 'adopted', progress: this.buildPurgeProgress() };
    }
    // NOTE: `deadline` intentionally does NOT short-circuit — it re-probes.
    // Settled earlier this app session → replay the remembered result.
    if (
      (this.purgeRunState === 'deleted' || this.purgeRunState === 'failed') &&
      this.lastPurgeTerminal
    ) {
      return { kind: 'terminal', terminal: this.lastPurgeTerminal };
    }
    if (this._attachPromise) {
      return this._attachPromise;
    }
    this._attachPromise = this._attachToRunningPurgeImpl().finally(() => {
      this._attachPromise = null;
    });
    return this._attachPromise;
  }

  /**
   * One-shot status GET behind {@link attachToRunningPurge}, then reconcile.
   * A failed GET is a NO-OP (transient connectivity): a latched deadline stays
   * latched and the re-probe cadence keeps running — only a SUCCESSFUL `none`
   * may clear the gate.
   */
  private async _attachToRunningPurgeImpl(): Promise<PurgeAttachResult> {
    let client: ReturnType<typeof buildSoulbitsClient>;
    try {
      client = await this._buildPurgeClient();
    } catch {
      // No token (logged out) — nothing to attach to.
      return { kind: 'none' };
    }

    let status: Awaited<ReturnType<typeof client.session.deleteStatusOrThrow>>;
    try {
      status = await client.session.deleteStatusOrThrow();
    } catch (e) {
      if (isPurgeAuthError(e)) {
        const ok = await this._refreshForPurge();
        if (ok) {
          try {
            client = await this._buildPurgeClient();
            status = await client.session.deleteStatusOrThrow();
          } catch {
            return { kind: 'none' }; // transient — keep any deadline latch
          }
        } else {
          return { kind: 'none' }; // auth exhausted — keep any deadline latch
        }
      } else {
        // Offline / 503 → transient by design. A latched deadline stays
        // latched (the run may still exist server-side); the broker 409
        // backstop still gates connects and the re-probe cadence continues.
        log.warn('Purge attach/re-probe status fetch failed — keeping current state', e);
        return { kind: 'none' };
      }
    }

    switch (status.status) {
      case 'in_progress': {
        // Adopt: polling sub-state with a FRESH 15-min deadline (the server
        // may legitimately run longer than our previous budget knew). Clears
        // any stale deadline latch + stops the re-probe cadence (active run).
        this.purgeRunState = 'polling';
        this.purgeStartedAt = Date.now();
        this.purgeRequestId = status.request_id;
        this.purgeAttempts = status.attempts ?? 0;
        this.purgePhase = status.phase as PurgePhase | undefined;
        this.lastPurgeTerminal = null;
        this._stopPurgeReProbe();
        this.setStatus('purging');
        this.emitPurgeProgress();
        // Run the poll loop in the background (it settles itself and emits
        // the terminal events); resolve the attach immediately. The loop is
        // published via _purgePromise so a re-entrant purgeCloudData() during
        // an adopted run shares it instead of starting a second machine.
        const loop = this._purgePollLoop().catch(e => {
          const reason = e instanceof Error ? e.message : String(e);
          log.warn(`Adopted purge poll loop crashed: ${reason}`);
          this._settlePurge('failed', { error: reason });
        });
        const chained = loop.finally(() => {
          if (this._purgePromise === chained) {
            this._purgePromise = null;
          }
        });
        this._purgePromise = chained;
        log.info(`Adopted running cloud data purge (request ${this.purgeRequestId ?? 'n/a'})`);
        return { kind: 'adopted', progress: this.buildPurgeProgress() };
      }
      case 'deleted':
      case 'failed': {
        // Settle PROPERLY (not merely run-state bookkeeping): status → idle,
        // legacy purge:done/purge:failed + full purge:terminal fire — the
        // banner hides, purgeBlocking clears and the screen updates even when
        // the server finished AFTER our deadline latch.
        this._settlePurge(status.status, {
          requestId: status.request_id ?? this.purgeRequestId,
          attempts: status.attempts ?? this.purgeAttempts,
          objectsDeleted: status.objects_deleted,
          versionsDeleted: status.versions_deleted,
          beatsRemoved: status.beats_removed,
          dekDeleted: status.dek_deleted,
          finishedAt: status.finished_at,
          ...(status.status === 'failed' ? { error: status.error } : {}),
        });
        return { kind: 'terminal', terminal: this.lastPurgeTerminal! };
      }
      case 'none': {
        if (this.status === 'purging' && this.purgeRunState === 'deadline') {
          // We were latched on our own deadline; the server says the run is
          // gone (finished + tombstone expired, or swept). Clear the run so
          // connecting unblocks — this is the way out of the deadline latch.
          log.info('Purge re-probe reports none while deadline-latched — clearing the run');
          this.purgeRunState = 'idle';
          this.purgeStartedAt = null;
          this.purgeRequestId = null;
          this.purgeAttempts = 0;
          this.purgePhase = undefined;
          this.lastPurgeTerminal = null;
          this._stopPurgeReProbe();
          this.setStatus('idle');
          this.emit('purge:cleared');
        }
        return { kind: 'none' };
      }
      default:
        return { kind: 'none' };
    }
  }

  // ── Post-deadline re-probe ─────────────────────────────────────────────────

  /**
   * Schedule the slow post-deadline re-probe (single timer, ± jitter). Fired
   * by `_settlePurge('deadline')`; re-arms itself until the run resolves.
   */
  private _schedulePurgeReProbe(): void {
    this._stopPurgeReProbe();
    const jitter = Math.round((Math.random() * 2 - 1) * PURGE_REPROBE_JITTER_MS);
    const delay = Math.max(PURGE_REPROBE_INTERVAL_MS + jitter, 5_000);
    this.purgeReprobeTimer = setTimeout(() => {
      this.purgeReprobeTimer = null;
      this._runPurgeReProbe();
    }, delay);
    log.info(`Purge deadline re-probe scheduled in ~${Math.round(delay / 1000)}s`);
  }

  private _stopPurgeReProbe(): void {
    if (this.purgeReprobeTimer) {
      clearTimeout(this.purgeReprobeTimer);
      this.purgeReprobeTimer = null;
    }
  }

  /**
   * One re-probe tick: a real status GET via attachToRunningPurge (shared
   * one-shot — never overlaps another GET, never POSTs). Re-arms only while
   * the run is still deadline-latched; any resolution stops the cadence.
   */
  private async _runPurgeReProbe(): Promise<void> {
    if (this.purgeRunState !== 'deadline') return; // resolved elsewhere
    try {
      await this.attachToRunningPurge();
    } catch (e) {
      log.warn('Purge deadline re-probe failed:', e instanceof Error ? e.message : String(e));
    } finally {
      if (this.purgeRunState === 'deadline') {
        this._schedulePurgeReProbe(); // still latched — keep probing
      }
    }
  }

  // ── Purge internals ───────────────────────────────────────────────────────

  /** Settle the run: sub-state, legacy events, full terminal payload. */
  private _settlePurge(
    outcome: 'deleted' | 'failed' | 'deadline',
    extras?: Partial<Omit<PurgeTerminalPayload, 'outcome'>>,
  ): void {
    // Drop any pending poll wait — the loop is leaving.
    if (this.purgeWaitTimer) {
      clearTimeout(this.purgeWaitTimer);
      this.purgeWaitTimer = null;
    }
    this.purgeWaitResolve = null;

    this.purgeRunState = outcome;
    const terminal: PurgeTerminalPayload = {
      outcome,
      requestId: extras?.requestId ?? this.purgeRequestId,
      attempts: extras?.attempts ?? this.purgeAttempts,
      elapsedMs: this.purgeElapsedMs(),
      objectsDeleted: extras?.objectsDeleted,
      versionsDeleted: extras?.versionsDeleted,
      beatsRemoved: extras?.beatsRemoved,
      dekDeleted: extras?.dekDeleted,
      finishedAt: extras?.finishedAt,
      error: extras?.error,
    };
    this.lastPurgeTerminal = terminal;

    if (outcome === 'deleted') {
      this.setStatus('idle');
      this._stopPurgeReProbe();
      log.info('Cloud data purge complete');
      this.emit('purge:done');
    } else if (outcome === 'failed') {
      this.setStatus('idle');
      this._stopPurgeReProbe();
      this.emit('purge:failed', terminal.error ?? 'unknown');
    } else {
      // deadline: keep status 'purging' — connecting stays gated — but arm the
      // slow re-probe so a server-side completion AFTER our budget resolves
      // the latch on its own (attach/re-probe reconciles from status).
      this._schedulePurgeReProbe();
    }

    this.emit('purge:terminal', terminal);
  }

  /** Emit the current progress (no-op when no run is active). */
  private emitPurgeProgress(pollFailures = 0): void {
    if (!this.isPurgeActive()) return;
    this.emit('purge:progress', this.buildPurgeProgress(pollFailures));
  }

  private buildPurgeProgress(pollFailures = 0): PurgeProgress {
    return {
      runState: this.purgeRunState === 'initiating' ? 'initiating' : 'polling',
      phase: this.purgePhase,
      requestId: this.purgeRequestId,
      attempts: this.purgeAttempts,
      elapsedMs: this.purgeElapsedMs(),
      reconnecting: pollFailures >= PURGE_POLL_FAILURE_RECONNECT_THRESHOLD,
    };
  }

  private purgeElapsedMs(): number {
    return this.purgeStartedAt !== null ? Math.max(Date.now() - this.purgeStartedAt, 0) : 0;
  }

  private _pastPurgeDeadline(): boolean {
    return this.purgeStartedAt !== null && Date.now() - this.purgeStartedAt >= PURGE_DEADLINE_MS;
  }

  /** Fresh client with the current token (refresh handled by callers). */
  private async _buildPurgeClient(): Promise<ReturnType<typeof buildSoulbitsClient>> {
    const paseto = await AuthService.getToken();
    return buildSoulbitsClient({ paseto });
  }

  /**
   * AuthService.refresh() with throw→false normalization — a THROWING refresh
   * counts as a failure for the consecutive-failure budget.
   */
  private async _refreshForPurge(): Promise<boolean> {
    try {
      const ok = await AuthService.refresh();
      if (!ok) {
        log.warn('Purge auth refresh returned false');
      }
      return ok;
    } catch (e) {
      log.warn('Purge auth refresh threw', e);
      return false;
    }
  }

  /**
   * Cancellable wait between status polls (3s ± 500ms jitter). The AppState
   * listener clears the timer in the background and resolves the promise
   * immediately on foreground (→ instant status fetch, then cadence resumes).
   */
  private _waitPollInterval(): Promise<void> {
    return new Promise<void>(resolve => {
      this.purgeWaitResolve = resolve;
      const jitter = Math.round((Math.random() * 2 - 1) * PURGE_POLL_JITTER_MS);
      const delay = Math.max(PURGE_POLL_INTERVAL_MS + jitter, 500);
      this.purgeWaitTimer = setTimeout(() => {
        this.purgeWaitTimer = null;
        this.purgeWaitResolve = null;
        resolve();
      }, delay);
    });
  }

  /**
   * AppState handling for the purge machine (pattern:
   * EntitySessionService.setupAppStateListener). Backgrounding PAUSES the
   * active run's poll timer (iOS/Android throttle timers anyway — be
   * explicit); returning to foreground fires ONE immediate status fetch and
   * resumes the cadence. A deadline-LATCHED run instead re-probes immediately
   * on foreground (the user coming back is the strongest signal the server
   * state may have resolved while we were away).
   */
  private setupPurgeAppStateListener(): void {
    try {
      this.purgeAppStateSubscription = AppState.addEventListener('change', nextAppState => {
        if (nextAppState === 'background') {
          if (!this.isPurgeActive()) return;
          log.info('App backgrounded during cloud data purge — pausing status polling');
          if (this.purgeWaitTimer) {
            clearTimeout(this.purgeWaitTimer);
            this.purgeWaitTimer = null;
          }
          // purgeWaitResolve stays pending — foreground resumes it.
        } else if (nextAppState === 'active') {
          if (this.isPurgeActive()) {
            log.info('App foregrounded during cloud data purge — immediate status fetch');
            const resolve = this.purgeWaitResolve;
            this.purgeWaitResolve = null;
            resolve?.(); // pending wait → instant poll; cadence resumes after
          } else if (this.purgeRunState === 'deadline') {
            log.info('App foregrounded with deadline-latched purge — immediate re-probe');
            this._runPurgeReProbe();
          }
        }
      });
    } catch {
      // Non-RN environments (unit tests without a AppState mock) — polling
      // simply never pauses and deadline re-probes rely on the timer only.
    }
  }
}

// ── Purge error classification helpers ──────────────────────────────────────

/** 401 from any purge request — refresh + rebuild + retry (bounded). */
function isPurgeAuthError(e: unknown): boolean {
  return e instanceof APIError && e.status === 401;
}

/**
 * Transient POST /data/delete failures: 503 (purge state unavailable) and
 * raw network errors (RN fetch surfaces those as TypeError).
 */
function isPurgeTransientServerError(e: unknown): boolean {
  if (e instanceof APIError && e.status === 503) return true;
  return e instanceof TypeError ||
    (e instanceof Error && (e.name === 'TypeError' || /network/i.test(e.message)));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Singleton export ──────────────────────────────────────────────────────

export const cloudSessionService = CloudSessionService.getInstance();
export default cloudSessionService;
