/**
 * AuthService.enrollDevice — delegated device enrollment (plan 7-15 E2).
 *
 * Proves the enrollment exchange (a) posts the grant + device fields to
 * `POST /v1/auth/device/enroll` and (b) persists the returned session through
 * the SAME `handleTokenResponse` path every login uses (no parallel token path).
 */

import AuthService from '../AuthService';
import { AUTH_ENDPOINTS } from '../../../config/cloud';

const TOKEN_RESPONSE = {
  token: 'new-paseto',
  refresh_token: 'new-refresh',
  expires_at: '2026-10-15T12:00:00Z',
};

const PARAMS = { grant: 'g1', deviceId: 'dev-1', deviceName: 'Pixel', platform: 'android' };

beforeEach(() => {
  (global as any).fetch = jest.fn();
});

describe('AuthService.enrollDevice', () => {
  it('posts the grant + device fields to the device-enroll endpoint', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => TOKEN_RESPONSE,
    });

    await AuthService.enrollDevice(PARAMS);

    expect(global.fetch).toHaveBeenCalledWith(
      AUTH_ENDPOINTS.deviceEnroll,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant: 'g1',
          device_id: 'dev-1',
          device_name: 'Pixel',
          platform: 'android',
        }),
      }),
    );
  });

  it('persists the returned session through the standard token path', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => TOKEN_RESPONSE,
    });

    await AuthService.enrollDevice(PARAMS);

    await expect(AuthService.getToken()).resolves.toBe('new-paseto');
    expect(AuthService.getTokenExpiresAt()).toBe(Date.parse(TOKEN_RESPONSE.expires_at));
  });

  it('throws AuthError (with status) on a rejected grant', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'enrollment_grant_invalid' }),
    });

    await expect(AuthService.enrollDevice(PARAMS)).rejects.toMatchObject({
      name: 'AuthError',
      status: 401,
    });
  });
});
