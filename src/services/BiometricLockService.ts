/**
 * BiometricLockService
 *
 * Manages app-lock authentication.
 *
 * Architecture:
 *   - PIN is stored in AsyncStorage (simple comparison, no OS prompt)
 *   - A separate "dummy" biometric credential is stored in the keychain with
 *     biometric access control. Calling getGenericPassword on it triggers the
 *     OS biometric prompt — the result doesn't matter, only that it succeeded.
 *
 * This separation means PIN verification never triggers a biometric prompt,
 * and biometric unlock never requires typing a PIN.
 */
import * as Keychain from 'react-native-keychain';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createLogger } from '../utils/logger';

const log = createLogger('[BiometricLockService]');

const STORAGE_KEY_ENABLED = '@harmony_setting_biometric_lock';
const STORAGE_KEY_PIN = '@harmony_setting_lock_pin';
const KEYCHAIN_SERVICE = 'HarmonyAIChat_BiometricLock';
const KEYCHAIN_BIOMETRIC_USER = 'biometric_check';

export type LockMode = 'biometric' | 'pin' | 'none';

// ── Biometric detection ──────────────────────────────────────────────────────

async function isBiometricAvailable(): Promise<boolean> {
  try {
    const biometryType = await Keychain.getSupportedBiometryType();
    return biometryType !== null;
  } catch (err) {
    log.warn('Biometric check failed:', err);
    return false;
  }
}

async function getBiometryType(): Promise<string | null> {
  try {
    return await Keychain.getSupportedBiometryType();
  } catch {
    return null;
  }
}

// ── Biometric credential (dummy — just triggers OS prompt) ───────────────────

/**
 * Store a dummy biometric credential in the keychain.
 * Its sole purpose is to allow getGenericPassword to trigger the OS
 * biometric prompt. The actual password value is meaningless.
 */
async function storeBiometricCredential(pin: string): Promise<void> {
  try {
    await Keychain.setGenericPassword(KEYCHAIN_BIOMETRIC_USER, pin, {
      service: KEYCHAIN_SERVICE,
      accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET_OR_DEVICE_PASSCODE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    log.info('Biometric credential stored');
  } catch (err) {
    log.error('Failed to store biometric credential:', err);
    throw err;
  }
}

/**
 * Trigger the OS biometric prompt. Returns true if the user successfully
 * authenticated via fingerprint/face, false otherwise.
 */
async function authenticateBiometric(): Promise<boolean> {
  try {
    const result = await Keychain.getGenericPassword({
      service: KEYCHAIN_SERVICE,
    });

    // If we got a result, biometric passed (the OS dialog confirmed identity)
    if (result) {
      log.info('Biometric authentication succeeded');
      return true;
    }

    log.warn('Biometric auth: no credential found');
    return false;
  } catch (err: any) {
    const msg = err?.message ?? '';
    if (msg.includes('cancel') || msg.includes('user fallback') || msg.includes('Cancel')) {
      log.info('Biometric cancelled by user');
      return false;
    }
    log.error('Biometric auth error:', msg);
    return false;
  }
}

/**
 * Remove the dummy biometric credential.
 */
async function clearBiometricCredential(): Promise<void> {
  try {
    await Keychain.resetGenericPassword({ service: KEYCHAIN_SERVICE });
    log.info('Biometric credential cleared');
  } catch (err) {
    log.error('Failed to clear biometric credential:', err);
  }
}

// ── PIN storage (AsyncStorage — simple, no OS prompt) ────────────────────────

async function storePin(pin: string): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY_PIN, pin);
  log.info('PIN stored');
}

async function getStoredPin(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(STORAGE_KEY_PIN);
  } catch {
    return null;
  }
}

async function clearPin(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY_PIN);
    await clearBiometricCredential();
    log.info('PIN and biometric credential cleared');
  } catch (err) {
    log.error('Failed to clear PIN:', err);
  }
}

/**
 * Check if a PIN is currently stored.
 */
async function isPinSet(): Promise<boolean> {
  const pin = await getStoredPin();
  return pin !== null && pin.length >= 4;
}

// ── Setup ────────────────────────────────────────────────────────────────────

/**
 * Set up the lock: store the PIN and, if biometric is available, also store
 * a biometric-protected credential so fingerprint unlock works.
 */
async function setupLock(pin: string): Promise<void> {
  await storePin(pin);

  const biometric = await isBiometricAvailable();
  if (biometric) {
    await storeBiometricCredential(pin);
  }
}

// ── Unlock ───────────────────────────────────────────────────────────────────

/**
 * Attempt to unlock.
 *
 * - If a PIN is provided: compare against stored PIN (no biometric prompt).
 * - If no PIN is provided: try biometric (if available & credential exists).
 */
async function unlock(pin?: string): Promise<boolean> {
  // PIN provided — direct comparison, no biometric
  if (pin !== undefined && pin.length >= 4) {
    const stored = await getStoredPin();
    if (stored === pin) {
      log.info('PIN unlock succeeded');
      return true;
    }
    log.info('PIN unlock failed: mismatch');
    return false;
  }

  // No PIN — try biometric
  const stored = await getStoredPin();
  if (!stored) {
    log.warn('Unlock: no PIN stored');
    return false;
  }

  const biometricAvailable = await isBiometricAvailable();
  if (!biometricAvailable) {
    log.info('Unlock: biometric not available, PIN required');
    return false;
  }

  return authenticateBiometric();
}

// ── Mode detection ───────────────────────────────────────────────────────────

async function getLockMode(): Promise<LockMode> {
  const pinSet = await isPinSet();
  if (!pinSet) return 'none';

  const biometric = await isBiometricAvailable();
  if (biometric) return 'biometric';

  return 'pin';
}

// ── Enabled/disabled toggle ──────────────────────────────────────────────────

async function isEnabled(): Promise<boolean> {
  try {
    const val = await AsyncStorage.getItem(STORAGE_KEY_ENABLED);
    return val === 'true';
  } catch {
    return false;
  }
}

async function setEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY_ENABLED, String(enabled));
}

export default {
  isBiometricAvailable,
  getBiometryType,
  authenticateBiometric,
  setupLock,
  storePin,
  verifyPin: getStoredPin, // legacy alias
  isPinSet,
  getLockMode,
  isEnabled,
  setEnabled,
  clearPin,
  unlock,
};
