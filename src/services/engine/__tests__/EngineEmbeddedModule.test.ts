/**
 * EngineEmbeddedModule — unit tests (task 4-2).
 *
 * Locks the JS-side contract of the iOS in-process engine module:
 *  - bare readiness-JSON parsing (the facade's `EngineStart` returns JSON with no
 *    `ENGINE_READY ` prefix)
 *  - the native-backed start / stop / state / call wrappers (NativeModules.SoulbitsEngine)
 *  - lifecycle event fan-out (ready / state / stopped / error)
 */

import { NativeModules, Platform, DeviceEventEmitter } from 'react-native';

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import * as embedded from '../EngineEmbeddedModule';
import { parseReadyPayload } from '../EngineSidecarModule';

const READY_JSON =
  '{"ws":28080,"wss":28443,"admin":28081,"bind":"127.0.0.1","pid":7,"dataDir":"/var/mobile/Documents","token":"deadbeef"}';

const mockNative: any = {
  isAvailable: jest.fn(async () => true),
  start: jest.fn(async () => ({ rawLine: READY_JSON })),
  stop: jest.fn(async () => undefined),
  getState: jest.fn(async () => 'ready'),
  call: jest.fn(async () => '{"ok":true}'),
  finishWake: jest.fn(async () => true),
  consumePendingWake: jest.fn(async () => null),
  consumePendingPushToken: jest.fn(async () => null),
  addListener: jest.fn(),
  removeListeners: jest.fn(),
};

/** Load the wrapper with a fresh module registry + our native mock (iOS). */
function loadModule(): typeof embedded {
  jest.resetModules();
  (Platform as any).OS = 'ios';
  (NativeModules as any).SoulbitsEngine = mockNative;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../EngineEmbeddedModule');
}

beforeEach(() => {
  jest.clearAllMocks();
  (Platform as any).OS = 'ios';
  (NativeModules as any).SoulbitsEngine = mockNative;
});

describe('parseReadyPayload', () => {
  it('parses the bare facade readiness document', () => {
    expect(parseReadyPayload(READY_JSON)).toEqual({
      wsPort: 28080,
      wssPort: 28443,
      adminPort: 28081,
      bind: '127.0.0.1',
      pid: 7,
      dataDir: '/var/mobile/Documents',
      token: 'deadbeef',
    });
  });

  it('tolerates a prefixed line and defaults optional fields', () => {
    expect(parseReadyPayload('ENGINE_READY {"ws":1,"admin":2}')).toEqual({
      wsPort: 1,
      wssPort: 0,
      adminPort: 2,
      bind: '127.0.0.1',
      pid: -1,
      dataDir: '',
      token: '',
    });
  });

  it('returns null for malformed or port-less documents', () => {
    expect(parseReadyPayload('')).toBeNull();
    expect(parseReadyPayload('{not json')).toBeNull();
    expect(parseReadyPayload('{"admin":28081}')).toBeNull();
    expect(parseReadyPayload('{"ws":0,"admin":28081}')).toBeNull();
  });
});

describe('native-backed API', () => {
  it('isEngineEmbeddedAvailable reflects the native check', async () => {
    const mod = loadModule();
    await expect(mod.isEngineEmbeddedAvailable()).resolves.toBe(true);
    mockNative.isAvailable.mockResolvedValueOnce(false);
    await expect(mod.isEngineEmbeddedAvailable()).resolves.toBe(false);
  });

  it('startEngineEmbedded parses the readiness document', async () => {
    const mod = loadModule();
    const payload = await mod.startEngineEmbedded({ dbKey: 'secret', logLevel: 'info' });
    expect(payload.wsPort).toBe(28080);
    expect(payload.adminPort).toBe(28081);
    expect(payload.token).toBe('deadbeef');
    expect(mockNative.start).toHaveBeenCalledWith(
      expect.objectContaining({ dbKey: 'secret', logLevel: 'info' }),
    );
  });

  it('startEngineEmbedded rejects when the native result is unparseable', async () => {
    const mod = loadModule();
    mockNative.start.mockResolvedValueOnce({ rawLine: '{not json' });
    await expect(mod.startEngineEmbedded()).rejects.toThrow(/readiness payload/);
  });

  it('startEngineEmbedded rejects when the module is absent', async () => {
    jest.resetModules();
    (NativeModules as any).SoulbitsEngine = undefined;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../EngineEmbeddedModule');
    await expect(mod.startEngineEmbedded()).rejects.toThrow(/unavailable/);
  });

  it('stopEngineEmbedded forwards to native (no-op without a module)', async () => {
    const mod = loadModule();
    await mod.stopEngineEmbedded();
    expect(mockNative.stop).toHaveBeenCalled();
  });

  it('getEngineEmbeddedState returns the native status', async () => {
    const mod = loadModule();
    await expect(mod.getEngineEmbeddedState()).resolves.toBe('ready');
    mockNative.getState.mockResolvedValueOnce('failed');
    await expect(mod.getEngineEmbeddedState()).resolves.toBe('failed');
  });

  it('callEngineEmbedded forwards the method + payload and resolves the JSON', async () => {
    const mod = loadModule();
    await expect(mod.callEngineEmbedded('lifecycle.batch', '{"deadline":"2026-01-01T00:00:00Z"}')).resolves.toBe('{"ok":true}');
    expect(mockNative.call).toHaveBeenCalledWith('lifecycle.batch', '{"deadline":"2026-01-01T00:00:00Z"}');
  });
});

describe('event fan-out', () => {
  it('delivers ready / state / stopped / error to subscribers', () => {
    const mod = loadModule();
    const seen: string[] = [];
    const unsubscribe = mod.onEngineEmbeddedEvent(e => seen.push(e.type));

    DeviceEventEmitter.emit('engine:ready', { rawLine: READY_JSON });
    DeviceEventEmitter.emit('engine:state', { status: 'ready' });
    DeviceEventEmitter.emit('engine:stopped', { code: 0 });
    DeviceEventEmitter.emit('engine:error', { message: 'init failed' });

    expect(seen).toEqual(['ready', 'state', 'stopped', 'crashed']);
    unsubscribe();
    DeviceEventEmitter.emit('engine:stopped', { code: 0 });
    expect(seen).toHaveLength(4);
  });

  it('normalizes the ready payload from the readiness document', () => {
    const mod = loadModule();
    const events: any[] = [];
    const unsubscribe = mod.onEngineEmbeddedEvent(e => events.push(e));
    DeviceEventEmitter.emit('engine:ready', { rawLine: READY_JSON });
    expect(events[0]).toEqual({
      type: 'ready',
      rawLine: READY_JSON,
      payload: expect.objectContaining({ wsPort: 28080, adminPort: 28081, token: 'deadbeef' }),
    });
    unsubscribe();
  });
});

describe('task 4-3 wake / push-token surface', () => {
  it('delivers engine:wake to wake subscribers with a normalized kind', () => {
    const mod = loadModule();
    const seen: any[] = [];
    const unsub = mod.onEngineWake(e => seen.push(e));
    DeviceEventEmitter.emit('engine:wake', { taskId: 't1', kind: 'maintenance' });
    DeviceEventEmitter.emit('engine:wake', { taskId: 't2', kind: 'bogus' });
    DeviceEventEmitter.emit('engine:wake', { kind: 'keepalive' }); // no taskId → dropped
    expect(seen).toEqual([
      { taskId: 't1', kind: 'maintenance', payload: undefined },
      { taskId: 't2', kind: 'keepalive', payload: undefined },
    ]);
    unsub();
  });

  it('delivers push:token to token subscribers', () => {
    const mod = loadModule();
    const seen: string[] = [];
    const unsub = mod.onPushToken(e => seen.push(e.token));
    DeviceEventEmitter.emit('push:token', { token: 'abc123' });
    DeviceEventEmitter.emit('push:token', { token: '' });
    expect(seen).toEqual(['abc123']);
    unsub();
  });

  it('finishEngineWake forwards to native', async () => {
    const mod = loadModule();
    await mod.finishEngineWake('t1', '{"honored":true}');
    expect(mockNative.finishWake).toHaveBeenCalledWith('t1', '{"honored":true}');
  });

  it('consumePendingEngineWake parses a queued wake (null when none)', async () => {
    const mod = loadModule();
    await expect(mod.consumePendingEngineWake()).resolves.toBeNull();
    mockNative.consumePendingWake.mockResolvedValueOnce({ taskId: 'q1', kind: 'relay' });
    await expect(mod.consumePendingEngineWake()).resolves.toEqual({
      taskId: 'q1',
      kind: 'relay',
      payload: undefined,
    });
  });

  it('consumePendingPushToken returns the token (null when none)', async () => {
    const mod = loadModule();
    await expect(mod.consumePendingPushToken()).resolves.toBeNull();
    mockNative.consumePendingPushToken.mockResolvedValueOnce('deadbeef');
    await expect(mod.consumePendingPushToken()).resolves.toBe('deadbeef');
  });
});
