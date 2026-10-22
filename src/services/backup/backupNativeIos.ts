/**
 * backupNativeIos — the JS wrapper around the iOS "SoulbitsBackup" native module
 * (plan 2-6 iOS half, landed with 4-2).
 *
 * The native side (`ios/SoulbitsBackup/SoulbitsBackupModule.swift`) owns:
 *
 *  - the iCloud ubiquity container: moves the engine's staged inbox objects into
 *    the container (NSFileCoordinator) and back out on restore; the system
 *    `bird` daemon uploads them,
 *  - NSMetadataQuery upload progress + a container listing,
 *  - the W2 key wrap: a synchronizable iCloud-Keychain unlock key that
 *    AEAD-wraps the backup DEK (kSecAttrSynchronizable +
 *    kSecAttrAccessibleAfterFirstUnlock + keychain access group).
 *
 * Same module NAME as Android's `SoulbitsBackup` but a different (iCloud-specific)
 * method set; everything degrades to null/empty off iOS, so the JS layer never
 * branches on the module's presence.
 */

import { NativeModules, Platform } from 'react-native';
import { createLogger } from '../../utils/logger';

const log = createLogger('[BackupNativeIos]');

const native: any = Platform.OS === 'ios' ? (NativeModules as any).SoulbitsBackup : null;

/** True when the iOS iCloud backup module is present. */
export function isBackupNativeIosAvailable(): boolean {
  return !!native && typeof native.probe === 'function';
}

/** A target's availability + account identity. */
export interface ICloudProbe {
  available: boolean;
  account?: string;
  detail?: string;
}

/** Probe the iCloud container (availability + signed-in state). */
export async function probeICloud(): Promise<ICloudProbe> {
  if (!native || typeof native.probe !== 'function') {
    return { available: false, detail: 'iCloud backup module unavailable' };
  }
  try {
    const res = await native.probe();
    return {
      available: Boolean(res?.available),
      account: typeof res?.account === 'string' ? res.account : undefined,
      detail: typeof res?.detail === 'string' ? res.detail : undefined,
    };
  } catch (e) {
    return { available: false, detail: (e as Error)?.message ?? String(e) };
  }
}

/** The container's backup directory path, or null when unavailable. */
export async function icloudContainerPath(): Promise<string | null> {
  if (!native || typeof native.containerURL !== 'function') return null;
  try {
    const res = await native.containerURL();
    return typeof res === 'string' ? res : null;
  } catch {
    return null;
  }
}

/** Move every staged inbox object into the ubiquity container. */
export async function syncInboxToICloud(inboxDir: string): Promise<{ moved: number }> {
  if (!native || typeof native.syncInboxToContainer !== 'function') return { moved: 0 };
  const res = await native.syncInboxToContainer(inboxDir);
  return { moved: Number(res?.moved) || 0 };
}

/** Copy the container's objects back into the local inbox (restore). */
export async function syncICloudToInbox(inboxDir: string): Promise<{ copied: number }> {
  if (!native || typeof native.syncContainerToInbox !== 'function') return { copied: 0 };
  const res = await native.syncContainerToInbox(inboxDir);
  return { copied: Number(res?.copied) || 0 };
}

/** One object in the iCloud container. */
export interface ICloudObject {
  name: string;
  size: number;
  modified: string;
}

/** List the container's objects (restore listing / Manage Storage parity). */
export async function listICloudContainer(): Promise<ICloudObject[]> {
  if (!native || typeof native.listContainer !== 'function') return [];
  try {
    const res = await native.listContainer();
    if (!Array.isArray(res)) return [];
    return res.map((o: any) => ({
      name: String(o?.name ?? ''),
      size: Number(o?.size) || 0,
      modified: String(o?.modified ?? ''),
    }));
  } catch (e) {
    log.warn('listContainer failed:', e);
    return [];
  }
}

/** Aggregate upload progress over the container. */
export interface ICloudUploadProgress {
  total: number;
  uploaded: number;
  percent: number;
}

export async function getICloudUploadProgress(): Promise<ICloudUploadProgress> {
  if (!native || typeof native.uploadProgress !== 'function') {
    return { total: 0, uploaded: 0, percent: 100 };
  }
  try {
    const res = await native.uploadProgress();
    return {
      total: Number(res?.total) || 0,
      uploaded: Number(res?.uploaded) || 0,
      percent: Number(res?.percent) || 0,
    };
  } catch {
    return { total: 0, uploaded: 0, percent: 0 };
  }
}

/** A W2 wrap entry (real AEAD bytes over the DEK). */
export interface ICloudWrapEntry {
  nonce: string;
  wrapped: string;
  hint?: string;
}

/**
 * Wrap the backup DEK under the synchronizable iCloud-Keychain unlock key,
 * returning the real wrap bytes (for the caller to record alongside the
 * manifest's informational W2 entry).
 */
export async function putICloudWrap(dekBase64: string): Promise<ICloudWrapEntry | null> {
  if (!native || typeof native.putICloudWrap !== 'function') return null;
  try {
    const res = await native.putICloudWrap(dekBase64);
    if (!res || typeof res.wrapped !== 'string') return null;
    return { nonce: String(res.nonce ?? ''), wrapped: res.wrapped, hint: res.hint };
  } catch (e) {
    log.warn('putICloudWrap failed:', e);
    return null;
  }
}

/** Read + unwrap the W2 DEK (Apple-to-Apple restore). Resolves null when absent. */
export async function getICloudWrap(): Promise<string | null> {
  if (!native || typeof native.getICloudWrap !== 'function') return null;
  try {
    const res = await native.getICloudWrap();
    return typeof res?.dekBase64 === 'string' ? res.dekBase64 : null;
  } catch (e) {
    log.warn('getICloudWrap failed:', e);
    return null;
  }
}

/** Remove the W2 keychain items (explicit "reset backup key"). */
export async function clearICloudWrap(): Promise<void> {
  if (!native || typeof native.clearICloudWrap !== 'function') return;
  try {
    await native.clearICloudWrap();
  } catch (e) {
    log.warn('clearICloudWrap failed:', e);
  }
}
