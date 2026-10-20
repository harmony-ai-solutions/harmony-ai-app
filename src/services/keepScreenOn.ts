/**
 * keepScreenOn — keep the display awake while audio plays.
 *
 * The app holds no screen keep-awake anywhere, so the OS dims and sleeps the
 * screen during a long listen → AppState goes `background` → the biometric
 * lock re-arms mid-playback. This wrapper drives the first-party native
 * helpers (NO new npm dependency):
 *
 *  - Android → `android/.../keepawake/KeepScreenOnModule.kt`
 *    (`WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON` on the current
 *    Activity's window; no Activity is a no-op).
 *  - iOS → `ios/KeepAwake/KeepScreenOnModule.m`
 *    (`UIScreen.mainScreen.idleTimerDisabled` on the main queue).
 *
 * Both platforms expose the SAME bridge name (`NativeModules.KeepScreenOn`),
 * so callers stay platform-agnostic. The module is absent off-device / in a
 * bare jest run / on web — every call degrades to a silent no-op so callers
 * never branch on the module's presence.
 *
 * Both calls are idempotent per direction (the `active` flag), which keeps the
 * common `useEffect(() => { activate(); return () => deactivate(); }, [playing])`
 * pattern from re-toggling the flag on every re-render.
 */

import { NativeModules } from 'react-native';
import { createLogger } from '../utils/logger';

const log = createLogger('[keepScreenOn]');

/** The native module surface this wrapper needs. */
interface KeepScreenOnBridge {
  activate(): Promise<void>;
  deactivate(): Promise<void>;
}

/** `true` while we hold the wake lock, so toggles stay balanced. */
let active = false;

function getBridge(): KeepScreenOnBridge | null {
  const mod = (NativeModules as Record<string, unknown>).KeepScreenOn as
    | Partial<KeepScreenOnBridge>
    | undefined;
  if (!mod || typeof mod.activate !== 'function' || typeof mod.deactivate !== 'function') {
    return null;
  }
  return mod as KeepScreenOnBridge;
}

/**
 * Keep the screen on. Safe to call repeatedly — already-active is a no-op.
 * Never throws (a missing bridge or a native error is logged at debug/warn).
 */
export async function activateKeepScreenOn(): Promise<void> {
  if (active) return;
  const bridge = getBridge();
  if (!bridge) {
    log.debug('KeepScreenOn native module unavailable — skipping activate');
    return;
  }
  // Flip first so concurrent callers don't double-activate; roll back on error.
  active = true;
  try {
    await bridge.activate();
  } catch (error) {
    active = false;
    log.warn('Failed to activate keep-screen-on:', error);
  }
}

/**
 * Release the wake lock. Safe to call repeatedly — already-released is a
 * no-op, so the effect cleanup can run unconditionally. Never throws.
 */
export async function deactivateKeepScreenOn(): Promise<void> {
  if (!active) return;
  const bridge = getBridge();
  active = false;
  if (!bridge) {
    log.debug('KeepScreenOn native module unavailable — skipping deactivate');
    return;
  }
  try {
    await bridge.deactivate();
  } catch (error) {
    log.warn('Failed to deactivate keep-screen-on:', error);
  }
}
