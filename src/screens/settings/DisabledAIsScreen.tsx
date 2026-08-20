/**
 * DisabledAIsScreen — the "Disabled AIs" settings sub-screen.
 *
 * Lists every AI the user has disabled (from the chat-list long-press menu or
 * the chat header menu) with avatar + name + a one-tap Enable action.
 * Enabling restores messaging for that conversation immediately.
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
import { getEntity } from '../../database/repositories/entities';
import { getCharacterProfile, getPrimaryImage, imageToDataURL } from '../../database/repositories/characters';
import {
  listConversationsByFlag,
  setConversationDisabled,
} from '../../database/repositories/chatConversationSettings';
import { hexToRgba } from '../../utils/colorUtils';
import EntitySessionService from '../../services/EntitySessionService';

interface DisabledEntry {
  participantKey: string;
  entityId: string | null;
  name: string;
  avatarUri: string | null;
}

export const DisabledAIsScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { theme } = useAppTheme();
  const { t } = useTranslation('settings');
  const { showToast } = useToast();
  const [entries, setEntries] = useState<DisabledEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const loadDisabled = useCallback(async () => {
    try {
      setLoading(true);
      const disabled = await listConversationsByFlag('blocked');
      const resolved: DisabledEntry[] = [];
      for (const settings of disabled) {
        let name = settings.participantKey;
        let avatarUri: string | null = null;
        if (settings.entityId) {
          const entity = await getEntity(settings.entityId);
          if (entity?.character_profile_id) {
            const profile = await getCharacterProfile(entity.character_profile_id);
            if (profile) name = profile.name;
            const image = await getPrimaryImage(entity.character_profile_id);
            if (image) avatarUri = imageToDataURL(image);
          } else if (entity) {
            name = entity.alias || settings.entityId;
          }
        }
        resolved.push({
          participantKey: settings.participantKey,
          entityId: settings.entityId,
          name,
          avatarUri,
        });
      }
      setEntries(resolved);
    } catch (error) {
      // ignore — empty list on error
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadDisabled();
    }, [loadDisabled]),
  );

  const handleEnable = async (entry: DisabledEntry) => {
    hapticLightPress();
    try {
      // Apply the in-memory override instantly so the send guard allows
      // messages immediately (no stale DB read delay).
      EntitySessionService.setDisabledOverride(entry.participantKey, false);
      await setConversationDisabled(entry.participantKey, entry.entityId, false);
      showToast(t('disabledAIsEnabledToast'));
      await loadDisabled();
    } catch (error) {
      // ignore
    }
  };

  if (!theme) return null;

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader title={t('disabledAIsTitle')} onBack={() => navigation.goBack()} />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {!loading && entries.length === 0 ? (
          <ThemedEmptyState
            icon="shield-off-outline"
            title={t('disabledAIsEmpty')}
            subtitle={t('disabledAIsEmptyHint')}
          />
        ) : (
          <ThemedCard elevated accentStripe style={styles.card}>
            {entries.map((entry, index) => (
              <View key={entry.participantKey}>
                {index > 0 && (
                  <View
                    style={[styles.separator, { backgroundColor: hexToRgba(theme.colors.border.default, 0.3) }]}
                  />
                )}
                <View style={styles.row}>
                  <ProfileAvatar name={entry.name} uri={entry.avatarUri} size={44} />
                  <View style={styles.rowText}>
                    <ThemedText size={15} weight="bold" numberOfLines={1}>
                      {entry.name}
                    </ThemedText>
                    <ThemedText variant="muted" size={12} numberOfLines={1}>
                      {entry.participantKey}
                    </ThemedText>
                  </View>
                  <TouchableOpacity
                    onPress={() => handleEnable(entry)}
                    activeOpacity={0.7}
                    style={[
                      styles.enableButton,
                      {
                        backgroundColor: hexToRgba(theme.colors.accent.primary, 0.15),
                        borderColor: hexToRgba(theme.colors.accent.primary, 0.4),
                      },
                    ]}
                    testID={`enable-${entry.entityId ?? entry.participantKey}`}
                  >
                    <Icon name="shield-account-outline" size={16} color={theme.colors.accent.primary} />
                    <ThemedText variant="accent" size={13} weight="medium">
                      {t('disabledAIsEnable')}
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
  enableButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 99,
    borderWidth: StyleSheet.hairlineWidth,
  },
});

export default DisabledAIsScreen;
