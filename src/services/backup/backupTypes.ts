/**
 * backupTypes — shared types for the user-owned-storage backup subsystem
 * (plan 2-6). The engine does the snapshotting + upload; the app owns settings,
 * credentials, scheduling and the unlock-path UX.
 */

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
