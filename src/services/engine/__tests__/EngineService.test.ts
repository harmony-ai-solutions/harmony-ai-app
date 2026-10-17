/**
 * EngineService — unit tests (tasks 3-2, 4-2).
 *
 * EngineService now consumes the platform-agnostic `EngineHost` (selected by
 * `selectEngineHost()`), so these tests inject a fake host by mocking the host
 * module. The subscription is registered at module load, so the mock factory
 * is hoisted above the imports (this is what binds the fake host's `onEvent`).
 */

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

// The host is built inside the hoisted factory (a top-level `const` would be in
// the temporal dead zone when EngineService requires the host at import time).
jest.mock('../EngineHost', () => {
  const host = {
    kind: 'sidecar',
    foregroundTier: false,
    isAvailable: jest.fn(async () => true),
    start: jest.fn(async () => ({
      wsPort: 28080,
      wssPort: 0,
      adminPort: 28081,
      bind: '127.0.0.1',
      pid: 42,
      dataDir: '/data/engine',
      token: 'tok',
    })),
    stop: jest.fn(async () => undefined),
    getState: jest.fn(async () => 'ready'),
    call: jest.fn(async () => '{}'),
    onEvent: jest.fn((_listener: (e: unknown) => void) => () => undefined),
    onExit: jest.fn((_listener: (e: unknown) => void) => () => undefined),
  };
  return { selectEngineHost: () => host, setEngineHostOverride: jest.fn(), __host: host };
});

import * as hostModule from '../EngineHost';
const mockHost = (hostModule as unknown as { __host: any }).__host as {
  isAvailable: jest.Mock;
  start: jest.Mock;
  stop: jest.Mock;
  getState: jest.Mock;
  call: jest.Mock;
  onEvent: jest.Mock;
  onExit: jest.Mock;
};

import {
  clearEngineConnection,
  connectEngine,
  connectionFromReady,
  disconnectEngine,
  getEngineConnection,
  getEngineStatus,
  getLastEngineExit,
  onEngineConnectionChange,
  onEngineExitChange,
  onEngineStatusChange,
  requireEngineConnection,
  resetEngineServiceForTests,
  restartEngine,
  setEngineConnection,
  syncEngineConnectionState,
} from '../EngineService';
import type { EngineReadyPayload } from '../../../types/engineSidecar';

// EngineService subscribes to host events at module load; capture the listener
// it registered so tests can drive the lifecycle fan-out.
const emit = mockHost.onEvent.mock.calls[0][0] as (e: unknown) => void;

const payload: EngineReadyPayload = {
  wsPort: 28080,
  wssPort: 28443,
  adminPort: 28081,
  bind: '127.0.0.1',
  pid: 42,
  dataDir: '/data/engine',
  token: 'tok',
};

beforeEach(() => {
  resetEngineServiceForTests();
  jest.clearAllMocks();
  mockHost.getState.mockResolvedValue('ready');
});

describe('EngineService', () => {
  it('builds a connection descriptor from a readiness payload', () => {
    const c = connectionFromReady(payload);
    expect(c).toEqual({
      adminBaseUrl: 'http://127.0.0.1:28081',
      wsBaseUrl: 'ws://127.0.0.1:28080',
      wssBaseUrl: 'wss://127.0.0.1:28443',
      token: 'tok',
      bind: '127.0.0.1',
      wsPort: 28080,
      wssPort: 28443,
      adminPort: 28081,
      pid: 42,
      dataDir: '/data/engine',
    });
  });

  it('defaults the bind host and omits a wss URL when the host is WS-only', () => {
    const c = connectionFromReady({ ...payload, bind: '', wssPort: 0 });
    expect(c.adminBaseUrl).toBe('http://127.0.0.1:28081');
    expect(c.wssBaseUrl).toBe('');
  });

  it('sets, gets and clears the connection', () => {
    expect(getEngineConnection()).toBeNull();
    setEngineConnection(payload);
    expect(getEngineConnection()?.adminPort).toBe(28081);
    clearEngineConnection();
    expect(getEngineConnection()).toBeNull();
  });

  it('requireEngineConnection throws when not connected', () => {
    expect(() => requireEngineConnection()).toThrow(/not connected/);
    setEngineConnection(payload);
    expect(requireEngineConnection().token).toBe('tok');
  });

  it('notifies listeners on set and clear', () => {
    const seen: Array<string | null> = [];
    const unsub = onEngineConnectionChange(c => seen.push(c?.adminBaseUrl ?? null));
    setEngineConnection(payload);
    clearEngineConnection();
    expect(seen).toEqual(['http://127.0.0.1:28081', null]);
    unsub();
    setEngineConnection(payload);
    expect(seen).toHaveLength(2);
  });

  it('connectEngine starts the host and publishes the connection', async () => {
    const ready = await connectEngine();
    expect(ready.adminPort).toBe(28081);
    expect(mockHost.start).toHaveBeenCalled();
    expect(getEngineConnection()?.token).toBe('tok');
  });

  it('disconnectEngine stops the host and clears the connection', async () => {
    setEngineConnection(payload);
    await disconnectEngine();
    expect(mockHost.stop).toHaveBeenCalled();
    expect(getEngineConnection()).toBeNull();
  });

  it('clears the connection when the host stops or crashes', () => {
    setEngineConnection(payload);
    emit({ type: 'stopped', code: 0, signal: null });
    expect(getEngineConnection()).toBeNull();

    setEngineConnection(payload);
    emit({ type: 'crashed', attempt: 3, maxAttempts: 3, code: 1, signal: null });
    expect(getEngineConnection()).toBeNull();
  });

  it('replaces the connection on a fresh readiness event (restart)', () => {
    setEngineConnection(payload);
    emit({ type: 'ready', payload: { ...payload, adminPort: 29000 }, rawLine: 'x' });
    expect(getEngineConnection()?.adminPort).toBe(29000);
  });

  it('syncEngineConnectionState clears when the host state is not ready', async () => {
    setEngineConnection(payload);
    mockHost.getState.mockResolvedValueOnce('failed');
    await syncEngineConnectionState();
    expect(getEngineConnection()).toBeNull();
  });
});

describe('EngineService — restartEngine (post-restore activation)', () => {
  it('stops then starts the host and re-publishes the connection', async () => {
    setEngineConnection(payload);
    const seen: Array<string | null> = [];
    const unsub = onEngineConnectionChange(c => seen.push(c?.adminBaseUrl ?? null));

    const ready = await restartEngine();

    expect(ready.adminPort).toBe(28081);
    expect(mockHost.stop).toHaveBeenCalledTimes(1);
    expect(mockHost.start).toHaveBeenCalledTimes(1);
    expect(getEngineConnection()?.token).toBe('tok');
    // The connection is cleared (disconnect) then re-published (connect), which
    // is the signal connection-change consumers re-init on.
    expect(seen).toEqual([null, 'http://127.0.0.1:28081']);
    unsub();
  });

  it('forwards start options through to the host', async () => {
    await restartEngine({ dataDir: '/custom' });
    expect(mockHost.start).toHaveBeenCalledWith(expect.objectContaining({ dataDir: '/custom' }));
  });

  it('shares a single in-flight restart across concurrent callers', async () => {
    let releaseStop!: () => void;
    const stopGate = new Promise<void>(resolve => {
      releaseStop = resolve;
    });
    mockHost.stop.mockImplementationOnce(() => stopGate);

    const first = restartEngine();
    const second = restartEngine();
    releaseStop();

    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b); // the same shared result
    expect(mockHost.stop).toHaveBeenCalledTimes(1);
    expect(mockHost.start).toHaveBeenCalledTimes(1);
  });

  it('clears the in-flight guard after a failure so a later restart can run', async () => {
    mockHost.start.mockRejectedValueOnce(new Error('boot failed'));
    await expect(restartEngine()).rejects.toThrow('boot failed');

    // Guard cleared → the next call starts a fresh cycle.
    const ready = await restartEngine();
    expect(ready.adminPort).toBe(28081);
    expect(mockHost.start).toHaveBeenCalledTimes(2);
  });
});

describe('EngineService — lifecycle status + last exit', () => {
  it('tracks starting/ready/failed status from host events', () => {
    emit({ type: 'state', status: 'starting' });
    expect(getEngineStatus()).toBe('starting');

    emit({ type: 'ready', payload, rawLine: 'x' });
    expect(getEngineStatus()).toBe('ready');

    emit({ type: 'crashed', attempt: 3, maxAttempts: 3, code: 1, signal: null });
    expect(getEngineStatus()).toBe('failed');
  });

  it('reports ready when a connection is published directly', () => {
    setEngineConnection(payload);
    expect(getEngineStatus()).toBe('ready');
  });

  it('reports stopped after an explicit disconnect', async () => {
    setEngineConnection(payload);
    await disconnectEngine();
    expect(getEngineStatus()).toBe('stopped');
  });

  it('notifies status listeners on change only', () => {
    const seen: Array<string | null> = [];
    const unsub = onEngineStatusChange(s => seen.push(s));
    emit({ type: 'state', status: 'starting' });
    emit({ type: 'ready', payload, rawLine: 'x' });
    expect(seen).toEqual(['starting', 'ready']);
    unsub();
    emit({ type: 'state', status: 'stopped' });
    expect(seen).toHaveLength(2);
  });

  it('records the last exit and notifies exit listeners', () => {
    const seen: unknown[] = [];
    const unsub = onEngineExitChange(e => seen.push(e));
    const exit = { code: 1, signal: null, expected: false, restartAttempt: 3, willRestart: false };
    emit({ type: 'exit', exit });
    expect(getLastEngineExit()).toEqual(exit);
    expect(seen).toEqual([exit]);
    expect(getEngineStatus()).toBe('failed'); // unexpected, non-restarting exit
    unsub();
  });

  it('maps expected exits to stopped and restarting exits to restarting', () => {
    emit({ type: 'exit', exit: { code: 0, signal: null, expected: true, restartAttempt: 0, willRestart: false } });
    expect(getEngineStatus()).toBe('stopped');

    emit({ type: 'exit', exit: { code: 1, signal: null, expected: false, restartAttempt: 1, willRestart: true } });
    expect(getEngineStatus()).toBe('restarting');
  });
});
