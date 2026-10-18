/**
 * BootSplash — the branded full-screen boot visual.
 *
 * Extracted from `AuthGate`'s former `GateSplash` so the SAME branded splash is
 * reused by every launch gate:
 *
 *   - `AuthGate` (store variant) — while the auth status loads.
 *   - `EngineBootGate` — while the embedded engine boots (owner ruling
 *     2026-10-18: hold the branded splash until the engine reports ready).
 *
 * It is deliberately dumb: brand wordmark + spinner + a caller-supplied status
 * label. The label is a prop (not resolved here) so each gate picks its own i18n
 * namespace, and the `testIDPrefix` lets each usage keep its stable test IDs
 * (container = `${prefix}`, spinner = `${prefix}-spinner`).
 */

import React from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedView } from '../themed/ThemedView';
import { ThemedText } from '../themed/ThemedText';

export interface BootSplashProps {
  /** The status label shown under the spinner (already translated). */
  label: string;
  /**
   * testID prefix. The container gets `testIDPrefix` verbatim and the spinner
   * gets `${testIDPrefix}-spinner`. Defaults to `boot-splash`.
   */
  testIDPrefix?: string;
  /** Brand wordmark. Defaults to `Soulbits`. */
  brand?: string;
}

export const BootSplash: React.FC<BootSplashProps> = ({
  label,
  testIDPrefix = 'boot-splash',
  brand = 'Soulbits',
}) => {
  const { theme } = useAppTheme();

  return (
    <ThemedView style={styles.splash} testID={testIDPrefix}>
      <ThemedText weight="bold" size={30} hierarchy="header" style={styles.brand}>
        {brand}
      </ThemedText>
      <ActivityIndicator
        color={theme?.colors.accent.primary ?? '#8f3ba7'}
        testID={`${testIDPrefix}-spinner`}
      />
      <ThemedText variant="secondary" size={14} style={styles.label}>
        {label}
      </ThemedText>
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  brand: {
    letterSpacing: 1,
  },
  label: {
    textAlign: 'center',
  },
});

export default BootSplash;
