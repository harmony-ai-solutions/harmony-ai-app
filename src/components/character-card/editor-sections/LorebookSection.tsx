/**
 * LorebookSection (Phase 8, Step 1) — extracted from the legacy
 * comparison-only editor (3-4).
 *
 * Renders the lorebook summary card (tap → viewer sheet) and hosts the
 * `LorebookViewerSheet` (which in turn hosts the `LorebookEntryEditor`). The
 * raw `character_book` JSON string flows through unchanged — every edit calls
 * `onChange` with updated JSON immediately (optimistic local update).
 */

import React, { useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../../contexts/ThemeContext';
import { ThemedText } from '../../themed/ThemedText';
import { LorebookViewerSheet } from '../LorebookViewerSheet';
import {
  countConstantEntries,
  parseLorebook,
} from '../lorebook';

export interface LorebookSectionProps {
  /** Raw `character_book` JSON string from the profile (`''`/`'null'`/invalid → no book). */
  characterBook: string | null;
  /** Called on every edit with the updated JSON string (optimistic). */
  onChange: (nextBookJson: string) => void;
}

export const LorebookSection: React.FC<LorebookSectionProps> = ({
  characterBook,
  onChange,
}) => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('characters');
  // Viewer sheet open state is pure UI — owned here, not by the screen.
  const [lorebookOpen, setLorebookOpen] = useState(false);

  if (!theme) return null;

  const lorebook = parseLorebook(characterBook);
  const loreEntryCount = lorebook?.entries.length ?? 0;
  const loreConstantCount = countConstantEntries(lorebook);
  const loreSummary = `${loreEntryCount} ${t('lorebookEntries', { count: loreEntryCount })} · ${loreConstantCount} ${t('lorebookConstant')}`;

  return (
    <View style={styles.container} testID="lorebook-section">
      <TouchableOpacity
        onPress={() => setLorebookOpen(true)}
        accessibilityRole="button"
        style={[styles.lorebookCard, { borderColor: theme.colors.border.default }]}
        testID="lorebook-summary-card"
      >
        <Icon
          name="book-open-variant"
          size={22}
          color={theme.colors.accent.primary}
        />
        <View style={styles.lorebookCardText}>
          <ThemedText size={14} weight="bold">
            {t('lorebook')}
          </ThemedText>
          <ThemedText variant="muted" size={12}>
            {loreSummary}
          </ThemedText>
        </View>
        <Icon name="chevron-right" size={22} color={theme.colors.text.muted} />
      </TouchableOpacity>

      <LorebookViewerSheet
        open={lorebookOpen}
        onClose={() => setLorebookOpen(false)}
        characterBook={characterBook}
        onChange={onChange}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  lorebookCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  lorebookCardText: {
    flex: 1,
    gap: 2,
  },
});