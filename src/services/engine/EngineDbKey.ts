/**
 * EngineDbKey — the app's custody of the embedded engine's at-rest DB key
 * (task 4-2; the key custody designed in 1-2's "DB key provisioning").
 *
 * The engine NEVER generates or stores this key: the app owns a 256-bit key,
 * keeps it in the device Keychain, and hands it to the engine on start
 * (`EngineInit`'s `dbKey` → SQLCipher-class database encryption). Android's
 * sidecar receives the same value via the `SE_DB_KEY` environment variable.
 *
 * Accessibility: `AccessibleAfterFirstUnlockThisDeviceOnly` — the key must be
 * readable whenever the app runs, including after a device restart once the user
 * has unlocked once (needed by 4-3's background wakes), and it must NEVER leave
 * the device (not synchronizable, not restored from a backup — the restored DB
 * comes from 2-6's user-owned-storage artifact, whose own DEK wrap carries the
 * key material).
 *
 * Injectable so tests run against a fake store without the keychain.
 */

import { Platform } from 'react-native';
import { createLogger } from '../../utils/logger';

const log = createLogger('[EngineDbKey]');

/** Keychain service name for the engine DB key (device-local). */
export const ENGINE_DB_KEY_SERVICE = 'soulbits.engine.db-key';

/** The stored password sentinel (react-native-keychain requires a username). */
const KEY_USERNAME = 'soulbits-engine';

/** A minimal key/value secret store (injectable for tests). */
export interface DbKeyStore {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
  remove(): Promise<void>;
}

/** Build 32 bytes (256 bits) of key material, base64-encoded. */
export function generateEngineDbKeyMaterial(): string {
  const bytes = new Uint8Array(32);
  const cryptoObj: Crypto | undefined = (globalThis as any).crypto;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    cryptoObj.getRandomValues(bytes);
  } else {
    // Fallback (should not happen in the app: index.js imports
    // react-native-get-random-values first). v4 UUIDs carry 122 random bits each.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { v4: uuidv4 } = require('uuid');
    for (let i = 0; i < 32; i++) {
      bytes[i] = parseInt(uuidv4().replace(/-/g, '').slice((i % 4) * 2, (i % 4) * 2 + 2), 16);
    }
  }
  return uint8ArrayToBase64(bytes);
}

/** Base64-encode bytes (avoids importing the DB base64 helper's globals). */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += chars[b0 >> 2];
    out += chars[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? chars[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? chars[b2 & 63] : '=';
  }
  return out;
}

/** The production store, backed by react-native-keychain (lazy-required). */
export const keychainDbKeyStore: DbKeyStore = {
  async get(): Promise<string | null> {
    try {
      const Keychain = require('react-native-keychain');
      const res = await Keychain.getGenericPassword({ service: ENGINE_DB_KEY_SERVICE });
      if (res && typeof res === 'object' && 'password' in res) {
        return (res as { password: string }).password ?? null;
      }
      return null;
    } catch (e) {
      log.warn('keychain read failed:', e);
      return null;
    }
  },
  async set(value: string): Promise<void> {
    const Keychain = require('react-native-keychain');
    const accessible =
      Keychain.ACCESSIBLE?.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY ??
      Keychain.ACCESSIBLE?.AFTER_FIRST_UNLOCK ??
      Keychain.ACCESSIBLE?.WHEN_UNLOCKED_THIS_DEVICE_ONLY;
    await Keychain.setGenericPassword(KEY_USERNAME, value, {
      service: ENGINE_DB_KEY_SERVICE,
      accessible,
    });
  },
  async remove(): Promise<void> {
    try {
      const Keychain = require('react-native-keychain');
      await Keychain.resetGenericPassword({ service: ENGINE_DB_KEY_SERVICE });
    } catch (e) {
      log.warn('keychain reset failed:', e);
    }
  },
};

/** True on platforms where the Keychain custodian is usable. */
export function isEngineDbKeyAvailable(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

/**
 * Read the engine DB key, generating + persisting a fresh one on first use.
 * Never throws: a keychain failure returns null so the engine falls back to its
 * unencrypted default rather than blocking startup.
 */
export async function getOrCreateEngineDbKey(
  store: DbKeyStore = keychainDbKeyStore,
): Promise<string | null> {
  const existing = await store.get().catch(() => null);
  if (existing && existing.length > 0) return existing;
  try {
    const key = generateEngineDbKeyMaterial();
    await store.set(key);
    log.info('Engine DB key provisioned');
    return key;
  } catch (e) {
    log.warn('failed to provision engine DB key (engine will run unencrypted):', e);
    return null;
  }
}

/** Explicit "reset engine DB key" (would orphan the current encrypted DB). */
export async function resetEngineDbKey(
  store: DbKeyStore = keychainDbKeyStore,
): Promise<void> {
  await store.remove();
}
