/**
 * backupTypes — shared types for the user-owned-storage backup subsystem
 * (plan 2-6). The engine does the snapshotting + upload; the app owns settings,
 * credentials, scheduling and the unlock-path UX.
 */

import type { BackupConflictPolicy } from '../engine/EngineApiClient';

export type { BackupConflictPolicy };

/** The selectable target types (mirrors the engine's GET /api/backup/targets). */
export type BackupTargetType =
  | 'local-folder'
  | 'webdav'
  | 'dropbox'
  | 'onedrive'
  | 'icloud-container'
  | 'soulbits-cloud'
  | 'google-drive';

/** Backup cadence (Android WorkManager / iOS BGTask). */
export type BackupCadence = 'daily' | 'weekly' | 'monthly' | 'off';

/** WebDAV connection details (password lives in the keychain, never here). */
export interface WebDAVConfig {
  baseUrl: string;
  username: string;
}

/**
 * A detected cloud-backup conflict (generation guard, owner ruling 2026-10-17):
 * another device wrote the cloud manifest with a different generation, so this
 * device's backup was HELD rather than silently overwriting it. Persisted in
 * settings so the conflict re-surfaces until the user resolves it.
 */
export interface PendingConflict {
  /** The generation the cloud manifest holds (the other device's). */
  remoteGeneration: number;
  /** The data version the cloud manifest holds. */
  remoteDataVersion: string;
  /** A human label for the device that wrote the cloud manifest. */
  remoteDeviceLabel?: string;
  /** When that device synced (RFC3339). */
  remoteSyncedAt?: string;
  /** The sync-group fingerprint of the cloud manifest (empty when none). */
  remoteSyncGroupFingerprint?: string;
  /** When this device detected the conflict (RFC3339). */
  detectedAt: string;
}

/** Persisted backup settings (AsyncStorage). */
export interface BackupSettings {
  /** Master switch for automatic backups. */
  enabled: boolean;
  targetType: BackupTargetType;
  cadence: BackupCadence;
  /** Restrict automatic backups to unmetered networks (default true). */
  wifiOnly: boolean;
  /** Restrict automatic backups to charging (default true). */
  chargingOnly: boolean;
  /** W4 passphrase wrap enabled (the passphrase itself is never persisted). */
  passphraseEnabled: boolean;
  /** Android SAF tree URI for the local-folder target. */
  localFolderUri?: string;
  /** A human label for the chosen local folder. */
  localFolderLabel?: string;
  /** WebDAV connection (non-secret part). */
  webdav?: WebDAVConfig;
  /** Last successful backup summary. */
  lastBackupAt?: string;
  lastDataVersion?: string;
  lastTotalBytes?: number;
  /** Last error surfaced to the user (cleared on success). */
  lastError?: string;
  /**
   * A held cloud-backup conflict awaiting the user's decision (generation
   * guard, owner ruling 2026-10-17). Cleared on the next successful run or when
   * the user resolves it via the conflict modal.
   */
  pendingConflict?: PendingConflict;
}

/** The default settings (backups off until the user opts in). */
export const DEFAULT_BACKUP_SETTINGS: BackupSettings = {
  enabled: false,
  targetType: 'local-folder',
  cadence: 'daily',
  wifiOnly: true,
  chargingOnly: true,
  passphraseEnabled: false,
};

/** The cadence options for the picker. */
export const BACKUP_CADENCES: { id: BackupCadence; labelKey: string }[] = [
  { id: 'daily', labelKey: 'cadenceDaily' },
  { id: 'weekly', labelKey: 'cadenceWeekly' },
  { id: 'monthly', labelKey: 'cadenceMonthly' },
  { id: 'off', labelKey: 'cadenceOff' },
];

/** Result of a manual/automatic backup run (app-facing view). */
export interface BackupRunResult {
  skipped: boolean;
  recoveryCode: string;
  recoveryCodeIsNew: boolean;
  dataVersion: string;
  totalBytes: number;
  uploadedObjects: number;
  dedupedObjects: number;
  /**
   * Present when the run was HELD by the generation guard (a cloud conflict).
   * Nothing was uploaded; the app surfaces the conflict modal.
   */
  held?: PendingConflict;
}

/** Result of a restore run (app-facing view). */
export interface RestoreRunResult {
  unwrapKind: string;
  dataVersion: string;
  schemaVersion: number;
  sideObjects: number;
  dbRows: number;
  dataDir: string;
}
