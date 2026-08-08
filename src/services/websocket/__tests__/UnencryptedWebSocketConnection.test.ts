/**
 * UnencryptedWebSocketConnection — lifecycle unit tests.
 *
 * These cover the standard browser-style `new WebSocket(url)` path (NOT the
 * self-signed native singleton). The bug class fixed in InsecureSSLWebSocket
 * Connection does not apply here, but pinning the contract (connect success /
 * failure, reconnect-replace, server-close, send guard, disconnect) guards
 * against regressions in this connection mode, which had NO prior unit tests.
 */
import { UnencryptedWebSocketConnection } from '../UnencryptedWebSocketConnection';
import { MockWebSocket, installMockWebSocket, flushMicrotasks } from './helpers/MockWebSocket';

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

describe('UnencryptedWebSocketConnection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    installMockWebSocket();
    MockWebSocket.reset();
  });

  it('connects, emits connected, and reports connected state', async () => {
    const conn = new UnencryptedWebSocketConnection();
    const events: string[] = [];
    conn.on('connected', () => events.push('connected'));

    const p = conn.connect('ws://10.0.2.2:28080/events');
    // The constructor + handler registration run synchronously inside connect(),
    // so the mock socket is ready before we fire onOpen.
    MockWebSocket.last!.fireOpen();
    await p;

    expect(events).toEqual(['connected']);
    expect(conn.isConnected()).toBe(true);
  });

  it('rejects and emits error on connect failure', async () => {
    const conn = new UnencryptedWebSocketConnection();
    const errors: any[] = [];
    conn.on('error', (e) => errors.push(e));

    const p = conn.connect('ws://10.0.2.2:28080/events');
    MockWebSocket.last!.fireError(new Error('ECONNREFUSED'));

    await expect(p).rejects.toThrow('ECONNREFUSED');
    expect(errors).toHaveLength(1);
    expect(conn.isConnected()).toBe(false);
  });

  it('replaces the live socket (and closes the old one) when connect is called again', async () => {
    const conn = new UnencryptedWebSocketConnection();

    const p1 = conn.connect('ws://10.0.2.2:28080/events');
    const first = MockWebSocket.last!;
    first.fireOpen();
    await p1;
    expect(conn.isConnected()).toBe(true);

    const p2 = conn.connect('ws://10.0.2.2:28080/events');
    // Prologue detached the old handlers and closed the old socket…
    expect(first.close).toHaveBeenCalled();
    // …and created a fresh socket for the new attempt.
    const second = MockWebSocket.last!;
    expect(second).not.toBe(first);
    second.fireOpen();
    await p2;
    expect(conn.isConnected()).toBe(true);
  });

  it('emits disconnected and reports not-connected on server-initiated close', async () => {
    const conn = new UnencryptedWebSocketConnection();
    const p = conn.connect('ws://10.0.2.2:28080/events');
    const ws = MockWebSocket.last!;
    ws.fireOpen();
    await p;

    const disconnected: string[] = [];
    conn.on('disconnected', () => disconnected.push('disconnected'));
    ws.fireClose(1006, 'abnormal');

    expect(disconnected).toEqual(['disconnected']);
    expect(conn.isConnected()).toBe(false);
  });

  it('throws when sending while not connected', async () => {
    const conn = new UnencryptedWebSocketConnection();
    await expect(
      conn.sendEvent({ event_id: '1', event_type: 'PING', status: 'NEW', payload: {} }),
    ).rejects.toThrow('No WebSocket connection available');
  });

  it('sends a JSON-serialized event when connected', async () => {
    const conn = new UnencryptedWebSocketConnection();
    const p = conn.connect('ws://10.0.2.2:28080/events');
    const ws = MockWebSocket.last!;
    ws.fireOpen();
    await p;

    await conn.sendEvent({ event_id: '1', event_type: 'CONNECTION_PING', status: 'NEW', payload: {} });

    expect(ws.send).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    expect(sent.event_type).toBe('CONNECTION_PING');
  });

  it('disconnect closes the socket and clears connected state', async () => {
    const conn = new UnencryptedWebSocketConnection();
    const p = conn.connect('ws://10.0.2.2:28080/events');
    const ws = MockWebSocket.last!;
    ws.fireOpen();
    await p;

    conn.disconnect();

    expect(ws.close).toHaveBeenCalled();
    expect(conn.isConnected()).toBe(false);
  });

  // Sanity: the helper's microtask flush is a no-op when nothing is pending
  // (guards against a silent helper regression that would mask real async bugs).
  it('flushMicrotasks resolves', async () => {
    await expect(flushMicrotasks()).resolves.toBeUndefined();
  });
});
