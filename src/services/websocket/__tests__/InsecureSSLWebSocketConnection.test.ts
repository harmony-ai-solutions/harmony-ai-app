/**
 * InsecureSSLWebSocketConnection — regression tests for the "Already Connected"
 * deadlock.
 *
 * The native `react-native-websocket-self-signed` module keeps a per-URL socket
 * map and rejects `connect()` with "Already Connected" if a socket for that URL
 * is still open. A failed connect used to leave `this.wssSelfSigned` unset, so
 * a later `disconnect()` was a no-op — the stale native socket lingered and
 * every subsequent connect failed forever.
 *
 * These tests verify the wrapper best-effort closes the native socket when a
 * connect attempt fails, so the next attempt starts from a clean slate.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { InsecureSSLWebSocketConnection } from '../InsecureSSLWebSocketConnection';

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
    connect = jest.fn();
    close = jest.fn(() => {
      // Mirrors the real library: closing a connection drops the cached instance
      // so the next getInstance(url) returns a fresh one.
      FakeWebSocketWithSelfSignedCert.instances.delete(this.url);
    });
    send = jest.fn();
    onOpen = jest.fn();
    onMessage = jest.fn();
    onClose = jest.fn();
    onError = jest.fn();

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
    let onOpenCb: (() => void) | null = null;
    (ws.onOpen as jest.Mock).mockImplementation((cb: () => void) => {
      onOpenCb = cb;
    });
    (ws.connect as jest.Mock).mockRejectedValue(new Error('Already Connected'));

    // First attempt fails (stale socket) and must close it…
    await expect(conn.connect(url)).rejects.toThrow('Already Connected');
    expect(ws.close).toHaveBeenCalled();

    // The close dropped the cached instance — the retry gets a fresh one.
    const freshWs = FakeWS.getInstance(url);
    expect(freshWs).not.toBe(ws);

    // Configure the fresh instance: resolve the connect and fire the native
    // open event (which is what resolves connect()'s outer promise).
    (freshWs.onOpen as jest.Mock).mockImplementation((cb: () => void) => {
      onOpenCb = cb;
    });
    (freshWs.connect as jest.Mock).mockImplementation(() => {
      onOpenCb?.();
      return Promise.resolve('Connected to ' + url);
    });

    // …second attempt succeeds.
    await conn.connect(url);
    expect(conn.isConnected()).toBe(true);
  });
});
