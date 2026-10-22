/**
 * NotificationPermission — unit tests (task 5-1 add-on).
 *
 * Exercises the JS wrapper against a mocked native `SoulbitsNotifications`
 * bridge: authorization request/status, graceful degradation when the bridge is
 * absent or throws, and the `isNotificationAuthorized` truth table.
 */

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { NativeModules, Platform } from 'react-native';
import {
  getNotificationAuthorizationStatus,
  isNotificationAuthorized,
  isNotificationPermissionSupported,
  requestNotificationPermission,
} from '../NotificationPermission';

const nativeModules = NativeModules as Record<string, unknown>;

function installBridge(overrides: Record<string, unknown> = {}) {
  nativeModules.SoulbitsNotifications = {
    requestAuthorization: jest.fn(() => Promise.resolve('authorized')),
    getAuthorizationStatus: jest.fn(() => Promise.resolve('authorized')),
    ...overrides,
  };
}

const originalPlatformOS = Platform.OS;

afterEach(() => {
  delete nativeModules.SoulbitsNotifications;
  (Platform as { OS: string }).OS = originalPlatformOS;
});

describe('NotificationPermission', () => {
  it('reports support when the native bridge is present (iOS)', () => {
    installBridge();
    expect(isNotificationPermissionSupported()).toBe(true);
  });

  it('reports support when the native bridge is present (Android — parity)', () => {
    installBridge();
    (Platform as { OS: string }).OS = 'android';
    expect(isNotificationPermissionSupported()).toBe(true);
  });

  it('reports no support when the bridge lacks the request method', () => {
    nativeModules.SoulbitsNotifications = { getAuthorizationStatus: jest.fn() };
    expect(isNotificationPermissionSupported()).toBe(false);
  });

  it('reports no support when the bridge is absent and no-ops gracefully', async () => {
    expect(isNotificationPermissionSupported()).toBe(false);
    await expect(requestNotificationPermission()).resolves.toBe('unavailable');
    await expect(getNotificationAuthorizationStatus()).resolves.toBe('unavailable');
  });

  it('reports no support on an unsupported platform even if the module exists', async () => {
    installBridge();
    (Platform as { OS: string }).OS = 'web';
    expect(isNotificationPermissionSupported()).toBe(false);
    await expect(requestNotificationPermission()).resolves.toBe('unavailable');
  });

  it('routes to the bridge on Android through the same path as iOS', async () => {
    installBridge({
      requestAuthorization: jest.fn(() => Promise.resolve('authorized')),
      getAuthorizationStatus: jest.fn(() => Promise.resolve('denied')),
    });
    (Platform as { OS: string }).OS = 'android';
    await expect(requestNotificationPermission()).resolves.toBe('authorized');
    await expect(getNotificationAuthorizationStatus()).resolves.toBe('denied');
  });

  it('returns the granted status from requestAuthorization', async () => {
    installBridge({ requestAuthorization: jest.fn(() => Promise.resolve('authorized')) });
    await expect(requestNotificationPermission()).resolves.toBe('authorized');
  });

  it('returns denied without throwing when the user declines', async () => {
    installBridge({ requestAuthorization: jest.fn(() => Promise.resolve('denied')) });
    await expect(requestNotificationPermission()).resolves.toBe('denied');
  });

  it('degrades to unavailable when the bridge rejects', async () => {
    installBridge({
      requestAuthorization: jest.fn(() => Promise.reject(new Error('boom'))),
      getAuthorizationStatus: jest.fn(() => Promise.reject(new Error('boom'))),
    });
    await expect(requestNotificationPermission()).resolves.toBe('unavailable');
    await expect(getNotificationAuthorizationStatus()).resolves.toBe('unavailable');
  });

  it('reads the current status without prompting', async () => {
    installBridge({ getAuthorizationStatus: jest.fn(() => Promise.resolve('provisional')) });
    await expect(getNotificationAuthorizationStatus()).resolves.toBe('provisional');
  });

  it('isNotificationAuthorized allows banner-capable statuses only', () => {
    expect(isNotificationAuthorized('authorized')).toBe(true);
    expect(isNotificationAuthorized('provisional')).toBe(true);
    expect(isNotificationAuthorized('ephemeral')).toBe(true);
    expect(isNotificationAuthorized('denied')).toBe(false);
    expect(isNotificationAuthorized('notDetermined')).toBe(false);
    expect(isNotificationAuthorized('unavailable')).toBe(false);
  });
});
