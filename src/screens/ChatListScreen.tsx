import React, { useState, useCallback, useRef } from 'react';
import {
  StyleSheet,
  View,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Animated,
  ActivityIndicator,
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
import {
  getAllEntities,
  setEntityMuted,
  setEntityDisabled,
  getDisabledEntityIds,
} from '../database/repositories/entities';
import { resolvePersonaId } from '../database/repositories/personas';
import {
  getPhoneConversationsPage,
  PhoneConversationPageRow,
  getLastInteractionMessage,
  deriveScopeFromParticipants,
  deriveParticipantKey,
} from '../database/repositories/interactions';
import {
  getPrimaryImage,
  getCharacterProfile,
  imageToDataURL,
} from '../database/repositories/characters';

import { useSyncConnection } from '../contexts/SyncConnectionContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import ChatPreferencesService, { ChatReplyMode } from '../services/ChatPreferencesService';
import EntitySessionService from '../services/EntitySessionService';
import { getBlockedUserIds } from '../services/social/SocialService';
import { hexToRgba } from '../utils/colorUtils';
import { InfoModal } from '../components/modals/InfoModal';
import { HeaderMenuButton } from '../components/navigation/HeaderMenuButton';
import { HeaderNotificationButton } from '../components/navigation/HeaderNotificationButton';
import { ChatPartnerPickerModal } from '../components/chat/ChatPartnerPickerModal';
import { openCharacterChat } from '../services/CharacterChatService';
import { CharacterProfile } from '../database/models';
import { ProfileAvatar } from '../components/profile/ProfileAvatar';
import { createLogger } from '../utils/logger';
import {
  getChatConversationSettingsBatch,
  setConversationPinned,
  setConversationArchived,
} from '../database/repositories/chatConversationSettings';
import {
  deleteConversationByParticipantKey,
  markConversationMessagesRead,
  markConversationMessagesUnread,
  getUnreadCountByParticipantKeys,
} from '../database/repositories/conversation_messages';
import {
  ChatConversationMenuModal,
  ChatConversationMenuState,
} from '../components/chat/ChatConversationMenuModal';
import { useAppAlert } from '../contexts/AppAlertContext';
import { useToast } from '../contexts/AppToastContext';
import {
  showBubble,
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

/** Conversations per page for the chat list's offset pagination (F6). */
const CHAT_LIST_PAGE_SIZE = 20;

/** Debounce window for full chat-list reloads after live session events. */
const CHAT_LIST_RELOAD_DEBOUNCE_MS = 400;

/**
 * Sort conversations: pinned first, then by last-message time (newest first);
 * conversations without messages sort to the bottom. Recency is the last
 * message's `created_at` — the SAME source the pagination query uses (F6/O11).
 */
function sortListItems(items: ChatListItem[]): ChatListItem[] {
  items.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (!a.lastMessageTime && !b.lastMessageTime) return 0;
    if (!a.lastMessageTime) return 1;
    if (!b.lastMessageTime) return -1;
    return b.lastMessageTime.getTime() - a.lastMessageTime.getTime();
  });
  return items;
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
  // pin/archive live on chat_conversation_settings; mute/disable are ENTITY
  // flags (entities.is_muted / is_disabled, Q8); unread is DERIVED from
  // conversation_messages.is_read (A5/A2).
  pinned: boolean;
  archived: boolean;
  muted: boolean;
  disabled: boolean;
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
  const { bottom: safeBottom } = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { canUseChat, connectionStatus } = useSyncConnection();
  const { t } = useTranslation('chatList');
  const [chatList, setChatList] = useState<ChatListItem[]>([]);
  const [archivedList, setArchivedList] = useState<ChatListItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [infoModalVisible, setInfoModalVisible] = useState(false);
  // "Start a new chat" picker (＋ FAB) — lists AI characters with a chat icon
  const [pickerVisible, setPickerVisible] = useState(false);

  // Long-press context menu state
  const [menuItem, setMenuItem] = useState<ChatListItem | null>(null);
  const [menuSettings, setMenuSettings] = useState<ChatConversationMenuState>({
    pinned: false,
    archived: false,
    muted: false,
    disabled: false,
    unreadCount: 0,
    replyMode: 'realistic',
  });
  // Guards the async reply-mode load in handleLongPress: only apply the result
  // if the SAME conversation is still the one whose menu is open.
  const menuItemKeyRef = useRef<string | null>(null);
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

  // Full (main + archived) list mirror for the live-update handlers — the
  // event subscription reads it synchronously without re-subscribing.
  const chatListRef = useRef<ChatListItem[]>([]);

  // Offset pagination (F6): pages already loaded, whether another page may
  // exist, and an in-flight guard so onEndReached cannot stack fetches.
  const listPageRef = useRef(0);
  const listHasMoreRef = useRef(true);
  const loadingMoreRef = useRef(false);
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Build chat-list rows from one page of conversation rows (deduped by
   * participant_key). Applies the blocked-users filter (F5) at the row level:
   * private conversations whose partner is blocked are skipped, and group
   * conversations containing a blocked participant are skipped. Stub-gap
   * tolerant — `blockedIds` is usually empty in stub fixtures.
   */
  const buildListItems = useCallback(
    async (
      activeEntityId: string,
      rows: PhoneConversationPageRow[],
      filteredIds: Set<string>,
    ): Promise<ChatListItem[]> => {
      // Get all entities for display info lookups
      const entities = await getAllEntities();
      const entityMap = new Map(entities.map(e => [e.id, e]));

      const listItems: ChatListItem[] = [];
      const seenPrivateKeys = new Set<string>(); // For deduping private interactions per D-01

      for (const row of rows) {
        let participantIds: string[];
        try {
          participantIds = JSON.parse(row.participantIds);
        } catch {
          participantIds = [];
        }

        const scope = row.interactionScope;
        const participantKey = row.participantKey || '';
        if (!participantKey) continue;

        if (scope === 'private') {
          // Private interactions: group by participant_key per D-01
          if (seenPrivateKeys.has(participantKey)) continue;
          seenPrivateKeys.add(participantKey);

          // Find the partner entity (the one that's NOT the impersonated entity)
          const partnerEntityId = participantIds.find(id => id !== activeEntityId);
          if (!partnerEntityId) continue;

          // F5: blocked users do not appear in the chat list.
          if (filteredIds.has(partnerEntityId)) continue;

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
            interactionId: row.interactionId,
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
            // pin/archived filled in below from the settings batch; mute/
            // disabled from the partner ENTITY flags (Q8); unread derived.
            pinned: false,
            archived: false,
            muted: entity?.is_muted === 1,
            disabled: entity?.is_disabled === 1,
            unreadCount: 0,
          });
        } else if (scope === 'group') {
          // Group interactions: one entry per participant set per D-01 (the
          // page query already dedupes by participant_key).

          // F5: skip group conversations containing a blocked participant.
          if (participantIds.some(id => filteredIds.has(id))) continue;

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
            interactionId: row.interactionId,
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
            // Groups have no single partner entity — mute/disable flags are
            // not applicable. pin/archived/unread filled in below.
            pinned: false,
            archived: false,
            muted: false,
            disabled: false,
            unreadCount: 0,
          });
        }
      }

      // Merge per-conversation pin/archive state from the settings batch.
      const keys = listItems.map(item => item.participantKey);
      const settingsMap = await getChatConversationSettingsBatch(keys);
      // Derive unread counts from conversation_messages.is_read, scoped to this
      // POV entity (A2) — the badge is no longer a stored counter.
      const unreadMap = await getUnreadCountByParticipantKeys(keys, activeEntityId);
      for (const item of listItems) {
        const settings = settingsMap.get(item.participantKey);
        if (settings) {
          item.pinned = settings.pinned;
          item.archived = settings.archived;
        }
        item.unreadCount = unreadMap.get(item.participantKey) ?? 0;
      }

      return listItems;
    },
    [t],
  );

  /**
   * Read the chat-list filter set: social-blocked users (getBlockedUserIds,
   * UNCHANGED — A4) UNION disabled entities (getDisabledEntityIds, Q8). A
   * disabled AI entity is filtered out of the list exactly like a blocked one
   * — it is off and must not be offered as a partner.
   */
  const loadFilteredEntityIds = useCallback(async (): Promise<Set<string>> => {
    const filtered = new Set<string>();
    try {
      (await getBlockedUserIds()).forEach(id => filtered.add(id));
    } catch (error) {
      log.warn('Failed to load blocked users — chat list filter skipped:', error);
    }
    try {
      (await getDisabledEntityIds()).forEach(id => filtered.add(id));
    } catch (error) {
      log.warn('Failed to load disabled entities — chat list filter skipped:', error);
    }
    return filtered;
  }, []);

  /**
   * Full chat-list (re)load — page 0 of the paginated conversation query
   * (F6). Resets pagination state. The focus effect awaits persona resolution
   * (F7) before calling this so the first load never flashes the default
   * 'user' perspective.
   */
  const loadChatList = useCallback(
    async (activeEntityId: string) => {
      try {
        const filteredIds = await loadFilteredEntityIds();

        listPageRef.current = 0;
        listHasMoreRef.current = true;

        const rows = await getPhoneConversationsPage(activeEntityId, {
          limit: CHAT_LIST_PAGE_SIZE,
          offset: 0,
        });

        const items = await buildListItems(activeEntityId, rows, filteredIds);
        const sorted = sortListItems(items);
        chatListRef.current = sorted;

        // Disabled conversations are FILTERED OUT (the disabled entity is off,
        // A4 union) — an enabled-but-archived conversation moves to the
        // separate archived section below the main list.
        setChatList(sorted.filter(item => !item.archived));
        setArchivedList(sorted.filter(item => item.archived));

        // Track how many pages are loaded for load-more (1 page now loaded).
        listPageRef.current = rows.length === CHAT_LIST_PAGE_SIZE ? 1 : 0;
        listHasMoreRef.current = rows.length === CHAT_LIST_PAGE_SIZE;

        // Keep the floating bubble's unread badge in sync with the
        // conversation that currently has the bubble shown (if any).
        syncBubbleUnreadBadge(sorted);
      } catch (error) {
        log.error('Failed to load chat list:', error);
      } finally {
        setRefreshing(false);
      }
    },
    [buildListItems, loadFilteredEntityIds],
  );

  /** Load the next page of conversations and append (offset pagination, F6). */
  const loadMoreChatList = useCallback(async () => {
    if (loadingMoreRef.current || !listHasMoreRef.current) return;
    const activeEntityId = impersonatedEntityIdRef.current;
    if (!activeEntityId) return;

    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const filteredIds = await loadFilteredEntityIds();
      const rows = await getPhoneConversationsPage(activeEntityId, {
        limit: CHAT_LIST_PAGE_SIZE,
        offset: listPageRef.current * CHAT_LIST_PAGE_SIZE,
      });

      if (rows.length === 0) {
        listHasMoreRef.current = false;
        return;
      }

      const items = await buildListItems(activeEntityId, rows, filteredIds);
      listPageRef.current += 1;
      listHasMoreRef.current = rows.length === CHAT_LIST_PAGE_SIZE;

      // Defensive dedupe — the page query groups by participant_key so keys
      // never repeat across pages, but guard against re-added rows anyway.
      const existingKeys = new Set(chatListRef.current.map(item => item.participantKey));
      const fresh = items.filter(item => !existingKeys.has(item.participantKey));
      if (fresh.length === 0) return;

      const merged = sortListItems([...chatListRef.current, ...fresh]);
      chatListRef.current = merged;
      setChatList(merged.filter(item => !item.archived));
      setArchivedList(merged.filter(item => item.archived));
      syncBubbleUnreadBadge(merged);
    } catch (error) {
      log.error('Failed to load more conversations:', error);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [buildListItems, loadFilteredEntityIds]);

  /** Debounce a full reload so rapid session events collapse into one fetch. */
  const scheduleChatListReload = useCallback(() => {
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    reloadTimerRef.current = setTimeout(() => {
      reloadTimerRef.current = null;
      loadChatList(impersonatedEntityIdRef.current);
    }, CHAT_LIST_RELOAD_DEBOUNCE_MS);
  }, [loadChatList]);

  // Load global impersonated persona on mount (personas are the ONLY
  // identities the user can chat as — falls back to the built-in 'user').
  // Returns the resolved id so the focus effect can AWAIT it before the first
  // list load — killing the 'user'-perspective flash + double load (F7).
  const loadImpersonatedEntity = useCallback(async (): Promise<string> => {
    try {
      const storedId =
        await ChatPreferencesService.getGlobalImpersonatedEntity();
      const resolvedId = await resolvePersonaId(storedId);
      setImpersonatedEntityId(resolvedId);
      return resolvedId;
    } catch (error) {
      log.error('Failed to load impersonated persona:', error);
      return 'user';
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        const resolvedId = await loadImpersonatedEntity();
        if (!active) return;
        // Reload chat list when screen gains focus (e.g., returning from
        // ChatDetailScreen) so the last-message preview reflects any messages
        // sent/received during the chat session.
        await loadChatList(resolvedId);
      })();
      return () => {
        active = false;
      };
    }, [loadImpersonatedEntity, loadChatList]),
  );

  // F1: live updates while the list is focused. `message:received` updates the
  // matching visible row incrementally (preview + recency + unread badge — and
  // the floating bubble badge via syncBubbleUnreadBadge, F8); a conversation
  // that is NOT yet in the list (brand-new chat) falls back to a debounced
  // full reload. Session lifecycle events (`session:started` / `session:stopped`)
  // can add/remove conversations, so they trigger the same debounced reload.
  useFocusEffect(
    useCallback(() => {
      const handleMessageReceived = async (interactionId: string, message: any) => {
        const session = EntitySessionService.getInteractionSession(interactionId);
        if (!session) return;
        const scope = deriveScopeFromParticipants(session.participantIds);
        const participantKey = deriveParticipantKey(
          session.participantIds,
          session.ownEntityId,
          scope,
        );
        if (!participantKey) return;

        const existing = chatListRef.current.find(item => item.participantKey === participantKey);
        if (!existing) {
          // New conversation — not worth an incremental insert; debounce a
          // full reload instead.
          scheduleChatListReload();
          return;
        }

        try {
          const lastMsg = await getLastInteractionMessage(
            impersonatedEntityIdRef.current,
            participantKey,
          );

          // Who sent the message — 'You' for our own entity, else the partner
          // display name.
          let lastMessageSender = existing.lastMessageSender;
          const senderEntityId = message?.entity_id;
          const isOwnMessage = senderEntityId === session.ownEntityId;
          if (isOwnMessage) {
            lastMessageSender = t('you');
          } else if (senderEntityId === existing.entityId) {
            lastMessageSender = existing.characterName;
          }

          // Derived unread (A5/A2): a partner message bumps the derived badge
          // ONLY when the conversation is not open on screen AND the partner
          // entity is not muted (O10 — muted partner suppresses the badge).
          // Open conversations are marked read as they render (ChatDetail),
          // so the open-conversation guard stays: no bump while open.
          const isOpen = EntitySessionService.isConversationOpen(participantKey);
          const mutedPartner = existing.muted;
          const nextUnread =
            !isOwnMessage && !isOpen && !mutedPartner
              ? existing.unreadCount + 1
              : existing.unreadCount;

          const updated: ChatListItem = {
            ...existing,
            lastMessage: lastMsg?.content || message?.content || existing.lastMessage,
            lastMessageTime: lastMsg?.created_at || existing.lastMessageTime || new Date(),
            lastMessageSender,
            unreadCount: nextUnread,
          };

          // Re-sort the full list with the refreshed row, then split.
          const nextList = sortListItems(
            chatListRef.current.map(item =>
              item.participantKey === participantKey ? updated : item,
            ),
          );
          chatListRef.current = nextList;
          setChatList(nextList.filter(item => !item.archived));
          setArchivedList(nextList.filter(item => item.archived));

          // F8: push the same unread state to any floating bubble for this
          // conversation.
          syncBubbleUnreadBadge(nextList);
        } catch (error) {
          log.error('Failed to apply live message update:', error);
          scheduleChatListReload();
        }
      };

      const handleSessionLifecycle = () => {
        scheduleChatListReload();
      };

      EntitySessionService.on('message:received', handleMessageReceived);
      EntitySessionService.on('session:started', handleSessionLifecycle);
      EntitySessionService.on('session:stopped', handleSessionLifecycle);

      return () => {
        EntitySessionService.off('message:received', handleMessageReceived);
        EntitySessionService.off('session:started', handleSessionLifecycle);
        EntitySessionService.off('session:stopped', handleSessionLifecycle);
        if (reloadTimerRef.current) {
          clearTimeout(reloadTimerRef.current);
          reloadTimerRef.current = null;
        }
      };
    }, [t, scheduleChatListReload]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadChatList(impersonatedEntityIdRef.current);
    setRefreshing(false);
  }, [loadChatList]);

  // Marketplace preview lock — viewable free, chat locked until acquired; own
  // library (never published) is NEVER locked. The picker list is built inside
  // ChatPartnerPickerModal (this screen does not own the rows), so locked
  // entries cannot be pre-filtered cheaply here — the CENTRAL hard gate in
  // openCharacterChat covers them instead: it silently returns (log.warn) and
  // no chat opens. That matches the old "locked characters simply don't open
  // a chat" picker UX without per-row async lock checks.
  const handleNewChat = async (profile: CharacterProfile) => {
    try {
      await openCharacterChat(profile, {
        navigateToChat: params => navigation.navigate('ChatDetail', params),
      });
    } catch (err) {
      log.error('Failed to open chat from picker:', err);
    }
  };

  const handleChatPress = async (item: ChatListItem) => {
    // Opening a conversation marks its partner-sent messages read (derived
    // unread, A5/A2) so the badge clears immediately.
    try {
      await markConversationMessagesRead(
        item.participantKey,
        impersonatedEntityIdRef.current,
      );
    } catch (error) {
      log.warn('Failed to mark read on open:', error);
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
    menuItemKeyRef.current = item.participantKey;
    setMenuSettings({
      pinned: item.pinned,
      archived: item.archived,
      muted: item.muted,
      disabled: item.disabled,
      unreadCount: item.unreadCount,
      // Optimistic default; the persisted value is loaded below.
      replyMode: 'realistic',
    });
    setMenuItem(item);
    // A6: load the persisted reply pacing for this participant key so the
    // menu label reflects the current mode. Keyed by participantKey (stable).
    ChatPreferencesService.getReplyMode(item.participantKey).then(mode => {
      if (menuItemKeyRef.current === item.participantKey) {
        setMenuSettings(prev => ({ ...prev, replyMode: mode }));
      }
    });
  };

  const closeMenu = useCallback(() => {
    menuItemKeyRef.current = null;
    setMenuItem(null);
  }, []);

  // Reload the list after any context action.
  const reloadAfterAction = useCallback(() => {
    setMenuItem(null);
    loadChatList(impersonatedEntityIdRef.current);
  }, [loadChatList]);

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
    // Mute is a per-ENTITY flag (Q8) — no-op for groups (no single partner).
    if (!item.entityId) return;
    await setEntityMuted(item.entityId, !item.muted);
    showToast(item.muted ? t('toastUnmuted') : t('toastMuted'));
    reloadAfterAction();
  }, [menuItem, reloadAfterAction, showToast, t]);

  // A6 — reply pacing toggle (instant vs realistic). Persists the preference
  // per participant key; best-effort broadcasts SET_REPLY_MODE to an active
  // session for this interaction (e.g. the floating bubble) if one exists.
  // The pacing itself is applied at session INIT (INIT_ENTITY.reply_mode) —
  // see ChatDetailScreen.initializeSession.
  const handleToggleReplyMode = useCallback(async () => {
    const item = menuItem;
    if (!item) return;
    const newMode: ChatReplyMode =
      menuSettings.replyMode === 'realistic' ? 'instant' : 'realistic';
    try {
      await ChatPreferencesService.setReplyMode(item.participantKey, newMode);
      // No-op (logs a warning) when no session matches — safe best-effort.
      await EntitySessionService.setReplyMode(item.interactionId, newMode);
      showToast(
        newMode === 'instant'
          ? t('toastReplyModeInstant')
          : t('toastReplyModeRealistic'),
      );
    } catch (error) {
      log.error('Failed to set reply mode:', error);
    }
  }, [menuItem, menuSettings.replyMode, showToast, t]);

  const handleToggleRead = useCallback(async () => {
    const item = menuItem;
    if (!item) return;
    const ownEntityId = impersonatedEntityIdRef.current;
    if (item.unreadCount > 0) {
      // Mark all partner-sent messages in this conversation read.
      await markConversationMessagesRead(item.participantKey, ownEntityId);
      showToast(t('toastMarkedRead'));
    } else {
      // "Mark unread" = set exactly the LAST partner-sent message unread
      // (set-to-1 semantics, F10/A5) so repeated actions cannot accumulate a
      // bogus count.
      await markConversationMessagesUnread(item.participantKey, ownEntityId, 1);
      showToast(t('toastMarkedUnread'));
    }
    reloadAfterAction();
  }, [menuItem, reloadAfterAction, showToast, t]);

  const handleToggleDisable = useCallback(async () => {
    const item = menuItem;
    if (!item) return;
    // Disable is a per-ENTITY flag (Q8) — no-op for groups (no single partner).
    if (!item.entityId) return;
    const nowDisabled = !item.disabled;
    if (nowDisabled) {
      showAlert(
        t('menuDisable'),
        t('disableConversationBody', { name: item.characterName }),
        [
          { text: t('common:cancel'), style: 'cancel' },
          {
            text: t('menuDisable'),
            style: 'destructive',
            onPress: async () => {
              await setEntityDisabled(item.entityId, true);
              showToast(t('toastDisabled'));
              reloadAfterAction();
            },
          },
        ],
      );
      return;
    }
    // Disabling lives on the entity — no conversation override to seed; the
    // send/incoming guards read the entity flag directly (Q8).
    await setEntityDisabled(item.entityId, false);
    showToast(t('toastEnabled'));
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
          onEndReached={loadMoreChatList}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[theme!.colors.accent.primary]}
              tintColor={theme!.colors.accent.primary}
              progressBackgroundColor={theme!.colors.background.surface}
            />
          }
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.loadMoreFooter}>
                <ActivityIndicator
                  size="small"
                  color={theme!.colors.accent.primary}
                />
              </View>
            ) : null
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
        isDisabled={menuItem?.disabled ?? false}
        onClose={closeMenu}
        onTogglePin={handleTogglePin}
        onToggleArchive={handleToggleArchive}
        onToggleMute={handleToggleMute}
        onOpenBubble={handleOpenBubble}
        onToggleRead={handleToggleRead}
        onToggleDisable={handleToggleDisable}
        onToggleReplyMode={handleToggleReplyMode}
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
                {item.disabled && (
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
  loadMoreFooter: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
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
