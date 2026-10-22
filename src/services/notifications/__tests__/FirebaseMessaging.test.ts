/**
 * FirebaseMessaging — unit tests (plan 7-12 §3, step 7).
 *
 * The RNFB native SDK is NEVER touched: every path goes through the injectable
 * {@link FirebaseMessagingApi} loader. These lock the runtime guarding
 * (unavailable / placeholder config → graceful fallback), the two verified
 * payload shapes (relay `data.payload` JSON blob; engine top-level
 * `message_id`), the dedupe interaction, and the token precedence.
 */

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

// Keep these off the native chain (they are the default cloud-registration legs
// and are exercised via `registerFcmTokenWithCloud` mocks below).
jest.mock('../../cloud/DeviceAuthService', () => ({
  __esModule: true,
  default: { registerDevice: jest.fn(async () => undefined) },
}));
jest.mock('../../social/NotificationService', () => ({
  __esModule: true,
  default: { registerPushToken: jest.fn(async () => undefined) },
}));

import { PushTokenStore } from '../PushTokenStore';
import { OutreachDedupe } from '../outreachDedupe';
import {
  FirebaseMessagingService,
  attachFirebaseMessaging,
  detachFirebaseMessagingForTests,
  getFirebaseMessaging,
  parsePushMessage,
  composePushLocalNotification,
  loadFirebaseMessagingApi,
  registerFcmTokenWithCloud,
  setFirebaseMessagingEnabled,
} from '../FirebaseMessaging';
import type {
  FirebaseMessagingApi,
  RemoteMessageLike,
} from '../FirebaseMessaging';
import DeviceAuthService from '../../cloud/DeviceAuthService';
import notificationService from '../../social/NotificationService';

type Listener = (m: any) => void;

interface ApiHarness {
  api: FirebaseMessagingApi;
  emitMessage: (m: RemoteMessageLike) => void;
  emitRefresh: (t: string) => void;
  emitOpened: (m: RemoteMessageLike) => void;
  backgroundHandler: () => ((m: RemoteMessageLike) => Promise<unknown>) | null;
  setInitial: (m: RemoteMessageLike | null) => void;
}

function makeApi(overrides: Partial<FirebaseMessagingApi> = {}): ApiHarness {
  const messages = new Set<Listener>();
  const refreshes = new Set<(t: string) => void>();
  const opened = new Set<Listener>();
  let bgHandler: ((m: RemoteMessageLike) => Promise<unknown>) | null = null;
  let initial: RemoteMessageLike | null = null;

  const api: FirebaseMessagingApi = {
    getApps: jest.fn(() => [{ name: '[DEFAULT]' }]),
    getMessaging: jest.fn(() => ({ __messaging: true })),
    getToken: jest.fn(async () => 'fcm-token'),
    onMessage: jest.fn((_m, l) => {
      messages.add(l as Listener);
      return () => messages.delete(l as Listener);
    }),
    onTokenRefresh: jest.fn((_m, l) => {
      refreshes.add(l);
      return () => refreshes.delete(l);
    }),
    onNotificationOpenedApp: jest.fn((_m, l) => {
      opened.add(l as Listener);
      return () => opened.delete(l as Listener);
    }),
    getInitialNotification: jest.fn(async () => initial),
    setBackgroundMessageHandler: jest.fn((_m, h) => {
      bgHandler = h;
    }),
    ...overrides,
  };

  return {
    api,
    emitMessage: m => messages.forEach(l => l(m)),
    emitRefresh: t => refreshes.forEach(l => l(t)),
    emitOpened: m => opened.forEach(l => l(m)),
    backgroundHandler: () => bgHandler,
    setInitial: m => {
      initial = m;
    },
  };
}

function makeService(
  harness: ApiHarness,
  extra: ConstructorParameters<typeof FirebaseMessagingService>[0] = {},
) {
  const store = extra.store ?? new PushTokenStore();
  const dedupe = extra.dedupe ?? new OutreachDedupe();
  const registerWithCloud = (extra.registerWithCloud ??
    jest.fn(async () => undefined)) as unknown as jest.Mock;
  const onInApp = (extra.onInApp ?? jest.fn()) as unknown as jest.Mock;
  const postLocal = (extra.postLocal ?? jest.fn(async () => true)) as unknown as jest.Mock;
  const service = new FirebaseMessagingService({
    loadApi: () => harness.api,
    store,
    dedupe,
    registerWithCloud,
    postLocal,
    getTransport: async () => 'auto',
    getHideContent: async () => false,
    onInApp,
    ...extra,
  });
  return { service, store, dedupe, registerWithCloud, onInApp, postLocal };
}

afterEach(() => {
  detachFirebaseMessagingForTests();
  setFirebaseMessagingEnabled(null);
});

// ── Wire parsing ─────────────────────────────────────────────────────────

describe('parsePushMessage', () => {
  it('parses a RELAY push (JSON-string payload blob) and extracts messageId', () => {
    const parsed = parsePushMessage({
      data: {
        kind: 'relay',
        payload: JSON.stringify({ kind: 'outreach', entityId: 'ent-1', messageId: 'msg-1' }),
      },
      notification: { title: 'Aria', body: 'Hello there' },
    });
    expect(parsed.kind).toBe('relay');
    expect(parsed.messageId).toBe('msg-1');
    expect(parsed.entityId).toBe('ent-1');
    expect(parsed.hasNotification).toBe(true);
    expect(parsed.title).toBe('Aria');
    expect(parsed.body).toBe('Hello there');
  });

  it('parses a RELAY push whose payload is already an object', () => {
    const parsed = parsePushMessage({
      data: { kind: 'relay', payload: { kind: 'outreach', entityId: 'e', messageId: 'm' } },
    });
    expect(parsed.kind).toBe('relay');
    expect(parsed.messageId).toBe('m');
    expect(parsed.entityId).toBe('e');
  });

  it('parses an ENGINE-local push (top-level message_id)', () => {
    const parsed = parsePushMessage({
      data: {
        entity_id: 'ent-9',
        message_type: 'outreach',
        message_id: 'engine-msg-9',
        created_at: '2026-10-13T00:00:00Z',
      },
    });
    expect(parsed.kind).toBe('engine');
    expect(parsed.messageId).toBe('engine-msg-9');
    expect(parsed.entityId).toBe('ent-9');
    expect(parsed.messageType).toBe('outreach');
    expect(parsed.createdAt).toBe('2026-10-13T00:00:00Z');
    expect(parsed.hasNotification).toBe(false);
  });

  it('classifies a keepalive/blind-tick push', () => {
    const parsed = parsePushMessage({ data: { kind: 'keepalive' } });
    expect(parsed.kind).toBe('keepalive');
    expect(parsed.messageId).toBeNull();
  });

  it('classifies unreadable/malformed payloads as unknown (never throws)', () => {
    expect(parsePushMessage({ data: { kind: 'relay', payload: 'not-json' } }).kind).toBe('unknown');
    expect(parsePushMessage({ data: {} }).kind).toBe('unknown');
    expect(parsePushMessage(undefined).kind).toBe('unknown');
    expect(parsePushMessage(null).kind).toBe('unknown');
  });
});

describe('composePushLocalNotification', () => {
  it('uses the OS alert text, or generic text when hiding content', () => {
    const parsed = parsePushMessage({
      data: { kind: 'relay', payload: JSON.stringify({ messageId: 'm1', entityId: 'e1' }) },
      notification: { title: 'Aria', body: 'Secret preview' },
    });
    expect(composePushLocalNotification(parsed, false)).toMatchObject({
      title: 'Aria',
      body: 'Secret preview',
      entityId: 'e1',
      messageId: 'm1',
    });
    expect(composePushLocalNotification(parsed, true).body).not.toBe('Secret preview');
  });
});

// ── Runtime guarding ─────────────────────────────────────────────────────

describe('FirebaseMessagingService — runtime guarding', () => {
  it('is inert when the SDK loader returns null (not linked)', async () => {
    const { service, store } = makeService(makeApi(), { loadApi: () => null });
    await service.start();
    expect(service.isActive()).toBe(false);
    expect(store.getPushToken()).toBeNull();
  });

  it('is inert when Firebase is not initialised (apps=0)', async () => {
    const harness = makeApi({ getApps: jest.fn(() => []) });
    const { service, store, registerWithCloud } = makeService(harness);
    service.installBackgroundHandler();
    await service.start();
    expect(service.isActive()).toBe(false);
    expect(store.getPushToken()).toBeNull();
    expect(registerWithCloud).not.toHaveBeenCalled();
    expect(harness.api.onMessage).not.toHaveBeenCalled();
  });

  it('is inert when disabled by the rollback knob', async () => {
    setFirebaseMessagingEnabled(false);
    const harness = makeApi();
    const { service, registerWithCloud } = makeService(harness);
    await service.start();
    expect(service.isActive()).toBe(false);
    expect(registerWithCloud).not.toHaveBeenCalled();
  });

  it('never crashes when getToken() rejects (placeholder config)', async () => {
    const harness = makeApi({ getToken: jest.fn(async () => Promise.reject(new Error('no config'))) });
    const { service, store, registerWithCloud } = makeService(harness);
    await service.start();
    expect(service.isActive()).toBe(true);
    expect(store.getPushToken()).toBeNull(); // native fallback stays in force
    expect(registerWithCloud).not.toHaveBeenCalled();
  });
});

// ── Token flow ───────────────────────────────────────────────────────────

describe('FirebaseMessagingService — token flow', () => {
  it('acquires the FCM token → store (sdk precedence) + cloud registration', async () => {
    const harness = makeApi({ getToken: jest.fn(async () => 'fcm-token') });
    const { service, store, registerWithCloud } = makeService(harness);
    // A native fallback token arrived first.
    store.setPushToken('apns-raw');
    await service.start();
    expect(store.getPushToken()).toBe('fcm-token');
    expect(registerWithCloud).toHaveBeenCalledWith('fcm-token');
  });

  it('re-registers on token refresh', async () => {
    const harness = makeApi();
    const { service, store, registerWithCloud } = makeService(harness);
    await service.start();
    (registerWithCloud as jest.Mock).mockClear();
    harness.emitRefresh('rotated-token');
    await Promise.resolve();
    expect(store.getPushToken()).toBe('rotated-token');
    expect(registerWithCloud).toHaveBeenCalledWith('rotated-token');
  });
});

// ── Message handling ─────────────────────────────────────────────────────

describe('FirebaseMessagingService — foreground', () => {
  const relay = {
    data: { kind: 'relay', payload: JSON.stringify({ entityId: 'e1', messageId: 'm1' }) },
    notification: { title: 'Aria', body: 'hi' },
  };

  it('dedupes and surfaces in-app only (never posts a local OS notification)', async () => {
    const harness = makeApi();
    const { service, onInApp, postLocal } = makeService(harness);
    await service.handleForeground(relay);
    expect(onInApp).toHaveBeenCalledTimes(1);
    expect(onInApp.mock.calls[0][0]).toMatchObject({ kind: 'relay', messageId: 'm1' });
    expect(postLocal).not.toHaveBeenCalled();
  });

  it('suppresses a duplicate (same message_id) across paths', async () => {
    const harness = makeApi();
    const { service, onInApp } = makeService(harness);
    await service.handleForeground(relay);
    await service.handleForeground(relay);
    expect(onInApp).toHaveBeenCalledTimes(1);
  });

  it('ignores keepalive and unknown payloads', async () => {
    const harness = makeApi();
    const { service, onInApp } = makeService(harness);
    await service.handleForeground({ data: { kind: 'keepalive' } });
    await service.handleForeground({ data: {} });
    expect(onInApp).not.toHaveBeenCalled();
  });

  it('honours notification_transport=off', async () => {
    const harness = makeApi();
    const { service, onInApp } = makeService(harness, { getTransport: async () => 'off' });
    await service.handleForeground(relay);
    expect(onInApp).not.toHaveBeenCalled();
  });
});

describe('FirebaseMessagingService — background', () => {
  it('posts a local notification for DATA-ONLY engine outreach', async () => {
    const harness = makeApi();
    const { service, postLocal } = makeService(harness);
    await service.handleBackground({
      data: { entity_id: 'e2', message_type: 'outreach', message_id: 'bg-1' },
    });
    expect(postLocal).toHaveBeenCalledTimes(1);
    expect(postLocal.mock.calls[0][0]).toMatchObject({ messageId: 'bg-1', entityId: 'e2' });
  });

  it('does NOT post locally when the OS already displayed a notification payload', async () => {
    const harness = makeApi();
    const { service, postLocal } = makeService(harness);
    await service.handleBackground({
      data: { kind: 'relay', payload: JSON.stringify({ entityId: 'e', messageId: 'bg-2' }) },
      notification: { title: 'Aria', body: 'hello' },
    });
    expect(postLocal).not.toHaveBeenCalled();
  });

  it('records dedupe so a later foreground/sibling path never doubles', async () => {
    const harness = makeApi();
    const { service, onInApp } = makeService(harness);
    const relay = {
      data: { kind: 'relay', payload: JSON.stringify({ entityId: 'e', messageId: 'shared-1' }) },
      notification: { title: 'Aria', body: 'hello' },
    };
    await service.handleBackground(relay); // OS displayed it; recorded
    await service.handleForeground(relay); // must be suppressed
    expect(onInApp).not.toHaveBeenCalled();
  });

  it('observes silent keepalive pushes without touching the wake path', async () => {
    const harness = makeApi();
    const onBackgroundWake = jest.fn();
    const { service, postLocal } = makeService(harness, { onBackgroundWake });
    await service.handleBackground({ data: { kind: 'keepalive' } });
    expect(onBackgroundWake).toHaveBeenCalledTimes(1);
    expect(onBackgroundWake.mock.calls[0][0].kind).toBe('keepalive');
    expect(postLocal).not.toHaveBeenCalled();
  });

  it('honours notification_transport=off', async () => {
    const harness = makeApi();
    const { service, postLocal } = makeService(harness, { getTransport: async () => 'off' });
    await service.handleBackground({
      data: { entity_id: 'e', message_id: 'bg-3' },
    });
    expect(postLocal).not.toHaveBeenCalled();
  });

  it('installs the background handler early (available Firebase)', () => {
    const harness = makeApi();
    const { service } = makeService(harness);
    service.installBackgroundHandler();
    expect(harness.api.setBackgroundMessageHandler).toHaveBeenCalledTimes(1);
    expect(typeof harness.backgroundHandler()).toBe('function');
  });
});

describe('FirebaseMessagingService — tap handling', () => {
  it('routes a tap into the open seam and marks it seen', async () => {
    const harness = makeApi();
    const onNotificationOpened = jest.fn();
    const { service, dedupe } = makeService(harness, { onNotificationOpened });
    const msg = {
      data: { kind: 'relay', payload: JSON.stringify({ entityId: 'e', messageId: 'tap-1' }) },
      notification: { title: 'Aria', body: 'hi' },
    };
    service.handleOpened(msg);
    expect(onNotificationOpened).toHaveBeenCalledTimes(1);
    expect(dedupe.hasSeen('tap-1')).toBe(true);
  });
});

// ── Singleton + loader ───────────────────────────────────────────────────

describe('attachFirebaseMessaging / loadFirebaseMessagingApi', () => {
  it('returns the same singleton and detaches for tests', () => {
    const first = attachFirebaseMessaging({ loadApi: () => null });
    const second = attachFirebaseMessaging({ loadApi: () => null });
    expect(second).toBe(first);
    expect(getFirebaseMessaging()).toBe(first);
    detachFirebaseMessagingForTests();
    expect(getFirebaseMessaging()).toBeNull();
  });

  it('loadFirebaseMessagingApi returns a callable modular API (or null, never throws)', () => {
    const api = loadFirebaseMessagingApi();
    // In a bare jest/node run RNFB is not fully linked; either a structural API
    // or null (guarded) is acceptable — it must never throw.
    if (api) {
      expect(typeof api.getMessaging).toBe('function');
      expect(typeof api.getToken).toBe('function');
      expect(typeof api.onMessage).toBe('function');
    } else {
      expect(api).toBeNull();
    }
  });
});

describe('registerFcmTokenWithCloud', () => {
  it('feeds the notification service and the device row', async () => {
    const registerPushToken = (notificationService.registerPushToken as jest.Mock);
    const registerDevice = (DeviceAuthService.registerDevice as jest.Mock);
    registerPushToken.mockClear();
    registerDevice.mockClear();
    await registerFcmTokenWithCloud('  fcm-abc  ');
    expect(registerPushToken).toHaveBeenCalledWith('fcm-abc');
    expect(registerDevice).toHaveBeenCalledWith({ pushToken: 'fcm-abc' });
  });

  it('is a no-op for a blank token', async () => {
    const registerDevice = (DeviceAuthService.registerDevice as jest.Mock);
    registerDevice.mockClear();
    await registerFcmTokenWithCloud('');
    expect(registerDevice).not.toHaveBeenCalled();
  });
});
