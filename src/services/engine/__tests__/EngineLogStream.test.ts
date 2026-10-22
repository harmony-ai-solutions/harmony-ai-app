/**
 * EngineLogStream — unit tests (plan 7-11).
 *
 * Drives the stream client against the shared browser-style `MockWebSocket`
 * (the same fake the connection unit tests use), so no network / native module
 * is needed.
 */

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import {
  EngineLogStream,
  type EngineLogStreamEvent,
  type EngineLogStreamStatus,
  type WebSocketLike,
} from '../EngineLogStream';
import type { EngineConnection } from '../EngineService';
import { MockWebSocket } from '../../websocket/__tests__/helpers/MockWebSocket';

const CONNECTION: EngineConnection = {
  adminBaseUrl: 'http://127.0.0.1:28081',
  wsBaseUrl: 'ws://127.0.0.1:28080',
  wssBaseUrl: '',
  token: 'loop-token',
  bind: '127.0.0.1',
  wsPort: 28080,
  wssPort: 0,
  adminPort: 28081,
  pid: 1,
  dataDir: '',
};

function makeStream(overrides: Partial<ConstructorParameters<typeof EngineLogStream>[0]> = {}) {
  MockWebSocket.reset();
  const events: EngineLogStreamEvent[] = [];
  const statuses: EngineLogStreamStatus[] = [];
  const stream = new EngineLogStream({
    getConnection: () => CONNECTION,
    wsFactory: (url: string) => new MockWebSocket(url) as unknown as WebSocketLike,
    onEvent: e => events.push(e),
    onStatusChange: s => statuses.push(s),
    ...overrides,
  });
  return { stream, events, statuses };
}

describe('EngineLogStream', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('builds the admin-port ws URL with the loopback token', () => {
    const { stream } = makeStream();
    expect(stream.buildUrl(CONNECTION)).toBe(
      'ws://127.0.0.1:28081/api/development/logs/stream?token=loop-token',
    );
  });

  it('falls back to the admin key param when no token is present', () => {
    const { stream } = makeStream({ getAdminApiKey: () => 'admin-key' });
    expect(stream.buildUrl({ ...CONNECTION, token: '' })).toBe(
      'ws://127.0.0.1:28081/api/development/logs/stream?apiKey=admin-key',
    );
  });

  it('opens, reports status, and forwards entry/remove/ping events', () => {
    const { stream, events, statuses } = makeStream();
    stream.start();

    const socket = MockWebSocket.last!;
    expect(socket.url).toBe(
      'ws://127.0.0.1:28081/api/development/logs/stream?token=loop-token',
    );
    socket.fireOpen();
    expect(stream.getStatus()).toBe('open');
    expect(statuses).toContain('open');

    socket.fireMessage({ type: 'entry', data: { id: 7, message: 'hi', component: 'chat' } });
    socket.fireMessage({ type: 'remove', removeId: 7 });
    socket.fireMessage({ type: 'ping', timestamp: 123 });

    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({
      type: 'entry',
      entry: { id: 7, message: 'hi', component: 'chat' },
    });
    expect(events[1]).toEqual({ type: 'remove', removeId: 7 });
    expect(events[2]).toEqual({ type: 'ping', timestamp: 123 });
  });

  it('ignores malformed frames', () => {
    const { stream, events } = makeStream();
    stream.start();
    const socket = MockWebSocket.last!;
    socket.fireOpen();
    socket.onmessage?.({ data: 'not json' });
    socket.fireMessage({ type: 'unknown' });
    expect(events).toHaveLength(0);
  });

  it('pushes filter + pause/resume control frames in-band', () => {
    const { stream } = makeStream();
    stream.start();
    const socket = MockWebSocket.last!;
    socket.fireOpen();

    stream.setFilter({ component: 'chat', minLevel: 'debug' });
    expect(socket.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'filter', data: { component: 'chat', entityId: undefined, minLevel: 'debug' } }),
    );

    stream.setPaused(true);
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'pause' }));
    stream.setPaused(false);
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'resume' }));
  });

  it('re-applies the current filter + pause state after a reconnect', () => {
    jest.useFakeTimers();
    const { stream } = makeStream({ reconnectBaseDelayMs: 1000 });
    stream.start();
    const first = MockWebSocket.last!;
    first.fireOpen();
    stream.setFilter({ component: 'chat' });
    stream.setPaused(true);

    // Drop the connection → a reconnect is scheduled; advance past the backoff.
    first.fireClose();
    expect(stream.getStatus()).toBe('reconnecting');
    jest.advanceTimersByTime(1000);

    const second = MockWebSocket.last!;
    expect(second).not.toBe(first);
    second.fireOpen();
    expect(second.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'filter', data: { component: 'chat', entityId: undefined, minLevel: undefined } }),
    );
    expect(second.send).toHaveBeenCalledWith(JSON.stringify({ type: 'pause' }));
  });

  it('backs off exponentially and caps the delay', () => {
    jest.useFakeTimers();
    const { stream } = makeStream({ reconnectBaseDelayMs: 1000, reconnectMaxDelayMs: 4000 });
    stream.start();
    MockWebSocket.last!.fireOpen();

    // Three drops without a successful open → delays 1000, 2000, 4000 (capped).
    MockWebSocket.last!.fireClose();
    jest.advanceTimersByTime(999);
    expect(MockWebSocket.instances).toHaveLength(1);
    jest.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(2);

    MockWebSocket.last!.fireClose();
    jest.advanceTimersByTime(2000);
    expect(MockWebSocket.instances).toHaveLength(3);

    MockWebSocket.last!.fireClose();
    jest.advanceTimersByTime(4000);
    expect(MockWebSocket.instances).toHaveLength(4);
  });

  it('stop() closes the socket and cancels reconnection', () => {
    jest.useFakeTimers();
    const { stream } = makeStream({ reconnectBaseDelayMs: 1000 });
    stream.start();
    const socket = MockWebSocket.last!;
    socket.fireOpen();

    stream.stop();
    expect(socket.close).toHaveBeenCalled();
    expect(stream.getStatus()).toBe('stopped');

    // A close after stop must NOT schedule a reconnect.
    socket.fireClose();
    jest.advanceTimersByTime(60000);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('does not connect without an engine connection', () => {
    const { stream, statuses } = makeStream({ getConnection: () => null });
    stream.start();
    expect(MockWebSocket.instances).toHaveLength(0);
    expect(statuses).toContain('idle');
  });
});
