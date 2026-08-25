/**
 * TagsSection (Phase 8, Step 1) — extracted from the legacy comparison-only
 * editor. Props-in/onChange-out wrapper around the shared
 * `TagChips` (edit mode). The Characters-screen import flow uses `TagChips`
 * directly in filter mode and is unaffected.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ThemedText } from '../../themed/ThemedText';
import { TagChips } from '../TagChips';

export interface TagsSectionProps {
  tags: string[];
  onChange: (next: string[]) => void;
  /** Suggestions from the existing library. */
  suggestions?: string[];
  /** Preserved testID from the original editor screen. */
  testID?: string;
}

export const TagsSection: React.FC<TagsSectionProps> = ({
  tags,
  onChange,
  suggestions = [],
  testID = 'profile-tag-chips',
}) => {
  const { t } = useTranslation('characters');
  return (
    <View style={styles.container} testID="tags-section">
      <ThemedText size={13} variant="secondary" weight="medium">
        {t('tags')}
      </ThemedText>
      <TagChips
        tags={tags}
        onChange={onChange}
        suggestions={suggestions}
        testID={testID}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
});