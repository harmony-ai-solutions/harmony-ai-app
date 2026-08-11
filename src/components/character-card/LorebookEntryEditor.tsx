/**
 * LorebookEntryEditor (3-4) — per-entry lorebook editor.
 *
 * Matching is **semantic**, so `content` is the primary field (what gets
 * embedded + matched). Keyword/position/budget fields are shown under
 * "Advanced — preserved for export" (they round-trip to the card but do not
 * drive matching). Macros in `content` are **highlighted, not resolved**
 * (card-management screen, §1-7). New entries get sensible defaults
 * (`enabled=true`, `position=before_char`, `insertion_order=10`).
 *
 * Built on paper `Modal`+`Portal` via the shared `SheetModal` (§A18).
 */

import React, { useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { ThemedButton } from '../themed/ThemedButton';
import { SheetModal } from './SheetModal';
import { MacroHighlighter } from './MacroHighlighter';
import { createDefaultLorebookEntry } from './lorebook';
import type { CharacterBookEntry } from '../../utils/charactercard/types';

export interface LorebookEntryEditorProps {
  open: boolean;
  onClose: () => void;
  /** Existing entry to edit, or `null` for a new entry (defaults applied). */
  entry: CharacterBookEntry | null;
  onSave: (entry: CharacterBookEntry) => void;
}

const POSITIONS: Array<'before_char' | 'after_char'> = [
  'before_char',
  'after_char',
];

export const LorebookEntryEditor: React.FC<LorebookEntryEditorProps> = ({
  open,
  onClose,
  entry,
  onSave,
}) => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('characters');

  const [draft, setDraft] = useState<CharacterBookEntry | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [keysText, setKeysText] = useState('');
  const [secondaryKeysText, setSecondaryKeysText] = useState('');
  const [position, setPosition] = useState<'before_char' | 'after_char'>(
    'before_char',
  );
  const [insertionOrderText, setInsertionOrderText] = useState('10');
  const [priorityText, setPriorityText] = useState('');
  const [idText, setIdText] = useState('');

  // Re-seed the draft whenever the sheet opens / target entry changes.
  useEffect(() => {
    if (!open) return;
    const base = entry ?? createDefaultLorebookEntry();
    setDraft({ ...base });
    setKeysText((base.keys ?? []).join(', '));
    setSecondaryKeysText((base.secondary_keys ?? []).join(', '));
    setPosition(base.position ?? 'before_char');
    setInsertionOrderText(String(base.insertion_order ?? 10));
    setPriorityText(base.priority != null ? String(base.priority) : '');
    setIdText(base.id != null ? String(base.id) : '');
    setAdvancedOpen(false);
  }, [open, entry]);

  if (!theme) return null;

  const accent = theme.colors.accent.primary;
  const inputStyle = {
    backgroundColor: theme.colors.background.base,
    borderColor: theme.colors.border.default,
    color: theme.colors.text.primary,
  };

  const setField = <K extends keyof CharacterBookEntry>(
    key: K,
    value: CharacterBookEntry[K],
  ) => {
    setDraft(prev => (prev ? { ...prev, [key]: value } : prev));
  };

  const handleSave = () => {
    if (!draft) return;
    const keys = keysText
      .split(',')
      .map(k => k.trim())
      .filter(Boolean);
    const secondaryKeys = secondaryKeysText
      .split(',')
      .map(k => k.trim())
      .filter(Boolean);
    const insertionOrder = parseInt(insertionOrderText, 10);
    const priority = priorityText.trim() === '' ? undefined : parseInt(priorityText, 10);
    const parsedId =
      idText.trim() === ''
        ? undefined
        : /^\d+$/.test(idText.trim())
          ? Number(idText.trim())
          : idText.trim();

    onSave({
      ...draft,
      keys,
      secondary_keys: secondaryKeys.length ? secondaryKeys : draft.secondary_keys,
      position,
      insertion_order: isNaN(insertionOrder) ? draft.insertion_order ?? 10 : insertionOrder,
      priority,
      id: parsedId,
    });
    onClose();
  };

  const renderSwitchField = (
    testID: string,
    label: string,
    value: boolean,
    onValueChange: (v: boolean) => void,
    hint?: string,
  ) => (
    <View style={styles.switchRow}>
      <View style={styles.switchLabelColumn}>
        <ThemedText size={14} style={styles.switchLabel}>
          {label}
        </ThemedText>
        {hint ? (
          <ThemedText variant="muted" size={12} style={styles.switchHint}>
            {hint}
          </ThemedText>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ true: accent, false: theme.colors.border.default }}
        testID={testID}
      />
    </View>
  );

  return (
    <SheetModal open={open} onClose={onClose} testID="lorebook-entry-editor">
      <View style={styles.header}>
        <ThemedText size={18} weight="bold" style={styles.title}>
          {entry ? t('lorebookEditEntry') : t('lorebookAddEntry')}
        </ThemedText>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Primary field: content (embedded + matched semantically) ── */}
        <ThemedText variant="secondary" size={13} weight="medium" style={styles.label}>
          {t('lorebookContent')}
        </ThemedText>
        <TextInput
          value={draft?.content ?? ''}
          onChangeText={text => setField('content', text)}
          multiline
          numberOfLines={6}
          style={[styles.multilineInput, inputStyle]}
          placeholderTextColor={theme.colors.text.muted}
          placeholder={t('lorebookContentPlaceholder')}
          testID="lorebook-entry-content-input"
        />
        <ThemedText variant="muted" size={12} style={styles.hint}>
          {t('lorebookEntryRetrievedWhen')}
        </ThemedText>

        {/* Macros highlighted, not resolved (management surface). */}
        <View style={styles.macroPanel}>
          <ThemedText variant="muted" size={12}>
            {t('macrosHighlightedHint')}
          </ThemedText>
          <MacroHighlighter
            text={draft?.content ?? ''}
            numberOfLines={3}
            testID="lorebook-entry-macro-highlight"
          />
        </View>

        {/* ── Test match (static hint — engine semantic-retrieval gated) ── */}
        <ThemedText variant="muted" size={12} style={styles.hint}>
          {t('lorebookTestMatchHint')}
        </ThemedText>
        <View style={styles.testMatchRow}>
          <ThemedButton
            variant="outline"
            label={t('lorebookTestMatch')}
            onPress={() => {}}
            disabled
            style={styles.testMatchButton}
            testID="lorebook-test-match"
          />
        </View>

        {/* ── Matching (behavioural drivers: enabled + constant) ── */}
        <View style={[styles.matchingGroup, { borderColor: theme.colors.border.default }]}>
          <ThemedText size={13} weight="medium" variant="secondary" style={styles.matchingGroupLabel}>
            {t('lorebookMatchingGroup')}
          </ThemedText>
          {renderSwitchField(
            'lorebook-enabled-switch',
            t('lorebookEntryEnabled'),
            draft?.enabled ?? true,
            v => setField('enabled', v),
            t('lorebookEntryEnabledHint'),
          )}
          {renderSwitchField(
            'lorebook-constant-switch',
            t('lorebookConstant'),
            draft?.constant ?? false,
            v => setField('constant', v),
            t('lorebookConstantHint'),
          )}
        </View>

        {/* ── Advanced — preserved for export ── */}
        <TouchableOpacity
          style={styles.advancedToggle}
          onPress={() => setAdvancedOpen(prev => !prev)}
          accessibilityRole="button"
          accessibilityState={{ expanded: advancedOpen }}
          testID="lorebook-entry-advanced-toggle"
        >
          <ThemedText size={14} weight="bold" variant="accent">
            {t('lorebookFieldsExportOnly')}
          </ThemedText>
          <ThemedText variant="muted" size={12}>
            {advancedOpen ? '▴' : '▾'}
          </ThemedText>
        </TouchableOpacity>
        {advancedOpen && (
          <View style={styles.advancedBody}>
            <ThemedText variant="muted" size={12} style={styles.hint}>
              {t('lorebookFieldsExportOnlyHint')}
            </ThemedText>

            <ThemedText variant="secondary" size={13} weight="medium" style={styles.label}>
              {t('lorebookEntryKeys')}
            </ThemedText>
            <TextInput
              value={keysText}
              onChangeText={setKeysText}
              style={[styles.singleInput, inputStyle]}
              placeholder="keyword, keyword2"
              placeholderTextColor={theme.colors.text.muted}
              testID="lorebook-entry-keys-input"
            />

            {renderSwitchField('lorebook-selective-switch', t('lorebookSelective'), draft?.selective ?? false, v =>
              setField('selective', v),
            )}
            {draft?.selective && (
              <>
                <ThemedText variant="secondary" size={13} weight="medium" style={styles.label}>
                  {t('lorebookSecondaryKeys')}
                </ThemedText>
                <TextInput
                  value={secondaryKeysText}
                  onChangeText={setSecondaryKeysText}
                  style={[styles.singleInput, inputStyle]}
                  placeholder="secondary keyword"
                  placeholderTextColor={theme.colors.text.muted}
                  testID="lorebook-entry-secondary-keys-input"
                />
              </>
            )}

            <ThemedText variant="secondary" size={13} weight="medium" style={styles.label}>
              {t('lorebookPosition')}
            </ThemedText>
            <View style={styles.chipRow}>
              {POSITIONS.map(pos => {
                const selected = position === pos;
                return (
                  <TouchableOpacity
                    key={pos}
                    onPress={() => setPosition(pos)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    style={[
                      styles.chip,
                      {
                        borderColor: selected ? accent : theme.colors.border.default,
                        backgroundColor: selected ? accent + '1A' : 'transparent',
                      },
                    ]}
                    testID={`lorebook-position-${pos}`}
                  >
                    <ThemedText size={13} variant={selected ? 'accent' : 'primary'}>
                      {t(pos === 'before_char' ? 'lorebookPositionBeforeChar' : 'lorebookPositionAfterChar')}
                    </ThemedText>
                  </TouchableOpacity>
                );
              })}
            </View>

            <ThemedText variant="secondary" size={13} weight="medium" style={styles.label}>
              {t('lorebookInsertionOrder')}
            </ThemedText>
            <TextInput
              value={insertionOrderText}
              onChangeText={setInsertionOrderText}
              keyboardType="numeric"
              style={[styles.singleInput, inputStyle]}
              placeholderTextColor={theme.colors.text.muted}
              testID="lorebook-entry-insertion-order-input"
            />

            {renderSwitchField('lorebook-case-sensitive-switch', t('lorebookCaseSensitive'), draft?.case_sensitive ?? false, v =>
              setField('case_sensitive', v),
            )}
            {renderSwitchField('lorebook-use-regex-switch', t('lorebookUseRegex'), draft?.use_regex ?? false, v =>
              setField('use_regex', v),
            )}

            <ThemedText variant="secondary" size={13} weight="medium" style={styles.label}>
              {t('lorebookName')}
            </ThemedText>
            <TextInput
              value={draft?.name ?? ''}
              onChangeText={text => setField('name', text)}
              style={[styles.singleInput, inputStyle]}
              placeholderTextColor={theme.colors.text.muted}
              testID="lorebook-entry-name-input"
            />

            <ThemedText variant="secondary" size={13} weight="medium" style={styles.label}>
              {t('lorebookComment')}
            </ThemedText>
            <TextInput
              value={draft?.comment ?? ''}
              onChangeText={text => setField('comment', text)}
              multiline
              numberOfLines={2}
              style={[styles.singleInput, inputStyle]}
              placeholderTextColor={theme.colors.text.muted}
              testID="lorebook-entry-comment-input"
            />

            <ThemedText variant="secondary" size={13} weight="medium" style={styles.label}>
              {t('lorebookPriority')}
            </ThemedText>
            <TextInput
              value={priorityText}
              onChangeText={setPriorityText}
              keyboardType="numeric"
              style={[styles.singleInput, inputStyle]}
              placeholderTextColor={theme.colors.text.muted}
              testID="lorebook-entry-priority-input"
            />

            <ThemedText variant="secondary" size={13} weight="medium" style={styles.label}>
              {t('lorebookId')}
            </ThemedText>
            <TextInput
              value={idText}
              onChangeText={setIdText}
              style={[styles.singleInput, inputStyle]}
              placeholderTextColor={theme.colors.text.muted}
              testID="lorebook-entry-id-input"
            />
          </View>
        )}
      </ScrollView>

      {/* Actions */}
      <View style={styles.actions}>
        <ThemedButton
          variant="ghost"
          label={t('common:cancel')}
          onPress={onClose}
          style={styles.actionButton}
          testID="lorebook-entry-cancel"
        />
        <ThemedButton
          variant="primary"
          label={t('common:save')}
          onPress={handleSave}
          style={styles.actionButton}
          testID="lorebook-entry-save"
        />
      </View>
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
  scroll: {
    flexShrink: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 8,
  },
  label: {
    marginTop: 12,
    marginBottom: 6,
  },
  hint: {
    marginTop: 4,
    marginBottom: 4,
  },
  singleInput: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
    fontSize: 15,
  },
  multilineInput: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 120,
    fontSize: 15,
    textAlignVertical: 'top',
  },
  macroPanel: {
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 8,
    gap: 4,
  },
  testMatchRow: {
    marginTop: 8,
    marginBottom: 8,
  },
  testMatchButton: {
    minWidth: 140,
    height: 44,
    alignSelf: 'flex-start',
  },
  advancedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 8,
  },
  advancedBody: {
    gap: 4,
  },
  matchingGroup: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 12,
    gap: 2,
  },
  matchingGroupLabel: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  switchLabelColumn: {
    flex: 1,
    gap: 2,
  },
  switchLabel: {
    flexShrink: 1,
  },
  switchHint: {
    flexShrink: 1,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
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
