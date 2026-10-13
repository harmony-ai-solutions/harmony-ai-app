/**
 * restoreOnboarding — the fresh-install restore-offer gate (plan 2-6 §5,
 * wired in 5-3 as the "restore-onboarding first-run gate" follow-up).
 *
 * Flow (2-6 §5): fresh install → sign-in completes → probe the backup targets:
 *
 *   - **iOS** — the iCloud ubiquity-container metadata (a `manifest.json`
 *     object means a backup exists there);
 *   - **integrated targets** — the target recorded in persisted settings +
 *     account **W1 escrow presence** (an escrowed backup key means a manifest
 *     was committed to the user's storage at backup time).
 *
 * If any source holds a backup the gate surfaces a **skippable** offer (date /
 * size / generation); otherwise there is no interstitial and the normal
 * post-sign-in path is untouched.
 *
 * The gate only ever *proposes*: `BackupOrchestrator` owns the actual probe /
 * restore, and `RestoreOnboardingScreen` owns the restore flow. This module is
 * deliberately tiny + dependency-injected so it unit-tests without a device.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { createLogger } from '../../utils/logger';
import {
  BACKUP_TARGET_OPTIONS,
  backupOrchestrator,
} from './BackupOrchestrator';
import { icloudTargetDeps } from './icloudTarget';
import type { BackupSettings, BackupTargetType } from './backupTypes';

const log = createLogger('[RestoreOnboarding]');

/** The manifest object key on every target (engine `backup.ManifestKey`). */
export const MANIFEST_OBJECT_NAME = 'manifest.json';

/** The AsyncStorage flag recording that the offer has been shown/resolved. */
export const RESTORE_OFFER_SEEN_KEY = '@soulbits_restore_offer_seen';

/**
 * A discovered backup, ready to render as the offer. Date/size/generation are
 * best-effort: iOS reads them from the container listing; the integrated-target
 * path reads them from the persisted settings' last-backup summary (the
 * generation needs the manifest itself, which the engine only returns on a
 * restore, so it is usually absent here).
 */
export interface RestoreOffer {
  /** Which target the backup was found on (drives the copy + picker default). */
  source: BackupTargetType;
  /** i18n label key for the target (mirrors BACKUP_TARGET_OPTIONS). */
  labelKey: string;
  /** ISO timestamp of the backup, when known. */
  createdAt?: string;
  /** Total artifact bytes, when known. */
  totalBytes?: number;
  /** Manifest generation, when known. */
  generation?: number;
  /** Target account identity (WebDAV username / provider email), when known. */
  account?: string;
}

/** The injectable surface the gate reads (tests supply a fake). */
export interface RestoreProbeDeps {
  settings: () => Promise<BackupSettings>;
  hasEscrowedKey: () => Promise<boolean>;
  listICloud: () => Promise<{ name: string; size: number; modified: string }[]>;
  isIOS: boolean;
}

/** Minimal AsyncStorage-shaped store (injectable for tests). */
export interface OfferSeenStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/** The production deps (backed by the orchestrator + iCloud target surface). */
export function defaultRestoreProbeDeps(): RestoreProbeDeps {
  return {
    settings: () => backupOrchestrator.getSettings(),
    hasEscrowedKey: () => backupOrchestrator.hasEscrowedKey(),
    listICloud: () => icloudTargetDeps.list(),
    isIOS: Platform.OS === 'ios',
  };
}

/** The i18n label key for a target type (falls back to the local folder). */
function targetLabelKey(target: BackupTargetType): string {
  return BACKUP_TARGET_OPTIONS.find((o) => o.id === target)?.labelKey ?? 'targetLocal';
}

/** True when an iCloud container listing names the backup manifest. */
function findICloudManifest(
  objects: { name: string; size: number; modified: string }[],
): { name: string; size: number; modified: string } | undefined {
  return objects.find(
    (o) => o.name === MANIFEST_OBJECT_NAME || o.name.endsWith(`/${MANIFEST_OBJECT_NAME}`),
  );
}

/**
 * Probe the backup targets for an existing manifest. Returns the offer, or null
 * when no target holds a backup (→ no interstitial).
 */
export async function probeRestoreOffer(
  deps: RestoreProbeDeps = defaultRestoreProbeDeps(),
): Promise<RestoreOffer | null> {
  // iOS: the ubiquity-container listing is the manifest-presence signal.
  if (deps.isIOS) {
    const objects = await deps.listICloud().catch(() => []);
    const manifest = findICloudManifest(objects);
    if (manifest) {
      return {
        source: 'icloud-container',
        labelKey: targetLabelKey('icloud-container'),
        createdAt: manifest.modified || undefined,
        totalBytes: manifest.size || undefined,
      };
    }
  }

  // Integrated targets: the target from persisted settings + account W1
  // presence. An escrowed key means a manifest was committed at backup time.
  const settings = await deps.settings().catch(() => null);
  const source: BackupTargetType = settings?.targetType ?? 'local-folder';
  const w1 = await deps.hasEscrowedKey().catch(() => false);
  if (w1) {
    return {
      source,
      labelKey: targetLabelKey(source),
      createdAt: settings?.lastBackupAt,
      totalBytes: settings?.lastTotalBytes,
      account: settings?.webdav?.username,
    };
  }

  return null;
}

/** True when the offer has already been shown/resolved on this install. */
export async function isRestoreOfferSeen(
  store: OfferSeenStore = AsyncStorage,
): Promise<boolean> {
  try {
    return (await store.getItem(RESTORE_OFFER_SEEN_KEY)) != null;
  } catch {
    return false;
  }
}

/** Record that the offer has been shown/resolved (once per install). */
export async function markRestoreOfferSeen(
  store: OfferSeenStore = AsyncStorage,
): Promise<void> {
  try {
    await store.setItem(RESTORE_OFFER_SEEN_KEY, '1');
  } catch (e) {
    log.warn('failed to record restore-offer seen flag:', e);
  }
}

/**
 * The AppShell entry point: probe once per install (skips when already seen).
 * Never throws — a probe failure yields null so sign-in is never blocked.
 */
export async function probeRestoreOfferOnce(
  deps: RestoreProbeDeps = defaultRestoreProbeDeps(),
  store: OfferSeenStore = AsyncStorage,
): Promise<RestoreOffer | null> {
  try {
    if (await isRestoreOfferSeen(store)) return null;
    return await probeRestoreOffer(deps);
  } catch (e) {
    log.warn('restore-offer probe failed (non-fatal):', e);
    return null;
  }
}
