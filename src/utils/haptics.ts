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
 */

/** Sharp double-tap pattern: vibrate 15ms, pause 30ms, vibrate 15ms */
const BUTTON_PRESS_PATTERN = [0, 15, 30, 15];

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Vibration } = require('react-native') as {
  Vibration?: { vibrate(duration: number | number[]): void; cancel(): void };
};

/**
 * Trigger a light haptic pulse suitable for primary button presses.
 *
 * Silently no-ops when:
 * - Vibration API is unavailable (simulators, RN versions without it)
 * - VIBRATE permission is not yet granted (needs APK rebuild after
 *   adding <uses-permission> to AndroidManifest.xml)
 * - Any native exception occurs
 */
export function hapticLightPress(): void {
  if (!Vibration) return;
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
  if (!Vibration) return;
  try {
    Vibration.vibrate(durationMs);
  } catch {
    // Silently ignore
  }
}

/**
 * Cancel any ongoing vibration.
 */
export function hapticCancel(): void {
  if (!Vibration) return;
  try {
    Vibration.cancel();
  } catch {
    // Silently ignore
  }
}
