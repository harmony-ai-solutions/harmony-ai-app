/**
 * DeviceAuthService — device registration + email auth-code flow (D-DEV-01).
 *
 * Talks to the auth-service device endpoints:
 *   - POST /v1/devices            RegisterDevice (upsert, authorized=false default)
 *   - POST /v1/devices/authorize  RequestDeviceAuthCode (no code → SES mails a
 *                                 6-digit code to the user's email)
 *   - POST /v1/devices/authorize  VerifyDeviceAuthCode ({device_id, code})
 *
 * All endpoints are PASETO-protected; requests go through AuthService.fetch
 * (transparent 401 → refresh → retry), reusing the app's existing HTTP client —
 * no new client is introduced.
 *
 * Status mapping for VerifyDeviceAuthCode:
 *   200 → device authorized (caller retries /connect)
 *   401 → "incorrect code" / "no auth code pending — request a new one"
 *   429 → "too many incorrect codes, please request a new code"
 */

import { Platform } from 'react-native';
import { CLOUD_HOSTS } from '../../config/cloud';
import AuthService from '../auth/AuthService';
import { getDeviceId } from './DeviceIdProvider';
import { createLogger } from '../../utils/logger';

const log = createLogger('[DeviceAuth]');

// ── Error type ──────────────────────────────────────────────────────────────

export class DeviceAuthError extends Error {
  constructor(
    public readonly action: string,
    message: string,
    public readonly status?: number,
  ) {
    super(`Device auth ${action} failed: ${message}`);
    this.name = 'DeviceAuthError';
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function parseErrorBody(
  res: Response,
): Promise<{ error?: string } | null> {
  try {
    return (await res.json()) as { error?: string };
  } catch {
    return null;
  }
}

/** The device platform sent to the backend (valid: android | ios | web). */
function devicePlatform(): string {
  return Platform.OS === 'web' ? 'web' : Platform.OS;
}

// ── Service ─────────────────────────────────────────────────────────────────

class DeviceAuthServiceClass {
  /**
   * Register the per-install device row (POST /v1/devices). First-run flow:
   * the device registers on login with authorized=false and the user completes
   * the email-code flow on the first /connect from this device.
   *
   * Idempotent — the backend upserts on (user_id, platform, device_id) and
   * keeps the existing authorization state for a known device.
   */
  async registerDevice(): Promise<void> {
    const deviceId = await getDeviceId();
    const res = await AuthService.fetch(`${CLOUD_HOSTS.auth}/v1/devices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: deviceId,
        platform: devicePlatform(),
        // push_token is added when the FCM token resolves (future); the
        // backend accepts an absent token.
      }),
    });

    if (!res.ok) {
      const body = await parseErrorBody(res);
      throw new DeviceAuthError(
        'registerDevice',
        body?.error ?? `HTTP ${res.status}`,
        res.status,
      );
    }
    log.info('Device registered:', deviceId);
  }

  /**
   * Request a fresh 6-digit email auth code (POST /v1/devices/authorize with
   * no code). The auth-service SES-mails the code to the user's email.
   * Returns 202 on success. 429 → rate-limited (per-email 3/min).
   */
  async requestCode(): Promise<void> {
    const deviceId = await getDeviceId();
    const res = await AuthService.fetch(`${CLOUD_HOSTS.auth}/v1/devices/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: deviceId }),
    });

    if (res.status !== 202) {
      const body = await parseErrorBody(res);
      throw new DeviceAuthError(
        'requestCode',
        body?.error ?? `HTTP ${res.status}`,
        res.status,
      );
    }
    log.info('Device auth code requested for:', deviceId);
  }

  /**
   * Verify the 6-digit email code (POST /v1/devices/authorize with code).
   * On 200 the device is authorized and the caller retries /connect.
   * On 401 the code was wrong (or expired) — show "invalid code".
   * On 429 the attempt limit was exceeded — show "too many attempts, try later".
   */
  async verifyCode(code: string): Promise<void> {
    const deviceId = await getDeviceId();
    const res = await AuthService.fetch(`${CLOUD_HOSTS.auth}/v1/devices/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: deviceId, code: code.trim() }),
    });

    if (res.ok) {
      log.info('Device authorized:', deviceId);
      return;
    }
    const body = await parseErrorBody(res);
    throw new DeviceAuthError(
      'verifyCode',
      body?.error ?? `HTTP ${res.status}`,
      res.status,
    );
  }
}

// ── Singleton export ────────────────────────────────────────────────────────

const DeviceAuthService = new DeviceAuthServiceClass();
export default DeviceAuthService;
