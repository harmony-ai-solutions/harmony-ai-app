/**
 * GreetingEditor (3-5/3-6) — `first_mes` editor with a live resolved preview.
 *
 * The raw field keeps macros **visible + highlighted** (`MacroHighlighter`,
 * management surface); the live preview beneath it resolves them via
 * `GreetingBubble` (`{{user}}` → own entity, `{{char}}` → name/nickname).
 */

import React from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { SectionHeader } from '../themed/SectionHeader';
import { GreetingBubble } from '../chat/GreetingBubble';
import { MacroHighlighter } from './MacroHighlighter';

export interface GreetingEditorProps {
  value: string;
  onChange: (next: string) => void;
  /** Display name substituting {{char}} (nickname || name). */
  charName: string;
  /** Display name substituting {{user}} (own/roleplay entity). */
  userName: string;
}

export const GreetingEditor: React.FC<GreetingEditorProps> = ({
  value,
  onChange,
  charName,
  userName,
}) => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('characters');

  if (!theme) return null;

  const inputStyle = {
    backgroundColor: theme.colors.background.base,
    borderColor: theme.colors.border.default,
    color: theme.colors.text.primary,
  };

  return (
    <View style={styles.container} testID="greeting-editor">
      <ThemedText variant="secondary" size={13} weight="medium" style={styles.label}>
        {t('greeting')}
      </ThemedText>
      <ThemedText variant="muted" size={12} style={styles.hint}>
        {t('greetingHint')}
      </ThemedText>

      <TextInput
        value={value}
        onChangeText={onChange}
        multiline
        numberOfLines={4}
        style={[styles.input, inputStyle]}
        placeholder={t('greetingPlaceholder')}
        placeholderTextColor={theme.colors.text.muted}
        testID="greeting-editor-input"
      />

      {/* Raw field, macros highlighted (management surface). */}
      <View style={[styles.macroPanel, { borderColor: theme.colors.border.default }]}>
        <ThemedText variant="muted" size={12}>
          {t('macrosHighlightedHint')}
        </ThemedText>
        <MacroHighlighter
          text={value}
          numberOfLines={2}
          style={styles.macroText}
          testID="greeting-macro-highlight"
        />
      </View>

      {/* Live preview — macros resolved. */}
      <SectionHeader title={t('greetingPreview')} style={styles.previewHeader} />
      <View testID="greeting-preview-bubble">
        <GreetingBubble
          text={value}
          charName={charName}
          userName={userName}
          theme={theme}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: 6,
  },
  label: {
    marginBottom: 0,
  },
  hint: {
    marginBottom: 4,
  },
  input: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 96,
    fontSize: 15,
    textAlignVertical: 'top',
  },
  macroPanel: {
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 4,
  },
  macroText: {
    fontSize: 13,
    lineHeight: 18,
  },
  previewHeader: {
    paddingHorizontal: 0,
    marginTop: 4,
  },
});
