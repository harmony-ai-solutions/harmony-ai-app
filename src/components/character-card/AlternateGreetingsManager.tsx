/**
 * AlternateGreetingsManager (3-5) — reorderable list of opening lines.
 *
 * Each row: mini-preview (macros resolved — preview surface), edit-inline,
 * delete, move up/down (reorder affordance — no drag library installed), and a
 * "default" radio that promotes the opener into `first_mes` (the parent demotes
 * the previous default into the alternates list). Count badge + empty hint.
 */

import React, { useState } from 'react';
import {
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { ThemedButton } from '../themed/ThemedButton';
import { resolveMacros } from '../../utils/macros';

export interface AlternateGreetingsManagerProps {
  alternateGreetings: string[];
  /** Current default (`first_mes`) — shown as the promoted target. */
  firstMes: string;
  charName: string;
  userName: string;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onEdit: (index: number, value: string) => void;
  /** Promotes the opener into `first_mes` (parent demotes the prior default). */
  onPromoteToDefault: (greeting: string) => void;
}

export const AlternateGreetingsManager: React.FC<AlternateGreetingsManagerProps> = ({
  alternateGreetings,
  firstMes,
  charName,
  userName,
  onAdd,
  onRemove,
  onMove,
  onEdit,
  onPromoteToDefault,
}) => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('characters');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState('');

  if (!theme) return null;

  const accent = theme.colors.accent.primary;
  const border = theme.colors.border.default;
  const inputStyle = {
    backgroundColor: theme.colors.background.base,
    borderColor: border,
    color: theme.colors.text.primary,
  };

  const count = alternateGreetings.length;
  const activeEditingIndex =
    editingIndex !== null && editingIndex < count ? editingIndex : null;

  const startEdit = (index: number) => {
    setEditingIndex(index);
    setDraft(alternateGreetings[index]);
  };

  const commitEdit = (index: number) => {
    onEdit(index, draft.trim());
    setEditingIndex(null);
    setDraft('');
  };

  const handleAdd = () => {
    onAdd();
    // The parent appends a blank opener — start editing it immediately.
    setEditingIndex(alternateGreetings.length);
    setDraft('');
  };

  return (
    <View style={styles.container} testID="alternate-greetings-manager">
      <View style={styles.headerRow}>
        <ThemedText size={13} variant="secondary" weight="medium">
          {t('alternateGreetings')}
        </ThemedText>
        <View style={[styles.countBadge, { borderColor: accent, backgroundColor: accent + '1A' }]}>
          <ThemedText size={12} variant="accent" weight="bold" testID="alternate-greetings-count">
            {count}
          </ThemedText>
        </View>
      </View>

      {count === 0 ? (
        <ThemedText variant="muted" size={13} style={styles.emptyHint} testID="alternate-greetings-empty">
          {t('alternateGreetingsEmpty')}
        </ThemedText>
      ) : (
        alternateGreetings.map((g, index) => {
          const isEditing = activeEditingIndex === index;
          return (
            <View key={index} style={[styles.row, { borderColor: border }]} testID={`alt-greeting-${index}`}>
              {/* Reorder affordance */}
              <View style={styles.moveCol}>
                <TouchableOpacity
                  onPress={() => onMove(index, -1)}
                  disabled={index === 0}
                  accessibilityRole="button"
                  accessibilityLabel={t('moveUp')}
                  testID={`alt-greeting-move-up-${index}`}
                  style={[styles.moveBtn, index === 0 && styles.moveBtnDisabled]}
                >
                  <Icon name="chevron-up" size={18} color={index === 0 ? border : accent} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => onMove(index, 1)}
                  disabled={index === count - 1}
                  accessibilityRole="button"
                  accessibilityLabel={t('moveDown')}
                  testID={`alt-greeting-move-down-${index}`}
                  style={[styles.moveBtn, index === count - 1 && styles.moveBtnDisabled]}
                >
                  <Icon name="chevron-down" size={18} color={index === count - 1 ? border : accent} />
                </TouchableOpacity>
              </View>

              {isEditing ? (
                <View style={styles.editBlock}>
                  <TextInput
                    value={draft}
                    onChangeText={setDraft}
                    multiline
                    numberOfLines={2}
                    style={[styles.editInput, inputStyle]}
                    placeholderTextColor={theme.colors.text.muted}
                    testID={`alt-greeting-input-${index}`}
                  />
                  <View style={styles.editActions}>
                    <ThemedButton
                      variant="ghost"
                      label={t('common:cancel')}
                      onPress={() => setEditingIndex(null)}
                      style={styles.editActionButton}
                      testID={`alt-greeting-cancel-${index}`}
                    />
                    <ThemedButton
                      variant="primary"
                      label={t('common:save')}
                      onPress={() => commitEdit(index)}
                      style={styles.editActionButton}
                      testID={`alt-greeting-save-${index}`}
                    />
                  </View>
                </View>
              ) : (
                <>
                  <TouchableOpacity
                    style={styles.previewBlock}
                    onPress={() => startEdit(index)}
                    accessibilityRole="button"
                    testID={`alt-greeting-preview-${index}`}
                  >
                    <ThemedText size={13} numberOfLines={2} variant="secondary">
                      {resolveMacros(g, charName, userName)}
                    </ThemedText>
                  </TouchableOpacity>
                  <View style={styles.rowActions}>
                    <TouchableOpacity
                      onPress={() => onPromoteToDefault(g)}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: g === firstMes }}
                      accessibilityLabel={t('markDefault')}
                      style={styles.iconBtn}
                      testID={`alt-greeting-default-${index}`}
                    >
                      <Icon
                        name={g === firstMes ? 'radiobox-marked' : 'radiobox-blank'}
                        size={20}
                        color={g === firstMes ? accent : theme.colors.text.muted}
                      />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => startEdit(index)}
                      accessibilityRole="button"
                      style={styles.iconBtn}
                      testID={`alt-greeting-edit-${index}`}
                    >
                      <Icon name="pencil-outline" size={18} color={theme.colors.text.secondary} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => onRemove(index)}
                      accessibilityRole="button"
                      style={styles.iconBtn}
                      testID={`alt-greeting-delete-${index}`}
                    >
                      <Icon name="trash-can-outline" size={18} color={theme.colors.status.error} />
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          );
        })
      )}

      <ThemedButton
        variant="outline"
        label={t('addAlternate')}
        icon="plus"
        onPress={handleAdd}
        style={styles.addButton}
        testID="alternate-greetings-add"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: 8,
    marginTop: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  countBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
  },
  emptyHint: {
    fontStyle: 'italic',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    padding: 8,
  },
  moveCol: {
    gap: 2,
  },
  moveBtn: {
    width: 24,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moveBtnDisabled: {
    opacity: 0.3,
  },
  previewBlock: {
    flex: 1,
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  iconBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editBlock: {
    flex: 1,
    gap: 6,
  },
  editInput: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 56,
    fontSize: 14,
    textAlignVertical: 'top',
  },
  editActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  editActionButton: {
    minWidth: 90,
    height: 38,
  },
  addButton: {
    height: 46,
  },
});
