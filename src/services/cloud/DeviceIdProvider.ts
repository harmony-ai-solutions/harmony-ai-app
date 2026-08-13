/**
 * DeviceIdProvider — stable per-install device identifier (D-DEV-01).
 *
 * Generates a UUID on first launch and persists it in app-private storage
 * (AsyncStorage). The same id is sent on:
 *   - POST /v1/devices               (device registration, auth-service)
 *   - POST /v1/devices/authorize     (email auth-code request + verify)
 *   - POST /v1/session/connect       (broker device-authorization gate)
 *
 * The broker + auth-service correlate on this id, so it must NEVER change for
 * the lifetime of the install (uninstalling the app clears it, as expected —
 * the device row is then re-registered + re-authorized).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../../utils/logger';

const log = createLogger('[DeviceId]');

/** AsyncStorage key for the per-install device id. */
const DEVICE_ID_KEY = 'soulbits.device_id';

/** In-memory cache — avoids an AsyncStorage read on every connect/register. */
let cachedDeviceId: string | null = null;

/**
 * Returns the stable per-install device id, creating + persisting it on first
 * call. Never throws: a storage failure falls back to an in-memory-only id so
 * the connect flow is never blocked by storage.
 */
export async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) {
    return cachedDeviceId;
  }

  try {
    const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (existing) {
      cachedDeviceId = existing;
      return existing;
    }
  } catch (e) {
    log.warn('Failed to read persisted device id, generating a new one', e);
  }

  const id = uuidv4();
  cachedDeviceId = id;
  try {
    await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  } catch (e) {
    log.warn('Failed to persist device id (in-memory only for this session)', e);
  }
  return id;
}

/**
 * Resets the cached id so the next getDeviceId() call re-reads (or regenerates)
 * it. Intended for tests and future "reset device identity" flows.
 */
export function resetDeviceIdCache(): void {
  cachedDeviceId = null;
}
