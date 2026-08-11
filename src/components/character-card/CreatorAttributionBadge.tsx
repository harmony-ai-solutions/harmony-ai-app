/**
 * CreatorAttributionBadge (3-5) — attribution metadata for the profile editor.
 *
 * Shows `creator` / `creator_notes` / `character_version`, a provenance badge
 * from `card_provenance` (spec / spec_version / source), and the `source`
 * field rendered **read-only** (the spec treats source as append-only).
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';

export interface CreatorAttributionBadgeProps {
  creator: string | null;
  creatorNotes: string | null;
  characterVersion: string | null;
  /** `card_provenance.source` (spec append-only, read-only here). */
  source: string[] | null;
  /** Parsed `card_provenance` object (spec/spec_version etc.). */
  provenance: Record<string, unknown> | null;
}

export const CreatorAttributionBadge: React.FC<CreatorAttributionBadgeProps> = ({
  creator,
  creatorNotes,
  characterVersion,
  source,
  provenance,
}) => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('characters');

  if (!theme) return null;

  const accent = theme.colors.accent.primary;
  const spec = provenance?.spec as string | undefined;
  const specVersion = provenance?.spec_version as string | undefined;
  const provenanceLabel = spec || specVersion
    ? [spec, specVersion].filter(Boolean).join(' · ')
    : null;

  return (
    <View style={styles.container} testID="creator-badge">
      {creator ? (
        <View style={styles.row}>
          <ThemedText size={13} variant="muted" style={styles.label}>
            {t('creator')}
          </ThemedText>
          <ThemedText size={14} style={styles.value}>
            {creator}
          </ThemedText>
        </View>
      ) : null}

      {characterVersion ? (
        <View style={styles.row}>
          <ThemedText size={13} variant="muted" style={styles.label}>
            {t('characterVersion')}
          </ThemedText>
          <ThemedText size={14} style={styles.value}>
            {characterVersion}
          </ThemedText>
        </View>
      ) : null}

      {creatorNotes ? (
        <View style={styles.row}>
          <ThemedText size={13} variant="muted" style={styles.label}>
            {t('creatorNotes')}
          </ThemedText>
          <ThemedText size={14} style={[styles.value, styles.notes]}>
            {creatorNotes}
          </ThemedText>
        </View>
      ) : null}

      {/* Provenance badge */}
      <View style={styles.badgeRow}>
        <ThemedText size={13} variant="muted" style={styles.label}>
          {t('provenance')}
        </ThemedText>
        {provenanceLabel ? (
          <View
            style={[styles.badge, { borderColor: accent, backgroundColor: accent + '1A' }]}
            testID="provenance-badge"
          >
            <ThemedText size={12} variant="accent" weight="bold">
              {provenanceLabel}
            </ThemedText>
          </View>
        ) : (
          <ThemedText variant="muted" size={13}>
            {t('importProvenanceNone')}
          </ThemedText>
        )}
      </View>

      {/* Source — read-only (spec append-only) */}
      <View style={styles.row}>
        <ThemedText size={13} variant="muted" style={styles.label}>
          {t('source')}
        </ThemedText>
        <View style={styles.sourceBlock} testID="source-list">
          {source && source.length > 0 ? (
            source.map((s, i) => (
              <ThemedText key={i} size={13} variant="secondary">
                {s}
              </ThemedText>
            ))
          ) : (
            <ThemedText size={13} variant="muted">
              {t('sourceNone')}
            </ThemedText>
          )}
        </View>
      </View>

      <ThemedText variant="muted" size={12} style={styles.readOnlyNote}>
        {t('sourceReadOnly')}
      </ThemedText>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  label: {
    width: 110,
    flexShrink: 0,
  },
  value: {
    flex: 1,
  },
  notes: {
    lineHeight: 18,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
  },
  sourceBlock: {
    flex: 1,
    gap: 2,
  },
  readOnlyNote: {
    marginTop: 2,
  },
});
