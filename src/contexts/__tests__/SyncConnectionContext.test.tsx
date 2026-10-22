/**
 * SyncConnectionContext — embedded-engine connect() wiring (app-engine parity).
 *
 * Pins the chat-critical fix: the embedded engine is dialed over the PLAIN
 * loopback WS (ws://) with the per-process loopback token appended as a query
 * param (the 7-11 posture the management API + log-stream WS already use) —
 * NOT the self-signed-TLS path that demanded a `soulbits_jwt` no producer ever
 * minted. Also pins that a failed attempt re-arms error toasts (the cert-flow
 * flag used to linger forever and suppress every connection-error toast).
 */
import React from 'react';
import { renderHook, act, cleanup } from '@testing-library/react-native';
import { SyncConnectionProvider, useSyncConnection } from '../SyncConnectionContext';

jest.mock('../../services/engine/EngineService', () => ({
  __esModule: true,
  getEngineConnection: jest.fn(),
  onEngineConnectionChange: jest.fn(() => jest.fn()),
}));

jest.mock('../../services/connection/ConnectionManager', () => ({
  __esModule: true,
  default: {
    createConnection: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
    disconnectConnection: jest.fn(),
  },
}));

jest.mock('../../services/ConnectionStateManager', () => ({
  __esModule: true,
  default: {
    initialize: jest.fn(() => Promise.resolve()),
    getConnectionSummary: jest.fn(() => ({ isPaired: false, isConnected: false })),
    getCurrentSource: jest.fn(() => Promise.resolve('selfhosted')),
    getIsPaired: jest.fn(() => false),
    getSecurityMode: jest.fn(() => Promise.resolve('secure')),
    getWSUrl: jest.fn(() => Promise.resolve('')),
    getWSSUrl: jest.fn(() => Promise.resolve('')),
    on: jest.fn(),
    off: jest.fn(),
    markConnected: jest.fn(() => Promise.resolve()),
    markDisconnected: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock('../I18nContext', () => ({
  __esModule: true,
  default: { t: (key: string) => key },
}));

const mockShowToast = jest.fn();
jest.mock('../AppToastContext', () => ({
  __esModule: true,
  useToast: () => ({ showToast: mockShowToast }),
}));

jest.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

const engineService = jest.requireMock('../../services/engine/EngineService');
const cm = jest.requireMock('../../services/connection/ConnectionManager').default;
const csm = jest.requireMock('../../services/ConnectionStateManager').default;

function engineConnection(overrides: Record<string, any> = {}) {
  return {
    adminBaseUrl: 'http://127.0.0.1:28081',
    wsBaseUrl: 'ws://127.0.0.1:28080',
    wssBaseUrl: 'wss://127.0.0.1:28443',
    token: 'loopback-token-xyz',
    bind: '127.0.0.1',
    wsPort: 28080,
    wssPort: 28443,
    adminPort: 28081,
    pid: 1234,
    dataDir: '/data',
    ...overrides,
  };
}

const wrapper = ({ children }: any) => (
  <SyncConnectionProvider>{children}</SyncConnectionProvider>
);

/** Render the provider and let the mount-time initialize settle (engine absent
 *  → no auto-connect), then return the hook result. */
async function renderProvider() {
  const rendered = await renderHook(() => useSyncConnection(), { wrapper });
  await act(async () => {});
  return rendered;
}

describe('SyncConnectionContext — embedded engine connect()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    engineService.getEngineConnection.mockReturnValue(null);
    engineService.onEngineConnectionChange.mockReturnValue(jest.fn());
    cm.createConnection.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it('dials the plain loopback WS with the token query param (ws preferred over wss)', async () => {
    const { result } = await renderProvider();
    engineService.getEngineConnection.mockReturnValue(engineConnection());

    await act(async () => {
      await result.current.connect();
    });

    expect(cm.createConnection).toHaveBeenCalledTimes(1);
    expect(cm.createConnection).toHaveBeenCalledWith(
      'sync',
      'sync',
      'ws://127.0.0.1:28080?token=loopback-token-xyz',
      'unencrypted',
    );
  });

  it('falls back to the loopback WSS + insecure-ssl when no plain WS port is advertised', async () => {
    const { result } = await renderProvider();
    engineService.getEngineConnection.mockReturnValue(
      engineConnection({ wsBaseUrl: '', wssBaseUrl: 'wss://127.0.0.1:28443' }),
    );

    await act(async () => {
      await result.current.connect();
    });

    expect(cm.createConnection).toHaveBeenCalledWith(
      'sync',
      'sync',
      'wss://127.0.0.1:28443?token=loopback-token-xyz',
      'insecure-ssl',
    );
  });

  it('appends the token without clobbering an existing query string', async () => {
    const { result } = await renderProvider();
    engineService.getEngineConnection.mockReturnValue(
      engineConnection({ wsBaseUrl: 'ws://127.0.0.1:28080/events?foo=bar' }),
    );

    await act(async () => {
      await result.current.connect();
    });

    expect(cm.createConnection).toHaveBeenCalledWith(
      'sync',
      'sync',
      'ws://127.0.0.1:28080/events?foo=bar&token=loopback-token-xyz',
      'unencrypted',
    );
  });

  it('surfaces a failure toast on an insecure-ssl attempt (cert flag is reset)', async () => {
    const { result } = await renderProvider();
    engineService.getEngineConnection.mockReturnValue(
      engineConnection({ wsBaseUrl: '', wssBaseUrl: 'wss://127.0.0.1:28443' }),
    );
    cm.createConnection.mockRejectedValueOnce(new Error('connect boom'));

    await act(async () => {
      await expect(result.current.connect()).rejects.toThrow('connect boom');
    });

    // Before the fix the insecure-ssl attempt set isCertFlowActiveRef and never
    // cleared it, so this toast was suppressed — the "no error visible" symptom.
    expect(mockShowToast).toHaveBeenCalledWith('syncConnection:failedToConnect');
  });
});

/**
 * Regression: the `"Not connected"` overlay on ChatListScreen while the embedded
 * engine is running (phase 1-1).
 *
 * Embedded-engine boots never write the legacy QR-pairing keys, so
 * `ConnectionStateManager.markConnected()` emits `'state:changed'` with
 * `isPaired: false`. Before the fix `handleStateChange` overwrote the provider's
 * engine-derived `isPaired` with that value, flipping `canUseChat` to false the
 * moment the loopback WS connected and replacing the loaded list with the
 * "engine starting" empty state.
 */
describe('SyncConnectionContext — engine availability survives state:changed (1-1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    engineService.getEngineConnection.mockReturnValue(null);
    engineService.onEngineConnectionChange.mockReturnValue(jest.fn());
    cm.createConnection.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  /** Invoke every handler the provider registered for an event. */
  function emit(event: string, payload: any) {
    const handlers = csm.on.mock.calls
      .filter(([name]: any[]) => name === event)
      .map(([, handler]: any[]) => handler);
    for (const handler of handlers) handler(payload);
    return handlers.length;
  }

  it('seeds isPaired from an already-running engine on mount (no !canUseChat flash)', async () => {
    engineService.getEngineConnection.mockReturnValue(engineConnection());

    const { result } = await renderProvider();

    expect(result.current.isPaired).toBe(true);
    expect(result.current.canUseChat).toBe(true);
  });

  it('state:changed with isPaired:false does NOT clear isPaired/canUseChat while the engine is available', async () => {
    engineService.getEngineConnection.mockReturnValue(engineConnection());

    const { result } = await renderProvider();
    expect(result.current.canUseChat).toBe(true);

    // This is exactly what ConnectionStateManager.markConnected() emits after
    // the loopback WS opens on an embedded-engine boot (no legacy pairing keys).
    await act(async () => {
      const handlerCount = emit('state:changed', { isPaired: false, isConnected: true });
      expect(handlerCount).toBeGreaterThan(0);
    });

    expect(result.current.isPaired).toBe(true);
    expect(result.current.canUseChat).toBe(true);
    expect(result.current.isConnected).toBe(true);
  });

  it('state:changed still clears isPaired when the engine is genuinely unavailable', async () => {
    engineService.getEngineConnection.mockReturnValue(null);

    const { result } = await renderProvider();

    await act(async () => {
      emit('state:changed', { isPaired: false, isConnected: false });
    });

    expect(result.current.isPaired).toBe(false);
    expect(result.current.canUseChat).toBe(false);
  });
});
