/**
 * TagChips (3-5) — shared add/remove tag chip row.
 *
 * Dual-use: the profile editor (edit tags) and — in P4 — the character-list
 * filter (the parent supplies `suggestions` from the existing library and
 * drives selection through `tags`/`onChange`). Promoted from the P2 inline
 * chip row in `ScenarioGeneratorSheet`.
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

export interface TagChipsProps {
  tags: string[];
  onChange: (next: string[]) => void;
  /** Suggestions from the existing library — only shown when not already added. */
  suggestions?: string[];
  testID?: string;
}

export const TagChips: React.FC<TagChipsProps> = ({
  tags,
  onChange,
  suggestions = [],
  testID = 'tag-chips',
}) => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('characters');
  const [draft, setDraft] = useState('');

  if (!theme) return null;

  const accent = theme.colors.accent.primary;
  const inputStyle = {
    backgroundColor: theme.colors.background.base,
    borderColor: theme.colors.border.default,
    color: theme.colors.text.primary,
  };

  const addTag = (raw: string) => {
    const tag = raw.trim();
    if (!tag) return;
    if (tags.some(existing => existing.toLowerCase() === tag.toLowerCase())) {
      setDraft('');
      return;
    }
    onChange([...tags, tag]);
    setDraft('');
  };

  const removeTag = (index: number) => {
    onChange(tags.filter((_, i) => i !== index));
  };

  const visibleSuggestions = suggestions.filter(
    s => !tags.some(existing => existing.toLowerCase() === s.toLowerCase()),
  );

  return (
    <View style={styles.container} testID={testID}>
      {tags.length > 0 && (
        <View style={styles.chipRow}>
          {tags.map((tag, index) => (
            <TouchableOpacity
              key={`${tag}-${index}`}
              onPress={() => removeTag(index)}
              accessibilityRole="button"
              accessibilityLabel={tag}
              style={[styles.chip, { borderColor: accent, backgroundColor: accent + '1A' }]}
              testID={`${testID}-tag-${tag}`}
            >
              <ThemedText size={13} variant="accent">
                {tag}
              </ThemedText>
              <Icon name="close" size={14} color={accent} />
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View style={styles.addRow}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={() => addTag(draft)}
          returnKeyType="done"
          placeholder={t('tagPlaceholder')}
          placeholderTextColor={theme.colors.text.muted}
          style={[styles.input, inputStyle]}
          testID={`${testID}-input`}
        />
        <TouchableOpacity
          onPress={() => addTag(draft)}
          accessibilityRole="button"
          style={[styles.addButton, { backgroundColor: accent }]}
          testID={`${testID}-add`}
        >
          <Icon name="plus" size={18} color="#ffffff" />
        </TouchableOpacity>
      </View>

      {visibleSuggestions.length > 0 && (
        <>
          <ThemedText variant="muted" size={12} style={styles.suggestLabel}>
            {t('tagSuggestions')}
          </ThemedText>
          <View style={styles.chipRow}>
            {visibleSuggestions.map(s => (
              <TouchableOpacity
                key={s}
                onPress={() => addTag(s)}
                accessibilityRole="button"
                style={[styles.chip, { borderColor: theme.colors.border.default }]}
                testID={`${testID}-suggestion-${s}`}
              >
                <ThemedText size={13} variant="secondary">
                  {s}
                </ThemedText>
                <Icon name="plus" size={14} color={theme.colors.text.secondary} />
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: 10,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
  },
  addRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  input: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 40,
    fontSize: 14,
  },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestLabel: {
    marginBottom: -4,
  },
});
