/**
 * SyncGroupOrchestrator — the app-side driver of the sync-group key lifecycle
 * (plan 7-3). It ties the three moving parts together and keeps them out of the
 * screen:
 *
 *   - the engine's `/api/sync/group/*` routes (7-2) — mint / import / rotate;
 *   - the account **escrow** slot (`/v1/account/sync-key`, 7-4) — where the app
 *     "wraps" (server-side KMS, W1-style) and later recovers the RAW group key;
 *   - the account **rotation-required** flag (`/v1/account/sync-rotation-required`,
 *     7-4) — read on screen open + after pairing, relayed to the engine, cleared
 *     after a successful rotation.
 *
 * The engine never holds Soulbits credentials: it returns the RAW group key and
 * the app does the account calls with the signed-in PASETO. All external calls
 * are injected so the unit suite mocks them (per 2-5/2-6 patterns).
 */

import { engineApiClient } from '../engine/EngineApiClient';
import type {
  SyncGroupKeyStatusDto,
  SyncClientStatusDto,
  SyncClientConfigPatchDto,
} from '../engine/EngineApiClient';
import AuthService from '../auth/AuthService';
import { SyncKeyEscrow } from './SyncKeyEscrow';
import { SyncRotationClient } from './SyncRotationClient';
import type { EscrowFetch } from '../backup/BackupKeyEscrow';
import { createLogger } from '../../utils/logger';

const log = createLogger('[SyncGroup]');

/** The engine surface the orchestrator needs (narrowed for test injection). */
export interface SyncGroupEngine {
  getSyncGroupKeyStatus(): Promise<SyncGroupKeyStatusDto>;
  initSyncGroup(): Promise<SyncGroupKeyStatusDto>;
  importSyncGroup(groupKeyBase64: string): Promise<SyncGroupKeyStatusDto>;
  rotateSyncGroup(): Promise<SyncGroupKeyStatusDto>;
  setSyncGroupRotationRequired(required: boolean): Promise<SyncGroupKeyStatusDto>;
  updateSyncClientConfig(partial: SyncClientConfigPatchDto): Promise<SyncClientStatusDto>;
}

export interface SyncGroupOrchestratorDeps {
  /** Returns the current cloud PASETO, or null when signed out. */
  getPaseto?: () => Promise<string | null>;
  /** The engine client (defaults to the shared singleton). */
  engine?: SyncGroupEngine;
  /** Builds the escrow client for a PASETO (tests inject a fetch). */
  escrowFactory?: (paseto: string, fetchImpl?: EscrowFetch) => SyncKeyEscrow;
  /** Builds the rotation-flag client for a PASETO (tests inject a fetch). */
  rotationFactory?: (paseto: string, fetchImpl?: EscrowFetch) => SyncRotationClient;
}

/** Outcome of a create/join attempt. */
export interface SyncGroupActionResult {
  /** `created` = first device minted + escrowed; `joined` = imported; `already_member`. */
  action: 'created' | 'joined' | 'already_member';
  /** The engine's post-action key status. */
  keyStatus: SyncGroupKeyStatusDto;
}

/** Raised when a group action needs a signed-in account but none is present. */
export class SyncGroupAuthError extends Error {
  constructor(message = 'Sign in to your SoulbitsCloud account to use cloud sync') {
    super(message);
    this.name = 'SyncGroupAuthError';
  }
}

export class SyncGroupOrchestrator {
  private readonly getPaseto: () => Promise<string | null>;
  private readonly engine: SyncGroupEngine;
  private readonly escrowFactory: (paseto: string, fetchImpl?: EscrowFetch) => SyncKeyEscrow;
  private readonly rotationFactory: (paseto: string, fetchImpl?: EscrowFetch) => SyncRotationClient;

  constructor(deps: SyncGroupOrchestratorDeps = {}) {
    this.getPaseto = deps.getPaseto ?? (async () => null);
    this.engine = deps.engine ?? (engineApiClient as unknown as SyncGroupEngine);
    this.escrowFactory = deps.escrowFactory ?? ((paseto, fetchImpl) => new SyncKeyEscrow({ paseto, fetchImpl }));
    this.rotationFactory =
      deps.rotationFactory ?? ((paseto, fetchImpl) => new SyncRotationClient({ paseto, fetchImpl }));
  }

  private async requirePaseto(): Promise<string> {
    const paseto = await this.getPaseto().catch(() => null);
    if (!paseto) throw new SyncGroupAuthError();
    return paseto;
  }

  /** Read the engine's sync-group key state (never key material). */
  keyStatus(): Promise<SyncGroupKeyStatusDto> {
    return this.engine.getSyncGroupKeyStatus();
  }

  /**
   * First-device path: mint the group key on the engine, then escrow it. Also
   * clears any stale `group_join_pending` flag so the engine settles into
   * `member`. No-op (returns `already_member`) when the engine already holds a key.
   */
  async startCloudSync(): Promise<SyncGroupActionResult> {
    const current = await this.engine.getSyncGroupKeyStatus();
    if (current.has_key || current.state === 'member') {
      return { action: 'already_member', keyStatus: current };
    }

    const paseto = await this.requirePaseto();
    const created = await this.engine.initSyncGroup();
    const raw = created.group_key_base64;
    if (!raw) {
      throw new Error('engine did not return a group key');
    }
    // "Wrap" is server-side (W1 KMS envelope) — the app PUTs the raw key.
    await this.escrowFactory(paseto).put(raw);
    // Clear the joining flag so a fresh first device is a plain member.
    await this.engine
      .updateSyncClientConfig({ group_join_pending: false })
      .catch(e => log.warn('group_join_pending clear failed (non-fatal):', e));
    return { action: 'created', keyStatus: created };
  }

  /**
   * Joining-device path: mark the engine as a joining member (drives
   * `key_pending`), recover the RAW group key from the account escrow, and
   * install it via `/api/sync/group/import`.
   */
  async joinCloudSync(): Promise<SyncGroupActionResult> {
    const paseto = await this.requirePaseto();
    await this.engine
      .updateSyncClientConfig({ group_join_pending: true })
      .catch(e => log.warn('group_join_pending set failed (non-fatal):', e));
    const raw = await this.escrowFactory(paseto).get();
    if (!raw) {
      throw new Error('no escrowed sync key yet — start cloud sync on another device first');
    }
    const imported = await this.engine.importSyncGroup(raw);
    return { action: 'joined', keyStatus: imported };
  }

  /**
   * Danger-zone "Reset sync key": rotate on the engine (engine-authoritative),
   * re-escrow the new RAW key, then clear the account rotation-required flag.
   * Other devices re-baseline on their next connect.
   */
  async resetSyncKey(): Promise<SyncGroupKeyStatusDto> {
    const paseto = await this.requirePaseto();
    const rotated = await this.engine.rotateSyncGroup();
    const raw = rotated.group_key_base64;
    if (!raw) {
      throw new Error('engine did not return a rotated group key');
    }
    await this.escrowFactory(paseto).put(raw);
    await this.rotationFactory(paseto).clear().catch(e => log.warn('rotation flag clear failed:', e));
    return rotated;
  }

  /**
   * Read the account rotation-required flag. Returns false when signed out (the
   * flag is an account-scoped concept).
   */
  async readRotationRequired(): Promise<boolean> {
    const paseto = await this.getPaseto().catch(() => null);
    if (!paseto) return false;
    return this.rotationFactory(paseto).getRequired();
  }

  /** Relay the rotation-required flag to the engine (the engine mints on rotate). */
  relayRotationRequired(required: boolean): Promise<SyncGroupKeyStatusDto> {
    return this.engine.setSyncGroupRotationRequired(required);
  }
}

/** The shared singleton (used by the sync screen). */
export const syncGroupOrchestrator = new SyncGroupOrchestrator({
  getPaseto: async () => AuthService.getToken().catch(() => null),
});
