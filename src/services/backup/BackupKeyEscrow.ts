/**
 * BackupKeyEscrow — the W1 account-escrow client (plan 2-5 endpoint, consumed
 * by 2-6).
 *
 * The SoulbitsCloud account service stores a locked copy of the backup DEK at
 * `PUT/GET/DELETE /v1/account/backup-key` (PASETO-authenticated; the server
 * KMS-wraps the client blob at rest). This is what makes Android "sign in and
 * restore" work — Android has no synced app-secret store, so W1 is its only
 * zero-effort unlock path. The honest claim (research §3.5): Soulbits holds only
 * a locked copy of the key; it cannot read the backup without attacking the
 * account infrastructure.
 */

import { CLOUD_HOSTS } from '../../config/cloud';
import { createLogger } from '../../utils/logger';

const log = createLogger('[BackupKeyEscrow]');

/** Minimal fetch surface (injectable for tests). */
export type EscrowFetch = (url: string, init?: RequestInit) => Promise<Response>;

/** The account backup-key escrow path. */
export const BACKUP_KEY_PATH = '/v1/account/backup-key';

export interface BackupKeyEscrowOptions {
  /** The current cloud PASETO (v4.local). */
  paseto: string;
  /** Base URL override (defaults to the resolved cloud session/auth host). */
  baseUrl?: string;
  /** Fetch override (tests). */
  fetchImpl?: EscrowFetch;
}

export class BackupKeyEscrow {
  private readonly paseto: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: EscrowFetch;

  constructor(opts: BackupKeyEscrowOptions) {
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

  /**
   * Store the DEK (base64) as the account's escrowed backup key. The engine's
   * `GET /api/backup/key` returns the DEK for exactly this call.
   */
  async put(dekBase64: string): Promise<void> {
    const res = await this.fetchImpl(`${this.baseUrl}${BACKUP_KEY_PATH}`, {
      method: 'PUT',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ wrapped_key: dekBase64 }),
    });
    if (!res.ok) {
      throw new Error(`Backup key escrow PUT failed (${res.status})`);
    }
  }

  /** Fetch the escrowed DEK (base64), or null when none is stored. */
  async get(): Promise<string | null> {
    const res = await this.fetchImpl(`${this.baseUrl}${BACKUP_KEY_PATH}`, {
      method: 'GET',
      headers: this.headers(),
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`Backup key escrow GET failed (${res.status})`);
    }
    const body = (await res.json()) as { wrapped_key?: string; status?: string };
    return body.wrapped_key ?? null;
  }

  /** Delete the escrowed key (account-deletion / user opt-out). Idempotent. */
  async remove(): Promise<void> {
    const res = await this.fetchImpl(`${this.baseUrl}${BACKUP_KEY_PATH}`, {
      method: 'DELETE',
      headers: this.headers(),
    });
    if (!res.ok && res.status !== 404) {
      log.warn(`Backup key escrow DELETE returned ${res.status}`);
    }
  }
}
