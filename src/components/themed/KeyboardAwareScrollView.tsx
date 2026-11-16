/**
 * KeyboardAwareScrollView — the shared "keyboard does not cover the form"
 * scroll container for the text-input screens.
 *
 * On Android 15 edge-to-edge the window no longer resizes for the IME
 * (`adjustResize` does not fire), so `KeyboardAvoidingView` + `ScrollView`
 * leaves the focused field underneath the keyboard — the owner-reported
 * "keyboard gets placed above the input fields" bug on the module-config
 * screens. This component applies the shared IME inset
 * (`useKeyboardHeight`, the same primitive the chat composer and the bottom
 * sheets use) to any scrolling form:
 *
 *  1. reserve the keyboard height as extra bottom content padding (so the
 *     content can scroll clear of the IME), and
 *  2. scroll the currently focused TextInput above the keyboard using
 *     ScrollView's own `scrollResponderScrollNativeHandleToKeyboard` — which
 *     compensates against the keyboard metrics RN's ScrollView already tracks.
 *
 * iOS is deliberately left to the screens' native `KeyboardAvoidingView`
 * (`behavior="padding"`): adding content padding there would double-compensate.
 */

import React, {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
} from 'react-native';
import type { ScrollViewProps, StyleProp, ViewStyle } from 'react-native';
import { useKeyboardHeight } from '../../hooks/useKeyboardHeight';

export interface KeyboardAwareScrollViewProps extends ScrollViewProps {
  /** Gap between the focused input and the keyboard's top edge (px). */
  keyboardGap?: number;
}

/**
 * Called by a text input when it gains focus. While the keyboard is already
 * open, any input in the container can be brought above it; when the keyboard
 * is still opening, the did-show effect below performs the scroll once the IME
 * metrics exist.
 */
const KeyboardAwareScrollContext = createContext<() => void>(() => {});

/**
 * The focus handler for a text input inside a {@link KeyboardAwareScrollView}.
 * A no-op outside one, so the shared field components stay usable everywhere.
 */
export function useKeyboardAwareFocus(): () => void {
  return useContext(KeyboardAwareScrollContext);
}

export const KeyboardAwareScrollView = forwardRef<
  ScrollView,
  KeyboardAwareScrollViewProps
>(({ contentContainerStyle, keyboardGap = 16, children, ...rest }, ref) => {
  const innerRef = useRef<ScrollView>(null);
  // Android-only: on iOS the screens' native KeyboardAvoidingView already
  // reserves the space, so adding the inset here would double-compensate.
  const keyboardHeight = useKeyboardHeight(Platform.OS === 'android');

  useImperativeHandle(ref, () => innerRef.current as ScrollView, []);

  const scrollFocusedIntoView = useCallback(() => {
    const focused =
      typeof TextInput.State?.currentlyFocusedInput === 'function'
        ? TextInput.State.currentlyFocusedInput()
        : null;
    if (!focused) return;
    innerRef.current?.scrollResponderScrollNativeHandleToKeyboard(
      focused,
      keyboardGap,
      true,
    );
  }, [keyboardGap]);

  const handleInputFocus = useCallback(() => {
    // Only scroll when the IME is already up (its metrics drive the offset).
    // The opening sequence is handled by the did-show effect below.
    if (keyboardHeight > 0) scrollFocusedIntoView();
  }, [keyboardHeight, scrollFocusedIntoView]);

  useEffect(() => {
    if (keyboardHeight <= 0) return;
    // Give the reserved padding one frame to lay out before measuring.
    const timer = setTimeout(scrollFocusedIntoView, 80);
    return () => clearTimeout(timer);
  }, [keyboardHeight, scrollFocusedIntoView]);

  const flattened = StyleSheet.flatten(
    contentContainerStyle as StyleProp<ViewStyle>,
  ) as ViewStyle | undefined;
  const basePaddingBottom =
    typeof flattened?.paddingBottom === 'number' ? flattened.paddingBottom : 0;

  return (
    <KeyboardAwareScrollContext.Provider value={handleInputFocus}>
      <ScrollView
        ref={innerRef}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          contentContainerStyle,
          keyboardHeight > 0
            ? { paddingBottom: basePaddingBottom + keyboardHeight }
            : null,
        ]}
        {...rest}
      >
        {children}
      </ScrollView>
    </KeyboardAwareScrollContext.Provider>
  );
});

KeyboardAwareScrollView.displayName = 'KeyboardAwareScrollView';

export default KeyboardAwareScrollView;
