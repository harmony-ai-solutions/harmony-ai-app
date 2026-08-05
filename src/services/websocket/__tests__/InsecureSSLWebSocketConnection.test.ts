/**
 * InsecureSSLWebSocketConnection — regression tests.
 *
 * 1. "Already Connected" deadlock: the native `react-native-websocket-self-signed`
 *    module keeps a per-URL socket map and rejects `connect()` if a socket for
 *    that URL is still open. A failed connect must best-effort close the stale
 *    native socket so the next attempt starts from a clean slate.
 *
 * 2. Listener-subscription hygiene (on-device incident 2026-08-05): the
 *    library's onX() methods OVERWRITE their listener reference without
 *    removing the previous native event subscription. "Clearing" handlers by
 *    registering no-ops orphaned the real closures, which kept answering
 *    native onError events with close() — a self-sustaining error→close→error
 *    ping-pong that flooded the bridge (hundreds of events/sec) and crashed
 *    the app with a JNI global reference table overflow. The wrapper must
 *    instead REMOVE subscriptions (removeOn*Listener) before close/reconnect.
 *
 * 3. The benign "No active WebSocket for this URL" close-race error must be
 *    ignored: never answered with close(), never emitted, never fatal.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { InsecureSSLWebSocketConnection } from '../InsecureSSLWebSocketConnection';
import { flushMicrotasks } from './helpers/MockWebSocket';

jest.mock('react-native-websocket-self-signed', () => {
  class FakeWebSocketWithSelfSignedCert {
    static instances: Map<string, FakeWebSocketWithSelfSignedCert> = new Map();

    static getInstance(url: string): FakeWebSocketWithSelfSignedCert {
      if (!this.instances.has(url)) {
        this.instances.set(url, new FakeWebSocketWithSelfSignedCert(url));
      }
      return this.instances.get(url)!;
    }

    url: string;
    // Captured event callbacks (registered via the onX jest.fns below).
    onOpenCb: (() => void) | null = null;
    onCloseCb: (() => void) | null = null;
    onErrorCb: ((err: string) => void) | null = null;

    // Default: a successful native connect (fires onOpen, then resolves).
    // Tests override this to simulate failures.
    connect = jest.fn(() => {
      this.onOpenCb?.();
      return Promise.resolve('Connected to ' + this.url);
    });
    close = jest.fn(() => {
      // Mirrors the real library: closing a connection drops the cached instance
      // so the next getInstance(url) returns a fresh one.
      FakeWebSocketWithSelfSignedCert.instances.delete(this.url);
    });
    send = jest.fn();
    onOpen = jest.fn((cb: () => void) => {
      this.onOpenCb = cb;
    });
    onMessage = jest.fn();
    onClose = jest.fn((cb: () => void) => {
      this.onCloseCb = cb;
    });
    onError = jest.fn((cb: (err: string) => void) => {
      this.onErrorCb = cb;
    });
    removeOnOpenListener = jest.fn();
    removeOnMessageListener = jest.fn();
    removeOnErrorListener = jest.fn();
    removeOnCloseListener = jest.fn();

    constructor(url: string) {
      this.url = url;
    }
  }

  return { __esModule: true, default: FakeWebSocketWithSelfSignedCert };
});

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

const FakeWS = jest.requireMock('react-native-websocket-self-signed').default;

describe('InsecureSSLWebSocketConnection', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    FakeWS.instances.clear();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('test-jwt');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('closes the stale native socket when connect fails ("Already Connected")', async () => {
    const url = 'wss://10.0.2.2:28443/events?connection_id=entity-Marcella';
    const conn = new InsecureSSLWebSocketConnection();

    // The native module rejects because a previous attempt left a socket open.
    const ws = FakeWS.getInstance(url);
    (ws.connect as jest.Mock).mockRejectedValue(new Error('Already Connected'));

    await expect(conn.connect(url)).rejects.toThrow('Already Connected');

    // The wrapper must close the stale socket so a retry isn't deadlocked.
    expect(ws.close).toHaveBeenCalled();
  });

  it('recovers on the next connect attempt after a failed one', async () => {
    const url = 'wss://10.0.2.2:28443/events?connection_id=entity-Marcella';
    const conn = new InsecureSSLWebSocketConnection();

    // First instance: stale native socket rejects the connect.
    const ws = FakeWS.getInstance(url);
    (ws.connect as jest.Mock).mockRejectedValue(new Error('Already Connected'));

    // First attempt fails (stale socket) and must close it…
    await expect(conn.connect(url)).rejects.toThrow('Already Connected');
    expect(ws.close).toHaveBeenCalled();

    // The close dropped the cached instance — the retry gets a fresh one
    // (whose default fake connect succeeds).
    await conn.connect(url);
    expect(FakeWS.instances.get(url)).not.toBe(ws);
    expect(conn.isConnected()).toBe(true);
  });

  it('removes subscriptions instead of registering no-op handlers when replacing a live socket', async () => {
    const url = 'wss://10.0.2.2:28443/events?connection_id=entity-Marcella';
    const conn = new InsecureSSLWebSocketConnection();
    const ws = FakeWS.getInstance(url);

    await conn.connect(url);
    expect(conn.isConnected()).toBe(true);

    // Second connect on the same wrapper: the prologue replaces the live
    // socket. The old code "cleared" handlers by registering no-ops — which
    // ORPHANED the real native subscriptions (the library's onX() overwrites
    // the listener reference without unsubscribing). The fix removes them.
    await conn.connect(url);

    expect(ws.removeOnOpenListener).toHaveBeenCalled();
    expect(ws.removeOnMessageListener).toHaveBeenCalled();
    expect(ws.removeOnErrorListener).toHaveBeenCalled();
    expect(ws.removeOnCloseListener).toHaveBeenCalled();
    // Exactly one onError registration on the replaced instance — a no-op
    // re-registration (old behavior) would show up as a second call.
    expect(ws.onError).toHaveBeenCalledTimes(1);
    expect(ws.close).toHaveBeenCalled();
    expect(conn.isConnected()).toBe(true);
  });

  it('cleans stale subscriptions when reusing a cached instance after a server-initiated close', async () => {
    const url = 'wss://10.0.2.2:28443/events?connection_id=entity-Marcella';
    const conn = new InsecureSSLWebSocketConnection();
    const ws = FakeWS.getInstance(url);

    await conn.connect(url);
    expect(conn.isConnected()).toBe(true);

    // Server-initiated close: the wrapper drops its reference, but the library
    // instance (and its subscriptions) survive in the static map because
    // close() was never called on it.
    ws.onCloseCb?.();
    expect(conn.isConnected()).toBe(false);
    expect(FakeWS.instances.get(url)).toBe(ws);

    // Reconnect: getInstance returns the SAME cached instance. The wrapper
    // must remove the leftover subscriptions BEFORE registering new ones,
    // otherwise the old closures are orphaned forever.
    ws.removeOnOpenListener.mockClear();
    ws.removeOnMessageListener.mockClear();
    ws.removeOnErrorListener.mockClear();
    ws.removeOnCloseListener.mockClear();

    await conn.connect(url);

    expect(ws.removeOnOpenListener).toHaveBeenCalled();
    expect(ws.removeOnMessageListener).toHaveBeenCalled();
    expect(ws.removeOnErrorListener).toHaveBeenCalled();
    expect(ws.removeOnCloseListener).toHaveBeenCalled();
    expect(conn.isConnected()).toBe(true);
  });

  it('ignores the benign "No active WebSocket for this URL" close-race error', async () => {
    const url = 'wss://10.0.2.2:28443/events?connection_id=entity-Marcella';
    const conn = new InsecureSSLWebSocketConnection();
    const ws = FakeWS.getInstance(url);

    await conn.connect(url);
    expect(conn.isConnected()).toBe(true);

    const errorHandler = jest.fn();
    conn.on('error', errorHandler);
    ws.close.mockClear();

    // The native module emits this when close() is called for an
    // already-removed socket. Answering it with another close() (the old
    // behavior) created the self-sustaining error→close→error ping-pong.
    ws.onErrorCb?.('No active WebSocket for this URL');

    expect(ws.close).not.toHaveBeenCalled();
    expect(errorHandler).not.toHaveBeenCalled();
    expect(conn.isConnected()).toBe(true);
  });

  it('emits a real error only once even if the native side reports it repeatedly', async () => {
    const url = 'wss://10.0.2.2:28443/events?connection_id=entity-Marcella';
    const conn = new InsecureSSLWebSocketConnection();
    const ws = FakeWS.getInstance(url);

    await conn.connect(url);

    const errorHandler = jest.fn();
    conn.on('error', errorHandler);

    ws.onErrorCb?.('Socket is closed');
    ws.onErrorCb?.('Socket is closed');

    expect(errorHandler).toHaveBeenCalledTimes(1);
    expect(ws.close).toHaveBeenCalledTimes(1);
  });

  it('settles exactly once when a connect times out, even if a native error arrives late (observation 1)', async () => {
    const url = 'wss://10.0.2.2:28443/events?connection_id=entity-Marcella';
    const conn = new InsecureSSLWebSocketConnection();
    const ws = FakeWS.getInstance(url);

    // Native connect() resolves, but onOpen NEVER fires → the 10s connect
    // timeout is the only settle path.
    (ws.connect as jest.Mock).mockImplementation(() => Promise.resolve('pending'));

    const errorHandler = jest.fn();
    conn.on('error', errorHandler);

    const connectPromise = conn.connect(url);

    // Drain the async connect() setup (AsyncStorage read + connect().then())
    // so the 10s timer is actually scheduled before we advance fake time.
    await flushMicrotasks();

    jest.advanceTimersByTime(10000);

    await expect(connectPromise).rejects.toThrow('Self-signed secure connection timeout');

    // The timed-out native socket was closed so a retry starts from a clean slate.
    expect(ws.close).toHaveBeenCalled();

    // The native side reports the timeout tear-down as an error AFTER we already
    // rejected. Before the fix this leaked one extra 'error' event; the timeout
    // branch now marks failureSignalled, so the late error is fully suppressed.
    const errorsBefore = errorHandler.mock.calls.length;
    ws.onErrorCb?.('Socket is closed');
    expect(errorHandler.mock.calls.length).toBe(errorsBefore);

    // Recovery: a fresh connect succeeds (the close dropped the cached instance).
    await conn.connect(url);
    expect(conn.isConnected()).toBe(true);
  });
});
