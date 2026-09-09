/**
 * ChatPartnerPickerModal — "start a new chat with one of your AI characters"
 *
 * Opens as a full-screen picker when the user taps the ＋ FAB on the Chat list
 * screen. Lists one MIXED alphabetical row set (avatar + resolved label +
 * description preview, chat icon button at the end):
 *
 *  - CARD rows — live profiles no live entity references yet. Tapping creates
 *    a new entity from the card via the existing create path.
 *  - ENTITY rows — every live AI entity with a linked card that has had NO
 *    interaction with the CURRENTLY impersonated persona (ruling 1b/2,
 *    Variant B). ONE ROW PER ENTITY: two unused entities sharing a card
 *    produce two rows — the old one-row-per-card list made duplicates
 *    unreachable and silently routed new chats to the newest entity.
 *
 * Rows come from `getChatPickerRows(impersonatedPersonaId)` (persona-scoped,
 * soft-delete aware, disabled/muted entities stay visible per ruling 3).
 * Labels resolve through the shared `resolveChatPickerRowLabel` helper
 * (card → nickname||name, entity → alias||nickname||name) so the sort, the
 * search filter and the render never drift apart. Marketplace-locked entries
 * are NOT filtered here — the central hard gate in openCharacterChat covers
 * them (it silently ignores the request).
 *
 * Full-screen (not a bottom sheet) so the keyboard never hides the search bar
 * or the results — the whole screen is the picker and results scroll freely.
 *
 * Tapping a row or its chat button fires `onChat(row)` — the parent
 * (ChatListScreen) routes through openCharacterChat, passing
 * `targetEntityId` for entity rows so the chat opens with THAT entity.
 */

import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { ThemedEmptyState } from '../themed/ThemedEmptyState';
import { hexToRgba } from '../../utils/colorUtils';
import { hapticLightPress } from '../../utils/haptics';
import {
  getChatPickerRows,
  getCharacterImages,
  hasChatPickerLibrary,
  resolveChatPickerRowLabel,
  ChatPickerRow,
} from '../../database/repositories/characters';
import { createDataURL } from '../../database/base64';
import { ProfileAvatar } from '../profile/ProfileAvatar';
import { createLogger } from '../../utils/logger';

const log = createLogger('[ChatPartnerPickerModal]');

interface ChatPartnerPickerModalProps {
  visible: boolean;
  onClose: () => void;
  /**
   * The currently impersonated persona entity id — scopes the picker's
   * "already chatted" filter (ruling 2, Variant B): an entity that has only
   * interacted with a DIFFERENT persona is still offered as a fresh chat.
   */
  impersonatedPersonaId: string;
  /** Fired when the user picks a row (card or entity) to chat with */
  onChat: (row: ChatPickerRow) => void;
}

/** Stable list key + testID suffix: `card:<profileId>` / `entity:<entityId>`. */
function chatPickerRowKey(row: ChatPickerRow): string {
  return row.kind === 'card' ? `card:${row.profile.id}` : `entity:${row.entity.id}`;
}

export const ChatPartnerPickerModal: React.FC<ChatPartnerPickerModalProps> = ({
  visible,
  onClose,
  impersonatedPersonaId,
  onChat,
}) => {
  const { theme } = useAppTheme();
  const { top: safeTop, bottom: safeBottom } = useSafeAreaInsets();
  const { t } = useTranslation('chatList');

  const [rows, setRows] = useState<ChatPickerRow[]>([]);
  const [libraryHasContent, setLibraryHasContent] = useState(false);
  const [avatars, setAvatars] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  // Height of the soft keyboard (0 when hidden) — keeps the search bar + list
  // visible without double-compensating via KeyboardAvoidingView.
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  // ── Keyboard inset (edge-to-edge Android: adjustResize doesn't fire) ──
  useEffect(() => {
    const onShow = (e: any) => {
      setKeyboardHeight(e?.endCoordinates?.height ?? 300);
    };
    const onHide = () => setKeyboardHeight(0);
    const subs = [
      Keyboard.addListener('keyboardWillShow', onShow),
      Keyboard.addListener('keyboardDidShow', onShow),
      Keyboard.addListener('keyboardWillHide', onHide),
      Keyboard.addListener('keyboardDidHide', onHide),
    ];
    return () => subs.forEach(s => s.remove());
  }, []);

  // Load picker rows + primary avatars each time the picker opens — or the
  // impersonated persona changes (the row set is persona-scoped, ruling 2).
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    setQuery('');

    (async () => {
      try {
        const data = await getChatPickerRows(impersonatedPersonaId);
        if (cancelled) return;
        setRows(data);

        // Entity rows carry their linked profile, so several rows may share
        // one profile id — load each avatar ONCE, keyed by profile id.
        const profileIds = [...new Set(data.map(row => row.profile.id))];
        const avatarMap: Record<string, string | null> = {};
        await Promise.all(
          profileIds.map(async profileId => {
            try {
              const imgs = await getCharacterImages(profileId);
              const primary = imgs.find(img => img.is_primary === true);
              avatarMap[profileId] = primary
                ? createDataURL(primary.image_data, primary.mime_type)
                : null;
            } catch {
              avatarMap[profileId] = null;
            }
          }),
        );
        // Distinguishes the two empty states (ruling 4 / pickerEmpty vs
        // pickerAllChatted) — a cheap LIMIT 1 probe, only meaningful when
        // there are no rows.
        const hasLibrary = await hasChatPickerLibrary();
        if (cancelled) return;
        setLibraryHasContent(hasLibrary);
        setAvatars(avatarMap);
      } catch (err) {
        log.error('Failed to load rows for chat picker:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, impersonatedPersonaId]);

  if (!theme) return null;

  const accent = theme.colors.accent.primary;
  const accentSecondary =
    theme.colors.accent.secondary ?? theme.colors.accent.primaryHover ?? accent;

  // Prefix match on the RESOLVED label (shared helper) — typing "Ma" finds
  // the entity aliased "Max" even though its card is named "Maximilian", but
  // not "Samara" (ruling 4).
  const filteredRows = rows.filter(row =>
    resolveChatPickerRowLabel(row)
      .toLowerCase()
      .startsWith(query.trim().toLowerCase()),
  );

  const handleChat = (row: ChatPickerRow) => {
    hapticLightPress();
    onClose();
    onChat(row);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <LinearGradient
          colors={[
            theme.colors.background.elevated,
            theme.colors.background.base,
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          colors={[accent + 'CC', accentSecondary + '55', 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.topStripe}
        />

        <>
          {/* ── Header ── */}
          <View style={[styles.header, { paddingTop: safeTop + 8 }]}>
            <View style={styles.headerText}>
              <ThemedText size={20} weight="bold" hierarchy="header">
                {t('pickerTitle')}
              </ThemedText>
              <ThemedText variant="muted" size={13}>
                {t('pickerHint')}
              </ThemedText>
            </View>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel={t('common:close')}
              accessibilityRole="button"
              style={[
                styles.closeBtn,
                { backgroundColor: hexToRgba(theme.colors.background.base, 0.75) },
              ]}
            >
              <Icon name="close" size={22} color={theme.colors.text.muted} />
            </TouchableOpacity>
          </View>

          {/* ── Search ── */}
          <View
            style={[
              styles.searchWrap,
              {
                backgroundColor: hexToRgba(theme.colors.background.base, 0.55),
                borderColor: hexToRgba(accent, 0.25),
              },
            ]}
          >
            <Icon name="magnify" size={18} color={theme.colors.text.muted} />
            <TextInput
              style={[styles.searchInput, { color: theme.colors.text.primary }]}
              placeholder={t('pickerSearch')}
              placeholderTextColor={theme.colors.text.disabled}
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
              autoFocus
              returnKeyType="search"
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
                <Icon name="close-circle" size={17} color={theme.colors.text.muted} />
              </TouchableOpacity>
            )}
          </View>

          {/* ── List ── */}
          <View style={styles.flex}>
            {loading ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator size="large" color={accent} />
              </View>
            ) : filteredRows.length === 0 ? (
              <ThemedEmptyState
                compact
                icon={query ? 'file-search-outline' : 'chat-outline'}
                title={
                  query
                    ? t('pickerNoResults')
                    : libraryHasContent
                      ? t('pickerAllChatted')
                      : t('pickerEmpty')
                }
                subtitle={
                  query
                    ? t('pickerNoResultsHint')
                    : libraryHasContent
                      ? t('pickerAllChattedHint')
                      : t('pickerEmptyHint')
                }
                style={styles.empty}
              />
            ) : (
              <FlatList
                data={filteredRows}
                keyExtractor={chatPickerRowKey}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={[
                  styles.listContent,
                  { paddingBottom: safeBottom + 16 },
                ]}
                renderItem={({ item }) => {
                  const label = resolveChatPickerRowLabel(item);
                  const rowKey = chatPickerRowKey(item);
                  return (
                    <TouchableOpacity
                      onPress={() => handleChat(item)}
                      activeOpacity={0.7}
                      style={styles.row}
                      testID={`chat-picker-${rowKey}`}
                      accessibilityRole="button"
                      accessibilityLabel={`Chat with ${label}`}
                    >
                      <ProfileAvatar
                        name={label}
                        uri={avatars[item.profile.id] ?? null}
                        size={44}
                        showRing={false}
                      />
                      <View style={styles.rowText}>
                        <ThemedText size={15} weight="bold" numberOfLines={1}>
                          {label}
                        </ThemedText>
                        {item.profile.description ? (
                          <ThemedText
                            variant="muted"
                            size={12}
                            numberOfLines={1}
                            style={styles.rowDesc}
                          >
                            {item.profile.description}
                          </ThemedText>
                        ) : null}
                      </View>
                      <TouchableOpacity
                        onPress={() => handleChat(item)}
                        hitSlop={8}
                        style={[
                          styles.chatIcon,
                          { backgroundColor: hexToRgba(accent, 0.18) },
                        ]}
                        testID={`chat-picker-chat-${rowKey}`}
                        accessibilityRole="button"
                        accessibilityLabel={`Start chat with ${label}`}
                      >
                        <Icon name="chat" size={18} color={accent} />
                      </TouchableOpacity>
                    </TouchableOpacity>
                  );
                }}
              />
            )}
          </View>

          {/* Keyboard spacer — keeps the list + search visible above the keyboard */}
          <View style={{ height: keyboardHeight }} />
        </>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  flex: {
    flex: 1,
  },
  topStripe: {
    height: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 12,
    paddingHorizontal: 12,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 0,
  },
  loadingWrap: {
    paddingVertical: 56,
    alignItems: 'center',
  },
  empty: {
    paddingVertical: 32,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 14,
  },
  rowText: {
    flex: 1,
  },
  rowDesc: {
    marginTop: 1,
  },
  chatIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default ChatPartnerPickerModal;
