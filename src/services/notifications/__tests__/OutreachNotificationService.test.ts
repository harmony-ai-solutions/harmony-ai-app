/**
 * OutreachNotificationService — unit tests (plan 7-12 §2, steps 3 + 4).
 *
 * Drives the service against the shared browser-style `MockWebSocket` and
 * injected seams (AppState, dedupe, settings, local-posting) — no network,
 * native module, or real timers needed for the policy assertions.
 */

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import {
  OutreachNotificationService,
  composeLocalNotification,
  genericOutreachBody,
  OUTREACH_STREAM_PATH,
  type OutreachNotificationEvent,
  type OutreachStreamStatus,
} from '../OutreachNotificationService';
import { OutreachDedupe } from '../outreachDedupe';
import type { EngineConnection } from '../../engine/EngineService';
import type { WebSocketLike } from '../../engine/EngineLogStream';
import { MockWebSocket } from '../../websocket/__tests__/helpers/MockWebSocket';
import {
  outreachNotificationEventFixture,
  outreachNotificationLiveEventFixture,
} from '../../engine/__fixtures__/managementContract.fixtures';

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

function makeEvent(overrides: Partial<OutreachNotificationEvent> = {}): OutreachNotificationEvent {
  return {
    type: 'outreach',
    entity_id: 'claire',
    entity_name: 'Claire',
    message_id: 'msg-1',
    title: 'Claire',
    body_preview: 'Thinking of you.',
    created_at: '2026-10-13T12:00:00Z',
    eligibility: 'eligible',
    ...overrides,
  };
}

interface MakeOptions {
  connection?: EngineConnection | null;
  appState?: string;
  transport?: string;
  hideContent?: boolean;
}

function makeService(options: MakeOptions = {}) {
  MockWebSocket.reset();
  const events: OutreachNotificationEvent[] = [];
  const posted: unknown[] = [];
  const statuses: OutreachStreamStatus[] = [];
  const appState = {
    currentState: (options.appState ?? 'active') as any,
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  };
  const service = new OutreachNotificationService({
    getConnection: () => (options.connection === undefined ? CONNECTION : options.connection),
    wsFactory: (url: string) => new MockWebSocket(url) as unknown as WebSocketLike,
    appState: appState as any,
    dedupe: new OutreachDedupe(),
    getTransport: () => Promise.resolve((options.transport ?? 'auto') as any),
    getHideContent: () => Promise.resolve(options.hideContent ?? false),
    postLocal: payload => {
      posted.push(payload);
      return Promise.resolve(true);
    },
    onInApp: event => events.push(event),
    onStatusChange: status => statuses.push(status),
  });
  return { service, events, posted, statuses, appState };
}

const flush = () => new Promise<void>(resolve => setImmediate(resolve));

describe('OutreachNotificationService — URL + parsing', () => {
  afterEach(() => jest.useRealTimers());

  it('builds the management-port ws URL with the loopback token', () => {
    const { service } = makeService();
    expect(service.buildUrl(CONNECTION)).toBe(
      `ws://127.0.0.1:28081${OUTREACH_STREAM_PATH}?token=loop-token`,
    );
  });

  it('falls back to the admin-key param when no token is present', () => {
    MockWebSocket.reset();
    const service = new OutreachNotificationService({
      getConnection: () => ({ ...CONNECTION, token: '' }),
      getAdminApiKey: () => 'admin-key',
    });
    expect(service.buildUrl({ ...CONNECTION, token: '' })).toBe(
      `ws://127.0.0.1:28081${OUTREACH_STREAM_PATH}?apiKey=admin-key`,
    );
  });

  it('returns null with no connection', () => {
    const { service } = makeService({ connection: null });
    expect(service.buildUrl(null)).toBeNull();
  });

  it('opens the socket and ignores ping frames', async () => {
    const { service, events, posted } = makeService();
    service.start();
    const socket = MockWebSocket.last!;
    socket.fireOpen();
    expect(service.getStatus()).toBe('open');

    socket.fireMessage({ type: 'ping', timestamp: 123 });
    await flush();
    expect(events).toHaveLength(0);
    expect(posted).toHaveLength(0);

    service.stop();
  });

  it('does not connect without an engine connection', () => {
    const { service, statuses } = makeService({ connection: null });
    service.start();
    expect(MockWebSocket.instances).toHaveLength(0);
    expect(statuses).toContain('idle');
    service.stop();
  });
});

describe('OutreachNotificationService — AppState policy', () => {
  it('foreground: surfaces in-app only, never posts an OS notification', async () => {
    const { service, events, posted } = makeService({ appState: 'active' });
    await service.handleEvent(makeEvent());
    expect(events).toHaveLength(1);
    expect(events[0].message_id).toBe('msg-1');
    expect(posted).toHaveLength(0);
  });

  it('background: posts a local notification with the preview body', async () => {
    const { service, events, posted } = makeService({ appState: 'background' });
    await service.handleEvent(makeEvent());
    expect(events).toHaveLength(0);
    expect(posted).toEqual([
      {
        title: 'Claire',
        body: 'Thinking of you.',
        entityId: 'claire',
        messageId: 'msg-1',
      },
    ]);
  });

  it('background + hide content: posts generic text', async () => {
    const { service, posted } = makeService({ appState: 'background', hideContent: true });
    await service.handleEvent(makeEvent());
    expect(posted).toEqual([
      {
        title: 'Claire',
        body: 'Claire sent you a message',
        entityId: 'claire',
        messageId: 'msg-1',
      },
    ]);
  });

  it('treats inactive as background (only active is foreground)', async () => {
    const { service, posted } = makeService({ appState: 'inactive' });
    await service.handleEvent(makeEvent());
    expect(posted).toHaveLength(1);
  });
});

describe('OutreachNotificationService — defensive suppression + dedupe', () => {
  it('suppresses non-eligible events (muted / decay_suppressed)', async () => {
    const { service, events, posted } = makeService({ appState: 'background' });
    await service.handleEvent(makeEvent({ eligibility: 'muted' }));
    await service.handleEvent(makeEvent({ eligibility: 'decay_suppressed' }));
    expect(events).toHaveLength(0);
    expect(posted).toHaveLength(0);
  });

  it('drops unknown types and blank ids', async () => {
    const { service, posted } = makeService({ appState: 'background' });
    await service.handleEvent(makeEvent({ type: 'ping' as any }));
    await service.handleEvent(makeEvent({ message_id: '' }));
    await service.handleEvent(null);
    expect(posted).toHaveLength(0);
  });

  it('dedupes by message_id (a live event + re-emission posts once)', async () => {
    const { service, posted } = makeService({ appState: 'background' });
    const live = makeEvent({ delivery: 'live' });
    await service.handleEvent(live);
    await service.handleEvent(live); // re-emission
    expect(posted).toHaveLength(1);
  });

  it('dedupes across foreground and background paths', async () => {
    const { service, events, posted } = makeService({ appState: 'active' });
    await service.handleEvent(makeEvent());
    expect(events).toHaveLength(1);

    // A later push while backgrounded carries the same id → suppressed.
    (service as any).appState.currentState = 'background';
    await service.handleEvent(makeEvent());
    expect(posted).toHaveLength(0);
  });

  it('suppresses everything when transport is off', async () => {
    const { service, events, posted } = makeService({ appState: 'background', transport: 'off' });
    await service.handleEvent(makeEvent());
    expect(events).toHaveLength(0);
    expect(posted).toHaveLength(0);
  });

  it('allows notifications for the other transports', async () => {
    for (const transport of ['auto', 'direct', 'cloud']) {
      const { service, posted } = makeService({ appState: 'background', transport });
      await service.handleEvent(makeEvent());
      expect(posted).toHaveLength(1);
    }
  });

  it('suppresses outreach for a store-locked entity (7-14 V3)', async () => {
    // A locked entity (provider not offered by this build) can't be interacted
    // with, so neither a local banner nor a foreground in-app event may imply
    // an actionable unread.
    const posted: unknown[] = [];
    const events: OutreachNotificationEvent[] = [];
    const service = new OutreachNotificationService({
      getConnection: () => CONNECTION,
      wsFactory: (url: string) => new MockWebSocket(url) as unknown as WebSocketLike,
      appState: {
        currentState: 'background',
        addEventListener: jest.fn(() => ({ remove: jest.fn() })),
      } as any,
      dedupe: new OutreachDedupe(),
      getTransport: () => Promise.resolve('auto' as any),
      getHideContent: () => Promise.resolve(false),
      isEntityLocked: (id: string) => Promise.resolve(id === 'locked-entity'),
      postLocal: payload => {
        posted.push(payload);
        return Promise.resolve(true);
      },
      onInApp: event => events.push(event),
    });

    await service.handleEvent(makeEvent({ entity_id: 'locked-entity', message_id: 'm-lock-1' }));
    expect(posted).toHaveLength(0);

    (service as any).appState.currentState = 'active';
    await service.handleEvent(makeEvent({ entity_id: 'locked-entity', message_id: 'm-lock-2' }));
    expect(events).toHaveLength(0);

    // An unlocked entity still notifies normally.
    await service.handleEvent(makeEvent({ entity_id: 'ok-entity', message_id: 'm-ok' }));
    expect(events).toHaveLength(1);
  });
});

describe('OutreachNotificationService — reconnect + teardown', () => {
  afterEach(() => jest.useRealTimers());

  it('reconnects with capped backoff after a drop', () => {
    jest.useFakeTimers();
    const { service } = makeService();
    service.start();
    MockWebSocket.last!.fireOpen();

    MockWebSocket.last!.fireClose();
    expect(service.getStatus()).toBe('reconnecting');
    jest.advanceTimersByTime(999);
    expect(MockWebSocket.instances).toHaveLength(1);
    jest.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(2);

    service.stop();
  });

  it('stop() closes the socket and cancels reconnection', () => {
    jest.useFakeTimers();
    const { service } = makeService();
    service.start();
    const socket = MockWebSocket.last!;
    socket.fireOpen();

    service.stop();
    expect(socket.close).toHaveBeenCalled();
    expect(service.getStatus()).toBe('stopped');

    socket.fireClose();
    jest.advanceTimersByTime(60000);
    expect(MockWebSocket.instances).toHaveLength(1);
  });
});

describe('OutreachNotificationService — canonical fixtures', () => {
  it('accepts the shipped outreachNotificationEvent fixtures', async () => {
    const { service, posted } = makeService({ appState: 'background' });
    // The canonical vendored fixtures (engine contract 1.4.0) drive the policy
    // end-to-end. The literal-union fields are narrowed here because the
    // fixture literals widen to `string`; the runtime shape is what is asserted.
    await service.handleEvent(
      outreachNotificationEventFixture as unknown as OutreachNotificationEvent,
    );
    await service.handleEvent(
      outreachNotificationLiveEventFixture as unknown as OutreachNotificationEvent,
    );
    // Same message_id in both fixtures → the live re-emission is deduped.
    expect(posted).toHaveLength(1);
    expect(posted[0]).toEqual({
      title: 'Aria',
      body: 'Thinking of you.',
      entityId: 'ent-1',
      messageId: 'msg-1',
    });
  });
});

describe('composeLocalNotification / genericOutreachBody', () => {
  it('falls back to generic text when the preview is empty', () => {
    const payload = composeLocalNotification(makeEvent({ body_preview: '' }), false);
    expect(payload.body).toBe('Claire sent you a message');
  });

  it('uses the title as a fallback when entity_name is empty', () => {
    const payload = composeLocalNotification(makeEvent({ entity_name: '' }), false);
    expect(payload.title).toBe('Claire');
  });

  it('genericOutreachBody handles a missing name', () => {
    expect(genericOutreachBody('')).toBe('Your companion sent you a message');
  });
});
