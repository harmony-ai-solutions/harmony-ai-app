/**
 * CloudWebSocketConnection — lifecycle unit tests.
 *
 * The most defensively-written sibling: it already carries `settled`/`opened`
 * guards so a connect-time failure rejects without emitting a spurious
 * 'disconnected' (which would race the rejection-driven reconnect), and so an
 * auth-failure close refreshes the PASETO before signaling disconnect.
 *
 * These tests pin that contract (which had NO prior unit coverage), including a
 * settled-guard case mirroring the InsecureSSL timeout-observation: a late
 * native error arriving after the timeout must not double-settle.
 */
import AuthService from '../../auth/AuthService';
import { CloudWebSocketConnection } from '../CloudWebSocketConnection';
import { MockWebSocket, installMockWebSocket, flushMicrotasks } from './helpers/MockWebSocket';

jest.mock('../../auth/AuthService', () => ({
  __esModule: true,
  default: {
    getToken: jest.fn(),
    refresh: jest.fn(),
    invalidate: jest.fn(),
  },
}));

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

const AuthServiceMock = AuthService as any;

describe('CloudWebSocketConnection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    installMockWebSocket();
    MockWebSocket.reset();
    AuthServiceMock.getToken.mockResolvedValue('paseto-xxx');
  });

  it('connects with the PASETO passed as a subprotocol', async () => {
    const conn = new CloudWebSocketConnection();
    const connected: string[] = [];
    conn.on('connected', () => connected.push('connected'));

    const p = conn.connect('wss://cloud.example.com/events');
    await flushMicrotasks();
    const ws = MockWebSocket.last!;
    expect(ws.protocols).toEqual(['Bearer.paseto-xxx']);

    ws.fireOpen();
    await p;

    expect(connected).toEqual(['connected']);
    expect(conn.isConnected()).toBe(true);
  });

  it('throws when not authenticated', async () => {
    AuthServiceMock.getToken.mockResolvedValue(null);
    const conn = new CloudWebSocketConnection();
    await expect(conn.connect('wss://cloud.example.com/events')).rejects.toThrow(
      'Not authenticated',
    );
  });

  it('rejects on connect-time failure WITHOUT emitting disconnected (no spurious reconnect)', async () => {
    const conn = new CloudWebSocketConnection();
    const disconnected: any[] = [];
    const errors: any[] = [];
    conn.on('disconnected', () => disconnected.push(true));
    conn.on('error', (e) => errors.push(e));

    const p = conn.connect('wss://cloud.example.com/events');
    await flushMicrotasks();
    const ws = MockWebSocket.last!;

    // RN guarantees error→close ordering. The error settles the promise; the
    // subsequent close performs ws cleanup but must NOT emit 'disconnected'
    // (this connection never reached 'connected').
    ws.fireError(new Error('upgrade rejected'));
    ws.fireClose(1006, '');

    await expect(p).rejects.toBeDefined();
    expect(errors).toHaveLength(1);
    expect(disconnected).toHaveLength(0);
  });

  it('refreshes the token on a policy-violation close (1008) of an established connection', async () => {
    AuthServiceMock.refresh.mockResolvedValue(true);
    const conn = new CloudWebSocketConnection();
    const disconnected: any[] = [];
    conn.on('disconnected', () => disconnected.push(true));

    const p = conn.connect('wss://cloud.example.com/events');
    await flushMicrotasks();
    const ws = MockWebSocket.last!;
    ws.fireOpen();
    await p;

    ws.fireClose(1008, 'policy');
    // onclose runs an async refresh before emitting 'disconnected'.
    await flushMicrotasks();

    expect(AuthServiceMock.refresh).toHaveBeenCalled();
    expect(disconnected).toEqual([true]);
  });

  it('emits disconnected when an established connection closes normally', async () => {
    const conn = new CloudWebSocketConnection();
    const disconnected: any[] = [];
    conn.on('disconnected', () => disconnected.push(true));

    const p = conn.connect('wss://cloud.example.com/events');
    await flushMicrotasks();
    const ws = MockWebSocket.last!;
    ws.fireOpen();
    await p;

    ws.fireClose(1000, '');

    expect(disconnected).toEqual([true]);
    expect(conn.isConnected()).toBe(false);
  });

  it('rejects on connect timeout (15s) and closes the half-open socket', async () => {
    jest.useFakeTimers();
    try {
      const conn = new CloudWebSocketConnection();
      const p = conn.connect('wss://cloud.example.com/events');
      await flushMicrotasks();
      const ws = MockWebSocket.last!;

      jest.advanceTimersByTime(15000);

      await expect(p).rejects.toThrow('Cloud WS connection timeout');
      expect(ws.close).toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not double-settle when a native error arrives after the timeout', async () => {
    jest.useFakeTimers();
    try {
      const conn = new CloudWebSocketConnection();
      const errors: any[] = [];
      conn.on('error', (e) => errors.push(e));

      const p = conn.connect('wss://cloud.example.com/events');
      await flushMicrotasks();
      const ws = MockWebSocket.last!;

      jest.advanceTimersByTime(15000); // timeout settles + emits 'error' + rejects
      await expect(p).rejects.toThrow('Cloud WS connection timeout');

      const errorsBefore = errors.length;
      // A late native error after the timeout — the `settled` guard must
      // suppress it (mirrors the failureSignalled guarantee in InsecureSSL).
      ws.fireError(new Error('late'));
      expect(errors.length).toBe(errorsBefore);
    } finally {
      jest.useRealTimers();
    }
  });
});
