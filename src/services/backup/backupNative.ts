/**
 * backupNative — the JS wrapper around the Android "SoulbitsBackup" native
 * module (plan 2-6 step 2). The native side owns:
 *
 *  - the WorkManager daily job (constraints: Wi-Fi-only + charging + idle) and
 *    a one-off "back up now" worker,
 *  - the SAF folder picker (a persistent tree URI for the local-folder target),
 *  - the share-sheet export of a staged file,
 *  - the Dropbox/OneDrive OAuth 2 + PKCE flows (token handed back to JS).
 *
 * Everything degrades to a no-op / null off Android (iOS iCloud lands with 4-2),
 * so the JS layer never branches on the module's presence.
 */

import { NativeModules, Platform } from 'react-native';
import { createLogger } from '../../utils/logger';
import type { BackupSettings } from './backupTypes';

const log = createLogger('[BackupNative]');

const native: any = Platform.OS === 'android' ? (NativeModules as any).SoulbitsBackup : null;

/** True when the native backup module is present (Android today). */
export function isBackupNativeAvailable(): boolean {
  return !!native;
}

/** WorkManager constraint shape passed to the native scheduler. */
export interface BackupWorkConstraints {
  requiresUnmeteredNetwork: boolean;
  requiresCharging: boolean;
  requiresIdle: boolean;
}

/**
 * Build the WorkManager constraint set from the user's settings. Pure so the
 * mapping is unit-tested without the native module.
 */
export function buildWorkConstraints(settings: BackupSettings): BackupWorkConstraints {
  return {
    requiresUnmeteredNetwork: settings.wifiOnly,
    requiresCharging: settings.chargingOnly,
    requiresIdle: true,
  };
}

/** A picked folder (Android SAF tree URI). */
export interface PickedFolder {
  uri: string;
  label: string;
}

/** Open the SAF folder picker; resolves null when the user cancels. */
export async function pickBackupFolder(): Promise<PickedFolder | null> {
  if (!native || typeof native.pickFolder !== 'function') return null;
  try {
    const res = await native.pickFolder();
    if (!res || typeof res.uri !== 'string') return null;
    return { uri: res.uri, label: res.label ?? res.uri };
  } catch (e) {
    log.warn('pickFolder failed:', e);
    return null;
  }
}

/** (Re)schedule the periodic backup job with the given constraints. */
export async function scheduleBackupJob(
  cadence: string,
  constraints: BackupWorkConstraints,
): Promise<void> {
  if (!native || typeof native.scheduleBackup !== 'function') return;
  await native.scheduleBackup({ cadence, constraints });
}

/** Cancel the periodic backup job. */
export async function cancelBackupJob(): Promise<void> {
  if (!native || typeof native.cancelBackup !== 'function') return;
  await native.cancelBackup();
}

/** Trigger an immediate one-off backup worker. */
export async function runBackupNow(): Promise<void> {
  if (!native || typeof native.runBackupNow !== 'function') return;
  await native.runBackupNow();
}

/** Share a staged artifact file via the system share sheet. */
export async function shareBackupFile(filePath: string, mimeType = 'application/octet-stream'): Promise<void> {
  if (!native || typeof native.shareFile !== 'function') return;
  await native.shareFile({ filePath, mimeType });
}

/** A completed OAuth PKCE flow's token. */
export interface OAuthTokenResult {
  accessToken: string;
  account?: string;
}

/**
 * Run the Dropbox/OneDrive OAuth 2 + PKCE flow in the native layer and return
 * the access token. Resolves null when the provider is unsupported / cancelled.
 */
export async function startProviderOAuth(
  provider: 'dropbox' | 'onedrive',
): Promise<OAuthTokenResult | null> {
  if (!native || typeof native.startOAuth !== 'function') return null;
  try {
    const res = await native.startOAuth({ provider });
    if (!res || typeof res.accessToken !== 'string') return null;
    return { accessToken: res.accessToken, account: res.account };
  } catch (e) {
    log.warn(`OAuth for ${provider} failed:`, e);
    return null;
  }
}

/** Clear a provider's stored token natively (sign-out). */
export async function clearProviderOAuth(provider: 'dropbox' | 'onedrive'): Promise<void> {
  if (!native || typeof native.clearOAuth !== 'function') return;
  await native.clearOAuth({ provider });
}
