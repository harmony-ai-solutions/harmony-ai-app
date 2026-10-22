/**
 * NotificationSettings — unit tests (plan 7-12 §4d).
 *
 * The single source of truth for the transport + lock-screen preferences:
 * defaults, persistence via AsyncStorage, the in-memory cache, and defensive
 * parsing of malformed stored values.
 */

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  __resetNotificationSettingsForTests,
  DEFAULT_HIDE_CONTENT_ON_LOCK_SCREEN,
  DEFAULT_NOTIFICATION_TRANSPORT,
  getHideContentOnLockScreen,
  getNotificationTransport,
  isNotificationTransport,
  loadNotificationSettings,
  NOTIFICATION_HIDE_CONTENT_KEY,
  NOTIFICATION_TRANSPORT_KEY,
  setHideContentOnLockScreen,
  setNotificationTransport,
} from '../NotificationSettings';

const getItem = AsyncStorage.getItem as jest.Mock;
const setItem = AsyncStorage.setItem as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  __resetNotificationSettingsForTests();
  getItem.mockResolvedValue(null);
});

describe('NotificationSettings', () => {
  it('defaults to auto + preview shown when nothing is stored', async () => {
    await expect(getNotificationTransport()).resolves.toBe('auto');
    await expect(getHideContentOnLockScreen()).resolves.toBe(false);
    expect(DEFAULT_NOTIFICATION_TRANSPORT).toBe('auto');
    expect(DEFAULT_HIDE_CONTENT_ON_LOCK_SCREEN).toBe(false);
  });

  it('reads a stored transport and hide-content value', async () => {
    getItem.mockImplementation((key: string) =>
      Promise.resolve(key === NOTIFICATION_TRANSPORT_KEY ? 'cloud' : 'true'),
    );
    await expect(getNotificationTransport()).resolves.toBe('cloud');
    await expect(getHideContentOnLockScreen()).resolves.toBe(true);
  });

  it('falls back to auto for a malformed stored transport', async () => {
    getItem.mockResolvedValue('bogus');
    await expect(getNotificationTransport()).resolves.toBe('auto');
  });

  it('persists both values under the reserved keys', async () => {
    await setNotificationTransport('off');
    await setHideContentOnLockScreen(true);
    expect(setItem).toHaveBeenCalledWith(NOTIFICATION_TRANSPORT_KEY, 'off');
    expect(setItem).toHaveBeenCalledWith(NOTIFICATION_HIDE_CONTENT_KEY, 'true');
  });

  it('caches after the first read and updates the cache on set', async () => {
    await getNotificationTransport();
    expect(getItem).toHaveBeenCalledTimes(1);

    await setNotificationTransport('direct');
    await expect(getNotificationTransport()).resolves.toBe('direct');
    // No second read: the setter primed the cache.
    expect(getItem).toHaveBeenCalledTimes(1);
  });

  it('never throws when storage fails (defaults survive)', async () => {
    getItem.mockRejectedValue(new Error('boom'));
    await expect(getNotificationTransport()).resolves.toBe('auto');
    await expect(getHideContentOnLockScreen()).resolves.toBe(false);
    setItem.mockRejectedValueOnce(new Error('boom'));
    await expect(setNotificationTransport('cloud')).resolves.toBeUndefined();
  });

  it('loadNotificationSettings returns both values', async () => {
    getItem.mockImplementation((key: string) =>
      Promise.resolve(key === NOTIFICATION_TRANSPORT_KEY ? 'direct' : 'true'),
    );
    await expect(loadNotificationSettings()).resolves.toEqual({
      transport: 'direct',
      hideContentOnLockScreen: true,
    });
  });

  it('isNotificationTransport guards the union', () => {
    expect(isNotificationTransport('auto')).toBe(true);
    expect(isNotificationTransport('off')).toBe(true);
    expect(isNotificationTransport('nope')).toBe(false);
    expect(isNotificationTransport(undefined)).toBe(false);
  });
});
