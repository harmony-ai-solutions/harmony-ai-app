/**
 * BiometricLockService
 *
 * Manages app-lock authentication.
 *
 * Architecture:
 *   - PIN is stored in AsyncStorage (simple comparison, no OS prompt).
 *   - Biometric unlock uses react-native-biometrics `simplePrompt`, which invokes
 *     the OS BiometricPrompt WITHOUT a CryptoObject. This is deliberate: a
 *     CryptoObject-bound prompt (e.g. react-native-keychain's getGenericPassword
 *     on a biometric-protected secret) is subject to Android's auth-validity
 *     window — the keychain native code hardcodes a 5s reuse window, so a second
 *     unlock within 5s would decrypt and return WITHOUT showing a prompt. A
 *     CryptoObject-free simplePrompt ALWAYS shows the prompt on every call.
 *
 * This separation means PIN verification never triggers a biometric prompt,
 * and biometric unlock never requires typing a PIN.
 */
import ReactNativeBiometrics from 'react-native-biometrics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createLogger } from '../utils/logger';

const log = createLogger('[BiometricLockService]');

const STORAGE_KEY_ENABLED = '@harmony_setting_biometric_lock';
const STORAGE_KEY_PIN = '@harmony_setting_lock_pin';

/** Fallback prompt message when none is supplied by the caller. */
const DEFAULT_PROMPT_MESSAGE = 'Confirm your identity to unlock';

/**
 * Hard upper bound for a biometric prompt. If the OS tears the prompt down
 * (screen-off, app backgrounded, activity recreation, system cancel) without
 * settling the native promise, we give up after this window so the UI is never
 * stranded on "Authenticating". The LockScreen additionally force-clears its
 * in-flight guard on a real resume (see LockScreen.tsx) so recovery is instant
 * even when RN's timer subsystem was suspended while backgrounded.
 */
const BIOMETRIC_PROMPT_TIMEOUT_MS = 10000;

// Single shared instance; constructed once (the native bridge is cheap to hold).
const rnBiometrics = new ReactNativeBiometrics();

export type LockMode = 'biometric' | 'pin' | 'none';

/** Localized strings for the OS biometric prompt (supplied by the UI layer). */
export interface BiometricPromptStrings {
  promptMessage: string;
  cancelButtonText?: string;
  fallbackPromptMessage?: string;
}

/** Options for an unlock attempt. Either verify a PIN or prompt biometrics. */
export interface UnlockOptions {
  /** If provided, verify this PIN instead of prompting biometrics. */
  pin?: string;
  /** Localized strings for the OS biometric prompt (biometric path only). */
  prompt?: BiometricPromptStrings;
}

// ── Biometric detection ──────────────────────────────────────────────────────

async function isBiometricAvailable(): Promise<boolean> {
  try {
    const { available } = await rnBiometrics.isSensorAvailable();
    return available === true;
  } catch (err) {
    log.warn('Biometric sensor check failed:', err);
    return false;
  }
}

async function getBiometryType(): Promise<string | null> {
  try {
    const { biometryType } = await rnBiometrics.isSensorAvailable();
    return biometryType ?? null;
  } catch {
    return null;
  }
}

// ── Biometric prompt (CryptoObject-free → always prompts) ────────────────────

/**
 * Show the OS biometric prompt. Returns true only if the user successfully
 * authenticated. Uses a CryptoObject-free prompt so it is shown on EVERY call
 * (no auth-validity reuse window). Bounded by a timeout so an interrupted prompt
 * (screen-off / background / system cancel) can never leave the UI stuck.
 */
async function authenticateBiometric(prompt?: BiometricPromptStrings): Promise<boolean> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    // The native `simplePrompt` promise can be orphaned by the OS: when the host
    // activity is torn down / recreated (screen-off, config change) the
    // BiometricPrompt callbacks may never fire, and on other interrupts (window
    // focus loss → ERROR_CANCELED, hardware errors) react-native-biometrics
    // *rejects*. Attach a catch so a delayed rejection arriving AFTER the race
    // has already settled (via the timeout) can never surface as an unhandled
    // promise rejection, and so any non-success rejection maps to a plain
    // { success: false } result instead of propagating.
    const nativePrompt = rnBiometrics
      .simplePrompt({
        promptMessage: prompt?.promptMessage ?? DEFAULT_PROMPT_MESSAGE,
        cancelButtonText: prompt?.cancelButtonText,
        fallbackPromptMessage: prompt?.fallbackPromptMessage,
      })
      .catch((err: any) => {
        log.warn('Biometric native prompt rejected:', err?.message ?? err);
        return { success: false } as const;
      });

    const result = await Promise.race([
      nativePrompt,
      new Promise<{ success: false }>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error('biometric_prompt_timeout')),
          BIOMETRIC_PROMPT_TIMEOUT_MS,
        );
      }),
    ]);

    if (timeoutHandle) clearTimeout(timeoutHandle);

    const success = result?.success === true;
    if (success) {
      log.info('Biometric authentication succeeded');
    } else {
      log.info('Biometric cancelled or failed');
    }
    return success;
  } catch (err: any) {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    const msg = err?.message ?? '';
    if (msg === 'biometric_prompt_timeout') {
      log.warn('Biometric prompt timed out / was interrupted');
      return false;
    }
    log.error('Biometric auth error:', msg);
    return false;
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
    log.info('PIN cleared');
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
 * Set up the lock: store the PIN. Biometric availability is detected at unlock
 * time, so no native biometric credential needs to be pre-stored.
 */
async function setupLock(pin: string): Promise<void> {
  await storePin(pin);
}

// ── Unlock ───────────────────────────────────────────────────────────────────

/**
 * Attempt to unlock.
 *
 * - If a PIN is provided: compare against stored PIN (no biometric prompt).
 * - If no PIN is provided: show the biometric prompt (if available & a PIN is set).
 *
 * `promptMessage` customises the OS biometric dialog text (biometric path only).
 */
async function unlock(options?: UnlockOptions): Promise<boolean> {
  const pin = options?.pin;

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

  return authenticateBiometric(options?.prompt);
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
