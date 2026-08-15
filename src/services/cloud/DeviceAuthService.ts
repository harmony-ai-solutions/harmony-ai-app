/**
 * DeviceAuthService — device registration + email auth-code flow (D-DEV-01).
 *
 * Talks to the auth-service device endpoints via the typed Soulbits client's
 * `devices` facade (Phase 4-2 — replaced the raw AuthService.fetch calls):
 *   - registerDevice()            → client.devices.registerDevice (upsert,
 *                                   authorized=false default)
 *   - requestCode()               → client.devices.requestDeviceAuthCode (202 →
 *                                   SES mails a 6-digit code + approval button)
 *   - verifyCode(code)            → client.devices.verifyDeviceAuthCode
 *                                   (200 → authorized; 401 wrong/expired code;
 *                                   429 attempt limit)
 *   - getStatus(deviceId?)        → client.devices.getDeviceAuthorizationStatus
 *                                   ({ authorized, authorizationPending }) —
 *                                   used by the modal's auto-resolve polling
 *
 * Client construction mirrors CloudSessionService: the client is built
 * PASETO-only (no refresh) per call from AuthService.getToken(), so the
 * app-owned refresh lifecycle stays the single source of truth. Client
 * `APIError`s are mapped to the app-local `DeviceAuthError` at the service
 * boundary so the modal's existing `err.status` branches keep working.
 */

import { Platform } from 'react-native';
import { APIError } from '@harmony-ai-solutions/soulbits-api-client';
import AuthService from '../auth/AuthService';
import { buildSoulbitsClient } from './soulbitsClient';
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

/** The device platform sent to the backend (valid: android | ios | web). */
function devicePlatform(): 'android' | 'ios' | 'web' {
  return Platform.OS === 'web' ? 'web' : (Platform.OS as 'android' | 'ios');
}

/**
 * Map a client APIError (or any thrown value) into the app-local
 * DeviceAuthError at the service boundary. The client's APIError carries the
 * HTTP `status` + a `code` that is the auth-service error message — both are
 * preserved on DeviceAuthError so the modal keeps branching on `err.status`.
 */
function toDeviceAuthError(action: string, e: unknown): DeviceAuthError {
  if (e instanceof APIError) {
    return new DeviceAuthError(action, e.code ?? e.message, e.status);
  }
  if (e instanceof DeviceAuthError) {
    return e;
  }
  const message = e instanceof Error ? e.message : String(e);
  return new DeviceAuthError(action, message);
}

// ── Service ─────────────────────────────────────────────────────────────────

class DeviceAuthServiceClass {
  /**
   * Register the per-install device row (client.devices.registerDevice).
   * First-run flow: the device registers on login with authorized=false and the
   * user completes the email-code flow on the first /connect from this device.
   *
   * Idempotent — the backend upserts on (user_id, platform, device_id) and
   * keeps the existing authorization state for a known device.
   */
  async registerDevice(): Promise<void> {
    const deviceId = await getDeviceId();
    try {
      const paseto = await AuthService.getToken();
      await buildSoulbitsClient({ paseto }).devices.registerDevice({
        deviceId,
        platform: devicePlatform(),
        // pushToken is added when the FCM token resolves (future); the
        // backend accepts an absent token.
      });
      log.info('Device registered:', deviceId);
    } catch (e) {
      throw toDeviceAuthError('registerDevice', e);
    }
  }

  /**
   * Request a fresh 6-digit email auth code (client.devices.requestDeviceAuthCode).
   * The auth-service SES-mails the code + an approval button link to the user's
   * email. Resolves on 202. 429 → rate-limited (per-email 3/min).
   */
  async requestCode(): Promise<void> {
    const deviceId = await getDeviceId();
    try {
      const paseto = await AuthService.getToken();
      await buildSoulbitsClient({ paseto }).devices.requestDeviceAuthCode(deviceId);
      log.info('Device auth code requested for:', deviceId);
    } catch (e) {
      throw toDeviceAuthError('requestCode', e);
    }
  }

  /**
   * Verify the 6-digit email code (client.devices.verifyDeviceAuthCode).
   * On 200 the device is authorized and the caller retries /connect.
   * On 401 the code was wrong (or expired) — show "invalid code".
   * On 429 the attempt limit was exceeded — show "too many attempts, try later".
   */
  async verifyCode(code: string): Promise<void> {
    const deviceId = await getDeviceId();
    try {
      const paseto = await AuthService.getToken();
      await buildSoulbitsClient({ paseto }).devices.verifyDeviceAuthCode(
        deviceId,
        code.trim(),
      );
      log.info('Device authorized:', deviceId);
    } catch (e) {
      throw toDeviceAuthError('verifyCode', e);
    }
  }

  /**
   * Poll the device authorization state (client.devices.getDeviceAuthorizationStatus).
   * Used by the modal's 5 s auto-resolve polling: when `authorized` flips true
   * the modal closes itself. `authorizationPending` is true while a code/token
   * pair is still outstanding for this device.
   *
   * @param deviceId Optional explicit device id — defaults to the per-install id.
   * @returns { authorized, authorizationPending } (camelCase, as mapped by the
   *          client facade from the wire's snake_case).
   * @throws {DeviceAuthError} — 404/400 surface to the modal's error UI;
   *           transient 5xx/429 are ignored by the polling loop.
   */
  async getStatus(deviceId?: string): Promise<{
    authorized: boolean;
    authorizationPending: boolean;
  }> {
    const id = deviceId ?? (await getDeviceId());
    try {
      const paseto = await AuthService.getToken();
      const status = await buildSoulbitsClient({ paseto }).devices.getDeviceAuthorizationStatus(id);
      return {
        authorized: status.authorized,
        authorizationPending: status.authorizationPending,
      };
    } catch (e) {
      throw toDeviceAuthError('getStatus', e);
    }
  }
}

// ── Singleton export ────────────────────────────────────────────────────────

const DeviceAuthService = new DeviceAuthServiceClass();
export default DeviceAuthService;
