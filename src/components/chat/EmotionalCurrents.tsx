/**
 * EmotionalCurrents — the engine-derived emotional "dyads" (two emotions that
 * combine into one named current) as cards on the State tab.
 *
 * Strictly presentational: the engine owns the keyword, type, sources,
 * combined intensity and description. This component never computes or invents
 * a dyad — callers only pass `derived.activeDyads` and hide the section when it
 * is empty. A missing field degrades to not rendering that line.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ActiveDyad } from '../../services/engine/engineApiMappers';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';

/** Combined intensity is two emotions × a 0–10 scale. */
const COMBINED_MAX = 20;

const DYAD_TYPE_KEYS: Record<string, string> = {
  primary: 'emotionalCurrentPrimary',
  secondary: 'emotionalCurrentSecondary',
};

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** "joy 9.4 + trust 6.2" — engine order preserved. */
export function formatSources(dyad: ActiveDyad): string {
  return dyad.sourceEmotions
    .map((emotion, index) => {
      const intensity = dyad.sourceIntensities[index];
      return Number.isFinite(intensity) ? `${emotion} ${intensity.toFixed(1)}` : emotion;
    })
    .join(' + ');
}

export interface EmotionalCurrentsProps {
  /** Engine-derived active dyads (`derived.activeDyads`). */
  dyads: ActiveDyad[];
}

export const EmotionalCurrents: React.FC<EmotionalCurrentsProps> = ({ dyads }) => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('chatDetail');

  if (!theme || dyads.length === 0) return null;

  return (
    <View testID="emotional-currents">
      {dyads.map((dyad, index) => {
        const typeKey = DYAD_TYPE_KEYS[(dyad.type ?? '').trim().toLowerCase()] ?? null;
        const keyword = capitalize((dyad.keyword ?? '').trim());
        const sources = formatSources(dyad);
        const combined = Number.isFinite(dyad.combinedIntensity) ? dyad.combinedIntensity : 0;
        const combinedPct = Math.max(0, Math.min(100, (combined / COMBINED_MAX) * 100));
        const typeLabel = typeKey ? t(typeKey) : '';
        const accessibilityLabel = [keyword, typeLabel, `${combined.toFixed(1)} / ${COMBINED_MAX}`]
          .filter(Boolean)
          .join(', ');

        return (
          <View
            key={`${dyad.keyword}-${index}`}
            style={[
              styles.card,
              {
                borderColor: theme.colors.border.default,
                backgroundColor: theme.colors.background.base + '55',
              },
            ]}
            accessibilityRole="summary"
            accessibilityLabel={accessibilityLabel}
            testID={`emotional-current-${index}`}
          >
            <View style={styles.titleRow}>
              {keyword ? (
                <ThemedText
                  size={13}
                  weight="medium"
                  numberOfLines={1}
                  style={styles.keyword}
                  testID={`emotional-current-keyword-${index}`}
                >
                  {keyword}
                </ThemedText>
              ) : null}
              {typeKey ? (
                <View
                  style={[
                    styles.typeBadge,
                    {
                      backgroundColor: theme.colors.accent.primary + '1A',
                      borderColor: theme.colors.accent.primary + '44',
                    },
                  ]}
                  testID={`emotional-current-type-${index}`}
                >
                  <ThemedText size={9} variant="accent" weight="medium" style={styles.upperText}>
                    {t(typeKey)}
                  </ThemedText>
                </View>
              ) : null}
              <View style={styles.spacer} />
              <ThemedText
                size={12}
                variant="secondary"
                style={styles.combined}
                testID={`emotional-current-combined-${index}`}
              >
                {`${combined.toFixed(1)} / ${COMBINED_MAX}`}
              </ThemedText>
            </View>

            {sources ? (
              <ThemedText
                size={11}
                variant="muted"
                style={styles.sources}
                testID={`emotional-current-sources-${index}`}
              >
                {sources}
              </ThemedText>
            ) : null}

            <View
              style={[styles.track, { backgroundColor: theme.colors.border.default + '55' }]}
              accessibilityRole="progressbar"
              accessibilityValue={{
                min: 0,
                max: COMBINED_MAX,
                now: combined,
                text: `${combined.toFixed(1)} / ${COMBINED_MAX}`,
              }}
            >
              <View
                testID={`emotional-current-bar-${index}`}
                style={[
                  styles.fill,
                  {
                    width: `${combinedPct}%`,
                    backgroundColor: theme.colors.accent.primary,
                  },
                ]}
              />
            </View>

            {dyad.description ? (
              <ThemedText
                size={11}
                variant="muted"
                style={styles.description}
                testID={`emotional-current-description-${index}`}
              >
                {dyad.description}
              </ThemedText>
            ) : null}
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
    gap: 5,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  keyword: {
    flexShrink: 1,
  },
  typeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
    borderWidth: 1,
  },
  upperText: {
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  spacer: {
    flex: 1,
  },
  combined: {
    marginLeft: 6,
  },
  sources: {
    letterSpacing: 0.2,
  },
  track: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 1,
  },
  fill: {
    height: '100%',
    borderRadius: 2,
  },
  description: {
    fontStyle: 'italic',
    marginTop: 1,
  },
});

export default EmotionalCurrents;
