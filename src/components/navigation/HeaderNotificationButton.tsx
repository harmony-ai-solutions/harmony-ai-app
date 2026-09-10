/**
 * HeaderNotificationButton — "bell" notification button for principal screens.
 *
 * Renders a compact obsidian-glass circular button (matching HeaderMenuButton)
 * with a MaterialCommunityIcons bell. A small accent badge shows the unread
 * notification count, pushed live from the in-memory NotificationService
 * (`subscribe` → 'unread' events — not reload-synced, so the badge updates the
 * moment the count changes). Tapping opens the Notifications screen (pushed
 * over the tabs from the root stack).
 */

import React, { useEffect, useState } from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import { useAppTheme } from '../../contexts/ThemeContext';
import { hexToRgba } from '../../utils/colorUtils';
import { hapticLightPress } from '../../utils/haptics';
import { notificationService } from '../../services/social/NotificationService';
import { ThemedText } from '../themed/ThemedText';

export const HeaderNotificationButton: React.FC = () => {
  const { theme } = useAppTheme();
  const navigation = useNavigation<any>();

  const [unread, setUnread] = useState(0);

  // Push updates from the NotificationService — subscribe once on mount and
  // seed the badge with the current count. The service emits 'unread' whenever
  // markRead/markAllRead changes the count, so the badge stays live without
  // focus-driven reloads (the pattern the F8 bubble follows later).
  useEffect(() => {
    const unsubscribe = notificationService.subscribe(count => setUnread(count));
    setUnread(notificationService.getUnreadCount());
    return unsubscribe;
  }, []);

  if (!theme) return null;

  const accentPrimary = theme.colors.accent.primary;
  const accentSecondary = theme.colors.accent.secondary;
  const baseHex = theme.colors.background.base;

  const handlePress = () => {
    hapticLightPress();
    navigation.navigate('Notifications');
  };

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.7}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityLabel="Notifications"
      accessibilityRole="button"
      testID="header-notification-button"
      style={[styles.button, { backgroundColor: hexToRgba(baseHex, 0.75) }]}
    >
      <LinearGradient
        colors={[accentPrimary + '18', 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <Icon name="bell-outline" size={19} color={theme.colors.text.secondary} />

      {unread > 0 && (
        <View
          style={[styles.badge, { backgroundColor: accentPrimary }]}
          testID="header-notification-badge"
        >
          <ThemedText size={9} weight="bold" style={{ color: '#fff' }}>
            {unread > 99 ? '99+' : unread}
          </ThemedText>
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 3,
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default HeaderNotificationButton;
