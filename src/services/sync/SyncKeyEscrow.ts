/**
 * SyncKeyEscrow — the W1 account-escrow client for the sync-group key slot
 * (plan 7-3; cloud side lands in 7-4).
 *
 * This is the **sibling slot** of `services/backup/BackupKeyEscrow`: exactly the
 * same mechanism (the app PUTs the raw base64 key material as `wrapped_key`; the
 * account service KMS-wraps it at rest under a server-side KEK — the app never
 * sees the wrap), on a distinct route so the sync-group key and the backup DEK
 * never collide. The engine (7-2) mints/returns the RAW group key and the app
 * wraps + escrows it here; a joining device GETs it back and injects it into the
 * engine's `/api/sync/group/import`.
 *
 * Endpoints (PASETO-authenticated, mirroring 2-5's backup-key slot):
 *   PUT    /v1/account/sync-key   { wrapped_key }
 *   GET    /v1/account/sync-key   → { wrapped_key } | 404
 *   DELETE /v1/account/sync-key
 */

import { CLOUD_HOSTS } from '../../config/cloud';
import { createLogger } from '../../utils/logger';
import type { EscrowFetch } from '../backup/BackupKeyEscrow';

const log = createLogger('[SyncKeyEscrow]');

/** The account sync-key escrow path. */
export const SYNC_KEY_PATH = '/v1/account/sync-key';

export interface SyncKeyEscrowOptions {
  /** The current cloud PASETO (v4.local). */
  paseto: string;
  /** Base URL override (defaults to the resolved cloud session/auth host). */
  baseUrl?: string;
  /** Fetch override (tests). */
  fetchImpl?: EscrowFetch;
}

export class SyncKeyEscrow {
  private readonly paseto: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: EscrowFetch;

  constructor(opts: SyncKeyEscrowOptions) {
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
   * Store the sync-group key (base64) as the account's escrowed sync key. The
   * engine's `/api/sync/group/init` (first device) or `/rotate` returns the RAW
   * key for exactly this call.
   */
  async put(groupKeyBase64: string): Promise<void> {
    const res = await this.fetchImpl(`${this.baseUrl}${SYNC_KEY_PATH}`, {
      method: 'PUT',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ wrapped_key: groupKeyBase64 }),
    });
    if (!res.ok) {
      throw new Error(`Sync key escrow PUT failed (${res.status})`);
    }
  }

  /** Fetch the escrowed sync-group key (base64), or null when none is stored. */
  async get(): Promise<string | null> {
    const res = await this.fetchImpl(`${this.baseUrl}${SYNC_KEY_PATH}`, {
      method: 'GET',
      headers: this.headers(),
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`Sync key escrow GET failed (${res.status})`);
    }
    const body = (await res.json()) as { wrapped_key?: string; status?: string };
    return body.wrapped_key ?? null;
  }

  /** Delete the escrowed sync key (revoke / user opt-out). Idempotent. */
  async remove(): Promise<void> {
    const res = await this.fetchImpl(`${this.baseUrl}${SYNC_KEY_PATH}`, {
      method: 'DELETE',
      headers: this.headers(),
    });
    if (!res.ok && res.status !== 404) {
      log.warn(`Sync key escrow DELETE returned ${res.status}`);
    }
  }
}
