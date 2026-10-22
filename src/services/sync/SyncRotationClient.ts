/**
 * SyncRotationClient — the account-side "rotation required" flag (plan 7-3;
 * cloud side lands in 7-4).
 *
 * The portal triggers a sync-key rotation (e.g. on device revoke); the cloud
 * records a flag the app reads on sync-screen open and after pairing. When set,
 * the app relays `POST /api/sync/group/rotation-required {required:true}` to the
 * engine (the engine is authoritative for the actual rotation — a surviving
 * member mints the new key on the next `rotate`), then clears the flag via
 * `DELETE` once it has rotated + re-wrapped + re-escrowed.
 *
 * Endpoints (PASETO-authenticated):
 *   GET    /v1/account/sync-rotation-required  → { required: boolean }
 *   DELETE /v1/account/sync-rotation-required
 */

import { CLOUD_HOSTS } from '../../config/cloud';
import { createLogger } from '../../utils/logger';
import type { EscrowFetch } from '../backup/BackupKeyEscrow';

const log = createLogger('[SyncRotation]');

/** The account sync-rotation-required path. */
export const SYNC_ROTATION_REQUIRED_PATH = '/v1/account/sync-rotation-required';

export interface SyncRotationClientOptions {
  /** The current cloud PASETO (v4.local). */
  paseto: string;
  /** Base URL override (defaults to the resolved cloud session/auth host). */
  baseUrl?: string;
  /** Fetch override (tests). */
  fetchImpl?: EscrowFetch;
}

export class SyncRotationClient {
  private readonly paseto: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: EscrowFetch;

  constructor(opts: SyncRotationClientOptions) {
    this.paseto = opts.paseto;
    this.baseUrl = (opts.baseUrl ?? CLOUD_HOSTS.session).replace(/\/$/, '');
    this.fetchImpl =
      opts.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : (undefined as unknown as EscrowFetch));
  }

  private headers(): Record<string, string> {
    return {
      Accept: 'application/json',
      Authorization: `Bearer ${this.paseto}`,
    };
  }

  /** Read the rotation-required flag (false when unset/absent). */
  async getRequired(): Promise<boolean> {
    const res = await this.fetchImpl(`${this.baseUrl}${SYNC_ROTATION_REQUIRED_PATH}`, {
      method: 'GET',
      headers: this.headers(),
    });
    if (res.status === 404) return false;
    if (!res.ok) {
      throw new Error(`Sync rotation-required GET failed (${res.status})`);
    }
    const body = (await res.json()) as { required?: boolean };
    return body.required === true;
  }

  /** Clear the rotation-required flag after a successful rotation + re-escrow. */
  async clear(): Promise<void> {
    const res = await this.fetchImpl(`${this.baseUrl}${SYNC_ROTATION_REQUIRED_PATH}`, {
      method: 'DELETE',
      headers: this.headers(),
    });
    if (!res.ok && res.status !== 404) {
      log.warn(`Sync rotation-required DELETE returned ${res.status}`);
    }
  }
}
