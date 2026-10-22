/**
 * EngineLifecycle — AppState-driven engine start/stop with a graceful stop
 * window (task 4-2, step 3).
 *
 * iOS is a FOREGROUND TIER (assessment §8.5): the engine has no background
 * execution in this phase. The policy is:
 *
 *   - **Foreground** (app `active`): ensure the engine is started (start on the
 *     first engine-dependent interaction).
 *   - **Background** (`background`/`inactive`): after a short grace window (so an
 *     in-flight transaction can finish), stop the engine. If the app returns to
 *     the foreground before the window elapses the stop is cancelled.
 *   - **Restart on foreground**: starting again is the same as the first start.
 *
 * Android's sidecar is NOT a foreground tier — it runs under a foreground
 * service (task 1-2) — so the background stop is skipped there; the foreground
 * start still applies.
 *
 * The reducer (`reduceEngineLifecycle`) is pure and total: all timing/AppState
 * decisions are expressible as events so the state machine is unit-tested
 * without timers or the RN runtime. The controller (`createEngineLifecycle`)
 * executes the reducer's effects (start/stop/timer arm-clear).
 */

import { AppState } from 'react-native';
import type { AppStateStatus } from 'react-native';
import { createLogger } from '../../utils/logger';
import { connectEngine, disconnectEngine, getEngineConnection } from './EngineService';
import { selectEngineHost } from './EngineHost';
import type { EngineHost } from './EngineHost';

const log = createLogger('[EngineLifecycle]');

/** Observable lifecycle status. */
export type EngineLifecycleStatus =
  | 'idle'
  | 'starting'
  | 'ready'
  | 'stopping'
  | 'stopped'
  | 'error';

/** The reducer's state. */
export interface EngineLifecycleState {
  status: EngineLifecycleStatus;
  /** True while the app reports `active`. */
  isForeground: boolean;
  /** Grace-window deadline (ms epoch) after a background transition, or null. */
  pendingStopAt: number | null;
  /** Last fatal start/stop error message (cleared on a successful start). */
  lastError: string | null;
}

/** Inputs to the reducer. */
export type EngineLifecycleEvent =
  | { type: 'appstate'; value: AppStateStatus; now: number }
  | { type: 'timer'; now: number }
  | { type: 'startRequested' }
  | { type: 'ready' }
  | { type: 'stopRequested' }
  | { type: 'stopped' }
  | { type: 'failed'; message: string };

/** What the controller must do after a reducer step. */
export interface EngineLifecycleEffect {
  /** Fire `start()` (if not already running). */
  start: boolean;
  /** Fire `stop()`. */
  stop: boolean;
  /** Arm a timer at this ms-epoch deadline, or null to clear any pending timer. */
  armTimerAt: number | null;
}

/** Options that shape the policy (host-driven defaults in the controller). */
export interface EngineLifecyclePolicy {
  /** Whether the host must stop on background (iOS) or stays alive (Android). */
  foregroundTier: boolean;
  /** Grace window (ms) between a background transition and the stop. */
  graceMs: number;
}

/** Default grace window for an in-flight transaction (ms). */
export const ENGINE_BACKGROUND_GRACE_MS = 3000;

/** The initial reducer state. */
export function initialEngineLifecycleState(isForeground = true): EngineLifecycleState {
  return { status: 'idle', isForeground, pendingStopAt: null, lastError: null };
}

function isActive(value: AppStateStatus): boolean {
  return value === 'active';
}

/**
 * The pure lifecycle reducer. Returns the next state and the effect the
 * controller must execute. Total (every event → a next state).
 */
export function reduceEngineLifecycle(
  state: EngineLifecycleState,
  event: EngineLifecycleEvent,
  policy: EngineLifecyclePolicy,
): { state: EngineLifecycleState; effect: EngineLifecycleEffect } {
  const none: EngineLifecycleEffect = { start: false, stop: false, armTimerAt: state.pendingStopAt };

  switch (event.type) {
    case 'appstate': {
      const foreground = isActive(event.value);
      if (foreground) {
        // Returning to the foreground cancels any pending stop and (re)starts.
        const running = state.status === 'ready' || state.status === 'starting';
        return {
          state: { ...state, isForeground: true, pendingStopAt: null },
          effect: { start: !running, stop: false, armTimerAt: null },
        };
      }
      // Background/inactive: arm the grace window only if the host is a
      // foreground tier and the engine is actually running.
      const running = state.status === 'ready' || state.status === 'starting';
      if (policy.foregroundTier && running) {
        const at = event.now + Math.max(0, policy.graceMs);
        return {
          state: { ...state, isForeground: false, pendingStopAt: at },
          effect: { start: false, stop: false, armTimerAt: at },
        };
      }
      return { state: { ...state, isForeground: false }, effect: none };
    }

    case 'timer': {
      if (state.pendingStopAt !== null && event.now >= state.pendingStopAt) {
        return {
          state: { ...state, pendingStopAt: null, status: 'stopping' },
          effect: { start: false, stop: true, armTimerAt: null },
        };
      }
      return { state, effect: none };
    }

    case 'startRequested':
      return { state: { ...state, status: 'starting' }, effect: { start: false, stop: false, armTimerAt: null } };

    case 'ready':
      return { state: { ...state, status: 'ready', lastError: null }, effect: none };

    case 'stopRequested':
      return { state: { ...state, status: 'stopping' }, effect: { start: false, stop: true, armTimerAt: null } };

    case 'stopped':
      return { state: { ...state, status: 'stopped', pendingStopAt: null }, effect: none };

    case 'failed':
      return {
        state: { ...state, status: 'error', lastError: event.message, pendingStopAt: null },
        effect: { start: false, stop: false, armTimerAt: null },
      };

    default:
      return { state, effect: none };
  }
}

// ── Imperative controller ────────────────────────────────────────────────

/** The AppState surface the controller needs (injectable for tests). */
export interface AppStateSource {
  currentState: AppStateStatus;
  addEventListener(type: 'change', handler: (state: AppStateStatus) => void): { remove(): void };
}

/** Timer surface (injectable for tests). */
export interface TimerSource {
  setTimeout(handler: () => void, ms: number): any;
  clearTimeout(handle: any): void;
}

export interface EngineLifecycleDeps {
  host?: EngineHost;
  /** Whether to stop on background. Defaults to the host's `foregroundTier`. */
  foregroundTier?: boolean;
  /** Grace window in ms. Defaults to {@link ENGINE_BACKGROUND_GRACE_MS}. */
  graceMs?: number;
  /** Start the engine. Default: reuse a live connection else `connectEngine()`. */
  start?: () => Promise<void>;
  /** Stop the engine. Default: `disconnectEngine()`-equivalent. */
  stop?: () => Promise<void>;
  now?: () => number;
  appState?: AppStateSource;
  timers?: TimerSource;
  /** Observability hook (tests, diagnostics). */
  onStateChange?: (state: EngineLifecycleState) => void;
}

export interface EngineLifecycleController {
  /** Current state snapshot. */
  getState(): EngineLifecycleState;
  /** Ensure the engine is started (idempotent; reuses a live connection). */
  ensureStarted(): Promise<void>;
  /** Transition AppState (exposed for tests; wired to RN AppState by default). */
  handleAppState(value: AppStateStatus): void;
  /** Fire the grace timer (exposed for tests). */
  handleTimer(): void;
  /** Detach the AppState listener + clear any timer. */
  dispose(): void;
}

/** Default start: reuse a live connection, else connect (DB key resolved by the host). */
async function defaultStart(): Promise<void> {
  if (getEngineConnection()) return;
  await connectEngine();
}

/** Default stop: stop the host and clear the connection. */
async function defaultStop(): Promise<void> {
  await disconnectEngine();
}

/** Build a controller. Exported for tests + used by {@link attachEngineLifecycle}. */
export function createEngineLifecycle(deps: EngineLifecycleDeps = {}): EngineLifecycleController {
  const host = deps.host ?? selectEngineHost();
  const policy: EngineLifecyclePolicy = {
    foregroundTier: deps.foregroundTier ?? host.foregroundTier,
    graceMs: deps.graceMs ?? ENGINE_BACKGROUND_GRACE_MS,
  };
  const now = deps.now ?? (() => Date.now());
  const timers: TimerSource = deps.timers ?? {
    setTimeout: (h, ms) => setTimeout(h, ms),
    clearTimeout: (h) => clearTimeout(h),
  };
  const start = deps.start ?? defaultStart;
  const stop = deps.stop ?? defaultStop;

  const appStateSource: AppStateSource =
    deps.appState ?? (AppState as unknown as AppStateSource);

  let state = initialEngineLifecycleState(isActive(appStateSource.currentState));
  let timerHandle: any = null;
  let inFlight: Promise<void> | null = null;

  const publish = () => {
    deps.onStateChange?.(state);
  };

  const apply = (event: EngineLifecycleEvent): void => {
    const { state: next, effect } = reduceEngineLifecycle(state, event, policy);
    state = next;

    if (effect.armTimerAt !== null) {
      if (timerHandle !== null) timers.clearTimeout(timerHandle);
      const delay = Math.max(0, effect.armTimerAt - now());
      timerHandle = timers.setTimeout(() => handleTimer(), delay);
    } else if (state.pendingStopAt === null && timerHandle !== null) {
      timers.clearTimeout(timerHandle);
      timerHandle = null;
    }

    publish();

    if (effect.start) void ensureStarted();
    if (effect.stop) void performStop();
  };

  const ensureStarted = async (): Promise<void> => {
    if (state.status === 'ready' || state.status === 'starting') return;
    if (inFlight) return inFlight;
    apply({ type: 'startRequested' });
    inFlight = (async () => {
      try {
        await start();
        state = reduceEngineLifecycle(state, { type: 'ready' }, policy).state;
        publish();
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        log.warn('engine start failed:', message);
        apply({ type: 'failed', message });
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };

  const performStop = async (): Promise<void> => {
    try {
      await stop();
    } catch (e) {
      log.warn('engine stop failed:', e instanceof Error ? e.message : String(e));
    } finally {
      apply({ type: 'stopped' });
    }
  };

  const handleTimer = (): void => {
    timerHandle = null;
    apply({ type: 'timer', now: now() });
  };

  const handleAppState = (value: AppStateStatus): void => {
    apply({ type: 'appstate', value, now: now() });
  };

  const subscription = appStateSource.addEventListener('change', handleAppState);

  // If the app boots already active, start now (first engine-dependent
  // interaction = app foreground).
  if (isActive(appStateSource.currentState)) {
    void ensureStarted();
  }

  return {
    getState: () => state,
    ensureStarted,
    handleAppState,
    handleTimer,
    dispose: () => {
      subscription.remove();
      if (timerHandle !== null) {
        timers.clearTimeout(timerHandle);
        timerHandle = null;
      }
    },
  };
}

// ── App-wide singleton ───────────────────────────────────────────────────

let attached: EngineLifecycleController | null = null;

/**
 * Attach the app-wide engine lifecycle controller (idempotent). Returns the
 * controller. Boot code calls this once; the process keeps it for its lifetime.
 */
export function attachEngineLifecycle(deps: EngineLifecycleDeps = {}): EngineLifecycleController {
  if (attached) return attached;
  attached = createEngineLifecycle(deps);
  log.info(`Engine lifecycle attached (foregroundTier=${attached.getState().isForeground})`);
  return attached;
}

/** Test-only: detach the singleton and reset it. */
export function detachEngineLifecycleForTests(): void {
  attached?.dispose();
  attached = null;
}
