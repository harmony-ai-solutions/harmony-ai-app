/**
 * DeviceAuthService + DeviceIdProvider tests (D-DEV-01).
 *
 * Covers:
 *   - getDeviceId(): stable per-install UUID, persisted in AsyncStorage
 *   - registerDevice(): client.devices.registerDevice with {deviceId, platform}
 *   - requestCode(): client.devices.requestDeviceAuthCode (202 → code emailed)
 *   - verifyCode(): 200 → resolved; 401 → "incorrect code"; 429 → too many
 *   - getStatus(): client.devices.getDeviceAuthorizationStatus mapping
 *                  ({authorized, authorizationPending}), Phase 4-2
 *
 * Mocks the Soulbits client module (jest.mock pattern from
 * soulbitsModelsCatalog.test.ts): the client factory is stubbed with jest.fn
 * devices-facade methods stashed on the module exports so tests can drive +
 * assert them. Client APIError is mapped to the app-local DeviceAuthError at
 * the service boundary — APIError mapping is tested per method.
 */

// Mock the logger so it doesn't emit after tests finish.
jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

// Mock the Soulbits client. The facade fns are created INSIDE the factory
// (hoisting — outer scope is not visible) and stashed on the module exports.
jest.mock('@harmony-ai-solutions/soulbits-api-client', () => {
  const registerDevice = jest.fn();
  const requestDeviceAuthCode = jest.fn();
  const verifyDeviceAuthCode = jest.fn();
  const getDeviceAuthorizationStatus = jest.fn();

  // Minimal APIError twin so `instanceof APIError` mapping works in tests.
  class MockAPIError extends Error {
    status: number;
    code: string | undefined;
    constructor(status: number, body: Record<string, unknown>) {
      super((body?.error as string | undefined) ?? `HTTP ${status}`);
      this.name = 'APIError';
      this.status = status;
      this.code = body?.error as string | undefined;
    }
  }

  return {
    createClient: () => ({
      devices: {
        registerDevice,
        requestDeviceAuthCode,
        verifyDeviceAuthCode,
        getDeviceAuthorizationStatus,
      },
    }),
    APIError: MockAPIError,
    __registerDevice: registerDevice,
    __requestDeviceAuthCode: requestDeviceAuthCode,
    __verifyDeviceAuthCode: verifyDeviceAuthCode,
    __getDeviceAuthorizationStatus: getDeviceAuthorizationStatus,
    __APIError: MockAPIError,
  };
});

// Mock AuthService — DeviceAuthService now obtains the PASETO via
// AuthService.getToken() (no raw fetch calls anymore).
jest.mock('../../auth/AuthService', () => ({
  __esModule: true,
  default: {
    getToken: jest.fn(async () => 'paseto-test'),
  },
}));

// AsyncStorage mock (jest convention: @react-native-async-storage/async-storage
// ships a built-in mock).
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// uuid v4 requires crypto.getRandomValues — Node ≥19 provides it globally
// (React Native uses react-native-get-random-values at runtime instead).
import * as SoulbitsClient from '@harmony-ai-solutions/soulbits-api-client';
import DeviceAuthService from '../DeviceAuthService';
import { getDeviceId, resetDeviceIdCache } from '../DeviceIdProvider';

const mockRegisterDevice = (SoulbitsClient as any).__registerDevice as jest.Mock;
const mockRequestDeviceAuthCode = (SoulbitsClient as any)
  .__requestDeviceAuthCode as jest.Mock;
const mockVerifyDeviceAuthCode = (SoulbitsClient as any)
  .__verifyDeviceAuthCode as jest.Mock;
const mockGetDeviceAuthorizationStatus = (SoulbitsClient as any)
  .__getDeviceAuthorizationStatus as jest.Mock;
const MockAPIError = (SoulbitsClient as any).__APIError as new (
  status: number,
  body: Record<string, unknown>,
) => Error;

beforeEach(() => {
  mockRegisterDevice.mockReset();
  mockRequestDeviceAuthCode.mockReset();
  mockVerifyDeviceAuthCode.mockReset();
  mockGetDeviceAuthorizationStatus.mockReset();
  resetDeviceIdCache();
});

describe('getDeviceId (DeviceIdProvider)', () => {
  it('generates a stable per-install UUID and persists it', async () => {
    const first = await getDeviceId();
    const second = await getDeviceId();
    expect(first).toBe(second);
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('reuses the persisted id across a cache reset', async () => {
    const first = await getDeviceId();
    resetDeviceIdCache();
    const after = await getDeviceId();
    expect(after).toBe(first);
  });
});

describe('DeviceAuthService.registerDevice', () => {
  it('registers {deviceId, platform} via the client facade on login (first-run)', async () => {
    mockRegisterDevice.mockResolvedValue({
      deviceId: 'dev-1',
      userId: 'user-1',
      platform: 'ios',
      pushToken: null,
      authorized: false,
      authorizedAt: null,
      lastSeenAt: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });

    await expect(DeviceAuthService.registerDevice()).resolves.toBeUndefined();

    expect(mockRegisterDevice).toHaveBeenCalledTimes(1);
    const params = mockRegisterDevice.mock.calls[0][0];
    expect(params.deviceId).toBe(await getDeviceId());
    expect(['android', 'ios', 'web']).toContain(params.platform);
  });

  it('maps a client APIError(400) to DeviceAuthError(400)', async () => {
    mockRegisterDevice.mockRejectedValue(
      new MockAPIError(400, { error: 'device_id is required' }),
    );

    await expect(DeviceAuthService.registerDevice()).rejects.toMatchObject({
      name: 'DeviceAuthError',
      status: 400,
    });
  });
});

describe('DeviceAuthService.requestCode', () => {
  it('requests a code via client.devices.requestDeviceAuthCode (202 → code emailed)', async () => {
    mockRequestDeviceAuthCode.mockResolvedValue({ message: 'code sent' });

    await expect(DeviceAuthService.requestCode()).resolves.toBeUndefined();

    expect(mockRequestDeviceAuthCode).toHaveBeenCalledTimes(1);
    expect(mockRequestDeviceAuthCode.mock.calls[0][0]).toBe(await getDeviceId());
  });

  it('maps a client APIError(429) to DeviceAuthError(429) (rate limit)', async () => {
    mockRequestDeviceAuthCode.mockRejectedValue(
      new MockAPIError(429, { error: 'too many auth code requests, please retry later' }),
    );

    await expect(DeviceAuthService.requestCode()).rejects.toMatchObject({
      status: 429,
    });
  });
});

describe('DeviceAuthService.verifyCode', () => {
  it('verifies via client.devices.verifyDeviceAuthCode (200 → authorized — caller retries /connect)', async () => {
    mockVerifyDeviceAuthCode.mockResolvedValue({ message: 'device authorized' });

    await expect(DeviceAuthService.verifyCode('123456')).resolves.toBeUndefined();

    expect(mockVerifyDeviceAuthCode).toHaveBeenCalledTimes(1);
    const [deviceId, code] = mockVerifyDeviceAuthCode.mock.calls[0];
    expect(deviceId).toBe(await getDeviceId());
    expect(code).toBe('123456');
  });

  it('maps a client APIError(401) to DeviceAuthError(401) on incorrect code', async () => {
    mockVerifyDeviceAuthCode.mockRejectedValue(
      new MockAPIError(401, { error: 'incorrect code' }),
    );

    await expect(DeviceAuthService.verifyCode('000000')).rejects.toMatchObject({
      name: 'DeviceAuthError',
      status: 401,
    });
  });

  it('maps a client APIError(429) to DeviceAuthError(429) after too many wrong attempts', async () => {
    mockVerifyDeviceAuthCode.mockRejectedValue(
      new MockAPIError(429, { error: 'too many incorrect codes, please request a new code' }),
    );

    await expect(DeviceAuthService.verifyCode('111111')).rejects.toMatchObject({
      status: 429,
    });
  });

  it('trims whitespace from the entered code', async () => {
    mockVerifyDeviceAuthCode.mockResolvedValue({ message: 'device authorized' });

    await DeviceAuthService.verifyCode(' 123456 ');

    const [deviceId, code] = mockVerifyDeviceAuthCode.mock.calls[0];
    expect(deviceId).toBe(await getDeviceId());
    expect(code).toBe('123456');
  });
});

describe('DeviceAuthService.getStatus (Phase 4-2)', () => {
  it('maps client.devices.getDeviceAuthorizationStatus to {authorized, authorizationPending}', async () => {
    mockGetDeviceAuthorizationStatus.mockResolvedValue({
      deviceId: 'dev-1',
      authorized: true,
      authorizationPending: false,
    });

    await expect(DeviceAuthService.getStatus()).resolves.toEqual({
      authorized: true,
      authorizationPending: false,
    });

    expect(mockGetDeviceAuthorizationStatus).toHaveBeenCalledTimes(1);
    expect(mockGetDeviceAuthorizationStatus.mock.calls[0][0]).toBe(
      await getDeviceId(),
    );
  });

  it('uses an explicit deviceId when provided', async () => {
    mockGetDeviceAuthorizationStatus.mockResolvedValue({
      deviceId: 'other-device',
      authorized: false,
      authorizationPending: true,
    });

    const result = await DeviceAuthService.getStatus('other-device');

    expect(result).toEqual({ authorized: false, authorizationPending: true });
    expect(mockGetDeviceAuthorizationStatus.mock.calls[0][0]).toBe('other-device');
  });

  it('maps a client APIError(404) to DeviceAuthError(404) (unknown device)', async () => {
    mockGetDeviceAuthorizationStatus.mockRejectedValue(
      new MockAPIError(404, { error: 'device not found' }),
    );

    await expect(DeviceAuthService.getStatus()).rejects.toMatchObject({
      name: 'DeviceAuthError',
      status: 404,
    });
  });
});
