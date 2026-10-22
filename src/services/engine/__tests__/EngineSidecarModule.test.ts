/**
 * EngineSidecarModule — unit tests (task 1-2).
 *
 * Locks the JS-side contract of the Android engine sidecar:
 *  - pure readiness-line parsing (the engine's stdout is NOT pure JSON)
 *  - line-buffered stdout scanning (partial-line carry across chunks)
 *  - exponential restart backoff schedule
 *  - the status reducer
 *  - the native-backed start/stop/state/availability wrappers, with the
 *    native module + process seam mocked (NativeModules.EngineSidecar)
 *  - lifecycle event fan-out (ready / restarting / crashed / stopped / exit)
 *
 * The readiness JSON keys are the engine's wire keys (`ws`, `wss`, `admin`,
 * `bind`, `pid`, `dataDir`) — see the engine repo's docs/Sidecar-Deployment.md.
 */

import { NativeModules, Platform, DeviceEventEmitter } from 'react-native';

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

import * as engineSidecar from '../EngineSidecarModule';

const READY_LINE =
  'ENGINE_READY {"ws":28080,"wss":28443,"admin":28081,"bind":"127.0.0.1","pid":12345,"dataDir":"/data/user/0/ai.soulbits.chat/files/engine","token":"a1b2c3"}';

const mockNative: any = {
  isAvailable: jest.fn(async () => true),
  start: jest.fn(async () => ({ rawLine: READY_LINE })),
  stop: jest.fn(async () => undefined),
  getState: jest.fn(async () => 'ready'),
  addListener: jest.fn(),
  removeListeners: jest.fn(),
};

/** Load the wrapper with a fresh module registry + our native mock (Android). */
function loadModule(): typeof engineSidecar {
  jest.resetModules();
  (Platform as any).OS = 'android';
  (NativeModules as any).EngineSidecar = mockNative;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../EngineSidecarModule');
}

beforeEach(() => {
  jest.clearAllMocks();
  (NativeModules as any).EngineSidecar = mockNative;
});

// ── parseReadyLine ───────────────────────────────────────────────────────
describe('parseReadyLine', () => {
  it('parses a well-formed readiness line into camelCase fields', () => {
    const parsed = engineSidecar.parseReadyLine(READY_LINE);
    expect(parsed).toEqual({
      wsPort: 28080,
      wssPort: 28443,
      adminPort: 28081,
      bind: '127.0.0.1',
      pid: 12345,
      dataDir: '/data/user/0/ai.soulbits.chat/files/engine',
      token: 'a1b2c3',
    });
  });

  it('tolerates trailing CR and surrounding whitespace', () => {
    expect(engineSidecar.parseReadyLine(READY_LINE + '\r')).not.toBeNull();
  });

  it('finds the prefix even when the line is preceded by stdout noise', () => {
    const noisy = '[GIN-debug] GET /public/appname --> 0.1ms ' + READY_LINE;
    expect(engineSidecar.parseReadyLine(noisy)?.wsPort).toBe(28080);
  });

  it('returns null for a line without the prefix', () => {
    expect(engineSidecar.parseReadyLine('{"ws":1,"admin":2}')).toBeNull();
    expect(engineSidecar.parseReadyLine('[GIN-debug] listening')).toBeNull();
    expect(engineSidecar.parseReadyLine('')).toBeNull();
  });

  it('returns null when the JSON after the prefix is malformed', () => {
    expect(engineSidecar.parseReadyLine('ENGINE_READY {not json')).toBeNull();
    expect(engineSidecar.parseReadyLine('ENGINE_READY ')).toBeNull();
  });

  it('returns null when required ports are missing or non-positive', () => {
    expect(engineSidecar.parseReadyLine('ENGINE_READY {"admin":28081}')).toBeNull();
    expect(engineSidecar.parseReadyLine('ENGINE_READY {"ws":0,"admin":28081}')).toBeNull();
    expect(engineSidecar.parseReadyLine('ENGINE_READY {"ws":28080,"admin":-1}')).toBeNull();
  });

  it('defaults optional fields (wss/pid/bind/dataDir/token) when absent', () => {
    const parsed = engineSidecar.parseReadyLine('ENGINE_READY {"ws":28080,"admin":28081}');
    expect(parsed).toEqual({
      wsPort: 28080,
      wssPort: 0,
      adminPort: 28081,
      bind: '127.0.0.1',
      pid: -1,
      dataDir: '',
      token: '',
    });
  });
});

// ── scanStdoutForReady ───────────────────────────────────────────────────
describe('scanStdoutForReady', () => {
  it('scans past noise lines to find readiness', () => {
    const chunk = '[GIN-debug] route dump\nseed: ok\n' + READY_LINE + '\n';
    const { payload } = engineSidecar.scanStdoutForReady(chunk);
    expect(payload?.adminPort).toBe(28081);
  });

  it('carries a partial line across chunks', () => {
    const first = engineSidecar.scanStdoutForReady('noise line\nENGINE_RE');
    expect(first.payload).toBeNull();
    expect(first.carry).toBe('ENGINE_RE');

    const second = engineSidecar.scanStdoutForReady('ADY {"ws":1,"admin":2}\n', first.carry);
    expect(second.payload).toEqual({
      wsPort: 1,
      wssPort: 0,
      adminPort: 2,
      bind: '127.0.0.1',
      pid: -1,
      dataDir: '',
      token: '',
    });
  });

  it('returns null and keeps the partial tail when no complete line yet', () => {
    const { payload, carry } = engineSidecar.scanStdoutForReady('partial-without-newline');
    expect(payload).toBeNull();
    expect(carry).toBe('partial-without-newline');
  });
});

// ── computeBackoffDelayMs ────────────────────────────────────────────────
describe('computeBackoffDelayMs', () => {
  it('follows the exponential schedule clamped to the ceiling', () => {
    expect(engineSidecar.computeBackoffDelayMs(1)).toBe(500);
    expect(engineSidecar.computeBackoffDelayMs(2)).toBe(1000);
    expect(engineSidecar.computeBackoffDelayMs(3)).toBe(2000);
    expect(engineSidecar.computeBackoffDelayMs(4)).toBe(4000);
    expect(engineSidecar.computeBackoffDelayMs(5)).toBe(8000);
    expect(engineSidecar.computeBackoffDelayMs(6)).toBe(8000);
  });

  it('clamps non-positive / fractional attempts to the base delay', () => {
    expect(engineSidecar.computeBackoffDelayMs(0)).toBe(500);
    expect(engineSidecar.computeBackoffDelayMs(-3)).toBe(500);
    expect(engineSidecar.computeBackoffDelayMs(1.9)).toBe(500);
  });
});

// ── nextEngineStatus ─────────────────────────────────────────────────────
describe('nextEngineStatus', () => {
  it('maps lifecycle events to statuses', () => {
    const ready = engineSidecar.nextEngineStatus('starting', {
      type: 'ready',
      payload: engineSidecar.parseReadyLine(READY_LINE)!,
      rawLine: READY_LINE,
    });
    expect(ready).toBe('ready');

    expect(
      engineSidecar.nextEngineStatus('ready', { type: 'restarting', attempt: 1, delayMs: 500 }),
    ).toBe('restarting');

    expect(
      engineSidecar.nextEngineStatus('restarting', {
        type: 'crashed',
        attempt: 3,
        maxAttempts: 3,
        code: 1,
        signal: null,
      }),
    ).toBe('failed');

    expect(
      engineSidecar.nextEngineStatus('ready', { type: 'stopped', code: 0, signal: null }),
    ).toBe('stopped');

    expect(engineSidecar.nextEngineStatus('ready', { type: 'state', status: 'stopped' })).toBe(
      'stopped',
    );
  });

  it('classifies exits: expected→stopped, restarting→restarting, final→failed', () => {
    expect(
      engineSidecar.nextEngineStatus('ready', {
        type: 'exit',
        exit: { code: 0, signal: null, expected: true, restartAttempt: 0, willRestart: false },
      }),
    ).toBe('stopped');

    expect(
      engineSidecar.nextEngineStatus('ready', {
        type: 'exit',
        exit: { code: 1, signal: null, expected: false, restartAttempt: 1, willRestart: true },
      }),
    ).toBe('restarting');

    expect(
      engineSidecar.nextEngineStatus('restarting', {
        type: 'exit',
        exit: { code: 1, signal: null, expected: false, restartAttempt: 3, willRestart: false },
      }),
    ).toBe('failed');
  });
});

// ── Native-backed API ────────────────────────────────────────────────────
describe('native-backed API', () => {
  it('isEngineSidecarAvailable reflects the native check', async () => {
    const mod = loadModule();
    await expect(mod.isEngineSidecarAvailable()).resolves.toBe(true);
    mockNative.isAvailable.mockResolvedValueOnce(false);
    await expect(mod.isEngineSidecarAvailable()).resolves.toBe(false);
  });

  it('startEngineSidecar resolves the parsed readiness payload from the raw line', async () => {
    const mod = loadModule();
    const payload = await mod.startEngineSidecar({ dbKey: 'secret', logLevel: 'info' });
    expect(payload.wsPort).toBe(28080);
    expect(payload.adminPort).toBe(28081);
    expect(mockNative.start).toHaveBeenCalledWith(
      expect.objectContaining({ dbKey: 'secret', logLevel: 'info' }),
    );
  });

  it('startEngineSidecar falls back to pre-parsed bridge fields when rawLine is absent', async () => {
    const mod = loadModule();
    mockNative.start.mockResolvedValueOnce({
      wsPort: 12345,
      adminPort: 12346,
      wssPort: 12347,
      bind: '127.0.0.1',
      pid: 99,
      dataDir: '/tmp/engine',
    });
    const payload = await mod.startEngineSidecar();
    expect(payload).toEqual({
      wsPort: 12345,
      wssPort: 12347,
      adminPort: 12346,
      bind: '127.0.0.1',
      pid: 99,
      dataDir: '/tmp/engine',
      token: '',
    });
  });

  it('startEngineSidecar rejects when the bridge result is unparseable', async () => {
    const mod = loadModule();
    mockNative.start.mockResolvedValueOnce({ rawLine: 'not a readiness line' });
    await expect(mod.startEngineSidecar()).rejects.toThrow(/parseable readiness/);
  });

  it('startEngineSidecar rejects when the native module is unavailable', async () => {
    jest.resetModules();
    (Platform as any).OS = 'android';
    (NativeModules as any).EngineSidecar = undefined;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../EngineSidecarModule');
    await expect(mod.startEngineSidecar()).rejects.toThrow(/unavailable/);
  });

  it('startEngineSidecar rejects when the feature flag is off', async () => {
    const mod = loadModule();
    mod.setEngineSidecarEnabled(false);
    try {
      await expect(mod.startEngineSidecar()).rejects.toThrow(/disabled/);
    } finally {
      mod.setEngineSidecarEnabled(null);
    }
  });

  it('startEngineSidecar recovers the loopback token when an already-running sidecar resolves with rawLine=""', async () => {
    const mod = loadModule();
    // 1st start: fresh launch with rawLine containing token.
    const first = await mod.startEngineSidecar();
    expect(first.token).toBe('a1b2c3');

    // 2nd start (e.g. JS reload while sidecar is alive): older native bridge
    // returns rawLine="" and no token field — cached token for the same
    // pid/wsPort/adminPort is restored.
    mockNative.start.mockResolvedValueOnce({
      rawLine: '',
      wsPort: 28080,
      wssPort: 28443,
      adminPort: 28081,
      bind: '127.0.0.1',
      pid: 12345,
      dataDir: '/data/user/0/ai.soulbits.chat/files/engine',
    });
    const second = await mod.startEngineSidecar();
    expect(second.token).toBe('a1b2c3');
  });

  it('stopEngineSidecar forwards to native and no-ops without a module', async () => {
    const mod = loadModule();
    await mod.stopEngineSidecar();
    expect(mockNative.stop).toHaveBeenCalledTimes(1);
  });

  it('getEngineSidecarState returns the native status', async () => {
    const mod = loadModule();
    await expect(mod.getEngineSidecarState()).resolves.toBe('ready');
    mockNative.getState.mockResolvedValueOnce('failed');
    await expect(mod.getEngineSidecarState()).resolves.toBe('failed');
  });
});

// ── Event fan-out ────────────────────────────────────────────────────────
describe('event fan-out', () => {
  it('delivers ready / restarting / crashed / stopped / exit to subscribers', () => {
    const mod = loadModule();
    const seen: string[] = [];
    const unsubscribe = mod.onEngineSidecarEvent(e => seen.push(e.type));

    DeviceEventEmitter.emit('engine:ready', { rawLine: READY_LINE });
    DeviceEventEmitter.emit('engine:restarting', { attempt: 1, delayMs: 500 });
    DeviceEventEmitter.emit('engine:crashed', { attempt: 3, maxAttempts: 3, code: 1 });
    DeviceEventEmitter.emit('engine:stopped', { code: 0 });
    DeviceEventEmitter.emit('engine:exit', {
      code: 0,
      signal: null,
      expected: true,
      restartAttempt: 0,
      willRestart: false,
    });

    expect(seen).toEqual(['ready', 'restarting', 'crashed', 'stopped', 'exit']);
    unsubscribe();
    DeviceEventEmitter.emit('engine:stopped', { code: 0 });
    expect(seen).toHaveLength(5);
  });

  it('normalizes the ready payload from the raw line', () => {
    const mod = loadModule();
    const events: any[] = [];
    const unsubscribe = mod.onEngineSidecarEvent(e => events.push(e));
    DeviceEventEmitter.emit('engine:ready', { rawLine: READY_LINE });
    expect(events[0]).toEqual({
      type: 'ready',
      rawLine: READY_LINE,
      payload: expect.objectContaining({ wsPort: 28080, adminPort: 28081 }),
    });
    unsubscribe();
  });

  it('onEngineExit delivers only exit events', () => {
    const mod = loadModule();
    const exits: any[] = [];
    const unsubscribe = mod.onEngineExit(e => exits.push(e));
    DeviceEventEmitter.emit('engine:ready', { rawLine: READY_LINE });
    DeviceEventEmitter.emit('engine:exit', { code: 1, expected: false, willRestart: true });
    expect(exits).toHaveLength(1);
    expect(exits[0]).toEqual({
      code: 1,
      signal: null,
      expected: false,
      restartAttempt: 0,
      willRestart: true,
    });
    unsubscribe();
  });
});
