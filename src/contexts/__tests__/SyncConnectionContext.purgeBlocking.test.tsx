/**
 * SyncConnectionContext — cloud data purge blocking gate (async purge §7 UX).
 *
 * Pins the purgeBlocking contract:
 *   - raised by a 'purging' cloud status (our purge, or an adopted
 *     other-device purge after PurgeInProgressError),
 *   - raised by the cold-start attach finding a purge in progress,
 *   - stays raised through a `deadline` terminal (connecting stays paused),
 *   - cleared by deleted/failed terminal events, purge:done/purge:failed,
 *     status 'idle', a resolved cold-start attach (`none`), and a successful
 *     WS connect,
 *   - connect() catching PurgeInProgressError (broker 409) raises the gate AND
 *     adopts the running purge's status.
 *
 * Heavy service singletons are mocked (pattern from
 * EntitySessionContext.sessionFailed.test.tsx); the cloudSessionService mock
 * is a real EventEmitter so the provider's listeners receive emits.
 */
import React from 'react';
import { renderHook, act } from '@testing-library/react-native';
import { PurgeInProgressError } from '@harmony-ai-solutions/soulbits-api-client';

jest.mock('../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

// CloudSessionService → EventEmitter mock (providers attach real listeners).
jest.mock('../../services/cloud/CloudSessionService', () => {
  const { EventEmitter } = require('eventemitter3');
  const svc: any = new EventEmitter();
  svc.getStatus = jest.fn(() => 'idle');
  svc.isPurging = jest.fn(() => false);
  svc.getSessionId = jest.fn(() => null);
  svc.connect = jest.fn(async () => undefined);
  svc.disconnect = jest.fn(async () => undefined);
  svc.attachToRunningPurge = jest.fn(async () => ({ kind: 'none' }));
  return { __esModule: true, cloudSessionService: svc, CloudSessionService: jest.fn() };
});

jest.mock('../../services/ConnectionStateManager', () => ({
  __esModule: true,
  default: {
    on: jest.fn(),
    off: jest.fn(),
    getCurrentSource: jest.fn(() => Promise.resolve('cloud')),
    getSecurityMode: jest.fn(() => Promise.resolve('secure')),
    getLastSync: jest.fn(() => Promise.resolve(0)),
    getSyncEstimateLimitMB: jest.fn(() => Promise.resolve(5)),
    getIsPaired: jest.fn(() => false),
    getIsTokenExpired: jest.fn(() => false),
    initialize: jest.fn(() => Promise.resolve()),
    getConnectionSummary: jest.fn(() => ({
      isPaired: false,
      isConnected: false,
      isTokenExpired: false,
      requiresRepair: false,
    })),
    markConnected: jest.fn(),
    markDisconnected: jest.fn(() => Promise.resolve()),
    initializeConnection: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock('../../services/connection/ConnectionManager', () => ({
  __esModule: true,
  default: {
    on: jest.fn(),
    off: jest.fn(),
    getSyncConnection: jest.fn(() => null),
    createConnection: jest.fn(() => Promise.resolve()),
    disconnectConnection: jest.fn(),
  },
}));

jest.mock('../../services/SyncService', () => {
  const mocks = {
    on: jest.fn(),
    off: jest.fn(),
    getServerUpdateRequired: jest.fn(() => false),
    requestHandshake: jest.fn(),
    requestHandshakeWithWait: jest.fn(async () => undefined),
    initiateSync: jest.fn(async () => undefined),
    forceFullSync: jest.fn(async () => undefined),
    markFullResyncRequired: jest.fn(async () => undefined),
    confirmSizeEstimate: jest.fn(async () => undefined),
    resolveNameClash: jest.fn(),
    getInstance: jest.fn(),
  };
  mocks.getInstance.mockReturnValue(mocks);
  return {
    __esModule: true,
    default: mocks,
    SyncService: mocks,
  };
});

jest.mock('../../services/auth/AuthService', () => ({
  __esModule: true,
  default: {
    isTokenExpired: jest.fn(() => false),
    refresh: jest.fn(async () => true),
    getToken: jest.fn(async () => 'paseto-test'),
  },
}));

jest.mock('../../services/cloud/DeviceAuthService', () => ({
  __esModule: true,
  default: { verifyCode: jest.fn(async () => undefined) },
}));

jest.mock('../../services/cloud/deviceDeepLink', () => ({
  __esModule: true,
  parseDeviceDeepLink: jest.fn(() => null),
}));

jest.mock('../../components/cloud/DeviceAuthModal', () => ({
  __esModule: true,
  DeviceAuthModal: () => null,
}));

const mockShowAlert = jest.fn();
jest.mock('../AppAlertContext', () => ({
  __esModule: true,
  useAppAlert: () => ({ showAlert: mockShowAlert }),
}));

jest.mock('../AppToastContext', () => ({
  __esModule: true,
  useToast: () => ({ showToast: jest.fn() }),
}));

jest.mock('../I18nContext', () => ({
  __esModule: true,
  default: { t: (key: string) => key },
}));

// The context cold-starts deep links via `import { Linking } from 'react-native'`
// — RN's index re-exports it lazily from this inner module, so mocking the
// inner path intercepts it without eager-loading the whole RN index (whose
// getter spread trips the DevMenu TurboModule invariant in node tests).
jest.mock('react-native/Libraries/Linking/Linking', () => ({
  __esModule: true,
  default: {
    getInitialURL: jest.fn(async () => null),
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
    openURL: jest.fn(async () => undefined),
    canOpenURL: jest.fn(async () => false),
  },
}));

import ConnectionStateManager from '../../services/ConnectionStateManager';
import ConnectionManager from '../../services/connection/ConnectionManager';
import SyncServiceMock from '../../services/SyncService';
import { cloudSessionService } from '../../services/cloud/CloudSessionService';
import { SyncConnectionProvider, useSyncConnection } from '../SyncConnectionContext';

const svc: any = cloudSessionService;
const cm: any = ConnectionManager;
const csm: any = ConnectionStateManager;

const wrapper = ({ children }: any) => (
  <SyncConnectionProvider>{children}</SyncConnectionProvider>
);

async function flush() {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  (SyncServiceMock as any).getInstance.mockReturnValue(SyncServiceMock);
  svc.getStatus.mockReturnValue('idle');
  svc.isPurging.mockReturnValue(false);
  svc.attachToRunningPurge.mockImplementation(async () => ({ kind: 'none' }));
  csm.getCurrentSource.mockResolvedValue('cloud');
  cm.createConnection.mockResolvedValue(undefined);
});

describe('SyncConnectionContext — purgeBlocking gate', () => {
  it('starts false when no purge is running, and cold-start attach finds none', async () => {
    const { result } = await renderHook(() => useSyncConnection(), { wrapper });
    await flush();

    expect(result.current.purgeBlocking).toBe(false);
    expect(svc.attachToRunningPurge).toHaveBeenCalledTimes(1);
  });

  it('cold-start attach → in_progress (adopted): purgeBlocking raises', async () => {
    // Mimic the REAL service: adopting emits status 'purging' synchronously.
    svc.attachToRunningPurge.mockImplementation(async () => {
      svc.getStatus.mockReturnValue('purging');
      svc.isPurging.mockReturnValue(true);
      svc.emit('status', 'purging');
      return { kind: 'adopted', progress: { runState: 'polling' } };
    });

    const { result } = await renderHook(() => useSyncConnection(), { wrapper });
    await flush();

    expect(result.current.purgeBlocking).toBe(true);
  });

  it('status purging raises the gate; terminal deleted/failed clears it', async () => {
    const { result } = await renderHook(() => useSyncConnection(), { wrapper });
    await flush();
    expect(result.current.purgeBlocking).toBe(false);

    await act(async () => {
      svc.emit('status', 'purging');
    });
    expect(result.current.purgeBlocking).toBe(true);

    await act(async () => {
      svc.emit('purge:terminal', { outcome: 'deleted' });
    });
    expect(result.current.purgeBlocking).toBe(false);

    await act(async () => {
      svc.emit('status', 'purging');
    });
    expect(result.current.purgeBlocking).toBe(true);
    await act(async () => {
      svc.emit('purge:terminal', { outcome: 'failed', error: 'attempt cap reached' });
    });
    expect(result.current.purgeBlocking).toBe(false);
  });

  it('stays blocking through a deadline terminal (connecting stays paused)', async () => {
    const { result } = await renderHook(() => useSyncConnection(), { wrapper });
    await flush();

    await act(async () => {
      svc.emit('status', 'purging');
    });
    expect(result.current.purgeBlocking).toBe(true);

    await act(async () => {
      svc.emit('purge:terminal', { outcome: 'deadline' });
    });
    expect(result.current.purgeBlocking).toBe(true);

    // Legacy events clear it (service emits them on deleted/failed settles).
    await act(async () => {
      svc.emit('purge:done');
    });
    expect(result.current.purgeBlocking).toBe(false);
  });

  it('purge:cleared (deadline latch reconciled away) clears the gate', async () => {
    const { result } = await renderHook(() => useSyncConnection(), { wrapper });
    await flush();

    await act(async () => {
      svc.emit('status', 'purging');
    });
    expect(result.current.purgeBlocking).toBe(true);
    await act(async () => {
      svc.emit('purge:terminal', { outcome: 'deadline' });
    });
    expect(result.current.purgeBlocking).toBe(true);

    // Re-probe GET reported none → the service clears the run: the gate must
    // drop immediately (status 'idle' fires too, this pins the typed event).
    await act(async () => {
      svc.emit('purge:cleared');
    });
    expect(result.current.purgeBlocking).toBe(false);
  });

  it('status idle clears a stale gate', async () => {
    // Mimic the real service invariant: attach while purging → adopted (it
    // emits status 'purging' synchronously), never none.
    svc.isPurging.mockReturnValue(true);
    svc.attachToRunningPurge.mockImplementation(async () => {
      svc.emit('status', 'purging');
      return { kind: 'adopted', progress: { runState: 'polling' } };
    });
    const { result } = await renderHook(() => useSyncConnection(), { wrapper });
    await flush();
    expect(result.current.purgeBlocking).toBe(true);

    await act(async () => {
      svc.emit('status', 'idle');
    });
    expect(result.current.purgeBlocking).toBe(false);
  });

  it('connect() hitting PurgeInProgressError (other device 409) raises the gate + adopts status', async () => {
    const { result } = await renderHook(() => useSyncConnection(), { wrapper });
    await flush();
    expect(result.current.purgeBlocking).toBe(false);

    // connect() path: cloud source, session 'ready', WS dial rejected with 409.
    svc.getStatus.mockReturnValue('ready');
    cm.createConnection.mockRejectedValueOnce(new PurgeInProgressError(3_000));

    await act(async () => {
      await result.current.connect().catch(() => {});
    });

    expect(result.current.purgeBlocking).toBe(true);
    expect(svc.attachToRunningPurge).toHaveBeenCalled();

    // The other device's purge settles → gate clears.
    await act(async () => {
      svc.emit('purge:terminal', { outcome: 'deleted' });
    });
    expect(result.current.purgeBlocking).toBe(false);
  });

  it('a successful WS connect clears the gate (belt-and-braces)', async () => {
    // Raise the gate via an adopted running purge (attach emits 'purging').
    svc.isPurging.mockReturnValue(true);
    svc.attachToRunningPurge.mockImplementation(async () => {
      svc.emit('status', 'purging');
      return { kind: 'adopted', progress: { runState: 'polling' } };
    });
    const { result } = await renderHook(() => useSyncConnection(), { wrapper });
    await flush();
    expect(result.current.purgeBlocking).toBe(true);

    // Fire the provider's 'connected:sync' listener registered on the mock.
    const connectedHandler = cm.on.mock.calls.find((c: any[]) => c[0] === 'connected:sync')?.[1];
    expect(connectedHandler).toBeDefined();
    await act(async () => {
      await connectedHandler();
    });
    expect(result.current.purgeBlocking).toBe(false);
  });

  it('purge:done (deleted) marks full re-sync required and auto-reconnects (post-purge forced re-sync)', async () => {
    const { result } = await renderHook(() => useSyncConnection(), { wrapper });
    await flush();
    expect(result.current.purgeBlocking).toBe(false);

    await act(async () => {
      svc.emit('purge:done');
    });
    await flush();

    // The persisted full-resync marker is set BEFORE the dial, so the
    // on-connect auto-sync (initiateSync) sees the cleared watermark and
    // escalates to force_full_sync.
    expect(SyncServiceMock.markFullResyncRequired).toHaveBeenCalledTimes(1);

    // FULL-BEFORE-INCREMENTAL ordering: the watermark must be cleared before
    // ANY reconnect dial happens, so no sync can ever start while the
    // watermark is still non-zero post-purge.
    expect((SyncServiceMock.markFullResyncRequired as any).mock.invocationCallOrder[0])
      .toBeLessThan(svc.connect.mock.invocationCallOrder[0]);

    // The purge killed the broker session: force a fresh broker round-trip
    // (POST /v1/session/connect), then dial the sync WS.
    expect(svc.connect).toHaveBeenCalledWith({ force: true });
    expect(cm.createConnection).toHaveBeenCalledWith('sync', 'sync', expect.any(String), 'cloud');
  });

  it('purge:failed does NOT auto-reconnect or mark full re-sync (deletion intent preserved)', async () => {
    const { result } = await renderHook(() => useSyncConnection(), { wrapper });
    await flush();

    await act(async () => {
      svc.emit('purge:failed', 'attempt cap reached');
    });
    await flush();

    expect(SyncServiceMock.markFullResyncRequired).not.toHaveBeenCalled();
    expect(svc.connect).not.toHaveBeenCalledWith({ force: true });
    expect(cm.createConnection).not.toHaveBeenCalled();
    expect(result.current.purgeBlocking).toBe(false);
  });
});

describe('SyncConnectionContext — post-purge result surface & estimate-prompt deferral', () => {
  // The provider registers the estimate handler via SyncService.on('sync:estimate', ...)
  // in a []-deps effect — capture it from the mock.
  function estimateHandler(): (payload: any) => Promise<void> {
    const handler = (SyncServiceMock as any).on.mock.calls
      .filter((c: any[]) => c[0] === 'sync:estimate')
      .pop()?.[1];
    expect(handler).toBeDefined();
    return handler;
  }

  beforeEach(() => {
    mockShowAlert.mockClear();
  });

  it('purge:done raises purgeResultPending; it stays until dismissed', async () => {
    const { result } = await renderHook(() => useSyncConnection(), { wrapper });
    await flush();
    expect(result.current.purgeResultPending).toBe(false);

    await act(async () => {
      svc.emit('purge:done');
    });
    await flush();
    expect(result.current.purgeResultPending).toBe(true);

    await act(async () => {
      result.current.dismissPurgeResult();
    });
    expect(result.current.purgeResultPending).toBe(false);
  });

  it('DEFERS the post-purge re-sync estimate prompt: not shown, never auto-confirmed, released on acknowledgment', async () => {
    const { result } = await renderHook(() => useSyncConnection(), { wrapper });
    await flush();

    await act(async () => {
      svc.emit('purge:done');
    });
    await flush();
    expect(result.current.purgeResultPending).toBe(true);

    // The forced full re-sync's estimate arrives (user saw 24 records).
    const handler = estimateHandler();
    await act(async () => {
      await handler({ total_records: 24, image_count: 0, estimated_download_mb: 0.5 });
    });
    await flush();

    // DEFERRED: no prompt clobbered the purge result surface, and the
    // estimate was NEVER auto-confirmed — the engine stays blocked on
    // SYNC_DATA_SIZE_ESTIMATE (SyncService.pendingSizeEstimate).
    expect(mockShowAlert).not.toHaveBeenCalled();
    expect(SyncServiceMock.confirmSizeEstimate).not.toHaveBeenCalled();

    // The user acknowledges the purge result → the SAME prompt is presented
    // verbatim (still not auto-confirmed — the user must answer).
    await act(async () => {
      result.current.dismissPurgeResult();
    });
    expect(result.current.purgeResultPending).toBe(false);
    expect(mockShowAlert).toHaveBeenCalledTimes(1);
    expect(mockShowAlert.mock.calls[0][0]).toBe('syncConnection:alertTitle');
    expect(SyncServiceMock.confirmSizeEstimate).not.toHaveBeenCalled();

    // The presented prompt's confirm button replies to the engine.
    const confirmButton = mockShowAlert.mock.calls[0][2].find((b: any) => b.text === 'common:confirm');
    expect(confirmButton).toBeDefined();
    await act(async () => {
      confirmButton.onPress();
    });
    expect(SyncServiceMock.confirmSizeEstimate).toHaveBeenCalledWith(true);
  });

  it('without a pending purge result the estimate prompts immediately (historical behaviour)', async () => {
    const { result } = await renderHook(() => useSyncConnection(), { wrapper });
    await flush();
    expect(result.current.purgeResultPending).toBe(false);

    const handler = estimateHandler();
    await act(async () => {
      await handler({ total_records: 24, image_count: 0, estimated_download_mb: 0.5 });
    });
    await flush();

    expect(mockShowAlert).toHaveBeenCalledTimes(1);
    expect(SyncServiceMock.confirmSizeEstimate).not.toHaveBeenCalled();
  });

  it('a completed FORCED sync clears the pending result surface (and drops any deferred prompt)', async () => {
    const { result } = await renderHook(() => useSyncConnection(), { wrapper });
    await flush();

    await act(async () => {
      svc.emit('purge:done');
    });
    await flush();

    // Estimate deferred while pending.
    const handler = estimateHandler();
    await act(async () => {
      await handler({ total_records: 24, image_count: 0, estimated_download_mb: 0.5 });
    });

    // The forced re-sync completes (estimate was answered on the presented
    // prompt) — the surface and any stale deferral are moot.
    const completedHandler = (SyncServiceMock as any).on.mock.calls
      .filter((c: any[]) => c[0] === 'sync:completed')
      .pop()?.[1];
    await act(async () => {
      completedHandler({ forceFullSync: true });
    });
    expect(result.current.purgeResultPending).toBe(false);

    // An INCREMENTAL completion must NOT clear the gate.
    await act(async () => {
      svc.emit('purge:done');
    });
    await flush();
    await act(async () => {
      completedHandler({ forceFullSync: false });
    });
    expect(result.current.purgeResultPending).toBe(true);
  });

  it('a failed purge clears the pending surface (no forced re-sync follows, normal prompting resumes)', async () => {
    const { result } = await renderHook(() => useSyncConnection(), { wrapper });
    await flush();

    await act(async () => {
      svc.emit('purge:done');
    });
    await flush();
    expect(result.current.purgeResultPending).toBe(true);

    await act(async () => {
      svc.emit('purge:failed', 'attempt cap reached');
    });
    await flush();
    expect(result.current.purgeResultPending).toBe(false);
  });
});

