import React, { useEffect, useState, useCallback, useRef } from 'react';
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
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../contexts/ThemeContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedText } from '../components/themed/ThemedText';
import { ThemedButton } from '../components/themed/ThemedButton';
import { ThemedEmptyState } from '../components/themed/ThemedEmptyState';
import { ThemedFab } from '../components/themed/ThemedFab';
import { ScreenHeader } from '../components/themed/ScreenHeader';
import { hapticLightPress } from '../utils/haptics';
import { TAB_BAR_CONTENT_PAD, TAB_BAR_FAB_OFFSET } from '../components/navigation/GlassTabBar';
import { getAllEntities } from '../database/repositories/entities';
import { resolvePersonaId } from '../database/repositories/personas';
import {
  getRecentPhoneInteractions,
  getLastInteractionMessage,
} from '../database/repositories/interactions';
import {
  getPrimaryImage,
  getCharacterProfile,
  imageToDataURL,
} from '../database/repositories/characters';

import { useSyncConnection } from '../contexts/SyncConnectionContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import ChatPreferencesService from '../services/ChatPreferencesService';
import { hexToRgba } from '../utils/colorUtils';
import { InfoModal } from '../components/modals/InfoModal';
import { HeaderMenuButton } from '../components/navigation/HeaderMenuButton';
import { HeaderNotificationButton } from '../components/navigation/HeaderNotificationButton';
import { ChatPartnerPickerModal } from '../components/chat/ChatPartnerPickerModal';
import { openCharacterChat } from '../services/CharacterChatService';
import { CharacterProfile } from '../database/models';
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

export const ChatListScreen: React.FC = () => {
  const { theme } = useAppTheme();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { canUseChat, connectionStatus } = useSyncConnection();
  const { t } = useTranslation('chatList');
  const [chatList, setChatList] = useState<ChatListItem[]>([]);
  const [_loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [infoModalVisible, setInfoModalVisible] = useState(false);
  // "Start a new chat" picker (＋ FAB) — lists AI characters with a chat icon
  const [pickerVisible, setPickerVisible] = useState(false);

  // Global impersonation state (the persona the user is "chatting as").
  // The "Chatting as" pill selector was removed from this screen to be
  // re-introduced on another screen later, but the selected persona still
  // drives which conversations are shown here.
  const [impersonatedEntityId, setImpersonatedEntityId] = useState<string>('user');

  // Stable ref so onRefresh ([] deps) always reads the latest entity ID
  const impersonatedEntityIdRef = useRef(impersonatedEntityId);
  impersonatedEntityIdRef.current = impersonatedEntityId;

  const loadChatList = async (activeEntityId: string) => {
    try {
      setLoading(true);

      // Get all entities for display info lookups
      const entities = await getAllEntities();
      const entityMap = new Map(entities.map(e => [e.id, e]));

      // Get recent phone interactions per D-15
      const interactions = await getRecentPhoneInteractions(activeEntityId);

      const listItems: ChatListItem[] = [];
      const seenPrivateKeys = new Set<string>(); // For deduping private interactions per D-01

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

          // Defensive: skip interactions whose partner entity no longer exists.
          // getAllEntities() only returns non-deleted entities, so a partner
          // absent from entityMap means the entity was deleted (or never
          // synced). Without this skip, a deleted partner renders as a bare
          // entity ID row with no profile info. This only applies to private
          // (pair) interactions — group chats handle missing members by name.
          if (!entityMap.has(partnerEntityId)) continue;

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
  };

  // Load global impersonated persona on mount (personas are the ONLY
  // identities the user can chat as — falls back to the built-in 'user').
  const loadImpersonatedEntity = useCallback(async () => {
    try {
      const storedId =
        await ChatPreferencesService.getGlobalImpersonatedEntity();
      const resolvedId = await resolvePersonaId(storedId);
      setImpersonatedEntityId(resolvedId);
    } catch (error) {
      log.error('Failed to load impersonated persona:', error);
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
    }, [impersonatedEntityId]),
  );

  // Re-run loadChatList when impersonatedEntityId changes
  useEffect(() => {
    if (impersonatedEntityId) {
      loadChatList(impersonatedEntityId);
    }
  }, [impersonatedEntityId]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadChatList(impersonatedEntityIdRef.current);
    setRefreshing(false);
  }, []);

  const handleNewChat = async (profile: CharacterProfile) => {
    try {
      await openCharacterChat(profile, {
        navigateToChat: params => navigation.navigate('ChatDetail', params),
      });
    } catch (err) {
      log.error('Failed to open chat from picker:', err);
    }
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

  const renderItem = ({ item }: { item: ChatListItem }) => (
    <TouchableOpacity
      onPress={() => {
        hapticLightPress();
        handleChatPress(item);
      }}
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

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader
        title={t('title')}
        titleRight={
          <TouchableOpacity
            onPress={() => {
              hapticLightPress();
              setInfoModalVisible(true);
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={[
              styles.infoGlassIcon,
              { backgroundColor: hexToRgba(theme?.colors.background.base ?? '#0f172a', 0.75) },
            ]}
            activeOpacity={0.7}
          >
            <LinearGradient
              colors={[
                (theme?.colors.accent.primary ?? '#ec4899') + '18',
                'transparent',
              ]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
            <Icon
              name="information-outline"
              size={18}
              color={theme?.colors.text.muted}
            />
          </TouchableOpacity>
        }
        right={
          <View style={styles.headerRightRow}>
            {/* ── Bell — opens the Notifications feed ── */}
            <HeaderNotificationButton />
            {/* ── "Three lines" menu — opens the Settings screen ── */}
            <HeaderMenuButton />
          </View>
        }
      />

      {!canUseChat ? (
        connectionStatus.mode === 'cloud' ? (
          /* ── Cloud mode: session not yet ready ── */
          <View
            style={styles.notPairedContainer}
            testID="chat-list-cloud-preparing"
            accessibilityLabel="Preparing cloud session"
          >
            <ThemedEmptyState
              icon="cloud-sync-outline"
              title={t('preparingCloudTitle')}
              subtitle={t('preparingCloudHint')}
              action={
                <ThemedButton
                  label={t('openConnectionManager')}
                  onPress={() => navigation.navigate('ConnectionSetup')}
                  style={styles.connectButton}
                  testID="open-connection-manager-button"
                />
              }
            />
          </View>
        ) : (
          /* ── Self-hosted: not paired ── */
          <View
            style={styles.notPairedContainer}
            testID="chat-list-not-paired"
            accessibilityLabel="Not paired with Harmony Link"
          >
            <ThemedEmptyState
              icon="connection"
              title={t('notConnected')}
              subtitle={t('notConnectedHint')}
              action={
                <ThemedButton
                  label={t('connectNow')}
                  onPress={() => navigation.navigate('ConnectionSetup')}
                  style={styles.connectButton}
                  testID="connect-now-button"
                />
              }
            />
          </View>
        )
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={chatList}
          renderItem={renderItem}
          keyExtractor={item => item.interactionId}
          contentContainerStyle={{ paddingBottom: TAB_BAR_CONTENT_PAD + safeBottom }}
          alwaysBounceVertical
          overScrollMode="always"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[theme!.colors.accent.primary]}
              tintColor={theme!.colors.accent.primary}
              progressBackgroundColor={theme!.colors.background.surface}
            />
          }
          ListEmptyComponent={
            <ThemedEmptyState
              icon="chat-outline"
              title={t('noConversations')}
              subtitle={t('noConversationsHint')}
              style={styles.emptyContainer}
              testID="chat-list-empty"
              accessibilityLabel="No conversations yet"
            />
          }
        />
      )}


      <ThemedFab
        icon="plus"
        onPress={() => setPickerVisible(true)}
        style={{ bottom: TAB_BAR_FAB_OFFSET + safeBottom }}
        testID="new-chat-fab"
      />

      {/* "Start a new chat" picker — lists AI characters with a chat icon */}
      <ChatPartnerPickerModal
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onChat={handleNewChat}
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
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
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
    alignItems: 'stretch',
    paddingHorizontal: 20,
  },
  connectButton: {
    width: '100%',
  },
  emptyContainer: {
    width: '100%',
  },
  headerRightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  infoGlassIcon: {
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
