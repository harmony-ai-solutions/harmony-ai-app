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
 *  2. scroll the currently focused TextInput so its **bottom edge** (plus a
 *     small gap) sits above the keyboard's top edge.
 *
 * Why not ScrollView's `scrollResponderScrollNativeHandleToKeyboard`? Its
 * formula is `top - keyboardScreenY + height + gap`, which treats the focused
 * field's scroll-content Y as if the ScrollView started at window y=0. These
 * forms sit below a navigation/header bar, so that helper under-scrolls by
 * exactly the header height — the field's top reaches the keyboard line while
 * its bottom stays covered (the reported "stops a little too early" bug).
 * Measuring both the field and the keyboard in WINDOW coordinates avoids the
 * assumption: the scroll delta is simply how far the field's bottom extends
 * past the keyboard top.
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
  Dimensions,
  Keyboard,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
} from 'react-native';
import type {
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollViewProps,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { useKeyboardHeight } from '../../hooks/useKeyboardHeight';

export interface KeyboardAwareScrollViewProps extends ScrollViewProps {
  /** Gap between the focused input's bottom edge and the keyboard's top (px). */
  keyboardGap?: number;
}

/**
 * How far the content must scroll for `fieldBottom` to clear the keyboard top
 * by `keyboardGap`; 0 when the field is already clear.
 *
 * Exported for the regression test: the bug was scrolling by the distance to
 * the field's TOP edge instead of its BOTTOM edge.
 */
export function keyboardScrollOverflow({
  fieldBottom,
  keyboardTop,
  keyboardGap,
}: {
  fieldBottom: number;
  keyboardTop: number;
  keyboardGap: number;
}): number {
  return Math.max(0, fieldBottom + keyboardGap - keyboardTop);
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
>(
  (
    {
      contentContainerStyle,
      keyboardGap = 16,
      children,
      onScroll,
      scrollEventThrottle = 16,
      ...rest
    },
    ref,
  ) => {
    const innerRef = useRef<ScrollView>(null);
    // Android-only: on iOS the screens' native KeyboardAvoidingView already
    // reserves the space, so adding the inset here would double-compensate.
    const keyboardHeight = useKeyboardHeight(Platform.OS === 'android');
    // The last known offset, so a focus-time scroll can be expressed absolutely
    // (`scrollTo` takes an absolute Y, not a delta).
    const scrollOffset = useRef(0);

    useImperativeHandle(ref, () => innerRef.current as ScrollView, []);

    const scrollFocusedIntoView = useCallback(() => {
      if (keyboardHeight <= 0) return;
      const focused =
        typeof TextInput.State?.currentlyFocusedInput === 'function'
          ? TextInput.State.currentlyFocusedInput()
          : null;
      const scrollView = innerRef.current;
      if (!focused || !scrollView || typeof focused.measureInWindow !== 'function') {
        return;
      }

      focused.measureInWindow((_x, y, _width, height) => {
        // Keyboard.metrics() is the same source RN's own helper uses; when it
        // is momentarily unavailable, derive the top from the window height.
        const keyboardTop =
          Keyboard.metrics()?.screenY ??
          Dimensions.get('window').height - keyboardHeight;
        const overflow = keyboardScrollOverflow({
          fieldBottom: y + height,
          keyboardTop,
          keyboardGap,
        });
        if (overflow <= 0) return;
        scrollView.scrollTo({
          y: scrollOffset.current + overflow,
          animated: true,
        });
      });
    }, [keyboardGap, keyboardHeight]);

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

    const handleScroll = useCallback(
      (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        scrollOffset.current = event.nativeEvent.contentOffset.y;
        onScroll?.(event);
      },
      [onScroll],
    );

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
          onScroll={handleScroll}
          scrollEventThrottle={scrollEventThrottle}
          {...rest}
        >
          {children}
        </ScrollView>
      </KeyboardAwareScrollContext.Provider>
    );
  },
);

KeyboardAwareScrollView.displayName = 'KeyboardAwareScrollView';

export default KeyboardAwareScrollView;
