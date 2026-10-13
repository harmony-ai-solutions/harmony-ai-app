/**
 * LocalNotifications — unit tests (plan 7-12 §4c).
 *
 * Exercises the JS wrapper against a mocked native `SoulbitsNotifications`
 * bridge (the same module name on iOS + Android): support detection, posting,
 * and graceful degradation when the bridge is absent or throws.
 */

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { NativeModules } from 'react-native';
import {
  isLocalNotificationsSupported,
  postLocalNotification,
} from '../LocalNotifications';

const nativeModules = NativeModules as Record<string, unknown>;

const PAYLOAD = {
  title: 'Claire',
  body: 'Thinking of you.',
  entityId: 'claire',
  messageId: 'msg-1',
};

afterEach(() => {
  delete nativeModules.SoulbitsNotifications;
});

describe('LocalNotifications', () => {
  it('reports unsupported when the bridge is absent and no-ops', async () => {
    expect(isLocalNotificationsSupported()).toBe(false);
    await expect(postLocalNotification(PAYLOAD)).resolves.toBe(false);
  });

  it('reports unsupported when the bridge lacks the posting method', () => {
    nativeModules.SoulbitsNotifications = { requestAuthorization: jest.fn() };
    expect(isLocalNotificationsSupported()).toBe(false);
  });

  it('posts through the bridge and returns true', async () => {
    const postLocalNotificationBridge = jest.fn(() => Promise.resolve(true));
    nativeModules.SoulbitsNotifications = { postLocalNotification: postLocalNotificationBridge };

    expect(isLocalNotificationsSupported()).toBe(true);
    await expect(postLocalNotification(PAYLOAD)).resolves.toBe(true);
    expect(postLocalNotificationBridge).toHaveBeenCalledWith({
      title: 'Claire',
      body: 'Thinking of you.',
      entityId: 'claire',
      messageId: 'msg-1',
    });
  });

  it('returns false when the native side declines', async () => {
    nativeModules.SoulbitsNotifications = {
      postLocalNotification: jest.fn(() => Promise.resolve(false)),
    };
    await expect(postLocalNotification(PAYLOAD)).resolves.toBe(false);
  });

  it('returns false and never calls the bridge without a messageId', async () => {
    const postLocalNotificationBridge = jest.fn(() => Promise.resolve(true));
    nativeModules.SoulbitsNotifications = { postLocalNotification: postLocalNotificationBridge };
    await expect(postLocalNotification({ ...PAYLOAD, messageId: '' })).resolves.toBe(false);
    expect(postLocalNotificationBridge).not.toHaveBeenCalled();
  });

  it('degrades to false when the bridge rejects', async () => {
    nativeModules.SoulbitsNotifications = {
      postLocalNotification: jest.fn(() => Promise.reject(new Error('boom'))),
    };
    await expect(postLocalNotification(PAYLOAD)).resolves.toBe(false);
  });
});
