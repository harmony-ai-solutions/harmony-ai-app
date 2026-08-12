/**
 * ForwardPickerModal — choose a character to forward a message to.
 *
 * Lists all AI characters the user has chatted with (phone interactions),
 * sorted by most recent activity first. The selected character opens its
 * chat with the forwarded message pre-filled / auto-sent.
 */
import React, { useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  FlatList,
  TouchableOpacity,
  TouchableWithoutFeedback,
  ActivityIndicator,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useTranslation } from 'react-i18next';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { ProfileAvatar } from '../profile/ProfileAvatar';
import { hapticLightPress } from '../../utils/haptics';
import { getAllEntities } from '../../database/repositories/entities';
import { getRecentPhoneInteractions } from '../../database/repositories/interactions';
import {
  getCharacterProfile,
  getPrimaryImage,
  imageToDataURL,
} from '../../database/repositories/characters';
import { createLogger } from '../../utils/logger';

const log = createLogger('[ForwardPickerModal]');

export interface ForwardTarget {
  interactionId: string;
  participantKey: string;
  participantIds: string[];
  entityId: string;
  characterName: string;
  avatarUri: string | null;
}

interface ForwardPickerModalProps {
  visible: boolean;
  /** The user's own entity id (the impersonated identity). */
  ownEntityId: string;
  /** The message content being forwarded. */
  messageText: string;
  onSelect: (target: ForwardTarget) => void;
  onClose: () => void;
}

export const ForwardPickerModal: React.FC<ForwardPickerModalProps> = ({
  visible,
  ownEntityId,
  messageText,
  onSelect,
  onClose,
}) => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('chatDetail');
  const { bottom: safeBottom } = useSafeAreaInsets();
  const [targets, setTargets] = useState<ForwardTarget[]>([]);
  const [loading, setLoading] = useState(false);

  const loadTargets = useCallback(async () => {
    if (!visible) return;
    setLoading(true);
    try {
      const entities = await getAllEntities();
      const entityMap = new Map(entities.map(e => [e.id, e]));
      const interactions = await getRecentPhoneInteractions(ownEntityId, 100);

      const list: ForwardTarget[] = [];
      const seenParticipantKeys = new Set<string>();

      for (const interaction of interactions) {
        const scope = interaction.interaction_scope;
        if (scope !== 'private') continue; // Only forward to 1:1 chats

        const participantKey = interaction.participant_key || '';
        if (!participantKey || seenParticipantKeys.has(participantKey)) continue;
        seenParticipantKeys.add(participantKey);

        let participantIds: string[] = [];
        try {
          participantIds = JSON.parse(interaction.participant_ids);
        } catch {
          participantIds = [];
        }

        const partnerEntityId = participantIds.find(id => id !== ownEntityId);
        if (!partnerEntityId) continue;
        const entity = entityMap.get(partnerEntityId);
        if (!entity) continue; // skip deleted entities

        // Display name: alias > character profile name > entity id
        let characterName = entity.alias || partnerEntityId;
        let avatarUri: string | null = null;
        if (entity.character_profile_id) {
          const profile = await getCharacterProfile(entity.character_profile_id);
          if (profile?.name) characterName = profile.name;
          const primaryImage = await getPrimaryImage(entity.character_profile_id);
          if (primaryImage) {
            avatarUri = imageToDataURL(primaryImage);
          }
        }

        list.push({
          interactionId: interaction.id,
          participantKey,
          participantIds,
          entityId: partnerEntityId,
          characterName,
          avatarUri,
        });
      }

      // getRecentPhoneInteractions already sorts by last_activity_at DESC,
      // so the list is ordered most-recent first.
      setTargets(list);
    } catch (err) {
      log.error('Failed to load forward targets:', err);
      setTargets([]);
    } finally {
      setLoading(false);
    }
  }, [visible, ownEntityId]);

  React.useEffect(() => {
    loadTargets();
  }, [loadTargets]);

  if (!theme) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback>
            <LinearGradient
              colors={[
                theme.colors.background.elevated,
                theme.colors.background.surface,
              ]}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={[
                styles.sheet,
                { paddingBottom: Math.max(safeBottom, 16) },
              ]}
            >
              {/* Accent top stripe */}
              <LinearGradient
                colors={[
                  theme.colors.accent.primary + 'CC',
                  (theme.colors.accent.secondary ?? theme.colors.accent.primaryHover) + '66',
                  'transparent',
                ]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.topStripe}
              />

              {/* Drag handle */}
              <View
                style={[
                  styles.handle,
                  { backgroundColor: theme.colors.border.default },
                ]}
              />

              {/* Header */}
              <View style={styles.header}>
                <View style={styles.headerText}>
                  <ThemedText size={17} weight="bold" hierarchy="header">
                    {t('forwardTitle')}
                  </ThemedText>
                  <ThemedText size={12} variant="muted" numberOfLines={2} hierarchy="caption">
                    {t('forwardCaption')}
                  </ThemedText>
                </View>
                <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Icon name="close" size={22} color={theme.colors.text.muted} />
                </TouchableOpacity>
              </View>

              {/* Message preview */}
              {messageText ? (
                <View style={[styles.preview, { backgroundColor: theme.colors.accent.primary + '10' }]}>
                  <Icon name="share-variant" size={16} color={theme.colors.accent.primary} />
                  <ThemedText size={13} numberOfLines={2} variant="secondary" style={styles.previewText}>
                    {messageText}
                  </ThemedText>
                </View>
              ) : null}

              <View
                style={[
                  styles.separator,
                  { backgroundColor: theme.colors.border.default + '44' },
                ]}
              />

              {/* Target list */}
              {loading ? (
                <View style={styles.loadingWrap}>
                  <ActivityIndicator size="large" color={theme.colors.accent.primary} />
                </View>
              ) : targets.length === 0 ? (
                <View style={styles.loadingWrap}>
                  <ThemedText size={14} variant="muted">
                    {t('forwardEmpty')}
                  </ThemedText>
                </View>
              ) : (
                <FlatList
                  data={targets}
                  keyExtractor={item => item.participantKey}
                  showsVerticalScrollIndicator={false}
                  style={styles.list}
                  contentContainerStyle={styles.listContent}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={styles.row}
                      onPress={() => {
                        hapticLightPress();
                        onSelect(item);
                      }}
                      activeOpacity={0.65}
                      testID="forward-target-row"
                    >
                      <ProfileAvatar name={item.characterName} uri={item.avatarUri} size={44} showRing={false} />
                      <View style={styles.rowInfo}>
                        <ThemedText size={15} weight="medium" numberOfLines={1}>
                          {item.characterName}
                        </ThemedText>
                      </View>
                      <Icon name="send" size={18} color={theme.colors.accent.primary} />
                    </TouchableOpacity>
                  )}
                />
              )}
            </LinearGradient>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
    maxHeight: '75%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 12,
  },
  topStripe: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    marginTop: 10,
    marginBottom: 12,
    opacity: 0.5,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  headerText: {
    flex: 1,
    marginRight: 12,
  },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    marginHorizontal: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 4,
  },
  previewText: {
    flex: 1,
    marginLeft: 8,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 20,
    marginVertical: 14,
  },
  list: {
    maxHeight: 400,
  },
  listContent: {
    paddingBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    gap: 12,
  },
  rowInfo: {
    flex: 1,
  },
  loadingWrap: {
    paddingVertical: 40,
    alignItems: 'center',
  },
});
