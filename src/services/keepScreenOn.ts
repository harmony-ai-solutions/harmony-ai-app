/**
 * keepScreenOn — keep the display awake while audio plays or the app is locked.
 *
 * The app holds no OTHER screen keep-awake anywhere, so whenever the OS dims
 * and sleeps the display the Activity stops → applifecycle ON_STOP → the
 * biometric lock re-arms (with zero grace). This wrapper drives the
 * first-party native helpers (NO new npm dependency):
 *
 *  - Android → `android/.../keepawake/KeepScreenOnModule.kt`
 *    (`WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON` on the current
 *    Activity's window; no Activity is a no-op).
 *  - iOS → `ios/KeepAwake/KeepScreenOnModule.m`
 *    (`UIScreen.mainScreen.idleTimerDisabled` on the main queue).
 *
 * Both platforms expose the SAME bridge name (`NativeModules.KeepScreenOn`),
 * so callers stay platform-agnostic. The module is absent off-device / in a
 * bare jest run / on web — every call degrades to a no-op (logged ONCE at INFO
 * so a shipped build's app-logs show the missing bridge instead of staying
 * silent).
 *
 * ## Refcounting (more than one consumer)
 *
 * The window flag / idle timer is a single global switch but consumers overlap:
 * `TtsTestPanel` holds it across synthesis + playback, and `LockScreen` holds it
 * while the app is locked (the panel can still be mounted underneath). So the
 * wrapper refcounts: [activateKeepScreenOn] takes a hold, [deactivateKeepScreenOn]
 * releases one, and the native side is toggled on the 0 → 1 and 1 → 0 edges
 * only. Semantics = "held while ANY consumer holds it" (last release wins);
 * releases below zero are ignored, so an unbalanced/unmount-time extra release
 * can never leave the flag on by accident. Callers stay balanced by pairing
 * activate/deactivate inside one effect (`useEffect(() => { activate(); return
 * () => deactivate(); }, [held])`).
 *
 * ## Foreground re-assert
 *
 * `FLAG_KEEP_SCREEN_ON` / `idleTimerDisabled` belong to the CURRENT Activity
 * window / screen, while this module's refcount lives in JS — an Activity
 * recreation (or simply the flag being cleared while the process was
 * backgrounded) would otherwise leave keep-awake silently dead with a non-zero
 * refcount. While at least one consumer holds it, the wrapper subscribes to
 * `AppLifecycle` and RE-APPLIES the flag on every return to `active`
 * (foreground). The Android module reads `currentActivity` at call time, so the
 * re-assert lands on the NEW window; no Kotlin change is needed.
 */

import { NativeModules } from 'react-native';
import type { AppStateStatus } from 'react-native';
import { AppLifecycle } from 'react-native-applifecycle';
import { createLogger } from '../utils/logger';

const log = createLogger('[keepScreenOn]');

/** The native module surface this wrapper needs. */
interface KeepScreenOnBridge {
  activate(): Promise<void>;
  deactivate(): Promise<void>;
}

/** Number of live consumers holding the wake lock (see the refcount note). */
let holders = 0;

/** Whether the native flag is believed to be set on the CURRENT window. */
let nativeActive = false;

/** Foreground listener, alive only while at least one consumer holds it. */
let lifecycleSubscription: { remove(): void } | null = null;

/** The missing-bridge INFO line is worth exactly once per app process. */
let missingBridgeLogged = false;

function getBridge(): KeepScreenOnBridge | null {
  const mod = (NativeModules as Record<string, unknown>).KeepScreenOn as
    | Partial<KeepScreenOnBridge>
    | undefined;
  if (!mod || typeof mod.activate !== 'function' || typeof mod.deactivate !== 'function') {
    return null;
  }
  return mod as KeepScreenOnBridge;
}

/** INFO (not debug): the native helper missing is a shipping defect. */
function logMissingBridgeOnce(): void {
  if (missingBridgeLogged) return;
  missingBridgeLogged = true;
  log.info(
    'KeepScreenOn native module unavailable — the display can sleep during playback/lock',
  );
}

/**
 * (Re)apply the flag on whatever Activity window is current right now.
 * Calling this again is what makes keep-awake survive a window recreation.
 */
async function applyNativeActive(): Promise<void> {
  const bridge = getBridge();
  if (!bridge) {
    nativeActive = false;
    logMissingBridgeOnce();
    return;
  }
  try {
    await bridge.activate();
    nativeActive = true;
  } catch (error) {
    nativeActive = false;
    log.warn('Failed to activate keep-screen-on:', error);
  }
}

/**
 * A return to `active` means the app is foregrounded on a (possibly NEW)
 * Activity window: re-assert so a recreated window cannot silently lose the
 * flag while a consumer still holds it.
 */
function handleLifecycleChange(next: AppStateStatus): void {
  if (next !== 'active' || holders === 0) return;
  void applyNativeActive();
}

function ensureLifecycleListener(): void {
  if (lifecycleSubscription) return;
  try {
    lifecycleSubscription = AppLifecycle.addEventListener('change', handleLifecycleChange);
  } catch (error) {
    log.debug('AppLifecycle listener unavailable — keep-screen-on will not re-assert:', error);
  }
}

function releaseLifecycleListener(): void {
  if (!lifecycleSubscription) return;
  const subscription = lifecycleSubscription;
  lifecycleSubscription = null;
  try {
    subscription.remove();
  } catch (error) {
    log.debug('Could not remove the AppLifecycle listener:', error);
  }
}

/**
 * Keep the screen on. Takes one hold — safe to call repeatedly as long as every
 * call is paired with a [deactivateKeepScreenOn]. Never throws.
 */
export async function activateKeepScreenOn(): Promise<void> {
  holders += 1;
  ensureLifecycleListener();
  // Another consumer already holds the native flag — nothing to toggle.
  if (holders > 1 && nativeActive) return;
  await applyNativeActive();
}

/**
 * Release one hold. The native flag is cleared when the LAST consumer releases
 * (and a floor of zero is ignored, so an extra release is harmless). Never
 * throws.
 */
export async function deactivateKeepScreenOn(): Promise<void> {
  if (holders === 0) return;
  holders -= 1;
  if (holders > 0) return;

  releaseLifecycleListener();
  const wasActive = nativeActive;
  nativeActive = false;
  if (!wasActive) return;

  const bridge = getBridge();
  if (!bridge) {
    logMissingBridgeOnce();
    return;
  }
  try {
    await bridge.deactivate();
  } catch (error) {
    log.warn('Failed to deactivate keep-screen-on:', error);
  }
}
