/**
 * SecureWebSocketConnection — lifecycle unit tests.
 *
 * Uses the standard browser-style `new WebSocket(url, protocols)` with the JWT
 * carried as a subprotocol, pulled from AsyncStorage. Covers: JWT happy path,
 * missing-JWT rejection, certificate-class error routing (cert:verification_
 * failed vs generic error), connect timeout, and reconnect-replace. This mode
 * had NO prior unit tests.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SecureWebSocketConnection } from '../SecureWebSocketConnection';
import { MockWebSocket, installMockWebSocket, flushMicrotasks } from './helpers/MockWebSocket';

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

describe('SecureWebSocketConnection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    installMockWebSocket();
    MockWebSocket.reset();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('test-jwt');
  });

  it('connects with the JWT passed as a subprotocol', async () => {
    const conn = new SecureWebSocketConnection();
    const connected: string[] = [];
    conn.on('connected', () => connected.push('connected'));

    const p = conn.connect('wss://10.0.2.2:28443/events');
    // connect() awaits AsyncStorage before constructing the socket.
    await flushMicrotasks();
    const ws = MockWebSocket.last!;
    expect(ws.protocols).toEqual(['Bearer.test-jwt']);

    ws.fireOpen();
    await p;

    expect(connected).toEqual(['connected']);
    expect(conn.isConnected()).toBe(true);
  });

  it('rejects when no JWT credentials are available', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    const conn = new SecureWebSocketConnection();
    await expect(conn.connect('wss://10.0.2.2:28443/events')).rejects.toThrow(
      'No JWT credentials available',
    );
  });

  it('emits cert:verification_failed (not error) on a certificate-class error', async () => {
    const conn = new SecureWebSocketConnection();
    const certEvents: any[] = [];
    const errorEvents: any[] = [];
    conn.on('cert:verification_failed', (e) => certEvents.push(e));
    conn.on('error', (e) => errorEvents.push(e));

    const p = conn.connect('wss://10.0.2.2:28443/events');
    await flushMicrotasks();
    MockWebSocket.last!.fireError({ message: 'self signed certificate in certificate chain' });

    await expect(p).rejects.toBeDefined();
    expect(certEvents).toHaveLength(1);
    expect(errorEvents).toHaveLength(0);
  });

  it('emits error (not cert) for a generic connect error', async () => {
    const conn = new SecureWebSocketConnection();
    const errorEvents: any[] = [];
    const certEvents: any[] = [];
    conn.on('error', (e) => errorEvents.push(e));
    conn.on('cert:verification_failed', () => certEvents.push(true));

    const p = conn.connect('wss://10.0.2.2:28443/events');
    await flushMicrotasks();
    MockWebSocket.last!.fireError({ message: 'connection refused' });

    await expect(p).rejects.toBeDefined();
    expect(errorEvents).toHaveLength(1);
    expect(certEvents).toHaveLength(0);
  });

  it('rejects on connect timeout (10s) and closes the half-open socket', async () => {
    jest.useFakeTimers();
    try {
      const conn = new SecureWebSocketConnection();
      const p = conn.connect('wss://10.0.2.2:28443/events');
      await flushMicrotasks();
      const ws = MockWebSocket.last!;

      // No open, no error — the 10s timeout must fire.
      jest.advanceTimersByTime(10000);

      await expect(p).rejects.toThrow('Secure connection timeout');
      expect(ws.close).toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('replaces the live socket on reconnect', async () => {
    const conn = new SecureWebSocketConnection();

    const p1 = conn.connect('wss://10.0.2.2:28443/events');
    await flushMicrotasks();
    const first = MockWebSocket.last!;
    first.fireOpen();
    await p1;
    expect(conn.isConnected()).toBe(true);

    const p2 = conn.connect('wss://10.0.2.2:28443/events');
    await flushMicrotasks();
    expect(first.close).toHaveBeenCalled();
    MockWebSocket.last!.fireOpen();
    await p2;
    expect(conn.isConnected()).toBe(true);
  });
});
