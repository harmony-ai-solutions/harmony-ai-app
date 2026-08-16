import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  StyleSheet,
  View,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Animated,
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
import { useAuth } from '../contexts/AuthContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import ChatPreferencesService from '../services/ChatPreferencesService';
import EntitySessionService from '../services/EntitySessionService';
import { hexToRgba } from '../utils/colorUtils';
import { InfoModal } from '../components/modals/InfoModal';
import { HeaderMenuButton } from '../components/navigation/HeaderMenuButton';
import { HeaderNotificationButton } from '../components/navigation/HeaderNotificationButton';
import { ChatPartnerPickerModal } from '../components/chat/ChatPartnerPickerModal';
import { openCharacterChat } from '../services/CharacterChatService';
import { isChatLocked } from '../services/MarketplacePurchaseService';
import { CharacterProfile } from '../database/models';
import { ProfileAvatar } from '../components/profile/ProfileAvatar';
import { createLogger } from '../utils/logger';
import {
  getChatConversationSettingsBatch,
  setConversationPinned,
  setConversationArchived,
  setConversationMuted,
  setConversationBlocked,
  incrementConversationUnread,
  clearConversationUnread,
  listConversationsByFlag,
} from '../database/repositories/chatConversationSettings';
import { deleteConversationByParticipantKey } from '../database/repositories/conversation_messages';
import {
  ChatConversationMenuModal,
  ChatConversationMenuState,
} from '../components/chat/ChatConversationMenuModal';
import { useAppAlert } from '../contexts/AppAlertContext';
import { useToast } from '../contexts/AppToastContext';
import {
  showBubble,
  hasBubblePermission,
  requestBubblePermission,
  getActiveBubbleConversations,
  setBubbleUnreadCount,
} from '../services/ChatBubbleService';

const log = createLogger('[ChatListScreen]');

/**
 * Sync every floating bubble's unread badge to its conversation's unread
 * count (each bubble belongs to a different conversation). No-op when no
 * bubble conversation is active.
 */
function syncBubbleUnreadBadge(listItems: ChatListItem[]): void {
  const activeBubbles = getActiveBubbleConversations();
  if (activeBubbles.length === 0) return;
  for (const bubble of activeBubbles) {
    const match = listItems.find(item => item.participantKey === bubble.participantKey);
    setBubbleUnreadCount(match?.unreadCount ?? 0, bubble.participantKey);
  }
}

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
  // Conversation settings (pin / archive / mute / block / unread)
  pinned: boolean;
  archived: boolean;
  muted: boolean;
  blocked: boolean;
  unreadCount: number;
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
  const { user } = useAuth();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { canUseChat, connectionStatus } = useSyncConnection();
  const { t } = useTranslation('chatList');
  const [chatList, setChatList] = useState<ChatListItem[]>([]);
  const [archivedList, setArchivedList] = useState<ChatListItem[]>([]);
  const [_loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [infoModalVisible, setInfoModalVisible] = useState(false);
  // "Start a new chat" picker (＋ FAB) — lists AI characters with a chat icon
  const [pickerVisible, setPickerVisible] = useState(false);

  // Long-press context menu state
  const [menuItem, setMenuItem] = useState<ChatListItem | null>(null);
  const [menuSettings, setMenuSettings] = useState<ChatConversationMenuState>({
    pinned: false,
    archived: false,
    muted: false,
    blocked: false,
    unreadCount: 0,
  });
  const { showAlert } = useAppAlert();
  const { showToast } = useToast();

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
            // Filled in below from the settings batch
            pinned: false,
            archived: false,
            muted: false,
            blocked: false,
            unreadCount: 0,
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
            // Filled in below from the settings batch
            pinned: false,
            archived: false,
            muted: false,
            blocked: false,
            unreadCount: 0,
          });
        }
      }

      // Merge per-conversation settings (pin / archive / mute / block / unread)
      const keys = listItems.map(item => item.participantKey);
      const settingsMap = await getChatConversationSettingsBatch(keys);
      for (const item of listItems) {
        const settings = settingsMap.get(item.participantKey);
        if (settings) {
          item.pinned = settings.pinned;
          item.archived = settings.archived;
          item.muted = settings.muted;
          item.blocked = settings.blocked;
          item.unreadCount = settings.unreadCount;
        }
      }

      // Sort: pinned first (by last message time), then the rest by last
      // message time (newest first); entities without messages sort to bottom.
      listItems.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        if (!a.lastMessageTime && !b.lastMessageTime) return 0;
        if (!a.lastMessageTime) return 1;
        if (!b.lastMessageTime) return -1;
        return b.lastMessageTime.getTime() - a.lastMessageTime.getTime();
      });

      // Blocked conversations STAY in the main list (with a shield indicator)
      // — blocking only stops messaging. Archived conversations move to the
      // separate archived section below the main list.
      const mainList = listItems.filter(item => !item.archived);
      setChatList(mainList);
      setArchivedList(listItems.filter(item => item.archived));

      // Keep the floating bubble's unread badge in sync with the conversation
      // that currently has the bubble shown (if any).
      syncBubbleUnreadBadge(listItems);
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
      await openCharacterChat(
        profile,
        {
          navigateToChat: params => navigation.navigate('ChatDetail', params),
        },
        user?.id,
      );
    } catch (err) {
      log.error('Failed to open chat from picker:', err);
    }
  };

  const handleChatPress = async (item: ChatListItem) => {
    // HARD GATE: never open a chat with a marketplace-listed AI the user has
    // not purchased (and does not own). The tap is silently ignored.
    if (!item.isGroup && item.characterId) {
      try {
        if (await isChatLocked(item.characterId, user?.id)) {
          return;
        }
      } catch (lockErr) {
        log.warn('Failed to check chat lock:', lockErr);
      }
    }

    // Opening a conversation clears its unread counter.
    try {
      await clearConversationUnread(item.participantKey);
      await ChatPreferencesService.markKeyAsRead(item.participantKey);
    } catch (error) {
      log.warn('Failed to clear unread on open:', error);
    }
    // Reload so the badge disappears immediately.
    loadChatList(impersonatedEntityIdRef.current);

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

  // ── Long-press → context menu ──
  const handleLongPress = (item: ChatListItem) => {
    hapticLightPress();
    setMenuSettings({
      pinned: item.pinned,
      archived: item.archived,
      muted: item.muted,
      blocked: item.blocked,
      unreadCount: item.unreadCount,
    });
    setMenuItem(item);
  };

  const closeMenu = useCallback(() => setMenuItem(null), []);

  // Reload the list after any context action.
  const reloadAfterAction = useCallback(() => {
    setMenuItem(null);
    loadChatList(impersonatedEntityIdRef.current);
  }, []);

  // ── Context actions ──
  const handleTogglePin = useCallback(async () => {
    const item = menuItem;
    if (!item) return;
    await setConversationPinned(
      item.participantKey,
      item.entityId || null,
      !item.pinned,
    );
    showToast(item.pinned ? t('toastUnpinned') : t('toastPinned'));
    reloadAfterAction();
  }, [menuItem, reloadAfterAction, showToast, t]);

  const handleToggleArchive = useCallback(async () => {
    const item = menuItem;
    if (!item) return;
    await setConversationArchived(
      item.participantKey,
      item.entityId || null,
      !item.archived,
    );
    showToast(item.archived ? t('toastUnarchived') : t('toastArchived'));
    reloadAfterAction();
  }, [menuItem, reloadAfterAction, showToast, t]);

  const handleToggleMute = useCallback(async () => {
    const item = menuItem;
    if (!item) return;
    await setConversationMuted(
      item.participantKey,
      item.entityId || null,
      !item.muted,
    );
    showToast(item.muted ? t('toastUnmuted') : t('toastMuted'));
    reloadAfterAction();
  }, [menuItem, reloadAfterAction, showToast, t]);

  const handleToggleRead = useCallback(async () => {
    const item = menuItem;
    if (!item) return;
    if (item.unreadCount > 0) {
      await clearConversationUnread(item.participantKey);
      await ChatPreferencesService.markKeyAsRead(item.participantKey);
      showToast(t('toastMarkedRead'));
    } else {
      await incrementConversationUnread(item.participantKey, item.entityId || null);
      await ChatPreferencesService.clearKeyLastRead(item.participantKey);
      showToast(t('toastMarkedUnread'));
    }
    reloadAfterAction();
  }, [menuItem, reloadAfterAction, showToast, t]);

  const handleToggleBlock = useCallback(async () => {
    const item = menuItem;
    if (!item) return;
    const nowBlocked = !item.blocked;
    if (nowBlocked) {
      showAlert(
        t('menuBlock'),
        t('deleteConversationBody', { name: item.characterName }),
        [
          { text: t('common:cancel'), style: 'cancel' },
          {
            text: t('menuBlock'),
            style: 'destructive',
            onPress: async () => {
              await setConversationBlocked(item.participantKey, item.entityId || null, true);
              EntitySessionService.setBlockedOverride(item.participantKey, true);
              showToast(t('toastBlocked'));
              reloadAfterAction();
            },
          },
        ],
      );
      return;
    }
    // Apply the override BEFORE the DB write resolves so the send guard
    // allows messages immediately after unblocking.
    EntitySessionService.setBlockedOverride(item.participantKey, false);
    await setConversationBlocked(item.participantKey, item.entityId || null, false);
    showToast(t('toastUnblocked'));
    reloadAfterAction();
  }, [menuItem, reloadAfterAction, showAlert, showToast, t]);

  const handleOpenBubble = useCallback(async () => {
    const item = menuItem;
    if (!item) return;
    setMenuItem(null);

    const conversation = {
      participantKey: item.participantKey,
      interactionId: item.interactionId,
      entityId: item.entityId,
      ownEntityId: impersonatedEntityIdRef.current,
      entityName: item.characterName,
      participantIds: item.participantIds,
      avatar: item.avatarUri,
    };

    // showBubble remembers the conversation and auto-requests the overlay
    // permission when missing. When the user grants it in the OS settings
    // screen, the bubble auto-shows on return — no spurious "permission
    // required" error.
    const shown = await showBubble(conversation);
    if (shown) {
      showToast(t('toastBubbleShown'));
      return;
    }

    // Permission not granted yet — request it. The service resolves true when
    // the user grants and returns; the pending conversation auto-shows.
    const accepted = await requestBubblePermission();
    if (!accepted) {
      showToast(t('bubblePermissionDenied'));
    } else {
      showToast(t('toastBubbleShown'));
    }
  }, [menuItem, showToast, t]);

  const handleDelete = useCallback(async () => {
    const item = menuItem;
    if (!item) return;
    setMenuItem(null);
    showAlert(
      t('deleteConversationTitle'),
      t('deleteConversationBody', { name: item.characterName }),
      [
        { text: t('common:cancel'), style: 'cancel' },
        {
          text: t('common:delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteConversationByParticipantKey(
                impersonatedEntityIdRef.current,
                item.participantKey,
              );
              showToast(t('toastDeleted'));
              loadChatList(impersonatedEntityIdRef.current);
            } catch (error) {
              log.error('Failed to delete conversation:', error);
            }
          },
        },
      ],
    );
  }, [menuItem, showAlert, showToast, t]);

  const renderItem = ({ item }: { item: ChatListItem }) => (
    <ChatRowCard
      item={item}
      onPress={() => {
        hapticLightPress();
        handleChatPress(item);
      }}
      onLongPress={() => handleLongPress(item)}
    />
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
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: TAB_BAR_CONTENT_PAD + safeBottom },
          ]}
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
          ListHeaderComponent={
            archivedList.length > 0 ? (
              <TouchableOpacity
                style={styles.archivedToggle}
                onPress={() => {
                  hapticLightPress();
                  navigation.navigate('ArchivedChats');
                }}
                activeOpacity={0.7}
                testID="chat-archived-toggle"
              >
                <Icon name="archive-outline" size={16} color={theme!.colors.text.muted} />
                <ThemedText variant="muted" size={13} weight="medium">
                  {t('archived')} ({archivedList.length})
                </ThemedText>
                <Icon name="chevron-right" size={16} color={theme!.colors.text.muted} />
              </TouchableOpacity>
            ) : null
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

      {/* Long-press context menu — pin / archive / mute / bubble / read / block / delete */}
      <ChatConversationMenuModal
        visible={menuItem !== null}
        conversationName={menuItem?.characterName ?? ''}
        settings={menuSettings}
        isBlocked={menuItem?.blocked ?? false}
        onClose={closeMenu}
        onTogglePin={handleTogglePin}
        onToggleArchive={handleToggleArchive}
        onToggleMute={handleToggleMute}
        onOpenBubble={handleOpenBubble}
        onToggleRead={handleToggleRead}
        onToggleBlock={handleToggleBlock}
        onDelete={handleDelete}
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

/**
 * ChatRowCard — a single conversation rendered as an Obsidian Glass card.
 *
 * Anatomy (outside → in):
 *   1. Hairline gradient border (silver top-left → faint indigo bottom-right)
 *   2. Deep dark glass body (~45 % opacity surface) with a specular sweep
 *   3. Prismatic accent tint from the top-left corner
 *   4. Gradient-ring avatar (ProfileAvatar) + name / preview / time badge
 *
 * Pressing the card springs it down to 0.98 scale for tactile feedback.
 */
const ChatRowCard: React.FC<{
  item: ChatListItem;
  onPress: () => void;
  onLongPress: () => void;
}> = ({ item, onPress, onLongPress }) => {
  const { theme } = useAppTheme();
  const scale = useRef(new Animated.Value(1)).current;

  if (!theme) return null;

  const handlePressIn = () => {
    Animated.spring(scale, {
      toValue: 0.98,
      useNativeDriver: true,
      speed: 40,
      bounciness: 0,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 40,
      bounciness: 0,
    }).start();
  };

  const borderStart = 'rgba(255, 255, 255, 0.20)';
  const borderEnd = hexToRgba(theme.colors.accent.secondary, 0.10);
  const glassFill = hexToRgba(theme.colors.background.surface, 0.45);

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <TouchableOpacity
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onLongPress={onLongPress}
        delayLongPress={400}
        activeOpacity={0.85}
        testID="chat-list-item"
        accessibilityLabel={`Chat with ${item.characterName}`}
      >
        {/* ── 1dp hairline gradient border ── */}
        <LinearGradient
          colors={[borderStart, borderEnd]}
          start={{ x: 0.15, y: 0 }}
          end={{ x: 0.85, y: 1 }}
          style={styles.cardBorder}
        >
          {/* ── Deep dark glass body ── */}
          <View style={[styles.cardBody, { backgroundColor: glassFill }]}>
            {/* Specular sweep — faint diagonal light across the glass surface */}
            <LinearGradient
              colors={['rgba(255, 255, 255, 0.08)', 'transparent']}
              start={{ x: 0, y: 0 }}
              end={{ x: 0.7, y: 1 }}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />

            {/* Prismatic accent tint from top-left */}
            <LinearGradient
              colors={[(theme.colors.accent.primary ?? '#7c3aed') + '14', 'transparent']}
              start={{ x: 0, y: 0 }}
              end={{ x: 0.6, y: 1 }}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />

            {/* Gradient-ring avatar */}
            <ProfileAvatar name={item.characterName} uri={item.avatarUri} size={52} />

            {/* Text */}
            <View style={styles.cardText}>
              <View style={styles.cardNameRow}>
                <ThemedText size={15} weight="bold" numberOfLines={1} style={styles.cardName}>
                  {item.characterName}
                </ThemedText>
              </View>
              <ThemedText variant="muted" size={13} numberOfLines={1} style={styles.cardPreview}>
                {item.lastMessageSender ? (
                  <>
                    <ThemedText variant="secondary" size={13} weight="medium">
                      {item.lastMessageSender}:{' '}
                    </ThemedText>
                    {item.lastMessage}
                  </>
                ) : (
                  item.lastMessage
                )}
              </ThemedText>
            </View>

            {/* Status column — time badge + status icons + unread */}
            <View style={styles.statusColumn}>
              {item.lastMessageTime && (
                <ThemedText variant="muted" size={11}>
                  {formatTime(item.lastMessageTime)}
                </ThemedText>
              )}
              <View style={styles.statusIconsRow}>
                {item.pinned && (
                  <Icon name="pin" size={13} color={theme.colors.accent.primary} />
                )}
                {item.muted && (
                  <Icon name="volume-off" size={13} color={theme.colors.text.muted} />
                )}
                {item.blocked && (
                  <Icon name="shield-off-outline" size={13} color={theme.colors.status.error} />
                )}
              </View>
              {item.unreadCount > 0 && (
                <View
                  style={[
                    styles.unreadBadge,
                    { backgroundColor: theme.colors.accent.primary },
                  ]}
                >
                  <ThemedText size={11} weight="bold" style={{ color: theme.colors.background.base }}>
                    {item.unreadCount > 99 ? '99+' : item.unreadCount}
                  </ThemedText>
                </View>
              )}
            </View>
          </View>
        </LinearGradient>
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { justifyContent: 'center', alignItems: 'center' },
  // ── List container ──
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 6,
    gap: 10,
  },
  // ── Chat row card ──
  cardBorder: {
    borderRadius: 18,
    padding: StyleSheet.hairlineWidth,
  },
  cardBody: {
    borderRadius: 17,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 12,
  },
  cardText: {
    flex: 1,
    gap: 3,
  },
  cardNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  cardName: {
    flexShrink: 1,
  },
  unreadBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-end',
  },
  archivedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    marginBottom: 4,
  },
  cardPreview: {
    lineHeight: 18,
  },
  statusColumn: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 4,
    flexShrink: 0,
    marginLeft: 6,
  },
  statusIconsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  timeBadge: {
    alignSelf: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 99,
    overflow: 'hidden',
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
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
  },
});
