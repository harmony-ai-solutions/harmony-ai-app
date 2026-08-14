/**
 * NotificationsScreen — the user's notification feed.
 *
 * Lists notifications from the client-only `notifications` table (who followed
 * the user, liked their AI profile / image / post, or commented on their posts
 * / images). Rows show the actor avatar + name, a type icon, the notification
 * text and a timestamp. Opening the screen marks everything as read.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedText } from '../components/themed/ThemedText';
import { ThemedEmptyState } from '../components/themed/ThemedEmptyState';
import { ScreenHeader } from '../components/themed/ScreenHeader';
import { ProfileAvatar } from '../components/profile/ProfileAvatar';
import { hexToRgba } from '../utils/colorUtils';
import { formatPostDate } from '../utils/dateFormat';
import { createLogger } from '../utils/logger';
import {
  getNotifications,
  markAllNotificationsRead,
  AppNotification,
  NotificationType,
} from '../database/repositories/userSocial';

const log = createLogger('[NotificationsScreen]');

function typeIcon(type: NotificationType): string {
  switch (type) {
    case 'follow':
      return 'account-plus-outline';
    case 'profile_like':
      return 'heart-outline';
    case 'image_like':
      return 'heart-outline';
    case 'image_comment':
      return 'comment-outline';
    case 'post_like':
      return 'heart-outline';
    case 'post_comment':
      return 'comment-outline';
    default:
      return 'bell-outline';
  }
}

export const NotificationsScreen: React.FC = () => {
  const { theme } = useAppTheme();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const { t } = useTranslation('profile');
  const { user } = useAuth();
  const navigation = useNavigation<any>();

  const [items, setItems] = useState<AppNotification[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) return;
    try {
      const data = await getNotifications(user.id);
      setItems(data);
    } catch (err) {
      log.error('Failed to load notifications:', err);
    }
  }, [user?.id]);

  // Load + mark everything read on focus (opening the feed reads it).
  useEffect(() => {
    load();
    if (user?.id) {
      markAllNotificationsRead(user.id).catch(err =>
        log.warn('Failed to mark notifications read:', err),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, user?.id]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (!theme) return null;

  const accent = theme.colors.accent.primary;

  return (
    <ThemedView variant="base" style={styles.container}>
      <ScreenHeader title={t('notificationsTitle')} onBack={() => navigation.goBack()} />

      <FlatList
        style={{ flex: 1 }}
        data={items}
        keyExtractor={item => item.id}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: safeBottom + 24 },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[accent]}
            tintColor={accent}
            progressBackgroundColor={theme.colors.background.surface}
          />
        }
        ListEmptyComponent={
          <ThemedEmptyState
            icon="bell-outline"
            title={t('notificationsEmpty')}
            subtitle={t('notificationsEmptyHint')}
            style={styles.empty}
          />
        }
        renderItem={({ item }) => {
          const unread = !item.isRead;
          return (
            <View
              style={[
                styles.row,
                unread && { backgroundColor: hexToRgba(accent, 0.08) },
              ]}
            >
              <ProfileAvatar
                name={item.actorDisplayName || '?'}
                uri={item.actorAvatarUrl}
                size={40}
                showRing={false}
              />
              <View style={styles.rowBody}>
                <View style={styles.rowTextLine}>
                  <Icon
                    name={typeIcon(item.type)}
                    size={14}
                    color={accent}
                    style={styles.rowIcon}
                  />
                  <ThemedText variant="secondary" size={13} style={styles.rowText}>
                    {item.text}
                  </ThemedText>
                </View>
                <ThemedText variant="muted" size={11} style={styles.rowTime}>
                  {formatPostDate(item.createdAt)}
                </ThemedText>
              </View>
              {unread && (
                <View style={[styles.unreadDot, { backgroundColor: accent }]} />
              )}
            </View>
          );
        }}
      />
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  empty: {
    paddingVertical: 48,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    marginBottom: 6,
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  rowTextLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rowIcon: {
    flexShrink: 0,
  },
  rowText: {
    flex: 1,
  },
  rowTime: {
    marginTop: 1,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});

export default NotificationsScreen;
