/**
 * PushTokenStore — unit tests (plan 7-12 §5, step 6).
 *
 * The store is the single source of truth the INIT_ENTITY payload and step 7's
 * Firebase integration both read/write. These lock the sync read, the
 * change/rotation fan-out, and the native-seam wiring (onPushToken +
 * consumePendingPushToken).
 */

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import {
  PushTokenStore,
  pushTokenStore,
  attachNativePushTokenSource,
  __resetPushTokenStoreForTests,
} from '../PushTokenStore';
import type { PushTokenNativeSource } from '../PushTokenStore';

describe('PushTokenStore', () => {
  it('starts empty and stores a trimmed token', () => {
    const store = new PushTokenStore();
    expect(store.getPushToken()).toBeNull();

    store.setPushToken('  abc-123  ');
    expect(store.getPushToken()).toBe('abc-123');
  });

  it('clears on a blank token', () => {
    const store = new PushTokenStore();
    store.setPushToken('tok');
    store.setPushToken('');
    expect(store.getPushToken()).toBeNull();
    store.setPushToken('tok2');
    store.setPushToken(undefined);
    expect(store.getPushToken()).toBeNull();
  });

  it('notifies subscribers on change (rotation) and not on a no-op set', () => {
    const store = new PushTokenStore();
    const seen: Array<string | null> = [];
    const unsub = store.onPushTokenChange(t => seen.push(t));

    store.setPushToken('t1');
    store.setPushToken('t1'); // no-op
    store.setPushToken('t2'); // rotation
    expect(seen).toEqual(['t1', 't2']);

    unsub();
    store.setPushToken('t3');
    expect(seen).toEqual(['t1', 't2']); // unsubscribed
  });

  it('swallows a throwing listener', () => {
    const store = new PushTokenStore();
    store.onPushTokenChange(() => {
      throw new Error('boom');
    });
    expect(() => store.setPushToken('t1')).not.toThrow();
    expect(store.getPushToken()).toBe('t1');
  });

  it('lets the SDK (FCM) token take precedence over the native fallback', () => {
    const store = new PushTokenStore();
    store.setPushToken('apns-raw'); // native fallback
    expect(store.getPushToken()).toBe('apns-raw');

    store.setPushToken('fcm-token', 'sdk');
    expect(store.getPushToken()).toBe('fcm-token');

    // A late native write while an SDK token is live must NOT clobber it.
    store.setPushToken('apns-raw-2');
    expect(store.getPushToken()).toBe('fcm-token');

    // Clearing the SDK token resumes the native fallback.
    store.setPushToken(null, 'sdk');
    expect(store.getPushToken()).toBe('apns-raw-2');
  });

  it('does not fan out a native write while the SDK token is effective', () => {
    const store = new PushTokenStore();
    store.setPushToken('apns-raw');
    const seen: Array<string | null> = [];
    store.onPushTokenChange(t => seen.push(t));

    store.setPushToken('fcm', 'sdk'); // effective changes → emit
    store.setPushToken('apns-raw-2'); // effective unchanged → no emit
    expect(seen).toEqual(['fcm']);
  });

  it('setSdkPushToken is shorthand for the sdk source', () => {
    const store = new PushTokenStore();
    store.setPushToken('apns-raw');
    store.setSdkPushToken('fcm');
    expect(store.getPushToken()).toBe('fcm');
  });
});

describe('attachNativePushTokenSource', () => {
  afterEach(() => __resetPushTokenStoreForTests());

  it('feeds the store from onPushToken events', () => {
    let listener: ((e: { token: string }) => void) | null = null;
    const source: PushTokenNativeSource = {
      onPushToken: l => {
        listener = l;
        return () => {
          listener = null;
        };
      },
      consumePendingPushToken: jest.fn(async () => null),
    };

    const unsub = attachNativePushTokenSource(source);
    expect(pushTokenStore.getPushToken()).toBeNull();

    listener!({ token: 'apns-token' });
    expect(pushTokenStore.getPushToken()).toBe('apns-token');

    unsub();
    expect(listener).toBeNull();
  });

  it('drains a token queued before JS booted', async () => {
    const source: PushTokenNativeSource = {
      onPushToken: () => () => undefined,
      consumePendingPushToken: jest.fn(async () => 'queued-token'),
    };

    attachNativePushTokenSource(source);
    await new Promise<void>(r => setImmediate(r));
    expect(pushTokenStore.getPushToken()).toBe('queued-token');
  });

  it('is a safe no-op when the native seam is absent', () => {
    const unsub = attachNativePushTokenSource({} as PushTokenNativeSource);
    expect(typeof unsub).toBe('function');
    expect(pushTokenStore.getPushToken()).toBeNull();
    expect(() => unsub()).not.toThrow();
  });
});
