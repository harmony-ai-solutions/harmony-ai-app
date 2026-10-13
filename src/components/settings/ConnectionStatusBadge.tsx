import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useSyncConnection } from '../../contexts/SyncConnectionContext';
import { useAppTheme } from '../../contexts/ThemeContext';

/**
 * Small colored dot indicating current connection state.
 * Green = connected, Amber = reconnecting or paired-not-connected,
 * Red = not paired, or the sticky server-update-required gate (3-3/D57).
 *
 * Exposes a Maestro-friendly testID + accessibilityLabel so E2E flows can
 * assert on connection state without relying on color perception.
 * The testID is state-dependent: `connection-status-dot-connected`,
 * `connection-status-dot-reconnecting`, `connection-status-dot-disconnected`,
 * `connection-status-dot-not-paired`,
 * `connection-status-dot-server-update-required`.
 */

interface ConnectionStatusBadgeProps {
  /**
   * Deprecated (task 3-4): the sticky server-update-required gate is gone with
   * the sync stack. Kept optional for call-site compatibility; ignored.
   */
  serverUpdateRequired?: boolean;
}

export const ConnectionStatusBadge: React.FC<ConnectionStatusBadgeProps> = () => {
  const { isConnected, isPaired, isReconnecting } = useSyncConnection();
  const { theme } = useAppTheme();

  const color = isConnected
    ? (theme?.colors.status.success ?? '#4caf50')
    : isReconnecting || isPaired
      ? (theme?.colors.status.warning ?? '#ff9800')
      : (theme?.colors.status.error ?? '#f44336');

  // State-derived testID for E2E selectors. Maestro flows assert on these
  // IDs instead of brittle text matching.
  const testID = isConnected
    ? 'connection-status-dot-connected'
    : isReconnecting
      ? 'connection-status-dot-reconnecting'
      : isPaired
        ? 'connection-status-dot-disconnected'
        : 'connection-status-dot-not-paired';

  const accessibilityLabel = isConnected
    ? 'Connected'
    : isReconnecting
      ? 'Reconnecting'
      : isPaired
        ? 'Disconnected'
        : 'Not paired';

  return (
    <View
      style={[styles.badge, { backgroundColor: color }]}
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="image"
    />
  );
};

const styles = StyleSheet.create({
  badge: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginHorizontal: 8,
  },
});
