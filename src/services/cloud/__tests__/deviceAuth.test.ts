/**
 * DeviceAuthService + DeviceIdProvider tests (D-DEV-01).
 *
 * Covers:
 *   - getDeviceId(): stable per-install UUID, persisted in AsyncStorage
 *   - registerDevice(): POST /v1/devices with {device_id, platform}
 *   - requestCode(): POST /v1/devices/authorize without code (202 → code mailed)
 *   - verifyCode(): 200 → resolved; 401 → "incorrect code"; 429 → too many
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

// Mock AuthService.fetch — the only HTTP client used by DeviceAuthService.
jest.mock('../../auth/AuthService', () => ({
  __esModule: true,
  default: {
    fetch: jest.fn(),
  },
}));

// AsyncStorage mock (jest convention: @react-native-async-storage/async-storage
// ships a built-in mock).
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// uuid v4 requires crypto.getRandomValues — Node ≥19 provides it globally
// (React Native uses react-native-get-random-values at runtime instead).
import DeviceAuthService from '../DeviceAuthService';
import { getDeviceId, resetDeviceIdCache } from '../DeviceIdProvider';
import AuthService from '../../auth/AuthService';

const mockFetch = AuthService.fetch as jest.Mock;

/** Build a minimal fetch Response for the given status + body. */
function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  mockFetch.mockReset();
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
  it('POSTs {device_id, platform} to /v1/devices on login (first-run)', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { device: { authorized: false } }));

    await expect(DeviceAuthService.registerDevice()).resolves.toBeUndefined();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toMatch(/\/v1\/devices$/);
    const body = JSON.parse(init.body as string);
    expect(body.device_id).toBe(await getDeviceId());
    expect(['android', 'ios', 'web']).toContain(body.platform);
  });

  it('throws DeviceAuthError on non-ok registration', async () => {
    mockFetch.mockResolvedValue(jsonResponse(400, { error: 'device_id is required' }));

    await expect(DeviceAuthService.registerDevice()).rejects.toMatchObject({
      name: 'DeviceAuthError',
      status: 400,
    });
  });
});

describe('DeviceAuthService.requestCode', () => {
  it('POSTs {device_id} without code → 202 (code emailed)', async () => {
    mockFetch.mockResolvedValue(jsonResponse(202, { message: 'code sent' }));

    await expect(DeviceAuthService.requestCode()).resolves.toBeUndefined();

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toMatch(/\/v1\/devices\/authorize$/);
    const body = JSON.parse(init.body as string);
    expect(body.device_id).toBe(await getDeviceId());
    expect(body.code).toBeUndefined();
  });

  it('surfaces 429 rate-limit as DeviceAuthError(429)', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(429, { error: 'too many auth code requests, please retry later' }),
    );

    await expect(DeviceAuthService.requestCode()).rejects.toMatchObject({
      status: 429,
    });
  });
});

describe('DeviceAuthService.verifyCode', () => {
  it('resolves on 200 (device authorized — caller retries /connect)', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { message: 'device authorized' }));

    await expect(DeviceAuthService.verifyCode('123456')).resolves.toBeUndefined();

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toMatch(/\/v1\/devices\/authorize$/);
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ device_id: await getDeviceId(), code: '123456' });
  });

  it('throws DeviceAuthError(401) on incorrect code', async () => {
    mockFetch.mockResolvedValue(jsonResponse(401, { error: 'incorrect code' }));

    await expect(DeviceAuthService.verifyCode('000000')).rejects.toMatchObject({
      name: 'DeviceAuthError',
      status: 401,
    });
  });

  it('throws DeviceAuthError(429) after too many wrong attempts', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(429, { error: 'too many incorrect codes, please request a new code' }),
    );

    await expect(DeviceAuthService.verifyCode('111111')).rejects.toMatchObject({
      status: 429,
    });
  });

  it('trims whitespace from the entered code', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { message: 'device authorized' }));

    await DeviceAuthService.verifyCode(' 123456 ');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.code).toBe('123456');
  });
});
