/**
 * TtsTagPickerModal — searchable list of the model's paralinguistic tags.
 *
 * The TTS test panel shows at most `MAX_INLINE_TAGS` quick-insert chips; the
 * dashed "[+ N more]" chip opens this picker so a large tag vocabulary
 * (Chatterbox Turbo ships dozens of `[laughter]` / `[sigh]`-style tags) stays
 * reachable without flooding the text field's toolbar.
 *
 * Conventions follow `ChatPartnerPickerModal` (the repo's picker pattern):
 * RN `Modal`, safe-area insets, a search field above a `FlatList`, a haptic on
 * row tap, `useAppTheme` colors and the shared logger. Rows are sorted
 * alphabetically (case-insensitive) and filtered live by case-insensitive
 * substring match. Tapping a row fires `onPick(tag)` — the panel appends it
 * through the exact same `insertTag` path as a chip press and closes the modal.
 *
 * It is a full-screen transparent-over-dark fade rather than a bottom sheet so
 * the keyboard never hides the search field or the results.
 */

import React, { useEffect, useState } from 'react';
import {
  FlatList,
  Keyboard,
  Modal,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { hapticLightPress } from '../../utils/haptics';
import { createLogger } from '../../utils/logger';
import { paralinguisticTagSlug } from './paralinguisticTagTestIds';

const log = createLogger('[TtsTagPickerModal]');

export interface TtsTagPickerModalProps {
  visible: boolean;
  /** The full tag vocabulary (the panel already trims it to the inline cap). */
  tags: string[];
  onClose: () => void;
  /** Fired with the tapped tag; the parent inserts it and closes the modal. */
  onPick: (tag: string) => void;
}

/** Case-insensitive alphabetical order; the filter never re-orders rows. */
function sortTags(tags: string[]): string[] {
  return [...tags].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' }),
  );
}

export const TtsTagPickerModal: React.FC<TtsTagPickerModalProps> = ({
  visible,
  tags,
  onClose,
  onPick,
}) => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('moduleConfig');
  const { top: safeTop, bottom: safeBottom } = useSafeAreaInsets();

  const [query, setQuery] = useState('');

  // Fresh search on every open; drop the keyboard so the list is fully visible.
  useEffect(() => {
    if (!visible) return;
    setQuery('');
    log.debug(`Tag picker opened (${tags.length} tags)`);
  }, [visible, tags.length]);

  if (!theme) return null;

  const normalizedQuery = query.trim().toLowerCase();
  const filteredTags = normalizedQuery
    ? sortTags(tags).filter((tag) => tag.toLowerCase().includes(normalizedQuery))
    : sortTags(tags);

  const handlePick = (tag: string) => {
    hapticLightPress();
    Keyboard.dismiss();
    onPick(tag);
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        {/* Tap outside the sheet to dismiss. */}
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
          accessibilityLabel={t('common:close')}
          accessibilityRole="button"
        />

        <View
          style={[
            styles.sheet,
            {
              paddingTop: safeTop + 12,
              paddingBottom: safeBottom + 12,
              backgroundColor: theme.colors.background.surface,
              borderColor: theme.colors.border.default,
            },
          ]}
        >
          {/* ── Header ── */}
          <View style={styles.header}>
            <ThemedText size={15} weight="bold" hierarchy="header" style={styles.headerTitle}>
              {t('tagPickerTitle')}
            </ThemedText>
            <TouchableOpacity
              testID="tts-tag-modal-close"
              onPress={onClose}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={t('common:close')}
              style={[
                styles.closeBtn,
                { backgroundColor: theme.colors.background.base },
              ]}
            >
              <Icon name="close" size={18} color={theme.colors.text.muted} />
            </TouchableOpacity>
          </View>

          {/* ── Search ── */}
          <View
            style={[
              styles.searchWrap,
              {
                backgroundColor: theme.colors.background.base,
                borderColor: theme.colors.border.default,
              },
            ]}
          >
            <Icon name="magnify" size={16} color={theme.colors.text.muted} />
            <TextInput
              testID="tts-tag-search"
              style={[styles.searchInput, { color: theme.colors.text.primary }]}
              placeholder={t('tagSearchPlaceholder')}
              placeholderTextColor={theme.colors.text.disabled}
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
            />
            {query.length > 0 ? (
              <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
                <Icon name="close-circle" size={16} color={theme.colors.text.muted} />
              </TouchableOpacity>
            ) : null}
          </View>

          {/* ── Tag list ── */}
          {filteredTags.length === 0 ? (
            <View style={styles.emptyWrap}>
              <ThemedText size={12} variant="muted" testID="tts-tag-empty">
                {t('noTagMatches')}
              </ThemedText>
            </View>
          ) : (
            <FlatList
              data={filteredTags}
              keyExtractor={(tag) => tag}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => (
                <TouchableOpacity
                  testID={`tts-tag-row:${paralinguisticTagSlug(item)}`}
                  onPress={() => handlePick(item)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Insert ${item}`}
                  style={[styles.row, { borderBottomColor: theme.colors.border.default }]}
                >
                  <ThemedText size={11} style={styles.rowText}>
                    {item}
                  </ThemedText>
                  <Icon name="insert" size={14} color="#94A3B8" />
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(2, 6, 23, 0.78)',
  },
  sheet: {
    flex: 1,
    marginTop: '12%',
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingBottom: 10,
  },
  headerTitle: {
    flex: 1,
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    height: 38,
    borderRadius: 9,
    borderWidth: 1,
    marginBottom: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 12,
    paddingVertical: 0,
  },
  listContent: {
    paddingBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: {
    flex: 1,
    color: '#E9D5FF',
    fontFamily: 'monospace',
  },
  emptyWrap: {
    paddingVertical: 28,
    alignItems: 'center',
  },
});

export default TtsTagPickerModal;
