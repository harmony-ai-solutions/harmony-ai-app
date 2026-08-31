/**
 * ArchivedChatsScreen — the "Archived" chat list.
 *
 * Shows every conversation the user has archived via the chat-list long-press
 * menu, separated from the main chat list. Tapping a chat opens it (which
 * keeps it archived but marks it read); long-press opens the same context
 * menu (Unarchive / Pin / Mute / Bubble / Read / Block / Delete).
 */

import React, { useCallback, useEffect, useState, useRef } from 'react';
import { StyleSheet, View, FlatList, RefreshControl, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedView } from '../../components/themed/ThemedView';
import { ThemedText } from '../../components/themed/ThemedText';
import { ThemedEmptyState } from '../../components/themed/ThemedEmptyState';
import { ScreenHeader } from '../../components/themed/ScreenHeader';
import { hapticLightPress } from '../../utils/haptics';
import { TAB_BAR_CONTENT_PAD } from '../../components/navigation/GlassTabBar';
import {
  getAllEntities,
  setEntityMuted,
  setEntityDisabled,
} from '../../database/repositories/entities';
import { resolvePersonaId } from '../../database/repositories/personas';
import {
  getPhoneConversationsPage,
  PhoneConversationPageRow,
  getLastInteractionMessage,
} from '../../database/repositories/interactions';
import {
  getPrimaryImage,
  getCharacterProfile,
  imageToDataURL,
} from '../../database/repositories/characters';
import {
  getChatConversationSettingsBatch,
  setConversationPinned,
  setConversationArchived,
} from '../../database/repositories/chatConversationSettings';
import {
  deleteConversationByParticipantKey,
  markConversationMessagesRead,
  markConversationMessagesUnread,
  getUnreadCountByParticipantKeys,
} from '../../database/repositories/conversation_messages';
import { ProfileAvatar } from '../../components/profile/ProfileAvatar';
import { ChatConversationMenuModal } from '../../components/chat/ChatConversationMenuModal';
import { useAppAlert } from '../../contexts/AppAlertContext';
import { useToast } from '../../contexts/AppToastContext';
import {
  showBubble,
  requestBubblePermission,
} from '../../services/ChatBubbleService';
import ChatPreferencesService, { ChatReplyMode } from '../../services/ChatPreferencesService';
import EntitySessionService from '../../services/EntitySessionService';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { hexToRgba } from '../../utils/colorUtils';

interface ArchivedItem {
  interactionId: string;
  entityId: string;
  characterName: string;
  lastMessage: string;
  lastMessageTime: Date | null;
  avatarUri: string | null;
  participantKey: string;
  participantIds: string[];
  isGroup: boolean;
  pinned: boolean;
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

export const ArchivedChatsScreen: React.FC = () => {
  const { theme } = useAppTheme();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { t } = useTranslation('chatList');
  const { showAlert } = useAppAlert();
  const { showToast } = useToast();
  const [items, setItems] = useState<ArchivedItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  // Long-press menu state
  const [menuItem, setMenuItem] = useState<ArchivedItem | null>(null);
  // A6 reply pacing for the conversation whose menu is open.
  const [menuReplyMode, setMenuReplyMode] = useState<ChatReplyMode>('realistic');
  // Guards the async reply-mode load: only apply if the same conversation is
  // still the one whose menu is open.
  const menuItemKeyRef = useRef<string | null>(null);

  const closeMenu = useCallback(() => {
    menuItemKeyRef.current = null;
    setMenuItem(null);
  }, []);

  const handleLongPress = (item: ArchivedItem) => {
    hapticLightPress();
    menuItemKeyRef.current = item.participantKey;
    setMenuReplyMode('realistic');
    setMenuItem(item);
    // A6: load the persisted reply pacing so the menu label reflects the
    // current mode (keyed by participantKey, stable across navigations).
    ChatPreferencesService.getReplyMode(item.participantKey).then(mode => {
      if (menuItemKeyRef.current === item.participantKey) {
        setMenuReplyMode(mode);
      }
    });
  };

  // Live persona (F12) — refreshed on every load; stable callbacks read the
  // ref instead of capturing a stale render value.
  const impersonatedEntityIdRef = useRef<string>('user');

  const loadArchived = useCallback(async () => {
    try {
      // F12: resolve the LIVE global persona (fallback 'user') — never
      // hardcode the 'user' perspective.
      const storedId = await ChatPreferencesService.getGlobalImpersonatedEntity();
      const impersonated = await resolvePersonaId(storedId);
      impersonatedEntityIdRef.current = impersonated;

      const entities = await getAllEntities();
      const entityMap = new Map(entities.map(e => [e.id, e]));

      // F6: same conversation-level query the chat list uses — deduped by
      // participant_key and ordered by last-message created_at.
      const rows = await getPhoneConversationsPage(impersonated, { limit: 200, offset: 0 });
      const candidates: ArchivedItem[] = [];
      const seenKeys = new Set<string>();

      for (const row of rows) {
        const scope = row.interactionScope;
        if (scope !== 'private') continue;
        const participantKey = row.participantKey || '';
        if (!participantKey || seenKeys.has(participantKey)) continue;
        seenKeys.add(participantKey);

        const participantIds = (() => {
          try {
            return JSON.parse(row.participantIds);
          } catch {
            return [];
          }
        })();
        const partnerEntityId = participantIds.find((id: string) => id !== impersonated);
        if (!partnerEntityId) continue;
        if (!entityMap.has(partnerEntityId)) continue;

        const entity = entityMap.get(partnerEntityId);
        const lastMsg = await getLastInteractionMessage(impersonated, participantKey);
        let avatarUri: string | null = null;
        let characterProfileName: string | null = null;
        if (entity?.character_profile_id) {
          const profile = await getCharacterProfile(entity.character_profile_id);
          characterProfileName = profile?.name ?? null;
          const primaryImage = await getPrimaryImage(entity.character_profile_id);
          if (primaryImage) avatarUri = imageToDataURL(primaryImage);
        }

        candidates.push({
          interactionId: row.interactionId,
          entityId: partnerEntityId,
          characterName: getEntityDisplayName(entity?.alias ?? null, characterProfileName, partnerEntityId),
          lastMessage: lastMsg?.content || t('noMessagesYet'),
          lastMessageTime: lastMsg?.created_at || null,
          avatarUri,
          participantKey,
          participantIds,
          isGroup: false,
          // mute/disabled are ENTITY flags (Q8); unread derived below.
          pinned: false,
          muted: entity?.is_muted === 1,
          disabled: entity?.is_disabled === 1,
          unreadCount: 0,
        });
      }

      // Filter to archived only. pin/archive come from the settings batch;
      // mute/disabled are entity flags (already set above); unread is derived
      // from conversation_messages.is_read (A2-scoped).
      const keys = candidates.map(c => c.participantKey);
      const settingsMap = await getChatConversationSettingsBatch(keys);
      const unreadMap = await getUnreadCountByParticipantKeys(keys, impersonated);
      const archived = candidates.filter(c => settingsMap.get(c.participantKey)?.archived);
      for (const item of archived) {
        const s = settingsMap.get(item.participantKey);
        if (s) {
          item.pinned = s.pinned;
        }
        item.unreadCount = unreadMap.get(item.participantKey) ?? 0;
      }
      archived.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        if (!a.lastMessageTime && !b.lastMessageTime) return 0;
        if (!a.lastMessageTime) return 1;
        if (!b.lastMessageTime) return -1;
        return b.lastMessageTime.getTime() - a.lastMessageTime.getTime();
      });
      setItems(archived);
    } catch (error) {
      // ignore — empty on error
    } finally {
      setRefreshing(false);
    }
  }, [t]);

  useEffect(() => {
    loadArchived();
  }, [loadArchived]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadArchived();
  }, [loadArchived]);

  // ── Context actions (all reload the list after acting) ──
  const reload = useCallback(() => {
    setMenuItem(null);
    loadArchived();
  }, [loadArchived]);

  const handleTogglePin = useCallback(async () => {
    const item = menuItem;
    if (!item) return;
    await setConversationPinned(item.participantKey, item.entityId || null, !item.pinned);
    showToast(item.pinned ? t('toastUnpinned') : t('toastPinned'));
    reload();
  }, [menuItem, reload, showToast, t]);

  const handleUnarchive = useCallback(async () => {
    const item = menuItem;
    if (!item) return;
    await setConversationArchived(item.participantKey, item.entityId || null, false);
    showToast(t('toastUnarchived'));
    reload();
  }, [menuItem, reload, showToast, t]);

  const handleToggleMute = useCallback(async () => {
    const item = menuItem;
    if (!item) return;
    // Mute is a per-ENTITY flag (Q8) — no-op for groups (no single partner).
    if (!item.entityId) return;
    await setEntityMuted(item.entityId, !item.muted);
    showToast(item.muted ? t('toastUnmuted') : t('toastMuted'));
    reload();
  }, [menuItem, reload, showToast, t]);

  // A6 — reply pacing toggle (instant vs realistic). Persists the preference
  // per participant key; best-effort broadcasts SET_REPLY_MODE to an active
  // session for this interaction if one exists (usually none from this screen).
  const handleToggleReplyMode = useCallback(async () => {
    const item = menuItem;
    if (!item) return;
    const newMode: ChatReplyMode =
      menuReplyMode === 'realistic' ? 'instant' : 'realistic';
    try {
      await ChatPreferencesService.setReplyMode(item.participantKey, newMode);
      await EntitySessionService.setReplyMode(item.interactionId, newMode);
      showToast(
        newMode === 'instant'
          ? t('toastReplyModeInstant')
          : t('toastReplyModeRealistic'),
      );
    } catch (error) {
      // ignore — storage failure shouldn't block the menu
    }
  }, [menuItem, menuReplyMode, showToast, t]);

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
    // permission when missing; the bubble auto-shows on return from settings.
    const shown = await showBubble(conversation);
    if (shown) {
      showToast(t('toastBubbleShown'));
      return;
    }

    // Permission not granted yet — request it; pending conversation auto-shows.
    const accepted = await requestBubblePermission();
    if (!accepted) {
      showToast(t('bubblePermissionDenied'));
    } else {
      showToast(t('toastBubbleShown'));
    }
  }, [menuItem, showToast, t]);

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
    reload();
  }, [menuItem, reload, showToast, t]);

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
              reload();
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
    reload();
  }, [menuItem, reload, showAlert, showToast, t]);

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
              loadArchived();
            } catch (error) {
              // ignore
            }
          },
        },
      ],
    );
  }, [menuItem, showAlert, showToast, t, loadArchived]);

  const handleOpenChat = (item: ArchivedItem) => {
    hapticLightPress();
    navigation.navigate('ChatDetail', {
      interactionId: item.interactionId,
      participantKey: item.participantKey,
      participantIds: item.participantIds,
      entityId: impersonatedEntityIdRef.current,
      entityName: item.characterName,
    });
  };

  if (!theme) return null;

  const renderItem = ({ item }: { item: ArchivedItem }) => (
    <ArchivedRow item={item} onPress={() => handleOpenChat(item)} onLongPress={() => handleLongPress(item)} />
  );

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader title={t('archived')} onBack={() => navigation.goBack()} />

      <FlatList
        style={{ flex: 1 }}
        data={items}
        renderItem={renderItem}
        keyExtractor={item => item.interactionId}
        contentContainerStyle={[styles.listContent, { paddingBottom: TAB_BAR_CONTENT_PAD + safeBottom }]}
        alwaysBounceVertical
        overScrollMode="always"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[theme.colors.accent.primary]}
            tintColor={theme.colors.accent.primary}
            progressBackgroundColor={theme.colors.background.surface}
          />
        }
        ListEmptyComponent={
          <ThemedEmptyState
            icon="archive-outline"
            title={t('archivedEmpty')}
            subtitle={t('archivedEmptyHint')}
          />
        }
      />

      <ChatConversationMenuModal
        visible={menuItem !== null}
        conversationName={menuItem?.characterName ?? ''}
        settings={{
          pinned: menuItem?.pinned ?? false,
          archived: true,
          muted: menuItem?.muted ?? false,
          disabled: menuItem?.disabled ?? false,
          unreadCount: menuItem?.unreadCount ?? 0,
          replyMode: menuReplyMode,
        }}
        isDisabled={menuItem?.disabled ?? false}
        onClose={closeMenu}
        onTogglePin={handleTogglePin}
        onToggleArchive={handleUnarchive}
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

const ArchivedRow: React.FC<{
  item: ArchivedItem;
  onPress: () => void;
  onLongPress: () => void;
}> = ({ item, onPress, onLongPress }) => {
  const { theme } = useAppTheme();
  if (!theme) return null;
  const glassFill = hexToRgba(theme.colors.background.surface, 0.45);
  const borderStart = 'rgba(255, 255, 255, 0.20)';
  const borderEnd = hexToRgba(theme.colors.accent.secondary, 0.10);

  return (
    <View
      style={[styles.cardBorder, { borderColor: borderStart }]}
    >
      <View style={[styles.cardBody, { backgroundColor: glassFill }]}>
        <ProfileAvatar name={item.characterName} uri={item.avatarUri} size={48} />
        <View style={styles.cardText}>
          <View style={styles.cardNameRow}>
            <ThemedText size={15} weight="bold" numberOfLines={1} style={styles.cardName}>
              {item.characterName}
            </ThemedText>
            {item.muted && <Icon name="volume-off" size={13} color={theme.colors.text.muted} />}
          </View>
          <ThemedText variant="muted" size={13} numberOfLines={1}>
            {item.lastMessage}
          </ThemedText>
        </View>
        <Icon name="archive-outline" size={16} color={theme.colors.text.muted} />
      </View>
      <TouchableOpacity
        style={StyleSheet.absoluteFill}
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={400}
        activeOpacity={0.6}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 6,
    gap: 10,
  },
  cardBorder: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  cardBody: {
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
});
