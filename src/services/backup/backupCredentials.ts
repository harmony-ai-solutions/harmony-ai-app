/**
 * backupCredentials — secret storage for the backup subsystem.
 *
 * All secrets (WebDAV password, Dropbox/OneDrive OAuth tokens, the displayed
 * recovery code) live in react-native-keychain, never in AsyncStorage or the
 * engine's manifest. The interface is injectable so tests run against a fake.
 */

import { Platform } from 'react-native';
import { createLogger } from '../../utils/logger';

const log = createLogger('[BackupCredentials]');

/** Keychain "service" names for each secret. */
export const BACKUP_CRED_SERVICES = {
  webdavPassword: 'soulbits.backup.webdav.password',
  dropboxToken: 'soulbits.backup.dropbox.token',
  oneDriveToken: 'soulbits.backup.onedrive.token',
  recoveryCode: 'soulbits.backup.recovery-code',
  passphrase: 'soulbits.backup.passphrase',
} as const;

export type BackupCredService =
  (typeof BACKUP_CRED_SERVICES)[keyof typeof BACKUP_CRED_SERVICES];

/** A minimal secret store (get/set/remove by service name). */
export interface CredentialStore {
  set(service: string, value: string): Promise<void>;
  get(service: string): Promise<string | null>;
  remove(service: string): Promise<void>;
}

/**
 * The production store, backed by react-native-keychain. The value is stored as
 * the password with a fixed username sentinel (the API requires a username).
 */
export const keychainCredentialStore: CredentialStore = {
  async set(service: string, value: string): Promise<void> {
    const Keychain = require('react-native-keychain');
    await Keychain.setGenericPassword('soulbits-backup', value, { service });
  },
  async get(service: string): Promise<string | null> {
    try {
      const Keychain = require('react-native-keychain');
      const res = await Keychain.getGenericPassword({ service });
      if (res && typeof res === 'object' && 'password' in res) {
        return (res as { password: string }).password ?? null;
      }
      return null;
    } catch (e) {
      log.warn(`keychain read failed for ${service}:`, e);
      return null;
    }
  },
  async remove(service: string): Promise<void> {
    try {
      const Keychain = require('react-native-keychain');
      await Keychain.resetGenericPassword({ service });
    } catch (e) {
      log.warn(`keychain reset failed for ${service}:`, e);
    }
  },
};

/** True on platforms where the keychain store is usable (all shipped platforms). */
export function isCredentialStoreAvailable(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}
