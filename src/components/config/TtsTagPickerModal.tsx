/**
 * TtsTagPickerModal — searchable list of the model's insertable tags.
 *
 * The TTS test panel shows at most `MAX_INLINE_TAGS` quick-insert chips per
 * kind; the dashed "[+ N more]" chip and the "Search all" button open this
 * picker so a large vocabulary (Eleven v3 ships 12 cues + 48 tones + 3 breaks)
 * stays reachable without flooding the text field's toolbar.
 *
 * Two shapes are accepted:
 *  - `sections` (tts-voice-ux Phase 3): kind-grouped tags with a header per
 *    kind (`tts-tag-section-<kind>`), optionally restricted to one kind by
 *    `kindFilter` (the "[+ N more]" path); "Search all…" passes no filter.
 *  - `tags` (legacy/caller convenience): one flat list, no headers.
 *
 * Conventions follow `ChatPartnerPickerModal` (the repo's picker pattern):
 * RN `Modal`, safe-area insets, a search field above a `FlatList`, a haptic on
 * row tap, `useAppTheme` colors and the shared logger. Rows are sorted
 * alphabetically (case-insensitive) WITHIN each section and filtered live by
 * case-insensitive substring match. Tapping a row fires `onPick(tag)` — the
 * panel appends it through the exact same `insertTag` path as a chip press and
 * closes the modal.
 *
 * It is a full-screen transparent-over-dark fade rather than a bottom sheet so
 * the keyboard never hides the search field or the results.
 */

import React, { useEffect, useMemo, useState } from 'react';
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

/** One kind group of insertable tags (`*word*` forms). */
export interface TtsTagPickerSection {
  /** `cues` / `tones` / `breaks`, or `all` for a legacy flat list. */
  kind: string;
  label: string;
  tags: string[];
}

export interface TtsTagPickerModalProps {
  visible: boolean;
  /** Flat tag vocabulary (`*sigh*` forms). Ignored when `sections` is given. */
  tags?: string[];
  /** Kind-grouped vocabulary — the Phase 3 shape. */
  sections?: TtsTagPickerSection[];
  /** Show only this section (`null`/absent = every section, "search all"). */
  kindFilter?: string | null;
  onClose: () => void;
  /** Fired with the tapped tag; the parent inserts it and closes the modal. */
  onPick: (tag: string) => void;
}

/** A rendered list row: a section header or one tag. */
type PickerRow =
  | { type: 'header'; kind: string; label: string; count: number }
  | { type: 'tag'; tag: string };

/** Case-insensitive alphabetical order; the filter never re-orders rows. */
function sortTags(tags: string[]): string[] {
  return [...tags].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' }),
  );
}

export const TtsTagPickerModal: React.FC<TtsTagPickerModalProps> = ({
  visible,
  tags,
  sections,
  kindFilter,
  onClose,
  onPick,
}) => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('moduleConfig');
  const { top: safeTop, bottom: safeBottom } = useSafeAreaInsets();

  const [query, setQuery] = useState('');

  /** The active groups: the kind filter narrows `sections` to one entry. */
  const visibleSections = useMemo<TtsTagPickerSection[]>(() => {
    if (Array.isArray(sections) && sections.length > 0) {
      if (!kindFilter) return sections;
      return sections.filter((section) => section.kind === kindFilter);
    }
    if (Array.isArray(tags) && tags.length > 0) {
      return [{ kind: 'all', label: '', tags }];
    }
    return [];
  }, [sections, tags, kindFilter]);

  const totalTags = visibleSections.reduce((sum, section) => sum + section.tags.length, 0);

  // Fresh search on every open; drop the keyboard so the list is fully visible.
  useEffect(() => {
    if (!visible) return;
    setQuery('');
    log.debug(`Tag picker opened (${totalTags} tags)`);
  }, [visible, totalTags]);

  const rows = useMemo<PickerRow[]>(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const result: PickerRow[] = [];
    for (const section of visibleSections) {
      const sorted = sortTags(section.tags);
      const matches = normalizedQuery
        ? sorted.filter((tag) => tag.toLowerCase().includes(normalizedQuery))
        : sorted;
      if (matches.length === 0) continue;
      // Flat callers (no grouped sections) keep the bare list they always had.
      if (Array.isArray(sections) && sections.length > 0 && section.label) {
        result.push({
          type: 'header',
          kind: section.kind,
          label: section.label,
          count: matches.length,
        });
      }
      for (const tag of matches) result.push({ type: 'tag', tag });
    }
    return result;
  }, [visibleSections, query, sections]);

  if (!theme) return null;

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
              placeholder={
                kindFilter ? t('tagSearchPlaceholder') : t('tagSearchPlaceholderAll')
              }
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
          {rows.length === 0 ? (
            <View style={styles.emptyWrap}>
              <ThemedText size={12} variant="muted" testID="tts-tag-empty">
                {t('noTagMatches')}
              </ThemedText>
            </View>
          ) : (
            <FlatList
              data={rows}
              // The vocabulary is bounded (12+48+3 on Eleven v3), so rendering
              // every row up-front keeps the grouped headers reachable without
              // a scroll in a short modal.
              initialNumToRender={rows.length}
              keyExtractor={(row) =>
                row.type === 'header' ? `section:${row.kind}` : `tag:${row.tag}`
              }
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) =>
                item.type === 'header' ? (
                  <View
                    testID={`tts-tag-section-${item.kind}`}
                    style={[styles.sectionHeader, { borderBottomColor: theme.colors.border.default }]}
                  >
                    <ThemedText size={10.5} weight="bold" style={styles.sectionHeaderText}>
                      {`${item.label} · ${item.count}`}
                    </ThemedText>
                  </View>
                ) : (
                  <TouchableOpacity
                    testID={`tts-tag-row:${paralinguisticTagSlug(item.tag)}`}
                    onPress={() => handlePick(item.tag)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Insert ${item.tag}`}
                    style={[styles.row, { borderBottomColor: theme.colors.border.default }]}
                  >
                    <ThemedText size={11} style={styles.rowText}>
                      {item.tag}
                    </ThemedText>
                    <Icon name="insert" size={14} color="#94A3B8" />
                  </TouchableOpacity>
                )
              }
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
  sectionHeader: {
    paddingTop: 10,
    paddingBottom: 4,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sectionHeaderText: {
    color: '#94A3B8',
    letterSpacing: 0.4,
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
