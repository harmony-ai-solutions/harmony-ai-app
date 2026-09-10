/**
 * AttributionSection (Phase 8, Step 1) — extracted from the legacy
 * comparison-only editor (3-5).
 *
 * Editable `creator` / `creator_notes` / `character_version` inputs plus the
 * read-only `CreatorAttributionBadge` (provenance spec/spec_version badge and
 * the append-only `source` list, both derived from `card_provenance`).
 */

import React from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../../contexts/ThemeContext';
import { ThemedText } from '../../themed/ThemedText';
import { CreatorAttributionBadge } from '../CreatorAttributionBadge';

export interface AttributionSectionProps {
  creator: string;
  onChangeCreator: (next: string) => void;
  creatorNotes: string;
  onChangeCreatorNotes: (next: string) => void;
  characterVersion: string;
  onChangeCharacterVersion: (next: string) => void;
  /** Parsed `card_provenance` object (spec/spec_version/source/…). */
  cardProvenance: Record<string, unknown> | null;
}

export const AttributionSection: React.FC<AttributionSectionProps> = ({
  creator,
  onChangeCreator,
  creatorNotes,
  onChangeCreatorNotes,
  characterVersion,
  onChangeCharacterVersion,
  cardProvenance,
}) => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('characters');

  if (!theme) return null;

  const inputStyle = {
    color: theme.colors.text.primary,
    borderColor: theme.colors.border.default,
    backgroundColor: theme.colors.background.base,
  };

  const provenanceSource = (() => {
    if (!cardProvenance || !Array.isArray(cardProvenance.source)) return null;
    return cardProvenance.source as string[];
  })();

  return (
    <View style={styles.container} testID="attribution-section">
      <View style={styles.field}>
        <ThemedText size={13} variant="secondary" style={styles.fieldLabel}>
          {t('creator')}
        </ThemedText>
        <TextInput
          style={[styles.input, inputStyle]}
          value={creator}
          onChangeText={onChangeCreator}
          placeholder={t('creatorPlaceholder')}
          placeholderTextColor={theme.colors.text.muted}
          testID="creator-input"
        />
      </View>

      <View style={styles.field}>
        <ThemedText size={13} variant="secondary" style={styles.fieldLabel}>
          {t('creatorNotes')}
        </ThemedText>
        <TextInput
          style={[styles.input, styles.multilineInput, inputStyle]}
          value={creatorNotes}
          onChangeText={onChangeCreatorNotes}
          placeholder={t('creatorNotesPlaceholder')}
          placeholderTextColor={theme.colors.text.muted}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
          testID="creator-notes-input"
        />
      </View>

      <View style={styles.field}>
        <ThemedText size={13} variant="secondary" style={styles.fieldLabel}>
          {t('characterVersion')}
        </ThemedText>
        <TextInput
          style={[styles.input, inputStyle]}
          value={characterVersion}
          onChangeText={onChangeCharacterVersion}
          placeholder={t('characterVersionPlaceholder')}
          placeholderTextColor={theme.colors.text.muted}
          testID="character-version-input"
        />
      </View>

      <CreatorAttributionBadge
        creator={creator.trim() || null}
        creatorNotes={creatorNotes.trim() || null}
        characterVersion={characterVersion.trim() || null}
        source={provenanceSource}
        provenance={cardProvenance}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  field: {
    gap: 6,
  },
  fieldLabel: {
    letterSpacing: 0.2,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  multilineInput: {
    minHeight: 80,
    paddingTop: 10,
  },
});