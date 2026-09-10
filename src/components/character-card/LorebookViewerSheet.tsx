/**
 * LorebookViewerSheet (3-4) — browse/edit the profile's lorebook.
 *
 * Reads/writes the `character_book` JSON string on the profile. Header shows
 * "Lorebook · N entries · C constant · scan depth S" (parsed from the top-level
 * `character_book` keys). Each row: enabled/disabled toggle, key preview,
 * `constant` badge, entry name/comment. Tap a row → `LorebookEntryEditor`;
 * "Add entry" starts a new entry. Every edit calls `onChange` with the updated
 * JSON immediately — the embedding happens on profile save (optimistic local
 * update, §3-4).
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Switch,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { ThemedButton } from '../themed/ThemedButton';
import { SheetModal } from './SheetModal';
import { MacroHighlighter } from './MacroHighlighter';
import { LorebookEntryEditor } from './LorebookEntryEditor';
import {
  createEmptyLorebook,
  countConstantEntries,
  parseLorebook,
} from './lorebook';
import type { CharacterBook, CharacterBookEntry } from '../../utils/charactercard/types';

export interface LorebookViewerSheetProps {
  open: boolean;
  onClose: () => void;
  /** Raw `character_book` JSON string from the profile (`''`/`'null'`/invalid → no book). */
  characterBook: string | null;
  /** Called on every edit with the updated JSON string (optimistic). */
  onChange: (nextBookJson: string) => void;
}

type EditingState = { mode: 'edit' | 'new'; index: number } | null;

export const LorebookViewerSheet: React.FC<LorebookViewerSheetProps> = ({
  open,
  onClose,
  characterBook,
  onChange,
}) => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('characters');

  const book = useMemo(() => parseLorebook(characterBook), [characterBook]);
  const entries = book?.entries ?? [];
  const constantCount = countConstantEntries(book);
  const scanDepth = book?.scan_depth;
  const tokenBudget = book?.token_budget;

  const [editing, setEditing] = useState<EditingState>(null);

  // Reset any in-flight entry editing when the sheet closes.
  useEffect(() => {
    if (!open) setEditing(null);
  }, [open]);

  if (!theme) return null;

  const updateBook = (updater: (b: CharacterBook) => CharacterBook) => {
    const current = parseLorebook(characterBook) ?? createEmptyLorebook();
    onChange(JSON.stringify(updater(current)));
  };

  const toggleEntry = (index: number) => {
    updateBook(b => ({
      ...b,
      entries: b.entries.map((e, i) =>
        i === index ? { ...e, enabled: !e.enabled } : e,
      ),
    }));
  };

  const saveEntry = (saved: CharacterBookEntry) => {
    if (!editing) return;
    if (editing.mode === 'new') {
      updateBook(b => ({ ...b, entries: [...b.entries, saved] }));
    } else {
      updateBook(b => ({
        ...b,
        entries: b.entries.map((e, i) => (i === editing.index ? saved : e)),
      }));
    }
  };

  const accent = theme.colors.accent.primary;
  const muted = theme.colors.text.muted;
  const border = theme.colors.border.default;

  const editedEntry =
    editing?.mode === 'edit' && entries[editing.index]
      ? entries[editing.index]
      : null;

  const headerParts = [
    t('lorebook'),
    `${entries.length} ${t('lorebookEntries', { count: entries.length })}`,
    `${constantCount} ${t('lorebookConstant')}`,
  ];
  if (scanDepth != null) {
    headerParts.push(`${t('lorebookScanDepth')} ${scanDepth}`);
  }
  if (tokenBudget != null) {
    headerParts.push(`${t('lorebookTokenBudget')} ${tokenBudget}`);
  }

  return (
    <SheetModal open={open} onClose={onClose} testID="lorebook-viewer">
      <View style={styles.header}>
        <ThemedText size={18} weight="bold" style={styles.title}>
          {headerParts.join(' · ')}
        </ThemedText>
        <ThemedText variant="muted" size={12} style={styles.subtitle}>
          {t('lorebookViewerHint')}
        </ThemedText>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        {entries.length === 0 ? (
          <View style={styles.emptyBox}>
            <ThemedText variant="muted" size={13}>
              {t('lorebookEmpty')}
            </ThemedText>
          </View>
        ) : (
          entries.map((entry, index) => (
            <TouchableOpacity
              key={index}
              onPress={() => setEditing({ mode: 'edit', index })}
              accessibilityRole="button"
              testID={`lorebook-entry-${index}`}
              style={[styles.entryRow, { borderColor: border }]}
            >
              <View style={styles.entryTopRow}>
                <Switch
                  value={entry.enabled}
                  onValueChange={() => toggleEntry(index)}
                  trackColor={{ true: accent, false: border }}
                  testID={`lorebook-toggle-${index}`}
                />
                <View style={styles.entryTitleBlock}>
                  <ThemedText size={14} weight="bold" numberOfLines={1}>
                    {entry.name ?? entry.comment ?? t('lorebookUntitledEntry')}
                  </ThemedText>
                  <ThemedText variant="muted" size={12} numberOfLines={1}>
                    {(entry.keys ?? []).join(', ') || t('lorebookNoKeys')}
                  </ThemedText>
                </View>
                {entry.constant ? (
                  <View style={[styles.constantBadge, { backgroundColor: accent + '1A', borderColor: accent }]}>
                    <ThemedText size={11} variant="accent" weight="bold">
                      {t('lorebookConstant')}
                    </ThemedText>
                  </View>
                ) : null}
              </View>
              {entry.content ? (
                <MacroHighlighter
                  text={entry.content}
                  numberOfLines={2}
                  style={styles.entryContent}
                  testID={`lorebook-entry-content-${index}`}
                />
              ) : null}
            </TouchableOpacity>
          ))
        )}

        <ThemedButton
          variant="outline"
          label={t('lorebookAddEntry')}
          icon="plus"
          onPress={() => setEditing({ mode: 'new', index: -1 })}
          style={styles.addButton}
          testID="lorebook-add-entry"
        />
      </ScrollView>

      <View style={styles.actions}>
        <ThemedButton
          variant="ghost"
          label={t('common:done')}
          onPress={onClose}
          style={styles.actionButton}
          testID="lorebook-done"
        />
      </View>

      <LorebookEntryEditor
        open={editing !== null}
        onClose={() => setEditing(null)}
        entry={editing?.mode === 'edit' ? editedEntry : null}
        onSave={saveEntry}
      />
    </SheetModal>
  );
};

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  title: {
    letterSpacing: 0.3,
  },
  subtitle: {
    marginTop: 2,
  },
  scroll: {
    flexShrink: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 8,
    gap: 10,
  },
  emptyBox: {
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    padding: 20,
    alignItems: 'center',
  },
  entryRow: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 8,
  },
  entryTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  entryTitleBlock: {
    flex: 1,
    gap: 2,
  },
  entryContent: {
    fontSize: 13,
    lineHeight: 18,
  },
  constantBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
  },
  addButton: {
    marginTop: 4,
    height: 46,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 12,
  },
  actionButton: {
    minWidth: 120,
    height: 46,
  },
});
