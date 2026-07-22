import React, { useEffect, useState, useCallback } from 'react';
import {
  StyleSheet,
  View,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import {
  Avatar,
  ActivityIndicator,
} from 'react-native-paper';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { RootStackParamList } from '../navigation/AppNavigator';
import { useAppTheme } from '../contexts/ThemeContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedText } from '../components/themed/ThemedText';
import { ThemedButton } from '../components/themed/ThemedButton';
import { ThemedFab } from '../components/themed/ThemedFab';
import { ScreenHeader } from '../components/themed/ScreenHeader';
import { TAB_BAR_CONTENT_PAD, TAB_BAR_FAB_OFFSET } from '../components/navigation/GlassTabBar';
import { getAllEntities } from '../database/repositories/entities';
import {
  getRecentPhoneInteractions,
  getLastInteractionMessage,
  deriveScopeFromParticipants,
  deriveParticipantKey,
  entityHasPhoneInteraction,
} from '../database/repositories/interactions';
import {
  getPrimaryImage,
  getCharacterProfile,
  imageToDataURL,
} from '../database/repositories/characters';
import { v7 as uuidv7 } from 'uuid';

import { useSyncConnection } from '../contexts/SyncConnectionContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import ChatPreferencesService from '../services/ChatPreferencesService';
import { ImpersonationSelectorModal } from '../components/modals/ImpersonationSelectorModal';
import { InfoModal } from '../components/modals/InfoModal';
import { createLogger } from '../utils/logger';

const log = createLogger('[ChatListScreen]');

interface ChatListItem {
  interactionId: string;
  entityId: string;
  characterId: string | null;
  characterName: string;
  lastMessage: string;
  lastMessageSender: string;
  lastMessageTime: Date | null;
  avatarUri: string | null;
  participantKey: string;
  participantIds: string[];
  isGroup: boolean;
}

const getEntityDisplayName = (
  alias: string | null,
  characterProfileName: string | null,
  entityId: string,
): string => {
  if (alias) return alias;
  if (characterProfileName) return characterProfileName;
  return entityId;
};

// Tab-screen navigation: routes are dispatched to the parent root stack.
// Using 'any' here avoids CompositeNavigationProp boilerplate while
// React Navigation v7 resolves routes across nested navigators at runtime.
type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export const ChatListScreen: React.FC = () => {
  const { theme } = useAppTheme();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { isPaired } = useSyncConnection();
  const { t } = useTranslation('chatList');
  const [chatList, setChatList] = useState<ChatListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [infoModalVisible, setInfoModalVisible] = useState(false);

  // Global impersonation state
  const [impersonatedEntityId, setImpersonatedEntityId] = useState<string>('user');
  const [impersonatedEntityDisplay, setImpersonatedEntityDisplay] = useState<{
    name: string;
    avatarUri: string | null;
  }>({ name: 'User', avatarUri: null });
  const [selectorModalVisible, setSelectorModalVisible] = useState(false);

  const loadChatList = useCallback(async (activeEntityId: string) => {
    try {
      setLoading(true);

      // Get all entities for display info lookups
      const entities = await getAllEntities();
      const entityMap = new Map(entities.map(e => [e.id, e]));

      // Get recent phone interactions per D-15
      const interactions = await getRecentPhoneInteractions(activeEntityId);

      const listItems: ChatListItem[] = [];
      const seenPrivateKeys = new Set<string>(); // For deduping private interactions per D-01
      const seenPartnerEntityIds = new Set<string>(); // Track entities with phone interactions to prevent duplicates

      for (const interaction of interactions) {
        let participantIds: string[];
        try {
          participantIds = JSON.parse(interaction.participant_ids);
        } catch {
          participantIds = [];
        }

        const scope = interaction.interaction_scope;

        if (scope === 'private') {
          // Private interactions: group by participant_key per D-01
          const participantKey = interaction.participant_key || '';
          if (!participantKey) continue;

          if (seenPrivateKeys.has(participantKey)) continue;
          seenPrivateKeys.add(participantKey);

          // Find the partner entity (the one that's NOT the impersonated entity)
          const partnerEntityId = participantIds.find(id => id !== activeEntityId);
          if (!partnerEntityId) continue;

          // Mark this partner as seen to prevent duplicate entries in the "no messages yet" section
          seenPartnerEntityIds.add(partnerEntityId);

          const entity = entityMap.get(partnerEntityId);

          // Get last message preview per D-25
          const lastMsg = await getLastInteractionMessage(activeEntityId, participantKey);

          // Determine who sent the last message
          let lastMessageSender = '';
          if (lastMsg) {
            if (lastMsg.sender_entity_id === activeEntityId) {
              lastMessageSender = t('you');
            } else {
              lastMessageSender = partnerEntityId;
              if (entity?.character_profile_id) {
                const profile = await getCharacterProfile(entity.character_profile_id);
                if (profile) {
                  lastMessageSender = profile.name;
                }
              }
            }
          }

          // Get character profile and avatar
          let avatarUri: string | null = null;
          let characterProfileName: string | null = null;
          if (entity?.character_profile_id) {
            const profile = await getCharacterProfile(entity.character_profile_id);
            characterProfileName = profile?.name ?? null;
            const primaryImage = await getPrimaryImage(entity.character_profile_id);
            if (primaryImage) {
              avatarUri = imageToDataURL(primaryImage);
            }
          }

          const characterName = getEntityDisplayName(
            entity?.alias ?? null,
            characterProfileName,
            partnerEntityId,
          );

          // Use the most recent interactionId for this participant_key
          listItems.push({
            interactionId: interaction.id,
            entityId: partnerEntityId,
            characterId: entity?.character_profile_id ?? null,
            characterName,
            lastMessage: lastMsg?.content || t('noMessagesYet'),
            lastMessageSender,
            lastMessageTime: lastMsg?.created_at || null,
            avatarUri,
            participantKey,
            participantIds,
            isGroup: false,
          });
        } else if (scope === 'group') {
          // Group interactions: show as separate entries per D-01
          const participantKey = interaction.participant_key || '';

          // Get last message preview
          const lastMsg = await getLastInteractionMessage(activeEntityId, participantKey);

          // Build display name from participant names per D-12
          const otherParticipantIds = participantIds.filter(id => id !== activeEntityId);
          const displayNames: string[] = [];
          let avatarUri: string | null = null;

          for (const pid of otherParticipantIds) {
            const entity = entityMap.get(pid);
            if (entity?.character_profile_id) {
              const profile = await getCharacterProfile(entity.character_profile_id);
              if (profile) {
                displayNames.push(profile.name);
                continue;
              }
            }
            displayNames.push(pid);
          }

          // Try to get avatar from first participant
          const firstEntity = otherParticipantIds.length > 0 ? entityMap.get(otherParticipantIds[0]) : null;
          if (firstEntity?.character_profile_id) {
            const primaryImage = await getPrimaryImage(firstEntity.character_profile_id);
            if (primaryImage) {
              avatarUri = imageToDataURL(primaryImage);
            }
          }

          const groupName = displayNames.join(', ');

          listItems.push({
            interactionId: interaction.id,
            entityId: '', // No single partner for groups
            characterId: null,
            characterName: groupName,
            lastMessage: lastMsg?.content || t('noMessagesYet'),
            lastMessageSender: '',
            lastMessageTime: lastMsg?.created_at || null,
            avatarUri,
            participantKey,
            participantIds,
            isGroup: true,
          });
        }
      }

      // Add entities that have NO phone interactions yet (not chatted with via phone)
      // These appear at the bottom of the list with "No messages yet"
      // Note: seenPartnerEntityIds is already populated in the first loop above
      for (const entity of entities) {
        // Skip the active (impersonated) entity
        if (entity.id === activeEntityId) {
          continue;
        }

        // Skip entities that already have a phone interaction (already in listItems)
        // This prevents duplicate "No messages yet" entries for entities with phone interactions
        if (seenPartnerEntityIds.has(entity.id)) {
          continue;
        }

        // Check if this entity has any phone interaction with the active entity
        // This is the key fix: we need to check if there's a phone interaction BEFORE
        // adding the entity as "no messages yet"
        const hasPhoneInteraction = await entityHasPhoneInteraction(activeEntityId, entity.id);
        if (hasPhoneInteraction) {
          // This entity already has a phone interaction - it should have been added
          // in the first loop. Skip it to avoid duplicates.
          continue;
        }

        // Get character profile and avatar
        let avatarUri: string | null = null;
        let characterProfileName: string | null = null;
        if (entity.character_profile_id) {
          const profile = await getCharacterProfile(entity.character_profile_id);
          characterProfileName = profile?.name ?? null;
          const primaryImage = await getPrimaryImage(entity.character_profile_id);
          if (primaryImage) {
            avatarUri = imageToDataURL(primaryImage);
          }
        }

        const characterName = getEntityDisplayName(
          entity.alias || null,
          characterProfileName,
          entity.id,
        );

        // Derive participantKey for the potential private interaction
        const potentialParticipantIds = [activeEntityId, entity.id];
        const scope = deriveScopeFromParticipants(potentialParticipantIds);
        const participantKey = deriveParticipantKey(
          potentialParticipantIds,
          activeEntityId,
          scope,
        );

        // Generate a temp interactionId for navigation (ChatDetailScreen
        // will replace it with the canonical server-assigned ID via INIT_ENTITY)
        const tempInteractionId = uuidv7();

        listItems.push({
          interactionId: tempInteractionId,
          entityId: entity.id,
          characterId: entity.character_profile_id ?? null,
          characterName,
          lastMessage: t('noMessagesYet'),
          lastMessageSender: '',
          lastMessageTime: null,
          avatarUri,
          participantKey,
          participantIds: potentialParticipantIds,
          isGroup: false,
        });
      }

      // Sort by last message time (newest first), entities without
      // messages (null time) sort to the bottom
      listItems.sort((a, b) => {
        if (!a.lastMessageTime && !b.lastMessageTime) return 0;
        if (!a.lastMessageTime) return 1;
        if (!b.lastMessageTime) return -1;
        return b.lastMessageTime.getTime() - a.lastMessageTime.getTime();
      });

      setChatList(listItems);
    } catch (error) {
      log.error('Failed to load chat list:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Load global impersonated entity on mount
  const loadImpersonatedEntity = useCallback(async () => {
    try {
      const allEntities = await getAllEntities();
      const storedId =
        await ChatPreferencesService.getGlobalImpersonatedEntity();

      // Pick best default: stored > 'user' entity > first entity
      let resolvedId = storedId;
      if (!resolvedId || !allEntities.some(e => e.id === resolvedId)) {
        const userEntity = allEntities.find(e => e.id === 'user');
        resolvedId = userEntity
          ? userEntity.id
          : (allEntities[0]?.id ?? 'user');
      }

      setImpersonatedEntityId(resolvedId);

      // Load display info for banner
      const entity = allEntities.find(e => e.id === resolvedId);
      if (entity?.character_profile_id) {
        const profile = await getCharacterProfile(entity.character_profile_id);
        const image = await getPrimaryImage(entity.character_profile_id);
        setImpersonatedEntityDisplay({
          name: profile?.name ?? resolvedId,
          avatarUri: image ? imageToDataURL(image) : null,
        });
      } else {
        setImpersonatedEntityDisplay({ name: resolvedId, avatarUri: null });
      }
    } catch (error) {
      log.error('Failed to load impersonated entity:', error);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadImpersonatedEntity();
      // Reload chat list when screen gains focus (e.g., returning from
      // ChatDetailScreen) so the last-message preview reflects any messages
      // sent/received during the chat session. Without this, the list stays
      // stale because impersonatedEntityId hasn't changed, so the useEffect
      // below won't re-trigger loadChatList.
      if (impersonatedEntityId) {
        loadChatList(impersonatedEntityId);
      }
    }, [loadImpersonatedEntity, loadChatList, impersonatedEntityId]),
  );

  // Re-run loadChatList when impersonatedEntityId changes
  useEffect(() => {
    if (impersonatedEntityId) {
      loadChatList(impersonatedEntityId);
    }
  }, [impersonatedEntityId, loadChatList]);

  const onRefresh = () => {
    setRefreshing(true);
    loadChatList(impersonatedEntityId);
  };

  const handleChatPress = (item: ChatListItem) => {
    if (item.isGroup) {
      // Group chat: navigate with interaction info
      navigation.navigate('ChatDetail', {
        interactionId: item.interactionId,
        participantKey: item.participantKey,
        participantIds: item.participantIds,
        entityId: impersonatedEntityId,
        entityName: item.characterName,
      });
    } else {
      // Private chat: navigate with interaction info
      navigation.navigate('ChatDetail', {
        interactionId: item.interactionId,
        participantKey: item.participantKey,
        participantIds: item.participantIds,
        entityId: impersonatedEntityId,
        entityName: item.characterName,
      });
    }
  };

  const handleImpersonationSelect = async (entityId: string) => {
    try {
      await ChatPreferencesService.setGlobalImpersonatedEntity(entityId);
      setImpersonatedEntityId(entityId);

      // Also update the display info for the banner
      const allEntities = await getAllEntities();
      const entity = allEntities.find(e => e.id === entityId);
      if (entity?.character_profile_id) {
        const profile = await getCharacterProfile(entity.character_profile_id);
        const image = await getPrimaryImage(entity.character_profile_id);
        setImpersonatedEntityDisplay({
          name: profile?.name ?? entityId,
          avatarUri: image ? imageToDataURL(image) : null,
        });
      } else {
        setImpersonatedEntityDisplay({ name: entityId, avatarUri: null });
      }

      setSelectorModalVisible(false);
      // loadChatList will re-run via the useEffect that watches impersonatedEntityId
    } catch (error) {
      log.error('Failed to save global entity preference:', error);
      setSelectorModalVisible(false);
    }
  };

  const renderItem = ({ item }: { item: ChatListItem }) => (
    <TouchableOpacity
      onPress={() => handleChatPress(item)}
      activeOpacity={0.65}
      style={styles.rowWrapper}
      testID="chat-list-item"
      accessibilityLabel={`Chat with ${item.characterName}`}
    >
      {/* Subtle prismatic tint from top-left */}
      <LinearGradient
        colors={[
          (theme?.colors.accent.primary ?? '#7c3aed') + '18',
          'transparent',
        ]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.6, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {/* Avatar */}
      <View
        style={[
          styles.avatarContainer,
          { borderColor: (theme?.colors.accent.primary ?? '#7c3aed') + '44' },
        ]}
      >
        {item.avatarUri ? (
          <Image
            source={{ uri: item.avatarUri }}
            style={styles.avatarImage}
            resizeMode="cover"
          />
        ) : (
          <LinearGradient
            colors={[
              (theme?.colors.accent.primary ?? '#7c3aed') + '33',
              theme?.colors.background.elevated ?? '#1e1e2e',
            ]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.avatarFallback}
          >
            <ThemedText size={16} weight="bold" style={{ color: theme?.colors.accent.primary }}>
              {item.characterName.substring(0, 2).toUpperCase()}
            </ThemedText>
          </LinearGradient>
        )}
      </View>

      {/* Text */}
      <View style={styles.rowText}>
        <ThemedText size={15} weight="bold" numberOfLines={1}>
          {item.characterName}
        </ThemedText>
        <ThemedText variant="muted" size={13} numberOfLines={1} style={styles.rowPreview}>
          {item.lastMessageSender
            ? `${item.lastMessageSender}: ${item.lastMessage}`
            : item.lastMessage}
        </ThemedText>
      </View>

      {/* Time */}
      {item.lastMessageTime && (
        <ThemedText variant="muted" size={12} style={styles.timeText}>
          {formatTime(item.lastMessageTime)}
        </ThemedText>
      )}

      {/* Full-width hairline separator */}
      <View
        style={[
          styles.rowSeparator,
          { backgroundColor: (theme?.colors.border.default ?? '#333') + '66' },
        ]}
      />
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <ThemedView style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader
        title={t('title')}
        right={
          <View style={styles.headerRightRow}>
            <TouchableOpacity
              onPress={() => setInfoModalVisible(true)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Icon
                name="information-outline"
                size={20}
                color={theme?.colors.text.muted}
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.impersonationHeaderAction}
              onPress={() => setSelectorModalVisible(true)}
            >
              <View style={styles.impersonationBannerText}>
                <ThemedText variant="muted" size={11}>
                  {t('chattingAs')}
                </ThemedText>
                <ThemedText
                  variant="primary"
                  size={14}
                  style={{ fontWeight: '600' }}
                >
                  {impersonatedEntityDisplay.name}
                </ThemedText>
              </View>
              <View
                style={[
                  styles.impersonationAvatar,
                  { borderColor: (theme?.colors.accent.primary ?? '#7c3aed') + '66' },
                ]}
              >
                {impersonatedEntityDisplay.avatarUri ? (
                  <Image
                    source={{ uri: impersonatedEntityDisplay.avatarUri }}
                    style={styles.impersonationAvatarImage}
                    resizeMode="cover"
                  />
                ) : (
                  <LinearGradient
                    colors={[
                      (theme?.colors.accent.primary ?? '#7c3aed') + '33',
                      theme?.colors.background.elevated ?? '#1e1e2e',
                    ]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.impersonationAvatarFallback}
                  >
                    <ThemedText
                      size={11}
                      weight="bold"
                      style={{ color: theme?.colors.accent.primary }}
                    >
                      {impersonatedEntityDisplay.name.substring(0, 2).toUpperCase()}
                    </ThemedText>
                  </LinearGradient>
                )}
              </View>
            </TouchableOpacity>
          </View>
        }
      />

      {!isPaired ? (
        <View
          style={styles.notPairedContainer}
          testID="chat-list-not-paired"
          accessibilityLabel="Not paired with Harmony Link"
        >
          <Icon name="connection" size={64} color={theme?.colors.text.muted} />
          <ThemedText style={styles.notPairedText}>{t('notConnected')}</ThemedText>
          <ThemedText variant="muted" size={13} style={styles.notPairedSubText}>
            {t('notConnectedHint')}
          </ThemedText>
          <ThemedButton
            label={t('connectNow')}
            onPress={() => navigation.navigate('ConnectionSetup')}
            style={styles.connectButton}
            testID="connect-now-button"
          />
        </View>
      ) : (
        <FlatList
          data={chatList}
          renderItem={renderItem}
          keyExtractor={item => item.interactionId}
          contentContainerStyle={{ paddingBottom: TAB_BAR_CONTENT_PAD + safeBottom }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          ListEmptyComponent={
            <View
              style={styles.emptyContainer}
              testID="chat-list-empty"
              accessibilityLabel="No conversations yet"
            >
              <Icon
                name="chat-outline"
                size={64}
                color={theme?.colors.text.muted}
              />
              <ThemedText variant="secondary" style={styles.emptyText}>
                {t('noConversations')}
              </ThemedText>
              <ThemedText variant="muted" size={12}>
                {t('noConversationsHint')}
              </ThemedText>
            </View>
          }
        />
      )}


      <ThemedFab icon="plus" onPress={() => navigation.navigate('CreateAI', {})} style={{ bottom: TAB_BAR_FAB_OFFSET + safeBottom }} />

      <ImpersonationSelectorModal
        visible={selectorModalVisible}
        onSelect={handleImpersonationSelect}
        onCancel={() => setSelectorModalVisible(false)}
        preSelectedEntityId={impersonatedEntityId}
      />

      <InfoModal
        visible={infoModalVisible}
        onClose={() => setInfoModalVisible(false)}
        title={t('aboutTitle')}
        message={t('aboutMessage')}
        icon="chat-processing"
      />
    </ThemedView>
  );
};

function formatTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else if (days === 1) {
    return 'Yesterday';
  } else if (days < 7) {
    return date.toLocaleDateString([], { weekday: 'short' });
  } else {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { justifyContent: 'center', alignItems: 'center' },
  // ── Chat row ──
  rowWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    overflow: 'hidden',
  },
  avatarContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    overflow: 'hidden',
    flexShrink: 0,
  },
  avatarImage: {
    width: 48,
    height: 48,
  },
  avatarFallback: {
    width: 48,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rowText: {
    flex: 1,
    gap: 3,
  },
  rowPreview: {
    lineHeight: 18,
  },
  rowSeparator: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
  },
  notPairedContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  notPairedText: { marginTop: 16, marginBottom: 8 },
  notPairedSubText: { marginBottom: 24, textAlign: 'center' },
  connectButton: {
    width: '100%',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    marginTop: 100,
  },
  emptyText: { marginTop: 16, marginBottom: 8 },
  headerRightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  impersonationHeaderAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
  },
  impersonationBannerText: {
    alignItems: 'flex-end',
  },
  impersonationAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    overflow: 'hidden',
    flexShrink: 0,
  },
  impersonationAvatarImage: {
    width: 30,
    height: 30,
  },
  impersonationAvatarFallback: {
    width: 30,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  timeText: {
    alignSelf: 'center',
    marginRight: 8,
  },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
  },
});
