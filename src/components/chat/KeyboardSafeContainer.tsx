/**
 * KeyboardSafeContainer — reliable keyboard avoidance for chat screens.
 *
 * Why this exists:
 *   On RN ≥ 0.81 (New Architecture) Android edge-to-edge is enabled by default,
 *   so `windowSoftInputMode="adjustResize"` no longer resizes the window and the
 *   keyboard simply overlays the app. `KeyboardAvoidingView` with
 *   `behavior={undefined}` on Android therefore offsets NOTHING — the input bar
 *   is hidden behind the keyboard and the user can't type.
 *
 * Solution:
 *   Listen to Keyboard show/hide events and animate a `paddingBottom` on the
 *   container. This is a pure-JS approach (no native dependency, no rebuild)
 *   and works identically on iOS and Android, including with the inline emoji
 *   picker and the input bar's own safe-area padding.
 *
 * Note: `keyboardDidShow` is used on Android (events may not fire in time with
 * will-*); `keyboardWillShow` is used on iOS for a smooth animation.
 */
import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Keyboard,
  Platform,
  Easing,
  StyleProp,
  ViewStyle,
} from 'react-native';

interface KeyboardSafeContainerProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Extra offset (px) added on top of the measured keyboard height. */
  extraOffset?: number;
}

export const KeyboardSafeContainer: React.FC<KeyboardSafeContainerProps> = ({
  children,
  style,
  extraOffset = 0,
}) => {
  const paddingBottom = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const showEvent =
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent =
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onShow = (e: any) => {
      const height = e?.endCoordinates?.height ?? 0;
      if (height <= 0) return;
      Animated.timing(paddingBottom, {
        toValue: height + extraOffset,
        duration: Platform.OS === 'ios' ? 250 : 160,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start();
    };

    const onHide = () => {
      Animated.timing(paddingBottom, {
        toValue: 0,
        duration: Platform.OS === 'ios' ? 200 : 120,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: false,
      }).start();
    };

    const subs = [
      Keyboard.addListener(showEvent, onShow),
      Keyboard.addListener(hideEvent, onHide),
    ];

    return () => subs.forEach(s => s.remove());
  }, [paddingBottom, extraOffset]);

  return (
    <Animated.View style={[style, { paddingBottom }]}>{children}</Animated.View>
  );
};

export default KeyboardSafeContainer;
