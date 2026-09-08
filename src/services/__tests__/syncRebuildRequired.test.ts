/**
 * Phase 4-5 / D76 + D82 — app reaction to the engine's stale-watermark
 * rebuild signal (`SYNC_REJECT reason: "rebuild_required"`).
 *
 * The engine's purge floor (`max_purged_deleted_at`, 1-2) passed this
 * established device's sync watermark — the engine holds stale live rows it
 * can no longer correct. The app reacts (D82: process restart):
 *
 *   1. abort the in-flight sync attempt — send NOTHING further (the engine
 *      does NOT tear down the WS on this signal — 1-2 pin; the process
 *      restart closes it by construction; NO client-side WS-kill),
 *   2. persist the one-time wipe flag (setWipeRebuildFlag) — CRASH-SAFETY:
 *      the flag MUST be persisted BEFORE the restart is invoked, so a failed
 *      restart still wipes on the next natural launch (the D61 boot window),
 *   3. restart the app process (react-native-restart, mocked here).
 *
 * Loop guard (D82): a rebuild already completed in THIS process lifetime (the
 * boot wipe ran + cleared the flag) → a re-signal means the rebuild failed to
 * advance the watermark — log + surface a diagnostic error, NEVER restart
 * again (defensive; the D76 invariant makes this unreachable).
 *
 * Precedence vs. 3-3 (D82): the version gate wins — while `serverUpdateRequired`
 * is sticky, `initiateSync()` short-circuits at its top, so no SYNC_REQUEST
 * goes out and no rebuild signal can arrive in response; an out-of-band
 * rebuild_required while sticky is ignored (belt-and-braces).
 */

import { SyncService, SYNC_SCHEMA_VERSION } from '../SyncService';
import { EventEmitter } from 'eventemitter3';

// --- module-level refs for hoisted jest.mock factories -----------------------
// (Only ever accessed INSIDE the returned closures, never at factory-execution
// time — the established pattern in this suite's sibling test files.)

const mockStore = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockStore.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      mockStore.delete(key);
    }),
    multiRemove: jest.fn(async (keys: string[]) => {
      keys.forEach(key => mockStore.delete(key));
    }),
    getAllKeys: jest.fn(async () => Array.from(mockStore.keys())),
    clear: jest.fn(async () => {
      mockStore.clear();
    }),
  },
}));

jest.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

let mockConnectionManager: EventEmitter & {
  sendEvent: jest.Mock;
  isConnected: jest.Mock;
};

jest.mock('../connection/ConnectionManager', () => {
  const { EventEmitter: EE } = require('eventemitter3');
  const cm: EventEmitter & { sendEvent: jest.Mock; isConnected: jest.Mock } = new EE();
  cm.sendEvent = jest.fn().mockResolvedValue(undefined);
  cm.isConnected = jest.fn().mockReturnValue(true);
  mockConnectionManager = cm;
  return { __esModule: true, default: cm };
});

// ── 4-5 surface under test: the restart module + the wipe-flag module.
const mockRestartApp: jest.Mock = jest.fn();
jest.mock('../AppRestart', () => ({
  restartApp: (...args: any[]) => mockRestartApp(...args),
}));

const mockSetWipeRebuildFlag: jest.Mock = jest.fn(async () => {
  // Simulate the real persistence (the real flag module writes
  // '@harmony_wipe_rebuild_pending' = 'true' to AsyncStorage).
  mockStore.set('@harmony_wipe_rebuild_pending', 'true');
});

let mockRebuildCompletedInProcess = false;
jest.mock('../WipeRebuildFlag', () => ({
  setWipeRebuildFlag: (...args: any[]) => mockSetWipeRebuildFlag(...args),
  hasRebuildCompletedInProcess: () => mockRebuildCompletedInProcess,
}));

// --- helpers -----------------------------------------------------------------

const FLAG_KEY = '@harmony_wipe_rebuild_pending';

function resetSingleton(): void {
  (SyncService as any).instance = null;
}

function flush(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

function sentEvents(): any[] {
  return mockConnectionManager.sendEvent.mock.calls.map(([, event]: [string, any]) => event);
}

function syncReject(overrides: Record<string, any> = {}): { event_type: string; status: string; payload: any } {
  return {
    event_type: 'SYNC_REJECT',
    status: 'NEW',
    payload: {
      reason: 'rebuild_required',
      message: 'Your local database is stale — a rebuild is required',
      ...overrides,
    },
  };
}

function handshakeAccept(overrides: Record<string, any> = {}): { event_type: string; status: string; payload: any } {
  return {
    event_type: 'HANDSHAKE_ACCEPT',
    status: 'NEW',
    payload: {
      jwt_token: 'test-jwt',
      wss_port: 0,
      token_expires_at: 1750000000,
      server_cert: 'test-cert',
      ...overrides,
    },
  };
}

function syncAccept(overrides: Record<string, any> = {}): { event_type: string; status: string; payload: any } {
  return {
    event_type: 'SYNC_ACCEPT',
    status: 'NEW',
    payload: {
      sync_session_id: 'sess-1',
      force_full_sync: false,
      ...overrides,
    },
  };
}

/** Drive a sync into the established in_progress state: SYNC_REQUEST + SYNC_ACCEPT. */
async function establishInProgressSession(svc: SyncService): Promise<void> {
  await svc.initiateSync();
  mockConnectionManager.emit('event:sync', syncAccept());
  await flush();
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockStore.clear();
  mockRebuildCompletedInProcess = false;
  mockConnectionManager.sendEvent.mockClear();
  (mockConnectionManager.isConnected as jest.Mock).mockReturnValue(true);
  mockConnectionManager.removeAllListeners();
  (mockConnectionManager as any).syncServiceListenersInstalled = false;
  (mockConnectionManager as any).syncServiceEventTarget = null;
  resetSingleton();
  jest.useRealTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

// --- 1. Signal handling: abort → persist flag → restart ----------------------

describe('4-5 — rebuild_required reaction (abort → flag → restart)', () => {
  it('aborts the in-flight session (no further SYNC_DATA/sends), persists the wipe flag, invokes the restart', async () => {
    const svc = SyncService.getInstance();
    const rejectedListener = jest.fn();
    svc.on('sync:rejected', rejectedListener);

    // Established in-flight session (SYNC_REQUEST sent + accepted).
    await establishInProgressSession(svc);
    const sendsBeforeSignal = mockConnectionManager.sendEvent.mock.calls.length;
    expect(sendsBeforeSignal).toBeGreaterThan(0);
    expect((svc as any).currentSession?.status).toBe('in_progress');

    mockConnectionManager.emit('event:sync', syncReject());
    await flush();

    // In-flight session aborted: the initiateSync guard is released.
    expect((svc as any).currentSession).toBeNull();
    expect((svc as any).syncPhase).toBe('IDLE');
    // NOTHING further was sent — no SYNC_ABORT, no SYNC_DATA, no retry request.
    expect(mockConnectionManager.sendEvent.mock.calls.length).toBe(sendsBeforeSignal);
    // No generic rejection toast (the rebuild label is the only UX).
    expect(rejectedListener).not.toHaveBeenCalled();

    // Wipe flag persisted + restart invoked.
    expect(mockSetWipeRebuildFlag).toHaveBeenCalledTimes(1);
    expect(mockStore.get(FLAG_KEY)).toBe('true');
    expect(mockRestartApp).toHaveBeenCalledTimes(1);
  });

  it('persists the wipe flag BEFORE invoking the restart (crash-safety ordering)', async () => {
    const svc = SyncService.getInstance();
    await establishInProgressSession(svc);

    mockConnectionManager.emit('event:sync', syncReject());
    await flush();

    expect(mockSetWipeRebuildFlag).toHaveBeenCalledTimes(1);
    expect(mockRestartApp).toHaveBeenCalledTimes(1);
    const flagIdx = mockSetWipeRebuildFlag.mock.invocationCallOrder[0];
    const restartIdx = mockRestartApp.mock.invocationCallOrder[0];
    expect(flagIdx).toBeLessThan(restartIdx);
  });

  it('restart throwing still leaves the wipe flag persisted (next natural launch wipes)', async () => {
    const svc = SyncService.getInstance();
    await establishInProgressSession(svc);

    // The restart call itself fails (e.g. native module unavailable).
    mockRestartApp.mockImplementation(() => {
      throw new Error('restart boom');
    });

    mockConnectionManager.emit('event:sync', syncReject());
    await flush();

    // The flag was persisted BEFORE the restart attempt — a crash between the
    // two (or a failed restart call) still wipes on the next natural launch
    // (the D61 boot window consumes the flag; pinned by wipeRebuildFlag.test.ts
    // and DatabaseContext.wipe.test.tsx).
    expect(mockSetWipeRebuildFlag).toHaveBeenCalledTimes(1);
    expect(mockStore.get(FLAG_KEY)).toBe('true');
    expect(mockRestartApp).toHaveBeenCalledTimes(1);
  });

  it('established session: orderly abort only — NO client-side WS-kill before the restart', async () => {
    const svc = SyncService.getInstance();
    await establishInProgressSession(svc);
    const sendsBeforeSignal = mockConnectionManager.sendEvent.mock.calls.length;

    mockConnectionManager.emit('event:sync', syncReject());
    await flush();

    // The WS is closed by the process restart, not torn down by the engine
    // (1-2 pin) and not killed client-side: the handler sent nothing further
    // and touched NO connection-teardown API (the mock exposes only
    // sendEvent/isConnected — any teardown call would throw).
    expect(mockConnectionManager.sendEvent.mock.calls.length).toBe(sendsBeforeSignal);
    expect((svc as any).currentSession).toBeNull();
    expect(mockRestartApp).toHaveBeenCalledTimes(1);
  });

  it('a flag-persist failure does NOT restart (a restart without the flag cannot wipe)', async () => {
    const svc = SyncService.getInstance();
    await establishInProgressSession(svc);
    mockSetWipeRebuildFlag.mockRejectedValueOnce(new Error('storage boom'));

    mockConnectionManager.emit('event:sync', syncReject());
    await flush();

    expect(mockRestartApp).not.toHaveBeenCalled();
    expect(mockStore.get(FLAG_KEY)).toBeUndefined();
  });
});

// --- 2. Loop guard -----------------------------------------------------------

describe('4-5 — loop guard (D82): a re-flag after a completed rebuild never restart-loops', () => {
  it('a rebuild_required re-signal after a completed rebuild logs + surfaces a diagnostic, NO second restart', async () => {
    const svc = SyncService.getInstance();
    const errorListener = jest.fn();
    svc.on('sync:error', errorListener);

    // The boot window already completed a wipe in THIS process lifetime.
    mockRebuildCompletedInProcess = true;

    mockConnectionManager.emit('event:sync', syncReject());
    await flush();

    // NO restart, NO flag re-persist — just the diagnostic.
    expect(mockRestartApp).not.toHaveBeenCalled();
    expect(mockSetWipeRebuildFlag).not.toHaveBeenCalled();
    expect(mockStore.get(FLAG_KEY)).toBeUndefined();
    expect(errorListener).toHaveBeenCalledTimes(1);
    expect(errorListener.mock.calls[0][0]).toMatch(/rebuild_required received after a completed rebuild/);
  });

  it('the completed-rebuild marker does not block a NORMAL sync (post-rebuild first pull works)', async () => {
    const svc = SyncService.getInstance();
    mockRebuildCompletedInProcess = true;

    // Normal sync after the rebuild: SYNC_REQUEST goes out, no flag, no restart.
    await svc.initiateSync();
    const requests = sentEvents().filter(e => e.event_type === 'SYNC_REQUEST');
    expect(requests.length).toBe(1);
    expect(mockSetWipeRebuildFlag).not.toHaveBeenCalled();
    expect(mockRestartApp).not.toHaveBeenCalled();
  });
});

// --- 3. Precedence vs. 3-3 version gate --------------------------------------

describe('4-5 — precedence: the version gate wins over the rebuild (3-3 / D82)', () => {
  it('sticky serverUpdateRequired suppresses initiateSync → no SYNC_REQUEST → no rebuild path fires', async () => {
    const svc = SyncService.getInstance();
    mockConnectionManager.emit('event:sync', handshakeAccept({ sync_schema_version: 1 }));
    await flush();
    expect(svc.getServerUpdateRequired()).toBe(true);

    // While sticky, initiateSync short-circuits — the engine can never answer
    // a SYNC_REQUEST that was never sent with rebuild_required.
    await svc.initiateSync();
    expect(sentEvents().filter(e => e.event_type === 'SYNC_REQUEST').length).toBe(0);
    expect(mockSetWipeRebuildFlag).not.toHaveBeenCalled();
    expect(mockRestartApp).not.toHaveBeenCalled();
  });

  it('an out-of-band rebuild_required while sticky is IGNORED (defensive belt-and-braces)', async () => {
    const svc = SyncService.getInstance();
    const errorListener = jest.fn();
    svc.on('sync:error', errorListener);
    mockConnectionManager.emit('event:sync', handshakeAccept({ sync_schema_version: 1 }));
    await flush();
    expect(svc.getServerUpdateRequired()).toBe(true);

    // Hypothetical racing signal: the rebuild must wait for the engine update
    // + accepted handshake — a wipe cannot help a version-mismatched engine.
    mockConnectionManager.emit('event:sync', syncReject());
    await flush();

    expect(mockSetWipeRebuildFlag).not.toHaveBeenCalled();
    expect(mockRestartApp).not.toHaveBeenCalled();
    expect(errorListener).not.toHaveBeenCalled();
  });

  it('after the engine is updated (gate clears), a rebuild_required signal fires the rebuild', async () => {
    const svc = SyncService.getInstance();
    mockConnectionManager.emit('event:sync', handshakeAccept({ sync_schema_version: 1 }));
    await flush();
    expect(svc.getServerUpdateRequired()).toBe(true);

    // Engine updated: accepted v2 handshake clears the gate (and re-kicks a sync).
    mockConnectionManager.emit('event:sync', handshakeAccept({ sync_schema_version: 2 }));
    await flush();
    expect(svc.getServerUpdateRequired()).toBe(false);

    // Now a genuine rebuild signal is honored.
    mockConnectionManager.emit('event:sync', syncReject());
    await flush();
    expect(mockSetWipeRebuildFlag).toHaveBeenCalledTimes(1);
    expect(mockRestartApp).toHaveBeenCalledTimes(1);
  });
});

// --- 4. Regression: existing reject reasons keep their handlers --------------

describe('4-5 — regression: other reject reasons are untouched', () => {
  it('unsupported_schema_version still enters the sticky version gate (3-3 / D83)', async () => {
    const svc = SyncService.getInstance();
    mockConnectionManager.emit(
      'event:sync',
      syncReject({ reason: 'unsupported_schema_version', min_supported: 2 }),
    );
    await flush();

    expect(svc.getServerUpdateRequired()).toBe(true);
    expect(mockSetWipeRebuildFlag).not.toHaveBeenCalled();
    expect(mockRestartApp).not.toHaveBeenCalled();
  });

  it('a non-rebuild, non-version reason keeps the generic rejection path', async () => {
    const svc = SyncService.getInstance();
    const rejectedListener = jest.fn();
    svc.on('sync:rejected', rejectedListener);

    mockConnectionManager.emit('event:sync', syncReject({ reason: 'clock_drift', message: 'Drift too large' }));
    await flush();

    expect(svc.getServerUpdateRequired()).toBe(false);
    expect(rejectedListener).toHaveBeenCalledWith(expect.objectContaining({ reason: 'clock_drift' }));
    expect(mockSetWipeRebuildFlag).not.toHaveBeenCalled();
    expect(mockRestartApp).not.toHaveBeenCalled();
  });

  it('a normal v2 flow never touches the flag or the restart (fresh installs are engine-exempt)', async () => {
    const svc = SyncService.getInstance();
    mockConnectionManager.emit('event:sync', handshakeAccept({ sync_schema_version: SYNC_SCHEMA_VERSION }));
    await flush();
    expect(svc.getServerUpdateRequired()).toBe(false);

    await svc.initiateSync();
    expect(sentEvents().filter(e => e.event_type === 'SYNC_REQUEST').length).toBe(1);
    expect(mockSetWipeRebuildFlag).not.toHaveBeenCalled();
    expect(mockRestartApp).not.toHaveBeenCalled();
  });
});