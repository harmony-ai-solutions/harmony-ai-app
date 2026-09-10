/**
 * Haptic feedback utility for button presses and UI interactions.
 *
 * Uses React Native's built-in Vibration API for a lightweight tactile
 * response — zero additional native dependencies required.
 *
 * Duration: 10ms vibration provides a subtle "physical button press" feel
 * without being intrusive or fatiguing.
 *
 * Requires `android.permission.VIBRATE` declared in AndroidManifest.xml
 * (already added). This is a "normal" permission auto-granted at install
 * time — no runtime permission prompt needed.
 *
 * Uses CJS require instead of ES import for Vibration because the named
 * export may not be available from 'react-native' in RN 0.73+.
 * Destructuring silently yields `undefined` if missing, avoiding a
 * bundle evaluation crash.
 *
 * The haptic feedback toggle in Settings (@harmony_setting_haptic_feedback)
 * is honored here: `loadHapticPreference()` should be called once at app
 * startup, and `setHapticFeedbackEnabled()` keeps the in-memory gate in sync
 * when the user flips the toggle. When disabled, all haptic output is a no-op.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

/** AsyncStorage key backing the Settings "Haptic feedback" toggle. */
export const HAPTIC_FEEDBACK_STORAGE_KEY = '@harmony_setting_haptic_feedback';

/** Sharp double-tap pattern: vibrate 15ms, pause 30ms, vibrate 15ms */
const BUTTON_PRESS_PATTERN = [0, 15, 30, 15];

/** In-memory gate mirroring the persisted user preference (default: on). */
let hapticFeedbackEnabled = true;

/**
 * Load the persisted haptic preference once at startup.
 * Fire-and-forget; defaults to enabled when unset or on any error.
 */
export async function loadHapticPreference(): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(HAPTIC_FEEDBACK_STORAGE_KEY);
    hapticFeedbackEnabled = stored !== 'false';
  } catch {
    // Storage unavailable — keep the default (enabled).
  }
}

/**
 * Persist the preference AND update the in-memory gate immediately so the
 * very next press respects the new value (no async re-read needed).
 */
export async function setHapticFeedbackEnabled(enabled: boolean): Promise<void> {
  hapticFeedbackEnabled = enabled;
  try {
    await AsyncStorage.setItem(HAPTIC_FEEDBACK_STORAGE_KEY, String(enabled));
  } catch {
    // Storage write failed — the in-memory gate still applies for this session.
  }
}

/** Current value of the user's haptic feedback preference. */
export function isHapticFeedbackEnabled(): boolean {
  return hapticFeedbackEnabled;
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Vibration } = require('react-native') as {
  Vibration?: { vibrate(duration: number | number[]): void; cancel(): void };
};

/**
 * Trigger a light haptic pulse suitable for primary button presses.
 *
 * Silently no-ops when:
 * - The user disabled haptic feedback in Settings
 * - Vibration API is unavailable (simulators, RN versions without it)
 * - VIBRATE permission is not yet granted (needs APK rebuild after
 *   adding <uses-permission> to AndroidManifest.xml)
 * - Any native exception occurs
 */
export function hapticLightPress(): void {
  if (!hapticFeedbackEnabled || !Vibration) return;
  try {
    Vibration.vibrate(BUTTON_PRESS_PATTERN);
  } catch {
    // VIBRATE permission not yet granted or API unavailable — OK to skip
  }
}

/**
 * Trigger a haptic pulse with a custom duration.
 * Prefer hapticLightPress() for standard button interactions.
 */
export function hapticPulse(durationMs: number): void {
  if (!hapticFeedbackEnabled || !Vibration) return;
  try {
    Vibration.vibrate(durationMs);
  } catch {
    // Silently ignore
  }
}

/**
 * Cancel any ongoing vibration.
 * Deliberately NOT gated on the preference — if the user just disabled
 * haptics mid-vibration, this still stops the running pulse.
 */
export function hapticCancel(): void {
  if (!Vibration) return;
  try {
    Vibration.cancel();
  } catch {
    // Silently ignore
  }
}
