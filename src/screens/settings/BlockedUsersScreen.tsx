/**
 * BlockedUsersScreen — the "Blocked Users" settings sub-screen.
 *
 * Lists every cloud user the local user has blocked (from the ⋮ menu on a
 * user's public profile) with avatar + name + a one-tap Unblock action.
 * Unblocking immediately restores the user's AI characters, posts and profile
 * on every surface (Discover, Market, Characters, notification feed).
 */
import React, { useCallback, useState } from 'react';
import { StyleSheet, ScrollView, View, TouchableOpacity } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../contexts/ThemeContext';
import { useToast } from '../../contexts/AppToastContext';
import { ThemedView } from '../../components/themed/ThemedView';
import { ThemedText } from '../../components/themed/ThemedText';
import { ThemedCard } from '../../components/themed/ThemedCard';
import { ThemedEmptyState } from '../../components/themed/ThemedEmptyState';
import { ScreenHeader } from '../../components/themed/ScreenHeader';
import { hapticLightPress } from '../../utils/haptics';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { ProfileAvatar } from '../../components/profile/ProfileAvatar';
import {
  getBlockedUsers,
  removeBlockedUser,
  BlockedUserEntry,
} from '../../database/repositories/userSocial';
import { hexToRgba } from '../../utils/colorUtils';

export const BlockedUsersScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { theme } = useAppTheme();
  const { t } = useTranslation('profile');
  const { showToast } = useToast();
  const [entries, setEntries] = useState<BlockedUserEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const loadBlocked = useCallback(async () => {
    try {
      setLoading(true);
      const blocked = await getBlockedUsers();
      setEntries(blocked);
    } catch {
      // ignore — empty list on error
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadBlocked();
    }, [loadBlocked]),
  );

  const handleUnblock = async (entry: BlockedUserEntry) => {
    hapticLightPress();
    try {
      await removeBlockedUser(entry.blockedUserId);
      showToast(
        t('userUnblockedToast', { name: entry.blockedDisplayName }),
      );
      await loadBlocked();
    } catch {
      // ignore
    }
  };

  if (!theme) return null;

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader title={t('blockedUsersTitle')} onBack={() => navigation.goBack()} />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {!loading && entries.length === 0 ? (
          <ThemedEmptyState
            icon="account-cancel-outline"
            title={t('blockedUsersEmpty')}
            subtitle={t('blockedUsersEmptyHint')}
          />
        ) : (
          <ThemedCard elevated accentStripe style={styles.card}>
            {entries.map((entry, index) => (
              <View key={entry.blockedUserId}>
                {index > 0 && (
                  <View
                    style={[styles.separator, { backgroundColor: hexToRgba(theme.colors.border.default, 0.3) }]}
                  />
                )}
                <View style={styles.row}>
                  <ProfileAvatar
                    name={entry.blockedDisplayName || '?'}
                    uri={entry.blockedAvatarUrl}
                    size={44}
                  />
                  <View style={styles.rowText}>
                    <ThemedText size={15} weight="bold" numberOfLines={1}>
                      {entry.blockedDisplayName || 'Unknown user'}
                    </ThemedText>
                    <ThemedText variant="muted" size={12} numberOfLines={1}>
                      {entry.blockedUserId}
                    </ThemedText>
                  </View>
                  <TouchableOpacity
                    onPress={() => handleUnblock(entry)}
                    activeOpacity={0.7}
                    style={[
                      styles.unblockButton,
                      {
                        backgroundColor: hexToRgba(theme.colors.accent.primary, 0.15),
                        borderColor: hexToRgba(theme.colors.accent.primary, 0.4),
                      },
                    ]}
                    testID={`unblock-user-${entry.blockedUserId}`}
                  >
                    <Icon name="shield-account-outline" size={16} color={theme.colors.accent.primary} />
                    <ThemedText variant="accent" size={13} weight="medium">
                      {t('blockedUsersUnblock')}
                    </ThemedText>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </ThemedCard>
        )}
      </ScrollView>
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
    gap: 16,
  },
  card: {
    gap: 0,
    padding: 0,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 72,
  },
  unblockButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 99,
    borderWidth: StyleSheet.hairlineWidth,
  },
});

export default BlockedUsersScreen;