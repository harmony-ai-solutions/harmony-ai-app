import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useSyncConnection } from '../../contexts/SyncConnectionContext';
import { useAppTheme } from '../../contexts/ThemeContext';

/**
 * Small colored dot indicating current connection state.
 * Green = connected, Amber = reconnecting or paired-not-connected, Red = not paired.
 */
export const ConnectionStatusBadge: React.FC = () => {
  const { isConnected, isPaired, isReconnecting } = useSyncConnection();
  const { theme } = useAppTheme();

  const color = isConnected
    ? (theme?.colors.status.success ?? '#4caf50')
    : isReconnecting || isPaired
      ? (theme?.colors.status.warning ?? '#ff9800')
      : (theme?.colors.status.error ?? '#f44336');

  return <View style={[styles.badge, { backgroundColor: color }]} />;
};

const styles = StyleSheet.create({
  badge: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginHorizontal: 8,
  },
});
