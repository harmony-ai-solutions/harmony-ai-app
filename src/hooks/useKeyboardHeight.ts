/**
 * useKeyboardHeight — the soft-keyboard height, the one mechanism the app uses
 * to react to the IME (chat composer, bottom sheets, scrolling forms).
 *
 * Why this exists: on Android 15 / targetSdk 35 the OS enforces edge-to-edge,
 * so the Activity is not resized and `android:windowSoftInputMode="adjustResize"`
 * no longer fires. `KeyboardAvoidingView` with `behavior` undefined (the
 * longstanding Android branch across the form screens) therefore does nothing
 * and the keyboard simply covers the focused input.
 *
 * Android only emits `keyboardDidShow` / `keyboardDidHide`; iOS emits both the
 * `keyboardWillShow`/`keyboardWillHide` and did-show/did-hide pairs.
 * Subscribing to all four keeps the hook platform-agnostic.
 *
 * `enabled` is for layouts that already get iOS compensation from a native
 * `KeyboardAvoidingView` (the scrolling forms pass `Platform.OS === 'android'`);
 * layouts that position themselves from the inset on every platform (the chat
 * composer, comment sheets) use the default.
 */

import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/** Fallback heights used when the event omits `endCoordinates`. */
const FALLBACK_KEYBOARD_HEIGHT = Platform.OS === 'android' ? 300 : 336;

export function useKeyboardHeight(enabled = true): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setHeight(0);
      return;
    }

    const onShow = (event?: { endCoordinates?: { height?: number } }) => {
      const reported = event?.endCoordinates?.height;
      setHeight(
        typeof reported === 'number' && reported > 0
          ? reported
          : FALLBACK_KEYBOARD_HEIGHT,
      );
    };
    const onHide = () => setHeight(0);

    const subscriptions = [
      Keyboard.addListener('keyboardWillShow', onShow),
      Keyboard.addListener('keyboardDidShow', onShow),
      Keyboard.addListener('keyboardWillHide', onHide),
      Keyboard.addListener('keyboardDidHide', onHide),
    ];

    return () => {
      subscriptions.forEach((subscription) => subscription.remove());
    };
  }, [enabled]);

  return height;
}

export default useKeyboardHeight;
