/**
 * BackupOrchestrator — the app-side coordinator for user-owned-storage backup
 * & restore (plan 2-6 step 2/3).
 *
 * It owns: settings persistence (AsyncStorage), credential resolution
 * (keychain), the W1 escrow call, target-descriptor construction for the
 * engine, the manual/automatic run, the restore unlock-material resolution, and
 * (re)scheduling the native periodic job. The engine owns snapshotting,
 * encryption and the actual upload.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createLogger } from '../../utils/logger';
import { SYNC_RELAY } from '../../config/cloud';
import AuthService from '../auth/AuthService';
import { engineApiClient, EngineApiError } from '../engine/EngineApiClient';
import type {
  BackupCreateResponseDto,
  BackupRestoreResponseDto,
  BackupTargetDescriptor,
  EngineApiClient,
} from '../engine/EngineApiClient';
import { BackupKeyEscrow } from './BackupKeyEscrow';
import type { EscrowFetch } from './BackupKeyEscrow';
import {
  BACKUP_CRED_SERVICES,
  keychainCredentialStore,
} from './backupCredentials';
import type { CredentialStore } from './backupCredentials';
import {
  buildWorkConstraints,
  cancelBackupJob,
  scheduleBackupJob,
} from './backupNative';
import { icloudTargetDeps } from './icloudTarget';
import type { ICloudTargetDeps } from './icloudTarget';
import {
  DEFAULT_BACKUP_SETTINGS,
} from './backupTypes';
import type {
  BackupRunResult,
  BackupSettings,
  BackupTargetType,
  RestoreRunResult,
} from './backupTypes';

const log = createLogger('[BackupOrchestrator]');

/** AsyncStorage-shaped settings store (injectable for tests). */
export interface SettingsStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** The persisted settings key. */
export const BACKUP_SETTINGS_KEY = '@soulbits_backup_settings';

/**
 * The hosted-target backup slot id (plan 7-5). The cloud scopes manifests by
 * (account, device), and the account is taken from the PASETO — so a single
 * stable per-account slot is enough and lets a fresh device resolve the same
 * manifest. Multi-device is last-writer-wins (the 2-6 design).
 */
export const BACKUP_CLOUD_SLOT = 'primary';

/** A cloud quota reading for the hosted-target display. */
export interface CloudQuota {
  usedBytes: number;
  quotaMb: number;
}

export interface BackupOrchestratorDeps {
  client?: EngineApiClient;
  storage?: SettingsStorage;
  credentials?: CredentialStore;
  /** Returns the current cloud PASETO, or null when signed out. */
  getPaseto?: () => Promise<string | null>;
  /** Escrow client factory (tests). */
  escrowFactory?: (paseto: string, fetchImpl?: EscrowFetch) => BackupKeyEscrow;
  /** The iOS iCloud target surface (defaults to the SoulbitsBackup module). */
  icloud?: ICloudTargetDeps;
  /** Fetch override for the cloud quota call (tests). */
  fetchImpl?: typeof fetch;
  /** Refreshes the cloud PASETO on a 401 (defaults to AuthService.refresh). */
  refreshPaseto?: () => Promise<boolean>;
}

export class BackupOrchestrator {
  private readonly client: EngineApiClient;
  private readonly storage: SettingsStorage;
  private readonly credentials: CredentialStore;
  private readonly getPaseto: () => Promise<string | null>;
  private readonly escrowFactory: (paseto: string) => BackupKeyEscrow;
  private readonly icloud: ICloudTargetDeps;
  private readonly fetchImpl: typeof fetch;
  private readonly refreshPaseto: () => Promise<boolean>;

  constructor(deps: BackupOrchestratorDeps = {}) {
    this.client = deps.client ?? engineApiClient;
    this.storage = deps.storage ?? AsyncStorage;
    this.credentials = deps.credentials ?? keychainCredentialStore;
    this.getPaseto = deps.getPaseto ?? (async () => null);
    this.escrowFactory =
      deps.escrowFactory ?? ((paseto: string) => new BackupKeyEscrow({ paseto }));
    this.icloud = deps.icloud ?? icloudTargetDeps;
    this.fetchImpl =
      deps.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : (undefined as unknown as typeof fetch));
    this.refreshPaseto = deps.refreshPaseto ?? (() => AuthService.refresh().catch(() => false));
  }

  /** True when a cloud account is signed in (the hosted target is available). */
  async isSignedIn(): Promise<boolean> {
    return !!(await this.getPaseto().catch(() => null));
  }

  // ── Settings ──────────────────────────────────────────────────────────

  /** Read the persisted settings (defaults when absent/corrupt). */
  async getSettings(): Promise<BackupSettings> {
    try {
      const raw = await this.storage.getItem(BACKUP_SETTINGS_KEY);
      if (!raw) return { ...DEFAULT_BACKUP_SETTINGS };
      const parsed = JSON.parse(raw) as Partial<BackupSettings>;
      return { ...DEFAULT_BACKUP_SETTINGS, ...parsed };
    } catch (e) {
      log.warn('failed to read backup settings:', e);
      return { ...DEFAULT_BACKUP_SETTINGS };
    }
  }

  /** Merge + persist a settings patch, returning the merged settings. */
  async updateSettings(patch: Partial<BackupSettings>): Promise<BackupSettings> {
    const current = await this.getSettings();
    const next: BackupSettings = { ...current, ...patch };
    try {
      await this.storage.setItem(BACKUP_SETTINGS_KEY, JSON.stringify(next));
    } catch (e) {
      log.warn('failed to persist backup settings:', e);
    }
    return next;
  }

  // ── Target descriptor ─────────────────────────────────────────────────

  /**
   * Build the engine target descriptor for the settings' target type, resolving
   * secrets from the keychain. Returns null when required secrets are missing.
   */
  async buildTargetDescriptor(settings: BackupSettings): Promise<BackupTargetDescriptor | null> {
    switch (settings.targetType) {
      case 'local-folder': {
        if (!settings.localFolderUri) return null;
        return { type: 'local-folder', destDir: settings.localFolderUri };
      }
      case 'webdav': {
        if (!settings.webdav?.baseUrl) return null;
        const password =
          (await this.credentials.get(BACKUP_CRED_SERVICES.webdavPassword)) ?? '';
        return {
          type: 'webdav',
          baseUrl: settings.webdav.baseUrl,
          username: settings.webdav.username,
          password,
        };
      }
      case 'dropbox': {
        const token = await this.credentials.get(BACKUP_CRED_SERVICES.dropboxToken);
        if (!token) return null;
        return { type: 'dropbox', accessToken: token };
      }
      case 'onedrive': {
        const token = await this.credentials.get(BACKUP_CRED_SERVICES.oneDriveToken);
        if (!token) return null;
        return { type: 'onedrive', accessToken: token };
      }
      case 'icloud-container':
        // The engine stages into a local inbox; the native SoulbitsBackup module
        // moves the objects into the ubiquity container (task 2-6 iOS half).
        return { type: 'icloud-container', inboxDir: this.icloud.inboxDir() };
      case 'soulbits-cloud': {
        // Hosted storage (plan 7-5): the app injects the account PASETO + the
        // sync-relay backup base + a stable slot id; the engine never
        // authenticates to Soulbits itself.
        const paseto = await this.getPaseto().catch(() => null);
        if (!paseto) return null;
        return {
          type: 'soulbits-cloud',
          baseUrl: SYNC_RELAY.backupBaseUrl,
          accessToken: paseto,
          device: BACKUP_CLOUD_SLOT,
        };
      }
      case 'google-drive':
      default:
        return null;
    }
  }

  /** Probe the configured target (availability + account identity). */
  async probeTarget(settings: BackupSettings): Promise<{ available: boolean; account?: string; detail?: string }> {
    // iCloud availability is an APP-side question (the engine target has no
    // iCloud access — it only knows its local inbox).
    if (settings.targetType === 'icloud-container') {
      try {
        return await this.icloud.probe();
      } catch (e) {
        return { available: false, detail: (e as Error)?.message ?? String(e) };
      }
    }
    const target = await this.buildTargetDescriptor(settings);
    if (!target) return { available: false, detail: 'target not configured' };
    try {
      return await this.client.probeBackupTarget(target);
    } catch (e) {
      return { available: false, detail: (e as Error)?.message ?? String(e) };
    }
  }

  // ── Hosted-target quota (plan 7-5) ────────────────────────────────────

  /**
   * Read the account's hosted-backup usage against its tier cap from the relay's
   * `/v1/sync/status` (`backup_bytes` + `quotas.backup_storage_mb`). Returns null
   * when signed out or on any failure (best-effort — never throws).
   */
  async getCloudQuota(): Promise<CloudQuota | null> {
    const paseto = await this.getPaseto().catch(() => null);
    if (!paseto) return null;
    let datasetId = BACKUP_CLOUD_SLOT;
    try {
      const st = await this.client.getSyncClientStatus();
      if (st?.dataset_id) datasetId = st.dataset_id;
    } catch {
      // engine not up yet — the status endpoint only needs a non-empty id
    }
    try {
      const res = await this.fetchImpl(
        `${SYNC_RELAY.backupBaseUrl}/v1/sync/status?dataset_id=${encodeURIComponent(datasetId)}`,
        { headers: { Accept: 'application/json', Authorization: `Bearer ${paseto}` } },
      );
      if (!res.ok) return null;
      const body = (await res.json()) as {
        backup_bytes?: number;
        quotas?: { backup_storage_mb?: number };
      };
      return {
        usedBytes: Number(body.backup_bytes ?? 0),
        quotaMb: Number(body.quotas?.backup_storage_mb ?? 0),
      };
    } catch (e) {
      log.warn('cloud quota fetch failed (non-fatal):', e);
      return null;
    }
  }

  /**
   * Run an engine backup/restore call, refreshing the cloud PASETO and retrying
   * once when the hosted target rejects the credential (HTTP 401 — the engine's
   * `ErrAuthNeeded`). Mirrors 7-3's relay-token auth-needed recovery.
   */
  private async withAuthRefresh<T>(run: (target: BackupTargetDescriptor) => Promise<T>, settings: BackupSettings): Promise<T> {
    let target = await this.buildTargetDescriptor(settings);
    if (!target) throw new Error('Backup target is not configured');
    try {
      return await run(target);
    } catch (e) {
      if (target.type === 'soulbits-cloud' && e instanceof EngineApiError && e.status === 401) {
        const refreshed = await this.refreshPaseto().catch(() => false);
        if (refreshed) {
          target = await this.buildTargetDescriptor(settings);
          if (target) return await run(target);
        }
      }
      throw e;
    }
  }

  // ── Backup ────────────────────────────────────────────────────────────

  /**
   * Stage + measure the artifact WITHOUT uploading, returning the exact size in
   * bytes (the estimate-confirm dialog's "~X MB → your target").
   */
  async estimateBackupSize(): Promise<number> {
    const settings = await this.getSettings();
    const target = await this.buildTargetDescriptor(settings);
    // A dry run needs a target descriptor, but never writes to it; fall back to
    // a throwaway local folder so the estimate works before a target is chosen.
    const effective: BackupTargetDescriptor = target ?? { type: 'local-folder', destDir: '' };
    const res = await this.client.createBackupArtifact(effective, { force: true, dryRun: true });
    return res.totalBytes;
  }

  /**
   * Run a backup now. Resolves skip-if-unchanged; escrows the DEK via W1 when
   * signed in; records the result in settings; (re)schedules the native job.
   */
  async backUpNow(opts: { passphrase?: string; force?: boolean } = {}): Promise<BackupRunResult> {
    const settings = await this.getSettings();
    const target = await this.buildTargetDescriptor(settings);
    if (!target) {
      throw new Error('Backup target is not configured');
    }

    const passphrase = opts.passphrase ?? (await this.resolvePassphrase(settings));
    const res: BackupCreateResponseDto = await this.withAuthRefresh(
      (t) =>
        this.client.createBackupArtifact(t, {
          deviceLabel: settings.localFolderLabel,
          passphrase,
          force: opts.force ?? false,
        }),
      settings,
    );

    // iOS iCloud: move the engine's staged inbox objects into the ubiquity
    // container; the system `bird` daemon uploads them (task 2-6 iOS half).
    if (target.type === 'icloud-container') {
      await this.icloud
        .syncInboxToContainer(target.inboxDir ?? this.icloud.inboxDir())
        .catch((e) => log.warn('iCloud inbox → container sync failed (non-fatal):', e));
    }

    // W1: escrow the DEK under the account when signed in (best-effort).
    await this.escrowDek().catch((e) => log.warn('W1 escrow failed (non-fatal):', e));
    // W2: wrap the DEK under the synchronizable iCloud Keychain key (best-effort).
    await this.storeICloudWrap().catch((e) => log.warn('W2 wrap failed (non-fatal):', e));

    await this.updateSettings({
      lastBackupAt: new Date().toISOString(),
      lastDataVersion: res.dataVersion,
      lastTotalBytes: res.totalBytes,
      lastError: undefined,
    });
    await this.scheduleIfEnabled();

    return {
      skipped: res.skipped,
      recoveryCode: res.recoveryCode,
      recoveryCodeIsNew: res.recoveryCodeIsNew,
      dataVersion: res.dataVersion,
      totalBytes: res.totalBytes,
      uploadedObjects: res.uploadedObjects,
      dedupedObjects: res.dedupedObjects,
    };
  }

  /** (Re)schedule or cancel the native periodic job per settings. */
  async scheduleIfEnabled(): Promise<void> {
    const settings = await this.getSettings();
    if (settings.enabled && settings.cadence !== 'off') {
      await scheduleBackupJob(settings.cadence, buildWorkConstraints(settings));
    } else {
      await cancelBackupJob();
    }
  }

  // ── Restore ───────────────────────────────────────────────────────────

  /**
   * W1 presence: does the signed-in account hold an escrowed backup key? A
   * stored escrow row means a backup lineage exists (the key is escrowed at
   * backup time), which the fresh-install restore gate uses as the
   * integrated-target manifest signal. Returns false when signed out or on any
   * failure (best-effort; never throws).
   */
  async hasEscrowedKey(): Promise<boolean> {
    const paseto = await this.getPaseto().catch(() => null);
    if (!paseto) return false;
    try {
      return !!(await this.escrowFactory(paseto).get());
    } catch (e) {
      log.warn('W1 escrow presence check failed (non-fatal):', e);
      return false;
    }
  }

  /**
   * Resolve the available unlock material, in the engine's preferred order:
   * W3 recovery code (stored for re-display), W1 escrowed DEK (signed in), W4
   * passphrase (supplied by the caller).
   */
  async recoverUnlockMaterial(opts: {
    recoveryCode?: string;
    passphrase?: string;
  } = {}): Promise<{ recoveryCode?: string; dekBase64?: string; passphrase?: string }> {
    const out: { recoveryCode?: string; dekBase64?: string; passphrase?: string } = {};
    const code =
      opts.recoveryCode ?? (await this.credentials.get(BACKUP_CRED_SERVICES.recoveryCode));
    if (code) out.recoveryCode = code;
    if (opts.passphrase) out.passphrase = opts.passphrase;

    // W2: the synchronizable iCloud Keychain wrap (iOS, zero user effort). The
    // native module unwraps and returns the DEK, which the engine accepts as
    // caller-supplied unlock material.
    if (!out.dekBase64) {
      const dek = await this.icloud.getWrap().catch(() => null);
      if (dek) out.dekBase64 = dek;
    }

    const paseto = await this.getPaseto().catch(() => null);
    if (paseto) {
      try {
        const dek = await this.escrowFactory(paseto).get();
        if (dek) out.dekBase64 = dek;
      } catch (e) {
        log.warn('W1 escrow fetch failed (non-fatal):', e);
      }
    }
    return out;
  }

  /**
   * Restore from the configured target into `destDataDir` (defaults to the
   * engine's restore-staging dir). The engine validates the artifact; the app
   * swaps the dir in on next start.
   */
  async restore(
    settings: BackupSettings,
    opts: { recoveryCode?: string; passphrase?: string; destDataDir?: string } = {},
  ): Promise<RestoreRunResult> {
    const target = await this.buildTargetDescriptor(settings);
    if (!target) throw new Error('Backup target is not configured');

    // iOS iCloud: pull the container objects into the local inbox so the
    // engine's inbox target can read them (task 2-6 iOS half).
    if (target.type === 'icloud-container') {
      await this.icloud.syncContainerToInbox(target.inboxDir ?? this.icloud.inboxDir());
    }

    const material = await this.recoverUnlockMaterial(opts);
    const res: BackupRestoreResponseDto = await this.withAuthRefresh(
      (t) =>
        this.client.restoreBackupArtifact(t, {
          recoveryCode: material.recoveryCode,
          passphrase: material.passphrase,
          dekBase64: material.dekBase64,
          destDataDir: opts.destDataDir,
        }),
      settings,
    );
    return {
      unwrapKind: res.unwrapKind,
      dataVersion: res.dataVersion,
      schemaVersion: res.schemaVersion,
      sideObjects: res.sideObjects,
      dbRows: res.dbRows,
      dataDir: res.dataDir,
    };
  }

  // ── Recovery code ─────────────────────────────────────────────────────

  /** Read (and cache) the recovery code for display in settings. */
  async getRecoveryCode(): Promise<string> {
    const cached = await this.credentials.get(BACKUP_CRED_SERVICES.recoveryCode);
    if (cached) return cached;
    const { recoveryCode } = await this.client.backupKey();
    await this.credentials.set(BACKUP_CRED_SERVICES.recoveryCode, recoveryCode);
    return recoveryCode;
  }

  /** Reset the backup key (explicit user action) and cache the new code. */
  async resetRecoveryCode(): Promise<string> {
    const { recoveryCode, dekBase64 } = await this.client.resetBackupKey();
    await this.credentials.set(BACKUP_CRED_SERVICES.recoveryCode, recoveryCode);
    // Re-escrow the new DEK so W1 stays valid for the new lineage.
    const paseto = await this.getPaseto().catch(() => null);
    if (paseto) {
      await this.escrowFactory(paseto).put(dekBase64).catch((e) => log.warn('re-escrow failed:', e));
    }
    return recoveryCode;
  }

  /** Enable + store the W4 passphrase wrap material. */
  async setPassphrase(passphrase: string): Promise<void> {
    await this.credentials.set(BACKUP_CRED_SERVICES.passphrase, passphrase);
    await this.updateSettings({ passphraseEnabled: true });
  }

  /** Disable + clear the W4 passphrase. */
  async clearPassphrase(): Promise<void> {
    await this.credentials.remove(BACKUP_CRED_SERVICES.passphrase);
    await this.updateSettings({ passphraseEnabled: false });
  }

  // ── helpers ───────────────────────────────────────────────────────────

  private async resolvePassphrase(settings: BackupSettings): Promise<string | undefined> {
    if (!settings.passphraseEnabled) return undefined;
    return (await this.credentials.get(BACKUP_CRED_SERVICES.passphrase)) ?? undefined;
  }

  private async escrowDek(): Promise<void> {
    const paseto = await this.getPaseto().catch(() => null);
    if (!paseto) return;
    const { dekBase64 } = await this.client.backupKey();
    await this.escrowFactory(paseto).put(dekBase64);
  }

  /**
   * W2: wrap the DEK under the synchronizable iCloud-Keychain key (iOS). The
   * native module is a no-op off iOS / when iCloud is unavailable.
   */
  private async storeICloudWrap(): Promise<void> {
    const { dekBase64 } = await this.client.backupKey();
    await this.icloud.putWrap(dekBase64);
  }
}

/** The shared singleton (used by the settings + restore screens). */
export const backupOrchestrator = new BackupOrchestrator({
  // W1 account escrow needs the signed-in cloud PASETO. The class default is
  // null (unit tests inject their own), so production wires the real token
  // source here — this is what makes "sign in and restore" work on Android.
  getPaseto: async () => AuthService.getToken().catch(() => null),
});

/** The target-type options surfaced in the picker (v1-shippable first). */
export const BACKUP_TARGET_OPTIONS: {
  id: BackupTargetType;
  labelKey: string;
  v1: boolean;
  /** Hosted target: only shown when a cloud account is signed in (plan 7-5). */
  requiresSignIn?: boolean;
}[] = [
  { id: 'local-folder', labelKey: 'targetLocal', v1: true },
  { id: 'webdav', labelKey: 'targetWebDAV', v1: true },
  { id: 'dropbox', labelKey: 'targetDropbox', v1: true },
  { id: 'onedrive', labelKey: 'targetOneDrive', v1: true },
  { id: 'soulbits-cloud', labelKey: 'targetSoulbitsCloud', v1: true, requiresSignIn: true },
  { id: 'icloud-container', labelKey: 'targetICloud', v1: false },
  { id: 'google-drive', labelKey: 'targetGoogleDrive', v1: false },
];
