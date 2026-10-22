/**
 * SyncAppliedOutreachCollector — unit tests (plan 7-12 §2/§5, step 5).
 *
 * The wake-window subscriber to the engine's events WS: buffers outreach/
 * greeting events that arrive while the wake applies pending changesets, ignores
 * the keepalive, and hands them to the relay on `take()`.
 */

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import {
  SyncAppliedOutreachCollector,
  DEFAULT_COLLECTOR_MAX_EVENTS,
} from '../SyncAppliedOutreachCollector';
import { OUTREACH_STREAM_PATH } from '../OutreachNotificationService';
import type { EngineConnection } from '../../engine/EngineService';
import type { WebSocketLike } from '../../engine/EngineLogStream';
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

const event = (overrides: Record<string, unknown> = {}) => ({
  type: 'outreach',
  entity_id: 'claire',
  entity_name: 'Claire',
  message_id: 'msg-1',
  title: 'Claire',
  body_preview: 'Thinking of you.',
  created_at: '2026-10-13T12:00:00Z',
  eligibility: 'eligible',
  ...overrides,
});

describe('SyncAppliedOutreachCollector', () => {
  beforeEach(() => MockWebSocket.reset());

  it('builds the management-port ws URL with the loopback token', () => {
    const c = new SyncAppliedOutreachCollector({ getConnection: () => CONNECTION });
    expect(c.buildUrl(CONNECTION)).toBe(
      `ws://127.0.0.1:28081${OUTREACH_STREAM_PATH}?token=loop-token`,
    );
  });

  it('falls back to the admin-key param when no token is present', () => {
    const c = new SyncAppliedOutreachCollector({
      getConnection: () => ({ ...CONNECTION, token: '' }),
      getAdminApiKey: () => 'admin-key',
    });
    expect(c.buildUrl({ ...CONNECTION, token: '' })).toBe(
      `ws://127.0.0.1:28081${OUTREACH_STREAM_PATH}?apiKey=admin-key`,
    );
  });

  it('returns null with no connection and opens nothing', () => {
    const c = new SyncAppliedOutreachCollector({ getConnection: () => null });
    expect(c.buildUrl(null)).toBeNull();
    c.start();
    expect(MockWebSocket.instances).toHaveLength(0);
    expect(c.take()).toEqual([]);
  });

  it('buffers outreach/greeting events and ignores the keepalive', () => {
    const c = new SyncAppliedOutreachCollector({
      getConnection: () => CONNECTION,
      wsFactory: (url: string) => new MockWebSocket(url) as unknown as WebSocketLike,
    });
    c.start();
    const socket = MockWebSocket.last!;

    socket.fireMessage({ type: 'ping', timestamp: 1 });
    socket.fireMessage(event());
    socket.fireMessage(event({ type: 'greeting', message_id: 'msg-2' }));
    socket.fireMessage('not json');
    socket.fireMessage({ type: 'other' });

    const taken = c.take();
    expect(taken).toHaveLength(2);
    expect(taken.map(e => e.message_id)).toEqual(['msg-1', 'msg-2']);

    // take() drains.
    expect(c.take()).toEqual([]);
    c.stop();
  });

  it('bounds the buffer at maxEvents', () => {
    const c = new SyncAppliedOutreachCollector({
      getConnection: () => CONNECTION,
      wsFactory: (url: string) => new MockWebSocket(url) as unknown as WebSocketLike,
      maxEvents: 2,
    });
    c.start();
    const socket = MockWebSocket.last!;
    socket.fireMessage(event({ message_id: 'm1' }));
    socket.fireMessage(event({ message_id: 'm2' }));
    socket.fireMessage(event({ message_id: 'm3' }));
    expect(c.take()).toHaveLength(2);
    c.stop();
  });

  it('closes the socket on stop (idempotent)', () => {
    const c = new SyncAppliedOutreachCollector({
      getConnection: () => CONNECTION,
      wsFactory: (url: string) => new MockWebSocket(url) as unknown as WebSocketLike,
    });
    c.start();
    const socket = MockWebSocket.last!;
    c.stop();
    expect(socket.close).toHaveBeenCalled();
    expect(() => c.stop()).not.toThrow();
  });

  it('is a safe no-op when the socket factory throws', () => {
    const c = new SyncAppliedOutreachCollector({
      getConnection: () => CONNECTION,
      wsFactory: () => {
        throw new Error('no socket');
      },
    });
    expect(() => c.start()).not.toThrow();
    expect(c.take()).toEqual([]);
    c.stop();
  });

  it('exposes a sane default bound', () => {
    expect(DEFAULT_COLLECTOR_MAX_EVENTS).toBeGreaterThan(0);
  });
});
