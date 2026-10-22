/**
 * icloudTarget — the app-side orchestration of the iOS iCloud-container backup
 * target (plan 2-6 iOS half, landed with 4-2).
 *
 * The engine's `ICloudContainerTarget` is the engine-side shape: it stages the
 * artifact objects into a LOCAL INBOX directory (it has no iCloud access). This
 * module owns the app-side half:
 *
 *   - the inbox directory the engine stages into / reads from;
 *   - moving the inbox → the ubiquity container after a backup, and
 *     container → inbox before a restore (via the SoulbitsBackup native module);
 *   - probing container availability;
 *   - the W2 key wrap (synchronizable iCloud Keychain).
 *
 * `BackupOrchestrator` consumes this through {@link ICloudTargetDeps} so the
 * flow is unit-testable with a fake.
 */

import { DocumentDirectoryPath } from 'react-native-fs';
import {
  getICloudUploadProgress,
  getICloudWrap,
  listICloudContainer,
  probeICloud,
  putICloudWrap,
  syncICloudToInbox,
  syncInboxToICloud,
} from './backupNativeIos';
import type { ICloudObject, ICloudProbe, ICloudUploadProgress, ICloudWrapEntry } from './backupNativeIos';

/** The inbox sub-directory (relative to the app's Documents dir). */
export const ICLOUD_INBOX_SUBDIR = 'backup-icloud-inbox';

/**
 * The absolute inbox directory the engine stages into and the native module
 * moves to/from the ubiquity container. Both halves MUST use the same path.
 */
export function icloudInboxDir(): string {
  return `${DocumentDirectoryPath}/${ICLOUD_INBOX_SUBDIR}`;
}

/** The iCloud target's app-side surface (injectable for tests). */
export interface ICloudTargetDeps {
  probe(): Promise<ICloudProbe>;
  inboxDir(): string;
  syncInboxToContainer(inboxDir: string): Promise<{ moved: number }>;
  syncContainerToInbox(inboxDir: string): Promise<{ copied: number }>;
  list(): Promise<ICloudObject[]>;
  uploadProgress(): Promise<ICloudUploadProgress>;
  putWrap(dekBase64: string): Promise<ICloudWrapEntry | null>;
  getWrap(): Promise<string | null>;
  clearWrap(): Promise<void>;
}

/** The production deps, backed by the SoulbitsBackup native module. */
export const icloudTargetDeps: ICloudTargetDeps = {
  probe: probeICloud,
  inboxDir: icloudInboxDir,
  syncInboxToContainer: syncInboxToICloud,
  syncContainerToInbox: syncICloudToInbox,
  list: listICloudContainer,
  uploadProgress: getICloudUploadProgress,
  putWrap: putICloudWrap,
  getWrap: getICloudWrap,
  clearWrap: async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { clearICloudWrap } = require('./backupNativeIos');
    await clearICloudWrap();
  },
};
