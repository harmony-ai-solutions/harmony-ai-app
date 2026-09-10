import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Shared reduced-motion hook — extracted from the ad-hoc pattern in
 * StatusPulseDot.tsx (§A19).
 *
 * Returns `true` when the OS "reduce motion" accessibility setting is enabled,
 * and re-renders live when the setting changes while the app is foregrounded
 * (listens to the `reduceMotionChanged` event).
 */
export function useReducedMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged' as any,
      setReduceMotion as any,
    );
    return () => {
      subscription.remove();
    };
    // AccessibilityInfo.addEventListener API: RN 0.76+ returns { remove }.
    // For older RN, the eventEmitter-based addEventListener returns a
    // `remove`-able subscription either way.
  }, []);

  return reduceMotion;
}
