/**
 * EmotionBars — the eight Ekman emotions as horizontal intensity bars
 * (tts-voice-ux Phase 5, `State` tab of the character-state sheet).
 *
 * Each row shows the emotion glyph + label, an intensity fill, a baseline
 * notch (where the emotion decays back to) and a "crystallized" badge when the
 * engine reports a `*_crystallize_start` timestamp. Engine order
 * (`EKMAN8_EMOTIONS`) is preserved — the vector is never re-sorted here.
 *
 * Display metadata is deliberately a small local table: the engine vocabulary
 * is fixed (8 Ekman names) and user-editable vocabularies are out of scope.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { EKMAN8_EMOTIONS, type Ekman8Emotion } from '../../types/emoji';
import type { EmotionState } from '../../database/models';
import { ThemedText } from '../themed/ThemedText';
import { useAppTheme } from '../../contexts/ThemeContext';
import {
  getEmotionBaseline,
  getEmotionIntensity,
  isEmotionCrystallized,
} from '../../hooks/useEmotionState';

export interface EmotionDisplay {
  /** chatDetail i18n key for the human label. */
  labelKey: string;
  emoji: string;
  /** Distinct accent hue per emotion (8 well-separated colors). */
  color: string;
}

/** Fixed display metadata for the engine's eight emotions. */
export const EMOTION_DISPLAY: Record<Ekman8Emotion, EmotionDisplay> = {
  joy: { labelKey: 'emotionJoy', emoji: '😊', color: '#FBBF24' },
  sadness: { labelKey: 'emotionSadness', emoji: '😢', color: '#60A5FA' },
  trust: { labelKey: 'emotionTrust', emoji: '🤝', color: '#34D399' },
  disgust: { labelKey: 'emotionDisgust', emoji: '🤢', color: '#A3E635' },
  fear: { labelKey: 'emotionFear', emoji: '😨', color: '#A78BFA' },
  anger: { labelKey: 'emotionAnger', emoji: '😠', color: '#F87171' },
  surprise: { labelKey: 'emotionSurprise', emoji: '😲', color: '#F472B6' },
  anticipation: { labelKey: 'emotionAnticipation', emoji: '👀', color: '#22D3EE' },
};

export function getEmotionDisplay(emotion: Ekman8Emotion): EmotionDisplay {
  return EMOTION_DISPLAY[emotion];
}

/**
 * Engine intensity bands. The engine owns the words; this only maps the
 * five known band names to their chatDetail i18n key (`null` for anything
 * unknown so no chip is rendered).
 */
const EMOTION_BAND_KEYS: Record<string, string> = {
  neutral: 'emotionBandNeutral',
  mild: 'emotionBandMild',
  moderate: 'emotionBandModerate',
  intense: 'emotionBandIntense',
  overwhelming: 'emotionBandOverwhelming',
};

export function emotionBandLabelKey(label: string | null | undefined): string | null {
  const normalized = (label ?? '').trim().toLowerCase();
  return EMOTION_BAND_KEYS[normalized] ?? null;
}

/**
 * Bar scale: intensities are 0..10 in the engine; `high_threshold` can exceed
 * that on an unusual profile, so the scale is `max(high_threshold, 10)`.
 */
export function emotionScaleMax(state: EmotionState): number {
  const threshold = Number.isFinite(state.high_threshold) ? state.high_threshold : 0;
  return Math.max(threshold, 10);
}

export interface EmotionBarsProps {
  state: EmotionState;
  /** Engine-derived band per emotion (`intensityLabels`); absent on old engines. */
  intensityLabels?: Record<string, string>;
}

export const EmotionBars: React.FC<EmotionBarsProps> = ({ state, intensityLabels }) => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('chatDetail');

  if (!theme) return null;

  const scaleMax = emotionScaleMax(state);

  return (
    <View testID="emotion-bars">
      {EKMAN8_EMOTIONS.map(emotion => {
        const display = getEmotionDisplay(emotion);
        const intensity = getEmotionIntensity(state, emotion);
        const baseline = getEmotionBaseline(state, emotion);
        const crystallized = isEmotionCrystallized(state, emotion);
        const bandKey = emotionBandLabelKey(intensityLabels?.[emotion]);
        const intensityPct = Math.max(0, Math.min(100, (intensity / scaleMax) * 100));
        const baselinePct = Math.max(0, Math.min(100, (baseline / scaleMax) * 100));

        return (
          <View
            key={emotion}
            style={styles.row}
            testID={`emotion-bar-${emotion}`}
          >
            <View style={styles.labelColumn}>
              <ThemedText size={12} numberOfLines={1} style={styles.label}>
                {display.emoji} {t(display.labelKey)}
              </ThemedText>
              {crystallized ? (
                <View
                  style={[styles.badge, { backgroundColor: display.color + '26' }]}
                  testID={`emotion-crystallized-${emotion}`}
                >
                  <ThemedText size={9} style={{ color: display.color }}>
                    {t('emotionCrystallized')}
                  </ThemedText>
                </View>
              ) : null}
            </View>

            <View
              style={[styles.track, { backgroundColor: theme.colors.border.default + '55' }]}
              accessibilityRole="progressbar"
              accessibilityLabel={t(display.labelKey)}
              accessibilityValue={{
                min: 0,
                max: scaleMax,
                now: intensity,
                text: `${intensity.toFixed(1)} / ${scaleMax.toFixed(0)}`,
              }}
            >
              <View
                testID={`emotion-bar-fill-${emotion}`}
                style={[
                  styles.fill,
                  { width: `${intensityPct}%`, backgroundColor: display.color },
                ]}
              />
              {/* Baseline notch — where this emotion decays back toward. */}
              <View
                testID={`emotion-baseline-${emotion}`}
                style={[
                  styles.baselineNotch,
                  { left: `${baselinePct}%`, backgroundColor: theme.colors.text.primary + '99' },
                ]}
              />
            </View>

            <ThemedText
              size={12}
              variant="secondary"
              style={styles.value}
              testID={`emotion-value-${emotion}`}
            >
              {intensity.toFixed(1)}
            </ThemedText>

            <View style={styles.bandColumn}>
              {bandKey ? (
                <View
                  style={[
                    styles.bandChip,
                    {
                      backgroundColor: theme.colors.accent.primary + '1A',
                      borderColor: theme.colors.accent.primary + '44',
                    },
                  ]}
                  testID={`emotion-band-${emotion}`}
                >
                  <ThemedText
                    size={9}
                    variant="accent"
                    weight="medium"
                    numberOfLines={1}
                    style={styles.bandChipText}
                  >
                    {t(bandKey)}
                  </ThemedText>
                </View>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 10,
  },
  labelColumn: {
    width: 96,
    alignItems: 'flex-start',
    gap: 2,
  },
  label: {
    flexShrink: 1,
  },
  value: {
    width: 34,
    textAlign: 'right',
  },
  bandColumn: {
    width: 86,
    alignItems: 'flex-end',
  },
  badge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 8,
  },
  bandChip: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 8,
    borderWidth: 1,
  },
  bandChipText: {
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  track: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 3,
  },
  baselineNotch: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    marginLeft: -1,
  },
});

export default EmotionBars;
