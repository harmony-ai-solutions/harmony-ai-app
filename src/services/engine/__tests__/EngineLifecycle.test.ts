/**
 * EngineLifecycle — reducer + controller tests (task 4-2).
 */

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import type { AppStateStatus } from 'react-native';
import {
  ENGINE_BACKGROUND_GRACE_MS,
  createEngineLifecycle,
  initialEngineLifecycleState,
  reduceEngineLifecycle,
} from '../EngineLifecycle';
import type { EngineLifecyclePolicy } from '../EngineLifecycle';
import type { EngineHost } from '../EngineHost';

const POLICY: EngineLifecyclePolicy = { foregroundTier: true, graceMs: 1000 };
const ANDROID_POLICY: EngineLifecyclePolicy = { foregroundTier: false, graceMs: 1000 };

describe('reduceEngineLifecycle', () => {
  it('starts on a foreground transition when idle', () => {
    const { state, effect } = reduceEngineLifecycle(
      initialEngineLifecycleState(true),
      { type: 'appstate', value: 'active', now: 0 },
      POLICY,
    );
    expect(effect.start).toBe(true);
    expect(effect.stop).toBe(false);
    expect(state.isForeground).toBe(true);
  });

  it('does not re-start while starting/ready', () => {
    const ready = { ...initialEngineLifecycleState(true), status: 'ready' as const };
    const { effect } = reduceEngineLifecycle(
      ready,
      { type: 'appstate', value: 'active', now: 0 },
      POLICY,
    );
    expect(effect.start).toBe(false);
  });

  it('arms the grace window on background and stops when it elapses', () => {
    const ready = { ...initialEngineLifecycleState(true), status: 'ready' as const };
    const bg = reduceEngineLifecycle(ready, { type: 'appstate', value: 'background', now: 100 }, POLICY);
    expect(bg.state.pendingStopAt).toBe(1100);
    expect(bg.effect.armTimerAt).toBe(1100);
    expect(bg.effect.stop).toBe(false);

    const before = reduceEngineLifecycle(bg.state, { type: 'timer', now: 500 }, POLICY);
    expect(before.effect.stop).toBe(false);

    const after = reduceEngineLifecycle(bg.state, { type: 'timer', now: 1100 }, POLICY);
    expect(after.effect.stop).toBe(true);
    expect(after.state.status).toBe('stopping');
  });

  it('cancels a pending stop when the app returns to the foreground', () => {
    const ready = { ...initialEngineLifecycleState(true), status: 'ready' as const };
    const bg = reduceEngineLifecycle(ready, { type: 'appstate', value: 'background', now: 0 }, POLICY);
    const fg = reduceEngineLifecycle(bg.state, { type: 'appstate', value: 'active', now: 200 }, POLICY);
    expect(fg.state.pendingStopAt).toBeNull();
    expect(fg.effect.armTimerAt).toBeNull();
    // Already running → no restart needed.
    expect(fg.effect.start).toBe(false);
  });

  it('treats inactive like background (grace), not an immediate stop', () => {
    const ready = { ...initialEngineLifecycleState(true), status: 'ready' as const };
    const { state, effect } = reduceEngineLifecycle(ready, { type: 'appstate', value: 'inactive', now: 0 }, POLICY);
    expect(state.pendingStopAt).toBe(1000);
    expect(effect.stop).toBe(false);
  });

  it('does not arm a background stop for a non-foreground-tier host (Android)', () => {
    const ready = { ...initialEngineLifecycleState(true), status: 'ready' as const };
    const { state, effect } = reduceEngineLifecycle(ready, { type: 'appstate', value: 'background', now: 0 }, ANDROID_POLICY);
    expect(state.pendingStopAt).toBeNull();
    expect(effect.stop).toBe(false);
    expect(effect.start).toBe(false);
  });

  it('surfaces a fatal start error', () => {
    const { state } = reduceEngineLifecycle(initialEngineLifecycleState(true), { type: 'failed', message: 'boom' }, POLICY);
    expect(state.status).toBe('error');
    expect(state.lastError).toBe('boom');
  });

  it('clears lastError on ready', () => {
    const errored = { ...initialEngineLifecycleState(true), status: 'error' as const, lastError: 'boom' };
    const { state } = reduceEngineLifecycle(errored, { type: 'ready' }, POLICY);
    expect(state.status).toBe('ready');
    expect(state.lastError).toBeNull();
  });
});

// ── Controller ───────────────────────────────────────────────────────────

interface FakeAppState {
  currentState: AppStateStatus;
  addEventListener: (t: 'change', h: (s: AppStateStatus) => void) => { remove(): void };
  fire: (s: AppStateStatus) => void;
}

function fakeAppState(initial: AppStateStatus = 'active'): FakeAppState {
  let handler: ((s: AppStateStatus) => void) | undefined;
  return {
    currentState: initial,
    addEventListener: (_t, h) => {
      handler = h;
      return { remove: () => { handler = undefined; } };
    },
    fire: (s) => handler?.(s),
  };
}

function fakeHost(foregroundTier: boolean): EngineHost {
  return {
    kind: foregroundTier ? 'embedded' : 'sidecar',
    foregroundTier,
    isAvailable: async () => true,
    start: async () => ({
      wsPort: 1, wssPort: 0, adminPort: 2, bind: '127.0.0.1', pid: -1, dataDir: '', token: '',
    }),
    stop: async () => undefined,
    getState: async () => 'stopped',
    call: async () => '{}',
    onEvent: () => () => undefined,
    onExit: () => () => undefined,
  };
}

describe('createEngineLifecycle', () => {
  it('starts immediately when the app boots active and stops after the grace window on background', async () => {
    const appState = fakeAppState('active');
    const start = jest.fn(async () => undefined);
    const stop = jest.fn(async () => undefined);
    const timer: { fn: (() => void) | null; at: number } = { fn: null, at: 0 };
    let clock = 0;

    const ctrl = createEngineLifecycle({
      host: fakeHost(true),
      graceMs: 1000,
      start,
      stop,
      appState,
      now: () => clock,
      timers: {
        setTimeout: (fn, ms) => { timer.fn = fn; timer.at = ms; return 1; },
        clearTimeout: () => { timer.fn = null; },
      },
    });

    // Boot (active) → started.
    await ctrl.ensureStarted();
    expect(start).toHaveBeenCalledTimes(1);
    expect(ctrl.getState().status).toBe('ready');

    // Background → grace timer armed, no stop yet.
    appState.fire('background');
    expect(stop).not.toHaveBeenCalled();
    expect(ctrl.getState().pendingStopAt).not.toBeNull();
    expect(timer.at).toBe(1000);

    // Timer fires at the deadline → stop.
    clock = 1000;
    timer.fn?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(ctrl.getState().status).toBe('stopped');

    ctrl.dispose();
  });

  it('cancels the scheduled stop when the app returns to the foreground', async () => {
    const appState = fakeAppState('active');
    const start = jest.fn(async () => undefined);
    const stop = jest.fn(async () => undefined);
    let cleared = 0;

    const ctrl = createEngineLifecycle({
      host: fakeHost(true),
      start,
      stop,
      appState,
      now: () => 0,
      graceMs: ENGINE_BACKGROUND_GRACE_MS,
      timers: {
        setTimeout: () => 7,
        clearTimeout: () => { cleared += 1; },
      },
    });
    await ctrl.ensureStarted();

    appState.fire('background');
    expect(ctrl.getState().pendingStopAt).not.toBeNull();
    appState.fire('active');
    expect(ctrl.getState().pendingStopAt).toBeNull();
    expect(cleared).toBeGreaterThan(0);

    ctrl.dispose();
  });

  it('surfaces a fatal start error in the state', async () => {
    const appState = fakeAppState('active');
    const ctrl = createEngineLifecycle({
      host: fakeHost(true),
      start: async () => { throw new Error('init failed'); },
      stop: async () => undefined,
      appState,
      timers: { setTimeout: () => 1, clearTimeout: () => undefined },
    });
    await ctrl.ensureStarted();
    expect(ctrl.getState().status).toBe('error');
    expect(ctrl.getState().lastError).toBe('init failed');
    ctrl.dispose();
  });

  it('does not stop on background for a non-foreground-tier host', () => {
    const appState = fakeAppState('active');
    const stop = jest.fn(async () => undefined);
    const ctrl = createEngineLifecycle({
      host: fakeHost(false),
      start: async () => undefined,
      stop,
      appState,
      timers: { setTimeout: () => 1, clearTimeout: () => undefined },
    });
    appState.fire('background');
    expect(ctrl.getState().pendingStopAt).toBeNull();
    expect(stop).not.toHaveBeenCalled();
    ctrl.dispose();
  });
});
