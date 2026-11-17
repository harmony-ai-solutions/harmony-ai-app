/**
 * CharacterStateSheet — the ONE combined "Character state" surface
 * (tts-voice-ux Phase 5 + 6).
 *
 * Opened from the chat header's mood chip or from chat settings. Three tabs:
 *   - `State`     — emotional vector (pull-based, "as of" stamped), the eight
 *                   Ekman intensity bars and the READ-ONLY vocal expressiveness.
 *   - `Memories`  — the AI's memory timeline.
 *   - `Knowledge` — its RAG collections / documents / similarity test query.
 *
 * The latter two are mounted lazily: only the active tab renders (and therefore
 * fetches), and switching back re-mounts it, which re-reads its data. Chat open
 * never fires three network calls.
 *
 * The sheet is presentational for the emotion vector: ChatDetailScreen owns
 * `useEmotionState` so the header chip and this sheet always agree.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import type { EmotionState } from '../../database/models';
import type { DominantEmotion } from '../../hooks/useEmotionState';
import type { EmotionDerived } from '../../services/engine/engineApiMappers';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { hapticLightPress } from '../../utils/haptics';
import { createLogger } from '../../utils/logger';
import { EmotionBars, emotionBandLabelKey, emotionScaleMax, getEmotionDisplay } from './EmotionBars';
import { EmotionalCurrents } from './EmotionalCurrents';
import { MemoriesTab } from './MemoriesTab';
import { KnowledgeTab } from './KnowledgeTab';

const log = createLogger('[CharacterStateSheet]');

export type CharacterStateTab = 'state' | 'memories' | 'knowledge';

/** Engine budget for each derived vocal-expressiveness level. */
const VOICE_BUDGETS: Record<string, { cues: number; tones: number }> = {
  subdued: { cues: 1, tones: 1 },
  natural: { cues: 3, tones: 2 },
  expressive: { cues: 5, tones: 3 },
};

const VOICE_LABEL_KEYS: Record<string, string> = {
  subdued: 'voiceLevelSubdued',
  natural: 'voiceLevelNatural',
  expressive: 'voiceLevelExpressive',
};

/** Normalizes the engine's derived level (absent/unknown ⇒ `natural`). */
export function normalizeVocalExpressiveness(value: string | null | undefined): string {
  const normalized = (value ?? '').trim().toLowerCase();
  return normalized === 'subdued' || normalized === 'expressive' ? normalized : 'natural';
}

function formatAsOf(date: Date | null | undefined): string {
  if (!date) return '';
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDecay(tau: number | null | undefined): string {
  if (!Number.isFinite(tau ?? NaN) || (tau ?? 0) <= 0) return '';
  const hours = tau as number;
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  return `${Math.round(hours)}h`;
}

export interface CharacterStateSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Partner entity whose inner life is shown. */
  entityId: string | null;
  characterName: string;
  avatarUri?: string | null;
  emotion: EmotionState | null;
  dominant: DominantEmotion | null;
  /**
   * Engine-derived view (dominant band, dyads, per-emotion bands). `null` on
   * older engines that omit `emotion_derived` — the tab then degrades to the
   * plain vector/bars.
   */
  derived: EmotionDerived | null;
  emotionLoading: boolean;
  emotionError: string | null;
  /** Re-read trigger used when the State tab is re-focused. */
  onRefreshEmotion: () => void;
  /** Engine-derived, READ-ONLY ('subdued' | 'natural' | 'expressive'). */
  vocalExpressiveness?: string | null;
}

export const CharacterStateSheet: React.FC<CharacterStateSheetProps> = ({
  visible,
  onClose,
  entityId,
  characterName,
  avatarUri,
  emotion,
  dominant,
  derived,
  emotionLoading,
  emotionError,
  onRefreshEmotion,
  vocalExpressiveness,
}) => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('chatDetail');
  const { bottom: safeBottom } = useSafeAreaInsets();

  const [tab, setTab] = useState<CharacterStateTab>('state');
  const previousTabRef = useRef<CharacterStateTab>('state');

  // Re-read the (pull-based) emotion vector when the State tab regains focus
  // while the sheet is open (a close must not trigger a read).
  useEffect(() => {
    if (visible && tab === 'state' && previousTabRef.current !== 'state') {
      onRefreshEmotion();
    }
    previousTabRef.current = tab;
  }, [tab, visible, onRefreshEmotion]);

  // Closing always returns to the State tab (and unmounts the heavy tabs so
  // they hold no data/requests while the sheet is closed).
  useEffect(() => {
    if (!visible) setTab('state');
  }, [visible]);

  const selectTab = useCallback((next: CharacterStateTab) => {
    if (next === tab) return;
    hapticLightPress();
    log.debug(`Character state tab → ${next}`);
    setTab(next);
  }, [tab]);

  if (!theme) return null;

  const asOf = formatAsOf(emotion?.last_update);
  const decay = formatDecay(emotion?.decay_tau);
  const level = normalizeVocalExpressiveness(vocalExpressiveness);
  const budget = VOICE_BUDGETS[level];

  const tabs: Array<{ key: CharacterStateTab; label: string }> = [
    { key: 'state', label: t('tabState') },
    { key: 'memories', label: t('tabMemories') },
    { key: 'knowledge', label: t('tabKnowledge') },
  ];

  const renderStateTab = () => {
    if (emotionLoading && !emotion) {
      return (
        <View style={styles.centered} testID="character-state-loading">
          <ActivityIndicator color={theme.colors.accent.primary} />
        </View>
      );
    }

    if (!emotion) {
      return (
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.centered} testID="character-state-empty">
            <ThemedText variant="muted" size={13} style={styles.emptyText}>
              {t('emotionEmpty')}
            </ThemedText>
            {emotionError ? (
              <ThemedText
                variant="muted"
                size={11}
                style={styles.emptyText}
                testID="character-state-error"
              >
                {t('emotionUnavailable')}
              </ThemedText>
            ) : null}
            <TouchableOpacity
              onPress={onRefreshEmotion}
              accessibilityRole="button"
              testID="character-state-retry"
            >
              <ThemedText size={13} variant="accent">
                {t('common:retry')}
              </ThemedText>
            </TouchableOpacity>
          </View>
          {renderVoiceExpressionCard()}
        </ScrollView>
      );
    }

    const dominantDisplay = dominant ? getEmotionDisplay(dominant.emotion) : null;
    const scaleMax = emotionScaleMax(emotion);
    const dominantBandKey = dominant
      ? emotionBandLabelKey(
          derived?.intensityLabels?.[dominant.emotion] ?? derived?.intensityLabel,
        )
      : null;
    const activeDyads = derived?.activeDyads ?? [];

    return (
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        testID="character-state-content"
      >
        {dominant && dominantDisplay ? (
          <View
            style={[
              styles.dominantCard,
              {
                borderColor: dominantDisplay.color + '66',
                backgroundColor: dominantDisplay.color + '14',
              },
            ]}
            testID="dominant-emotion-card"
          >
            <ThemedText size={11} variant="muted" style={styles.cardLabel}>
              {t('dominantEmotion')}
            </ThemedText>
            <View style={styles.dominantRow}>
              <ThemedText size={20}>{dominantDisplay.emoji}</ThemedText>
              <ThemedText size={17} weight="bold">
                {t(dominantDisplay.labelKey)}
              </ThemedText>
              <ThemedText size={17} weight="bold" style={{ color: dominantDisplay.color }}>
                {`${dominant.intensity.toFixed(1)} / ${scaleMax}`}
              </ThemedText>
              {dominantBandKey ? (
                <View
                  style={[
                    styles.bandBadge,
                    {
                      backgroundColor: theme.colors.accent.primary + '1A',
                      borderColor: theme.colors.accent.primary + '44',
                    },
                  ]}
                  testID="dominant-emotion-band"
                >
                  <ThemedText size={9} variant="accent" weight="medium" style={styles.bandBadgeText}>
                    {t(dominantBandKey)}
                  </ThemedText>
                </View>
              ) : null}
            </View>
          </View>
        ) : null}

        {activeDyads.length > 0 ? (
          <>
            <ThemedText
              size={12}
              variant="muted"
              weight="medium"
              style={styles.sectionHeader}
              testID="emotional-currents-header"
            >
              {t('emotionalCurrents')}
            </ThemedText>
            <EmotionalCurrents dyads={activeDyads} />
          </>
        ) : null}

        <View style={styles.sectionHeaderRow}>
          <ThemedText size={12} variant="muted" weight="medium" style={styles.sectionLabel}>
            {t('eightEmotions')}
          </ThemedText>
          <ThemedText size={11} variant="muted">
            {t('emotionScale', { max: scaleMax })}
          </ThemedText>
        </View>

        <EmotionBars state={emotion} intensityLabels={derived?.intensityLabels} />

        {renderVoiceExpressionCard()}
      </ScrollView>
    );
  };

  const renderVoiceExpressionCard = () => (
    <View
      style={[
        styles.voiceCard,
        {
          borderColor: theme.colors.border.default,
          backgroundColor: theme.colors.background.base + '55',
        },
      ]}
      testID="voice-expression-card"
    >
      <View style={styles.voiceHeader}>
        <ThemedText size={12} variant="muted" weight="medium">
          {t('voiceExpressionLevel')}
        </ThemedText>
        <View
          style={[styles.levelBadge, { backgroundColor: theme.colors.accent.primary + '22' }]}
          testID="voice-expression-level"
        >
          <ThemedText size={10} variant="accent" weight="medium">
            {t(VOICE_LABEL_KEYS[level])}
          </ThemedText>
        </View>
      </View>
      <ThemedText size={12} variant="secondary" style={styles.voiceBudget}>
        {t('voiceExpressionBudget', { cues: budget.cues, tones: budget.tones })}
      </ThemedText>
    </View>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('common:close')}
        />

        <View
          style={[
            styles.sheet,
            {
              paddingBottom: safeBottom + 12,
              backgroundColor: theme.colors.background.surface,
              borderColor: theme.colors.border.default,
            },
          ]}
          testID="character-state-sheet"
        >
          <View style={styles.grabber} />

          {/* ── Header: avatar + name + freshness stamp ── */}
          <View style={styles.header}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatar} />
            ) : (
              <View
                style={[styles.avatar, { backgroundColor: theme.colors.accent.primary + '22' }]}
              >
                <ThemedText size={12} weight="bold" variant="accent">
                  {characterName.substring(0, 2).toUpperCase()}
                </ThemedText>
              </View>
            )}
            <View style={styles.headerText}>
              <ThemedText size={16} weight="bold" numberOfLines={1} hierarchy="header">
                {characterName}
              </ThemedText>
              <ThemedText size={11} variant="muted" testID="character-state-as-of">
                {asOf
                  ? decay
                    ? t('emotionAsOfDecay', { time: asOf, duration: decay })
                    : t('emotionAsOf', { time: asOf })
                  : t('characterState')}
              </ThemedText>
            </View>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={t('common:close')}
              testID="character-state-close"
            >
              <Icon name="close" size={20} color={theme.colors.text.muted} />
            </TouchableOpacity>
          </View>

          {/* ── Tabs ── */}
          <View
            style={[styles.tabBar, { borderColor: theme.colors.border.default + '66' }]}
            accessibilityRole="tablist"
          >
            {tabs.map(item => {
              const selected = tab === item.key;
              return (
                <TouchableOpacity
                  key={item.key}
                  onPress={() => selectTab(item.key)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  testID={`character-state-tab-${item.key}`}
                  style={[
                    styles.tab,
                    {
                      borderBottomColor: selected
                        ? theme.colors.accent.primary
                        : 'transparent',
                    },
                  ]}
                >
                  <ThemedText size={13} variant={selected ? 'accent' : 'muted'} weight="medium">
                    {item.label}
                  </ThemedText>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* ── Active tab (lazy: only this one is mounted) ── */}
          {tab === 'state' ? (
            renderStateTab()
          ) : tab === 'memories' ? (
            <MemoriesTab entityId={entityId} />
          ) : (
            <KnowledgeTab entityId={entityId} />
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(2, 6, 23, 0.78)',
  },
  sheet: {
    maxHeight: '88%',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderTopWidth: 1,
    paddingTop: 0,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(148,163,184,0.4)',
    marginTop: 8,
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
  },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 2,
  },
  scroll: {
    flexShrink: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  centered: {
    paddingHorizontal: 20,
    paddingVertical: 28,
    alignItems: 'center',
    gap: 8,
  },
  emptyText: {
    textAlign: 'center',
  },
  dominantCard: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 14,
  },
  cardLabel: {
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  bandBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
    borderWidth: 1,
  },
  bandBadgeText: {
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  sectionHeader: {
    marginTop: 4,
    marginBottom: 6,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
    marginBottom: 6,
  },
  sectionLabel: {
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  dominantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  voiceCard: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 6,
    gap: 4,
  },
  voiceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  levelBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  voiceBudget: {
    marginTop: 2,
  },
});

export default CharacterStateSheet;
