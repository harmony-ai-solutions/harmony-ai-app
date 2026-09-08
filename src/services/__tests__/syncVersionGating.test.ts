/**
 * Phase 3-3 — Sync-schema version gating (D6/D11/D57/D83), app side.
 *
 * The app advertises `sync_schema_version: 2` in BOTH the handshake request
 * and the SYNC_REQUEST payload (optional field — old engines ignore it; absent
 * = version 1). The gate protects an updated app from an un-migrated engine:
 *
 *   - HANDSHAKE_ACCEPT advertising engine version < 2 (or absent → 1) enters
 *     the sticky `serverUpdateRequired` gate and aborts the sync attempt.
 *   - SYNC_REJECT with `reason: "unsupported_schema_version"` enters the SAME
 *     sticky gate instead of the generic rejection notification (D83).
 *   - While sticky, `initiateSync()` short-circuits at its TOP — one choke
 *     point covering EVERY trigger class (on-connect, token refresh, session
 *     start, screen/manual pulls, syncAndWait). Verified trigger map (direct
 *     callers of `initiateSync`, via gitnexus impact analysis):
 *       - on-connect:      SyncConnectionContext.tsx handleSyncConnected
 *       - token refresh:   soulbitsTokenSync.ts refreshAllAndSync
 *       - session start:   EntitySessionService.ts handleInitEntityResponse /
 *                          handleIncomingUtterance
 *       - manual / screen: SyncSettingsScreen.handleSyncNow /
 *                          handleForceFullSync; forceFullSync()
 *       - syncAndWait:     SyncService.runSyncAndWait
 *       - persona delete:  userEntities.firePersonaDeleteSync
 *   - A slow re-probe (~10 min) re-handshakes; an accepted version-≥-2
 *     handshake clears the gate and re-kicks a sync (D11 auto-recovery).
 */

import { SyncService, SYNC_SCHEMA_VERSION, SERVER_UPDATE_REPROBE_INTERVAL_MS } from '../SyncService';
import { EventEmitter } from 'eventemitter3';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ConnectionStateManager from '../ConnectionStateManager';

// --- module-level refs for hoisted jest.mock factories -----------------------

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

function resetSingleton(): void {
  (SyncService as any).instance = null;
}

function flush(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

function sentEvents(): any[] {
  return mockConnectionManager.sendEvent.mock.calls.map(([, event]: [string, any]) => event);
}

function sentSyncRequests(): any[] {
  return sentEvents().filter(e => e.event_type === 'SYNC_REQUEST');
}

function sentHandshakes(): any[] {
  return sentEvents().filter(e => e.event_type === 'HANDSHAKE_REQUEST');
}

/** Build a HANDSHAKE_ACCEPT event payload. Version omitted = absent field. */
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

function syncReject(overrides: Record<string, any> = {}): { event_type: string; status: string; payload: any } {
  return {
    event_type: 'SYNC_REJECT',
    status: 'NEW',
    payload: {
      reason: 'clock_drift',
      message: 'Rejected',
      ...overrides,
    },
  };
}

beforeEach(async () => {
  mockStore.clear();
  mockConnectionManager.sendEvent.mockClear();
  // mockReturnValue implementations persist across mockClear() — always reset
  // the connection to "available" (a prior test may have flipped it).
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

/**
 * Clear the sticky gate by simulating an accepted version-≥-2 handshake.
 * Also used at the end of real-timer tests that enter the gate so the ~10 min
 * probe timer never leaks into the real event loop (jest would otherwise hang
 * waiting for the worker to exit).
 */
async function clearGate(svc: SyncService): Promise<void> {
  mockConnectionManager.emit('event:sync', handshakeAccept({ sync_schema_version: 2 }));
  await flush();
}

describe('version advertisement', () => {
  it('sends sync_schema_version: 2 in the HANDSHAKE_REQUEST payload', async () => {
    const svc = SyncService.getInstance();
    await svc.requestHandshake();

    const handshakes = sentHandshakes();
    expect(handshakes.length).toBe(1);
    expect(handshakes[0].payload.sync_schema_version).toBe(SYNC_SCHEMA_VERSION);
    expect(handshakes[0].payload.sync_schema_version).toBe(2);
  });

  it('sends sync_schema_version: 2 in the SYNC_REQUEST payload', async () => {
    const svc = SyncService.getInstance();
    await svc.initiateSync();

    const requests = sentSyncRequests();
    expect(requests.length).toBe(1);
    expect(requests[0].payload.sync_schema_version).toBe(SYNC_SCHEMA_VERSION);
    expect(requests[0].payload.sync_schema_version).toBe(2);
  });
});

describe('HANDSHAKE_ACCEPT version evaluation (D6 — operative v1→v2 path)', () => {
  it('engine version 1 → sticky serverUpdateRequired, sync attempt aborted', async () => {
    const svc = SyncService.getInstance();
    const gateListener = jest.fn();
    svc.on('sync:server-update-required', gateListener);

    mockConnectionManager.emit('event:sync', handshakeAccept({ sync_schema_version: 1 }));
    await flush();

    expect(svc.getServerUpdateRequired()).toBe(true);
    expect(gateListener).toHaveBeenCalledWith(true);

    // The sync attempt is aborted at the choke point — no SYNC_REQUEST goes out.
    await svc.initiateSync();
    expect(sentSyncRequests().length).toBe(0);

    await clearGate(svc);
  });

  it('absent engine field is treated as version 1 (pre-plan engine)', async () => {
    const svc = SyncService.getInstance();

    mockConnectionManager.emit('event:sync', handshakeAccept());
    await flush();

    expect(svc.getServerUpdateRequired()).toBe(true);

    await clearGate(svc);
  });

  it('engine version 2 → proceeds; initiateSync sends a SYNC_REQUEST', async () => {
    const svc = SyncService.getInstance();

    mockConnectionManager.emit('event:sync', handshakeAccept({ sync_schema_version: 2 }));
    await flush();

    expect(svc.getServerUpdateRequired()).toBe(false);

    await svc.initiateSync();
    expect(sentSyncRequests().length).toBe(1);
  });

  it('engine version above the app (forward-compat) → proceeds', async () => {
    const svc = SyncService.getInstance();

    mockConnectionManager.emit('event:sync', handshakeAccept({ sync_schema_version: 3 }));
    await flush();

    expect(svc.getServerUpdateRequired()).toBe(false);
  });
});

describe('SYNC_REJECT reason mapping (D83)', () => {
  it('reason=unsupported_schema_version → sticky serverUpdateRequired, no generic rejection notification', async () => {
    const svc = SyncService.getInstance();
    const gateListener = jest.fn();
    const rejectedListener = jest.fn();
    svc.on('sync:server-update-required', gateListener);
    svc.on('sync:rejected', rejectedListener);

    mockConnectionManager.emit('event:sync', syncReject({ reason: 'unsupported_schema_version', min_supported: 2 }));
    await flush();

    expect(svc.getServerUpdateRequired()).toBe(true);
    expect(gateListener).toHaveBeenCalledWith(true);
    // D57/D83: the sticky gate REPLACES the generic rejection notification —
    // no 'sync:rejected' emission (no error-toast spam from the context).
    expect(rejectedListener).not.toHaveBeenCalled();

    await clearGate(svc);
  });

  it('reason=rebuild_required is NOT the version gate and NOT the generic path (4-5 specializes it: wipe flag + restart)', async () => {
    const svc = SyncService.getInstance();
    const gateListener = jest.fn();
    const rejectedListener = jest.fn();
    svc.on('sync:server-update-required', gateListener);
    svc.on('sync:rejected', rejectedListener);

    mockConnectionManager.emit('event:sync', syncReject({ reason: 'rebuild_required', message: 'Rebuild required' }));
    await flush();

    // The 4-5 rebuild path is neither the version gate nor the generic
    // rejection — no sticky gate, no 'sync:rejected' toast (the restart
    // tears the process down before any UX could render; the wipe-flag
    // persistence is covered in depth by syncRebuildRequired.test.ts).
    expect(svc.getServerUpdateRequired()).toBe(false);
    expect(gateListener).not.toHaveBeenCalled();
    expect(rejectedListener).not.toHaveBeenCalled();
    // The wipe flag WAS persisted (real flag module against the mock store) —
    // the restart then dies with the process (native module absent in jest,
    // caught + logged by the handler).
    expect(mockStore.get('@harmony_wipe_rebuild_pending')).toBe('true');
  });

  it('a non-version reason keeps the existing generic rejection path', async () => {
    const svc = SyncService.getInstance();
    const rejectedListener = jest.fn();
    svc.on('sync:rejected', rejectedListener);

    mockConnectionManager.emit('event:sync', syncReject({ reason: 'clock_drift', message: 'Drift too large' }));
    await flush();

    expect(svc.getServerUpdateRequired()).toBe(false);
    expect(rejectedListener).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'clock_drift' }),
    );
  });
});

describe('initiateSync choke point while sticky (D57 — one gate, every trigger)', () => {
  it('direct initiateSync short-circuits — no network attempts', async () => {
    const svc = SyncService.getInstance();
    mockConnectionManager.emit('event:sync', handshakeAccept({ sync_schema_version: 1 }));
    await flush();
    expect(svc.getServerUpdateRequired()).toBe(true);

    await svc.initiateSync();
    await svc.initiateSync(true); // force full sync — same choke point
    expect(sentSyncRequests().length).toBe(0);
    expect(mockConnectionManager.sendEvent).not.toHaveBeenCalled();

    await clearGate(svc);
  });

  it('forceFullSync (manual pull) short-circuits', async () => {
    const svc = SyncService.getInstance();
    mockConnectionManager.emit('event:sync', handshakeAccept({ sync_schema_version: 1 }));
    await flush();

    await svc.forceFullSync();
    expect(sentSyncRequests().length).toBe(0);

    await clearGate(svc);
  });

  it('syncAndWait (critical caller path) short-circuits via its initiateSync', async () => {
    const svc = SyncService.getInstance();
    mockConnectionManager.emit('event:sync', handshakeAccept({ sync_schema_version: 1 }));
    await flush();

    // runSyncAndWait kicks initiateSync() internally — it must no-op while
    // sticky (resolves only via its timeout, but never sends a SYNC_REQUEST).
    await svc.syncAndWait({ timeoutMs: 50 });
    expect(sentSyncRequests().length).toBe(0);

    await clearGate(svc);
  });

  it('clears only on an accepted version-≥-2 handshake, then sync resumes', async () => {
    const svc = SyncService.getInstance();
    mockConnectionManager.emit('event:sync', handshakeAccept({ sync_schema_version: 1 }));
    await flush();
    expect(svc.getServerUpdateRequired()).toBe(true);

    // Same-version accept while sticky: stays sticky (no false clear).
    mockConnectionManager.emit('event:sync', handshakeAccept({ sync_schema_version: 1 }));
    await flush();
    expect(svc.getServerUpdateRequired()).toBe(true);

    // Accepted ≥2 handshake: clears + re-kicks a sync.
    mockConnectionManager.emit('event:sync', handshakeAccept({ sync_schema_version: 2 }));
    await flush();

    expect(svc.getServerUpdateRequired()).toBe(false);
    expect(sentSyncRequests().length).toBe(1);
  });
});

describe('slow background re-probe (D57/D11 auto-recovery)', () => {
  it('re-handshakes after the interval and recovers once the engine is updated', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    const svc = SyncService.getInstance();
    mockConnectionManager.emit('event:sync', handshakeAccept({ sync_schema_version: 1 }));
    await flush();
    expect(svc.getServerUpdateRequired()).toBe(true);

    // No probe before the interval.
    await jest.advanceTimersByTimeAsync(SERVER_UPDATE_REPROBE_INTERVAL_MS - 1);
    expect(sentHandshakes().length).toBe(0);

    // Probe fires: connection is up → re-handshake over the live WS.
    await jest.advanceTimersByTimeAsync(1);
    expect(sentHandshakes().length).toBe(1);
    expect(sentHandshakes()[0].payload.sync_schema_version).toBe(SYNC_SCHEMA_VERSION);

    // Engine was updated: it now advertises version 2.
    mockConnectionManager.emit('event:sync', handshakeAccept({ sync_schema_version: 2 }));
    await flush();

    expect(svc.getServerUpdateRequired()).toBe(false);
    // D11: data re-pulls once the engine is updated.
    expect(sentSyncRequests().length).toBe(1);
  });

  it('re-arms the probe while still sticky after an unanswered probe', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    const svc = SyncService.getInstance();
    mockConnectionManager.emit('event:sync', handshakeAccept({ sync_schema_version: 1 }));
    await flush();

    // First probe fires; the engine still advertises 1 (or never replies).
    await jest.advanceTimersByTimeAsync(SERVER_UPDATE_REPROBE_INTERVAL_MS);
    mockConnectionManager.emit('event:sync', handshakeAccept({ sync_schema_version: 1 }));
    await flush();
    expect(svc.getServerUpdateRequired()).toBe(true);

    // The gate is still sticky — the next probe must fire again after another
    // interval (the timer was re-armed when the gate re-entered is a no-op;
    // the re-arm happens via the initial entry — assert it keeps probing).
    await jest.advanceTimersByTimeAsync(SERVER_UPDATE_REPROBE_INTERVAL_MS);
    expect(sentHandshakes().length).toBe(2);
  });

  it('requests a one-shot re-dial from the connection context when the WS is down', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    (mockConnectionManager.isConnected as jest.Mock).mockReturnValue(false);
    const svc = SyncService.getInstance();
    const reconnectListener = jest.fn();
    svc.on('sync:server-update-probe-reconnect', reconnectListener);

    mockConnectionManager.emit('event:sync', handshakeAccept({ sync_schema_version: 1 }));
    await flush();

    await jest.advanceTimersByTimeAsync(SERVER_UPDATE_REPROBE_INTERVAL_MS);

    // Connection down → ONE re-dial signal (no handshake attempted in-band).
    expect(reconnectListener).toHaveBeenCalledTimes(1);
    expect(sentHandshakes().length).toBe(0);
  });

  it('sticky state clears cancel the probe timer (no further probes)', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    const svc = SyncService.getInstance();
    mockConnectionManager.emit('event:sync', handshakeAccept({ sync_schema_version: 1 }));
    await flush();

    mockConnectionManager.emit('event:sync', handshakeAccept({ sync_schema_version: 2 }));
    await flush();
    expect(svc.getServerUpdateRequired()).toBe(false);

    // Advance well past the interval: the timer was cancelled — no re-handshake.
    await jest.advanceTimersByTimeAsync(SERVER_UPDATE_REPROBE_INTERVAL_MS * 2);
    expect(sentHandshakes().length).toBe(0);
  });
});

describe('gate is inert for a normal (v2-aligned) flow', () => {
  it('no handshake/reject → not sticky, sync flows normally', async () => {
    const svc = SyncService.getInstance();
    expect(svc.getServerUpdateRequired()).toBe(false);

    await svc.initiateSync();
    expect(sentSyncRequests().length).toBe(1);
  });

  it('a clock-drift reject does not enter the gate', async () => {
    const svc = SyncService.getInstance();
    mockConnectionManager.emit('event:sync', syncReject({ reason: 'clock_drift' }));
    await flush();
    expect(svc.getServerUpdateRequired()).toBe(false);
  });
});