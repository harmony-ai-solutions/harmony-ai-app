import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Modal, Portal } from 'react-native-paper';
import LinearGradient from 'react-native-linear-gradient';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { ThemedButton } from '../themed/ThemedButton';
import { SelectPicker } from '../config/SelectPicker';
import { useReducedMotion } from '../../hooks/useReducedMotion';

const SCREEN_HEIGHT = Dimensions.get('window').height;

/**
 * Guided scenario inputs — maps 1:1 to the engine `guided` payload shape
 * (contract §2-2/§2-3): `{ mood, setting, relationship, timeOfDay, whoFirst, premise }`.
 * Omitted entirely for random / "Surprise me" generations.
 */
export interface ScenarioGuidedInputs {
  mood: string[];
  setting: string;
  relationship: string;
  timeOfDay: string;
  whoFirst: 'character' | 'user';
  premise: string;
}

export interface ScenarioSuggestions {
  moods: string[];
  settings: string[];
  relationships: Array<{ id: string; name: string }>;
  timesOfDay: string[];
}

export const DEFAULT_SCENARIO_SUGGESTIONS: ScenarioSuggestions = {
  moods: ['Warm', 'Playful', 'Mysterious', 'Tense', 'Romantic', 'Somber'],
  settings: [
    'Cafe at midnight',
    'Rooftop garden',
    'Rainy street',
    'Old library',
    'Cozy cabin',
  ],
  relationships: [
    { id: 'strangers', name: 'Strangers' },
    { id: 'old-friends', name: 'Old friends' },
    { id: 'rivals', name: 'Rivals' },
    { id: 'partners', name: 'Partners' },
  ],
  timesOfDay: ['Dawn', 'Morning', 'Afternoon', 'Dusk', 'Night'],
};

export interface ScenarioGeneratorSheetProps {
  open: boolean;
  onClose: () => void;
  /**
   * Called when the user confirms the guided inputs. `null` = random /
   * "Surprise me" (no `guided` payload sent to the engine).
   */
  onGenerate: (guidedInputs: ScenarioGuidedInputs | null) => void;
  /** Optional suggestion overrides — merged over the defaults. */
  suggestions?: Partial<ScenarioSuggestions>;
}

/**
 * Inline multi-select chip row (P2). Promoted to a shared `TagChips` in P3
 * (3-5) — do NOT create the shared component yet.
 */
interface ChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}

const Chip: React.FC<ChipProps> = ({ label, selected, onPress, testID }) => {
  const { theme } = useAppTheme();
  if (!theme) return null;
  const accent = theme.colors.accent.primary;
  return (
    <TouchableOpacity
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[
        styles.chip,
        {
          borderColor: selected ? accent : theme.colors.border.default,
          backgroundColor: selected ? accent + '1A' : 'transparent',
        },
      ]}
    >
      <ThemedText size={13} variant={selected ? 'accent' : 'primary'}>
        {label}
      </ThemedText>
    </TouchableOpacity>
  );
};

/**
 * ScenarioGeneratorSheet — bottom sheet for guided scenario generation.
 *
 * Uses react-native-paper `Modal`+`Portal` (§A18 — no @gorhom/bottom-sheet).
 * Default appearance slides the sheet up; reduced-motion renders a static
 * sheet (paper's own Modal fade provides the cross-fade).
 */
export const ScenarioGeneratorSheet: React.FC<ScenarioGeneratorSheetProps> = ({
  open,
  onClose,
  onGenerate,
  suggestions,
}) => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('scenario');
  const reduceMotion = useReducedMotion();
  const { bottom } = useSafeAreaInsets();

  const merged = useMemo<ScenarioSuggestions>(
    () => ({ ...DEFAULT_SCENARIO_SUGGESTIONS, ...suggestions }),
    [suggestions],
  );

  const [selectedMoods, setSelectedMoods] = useState<string[]>([]);
  const [setting, setSetting] = useState('');
  const [relationship, setRelationship] = useState('');
  const [timeOfDay, setTimeOfDay] = useState('');
  const [whoFirst, setWhoFirst] = useState<'character' | 'user'>('character');
  const [premise, setPremise] = useState('');
  const [generating, setGenerating] = useState(false);

  const slideY = useRef(new Animated.Value(0)).current;

  // Reset the form whenever the sheet opens; slide it up unless the OS wants
  // reduced motion (paper's Modal fade becomes the only animation).
  useEffect(() => {
    if (!open) return;
    setSelectedMoods([]);
    setSetting('');
    setRelationship('');
    setTimeOfDay('');
    setWhoFirst('character');
    setPremise('');
    setGenerating(false);

    if (reduceMotion) {
      slideY.setValue(0);
      return;
    }
    slideY.setValue(SCREEN_HEIGHT);
    Animated.timing(slideY, {
      toValue: 0,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [open, reduceMotion, slideY]);

  const toggleMood = useCallback((mood: string) => {
    setSelectedMoods(prev =>
      prev.includes(mood) ? prev.filter(m => m !== mood) : [...prev, mood],
    );
  }, []);

  const hasGuidedInput =
    selectedMoods.length > 0 ||
    setting.trim().length > 0 ||
    relationship.length > 0 ||
    timeOfDay.length > 0 ||
    premise.trim().length > 0;

  const handleGenerate = useCallback(() => {
    if (generating) return;
    setGenerating(true);
    onGenerate(
      hasGuidedInput
        ? {
            mood: selectedMoods,
            setting,
            relationship,
            timeOfDay,
            whoFirst,
            premise,
          }
        : null,
    );
  }, [
    generating,
    hasGuidedInput,
    selectedMoods,
    setting,
    relationship,
    timeOfDay,
    whoFirst,
    premise,
    onGenerate,
  ]);

  const handleSurpriseMe = useCallback(() => {
    setSelectedMoods([]);
    setSetting('');
    setRelationship('');
    setTimeOfDay('');
    setWhoFirst('character');
    setPremise('');
    setGenerating(false);
    onGenerate(null);
  }, [onGenerate]);

  if (!theme) return null;

  const accent = theme.colors.accent.primary;
  const accentSecondary =
    theme.colors.accent.secondary ?? theme.colors.accent.primary;
  const inputStyle = {
    backgroundColor: theme.colors.background.base,
    borderColor: theme.colors.border.default,
    color: theme.colors.text.primary,
  };

  const renderSheetBody = () => (
      <>
        {/* Gradient background */}
        <LinearGradient
          colors={[theme.colors.background.elevated, theme.colors.background.surface]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={[StyleSheet.absoluteFill, styles.sheetRadius]}
        />
        {/* Prismatic tint */}
        <LinearGradient
          colors={[accent + '10', 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0.6 }}
          style={[StyleSheet.absoluteFill, styles.sheetRadius]}
          pointerEvents="none"
        />
        {/* Top accent stripe */}
        <LinearGradient
          colors={[accent + 'CC', accentSecondary + '66', 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.topStripe}
        />

        {/* Grabber */}
        <View style={styles.grabber} />

        {/* Header */}
        <View style={styles.header}>
          <ThemedText size={18} weight="bold" style={styles.title}>
            {t('title')}
          </ThemedText>
          <ThemedText variant="muted" size={13} style={styles.subtitle}>
            {t('preparingOpening')}
          </ThemedText>
        </View>

        {/* Form */}
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: bottom + 16 },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          {/* Mood / Tone — multi-select chips */}
          <View style={styles.section}>
            <ThemedText variant="secondary" size={13} weight="medium" style={styles.sectionLabel}>
              {t('mood')}
            </ThemedText>
            <View style={styles.chipRow}>
              {merged.moods.map(mood => (
                <Chip
                  key={mood}
                  label={mood}
                  selected={selectedMoods.includes(mood)}
                  onPress={() => toggleMood(mood)}
                  testID={`scenario-sheet-mood-${mood}`}
                />
              ))}
            </View>
          </View>

          {/* Setting / Location — free text + quick suggestions */}
          <View style={styles.section}>
            <ThemedText variant="secondary" size={13} weight="medium" style={styles.sectionLabel}>
              {t('setting')}
            </ThemedText>
            <TextInput
              value={setting}
              onChangeText={setSetting}
              style={[styles.textInput, inputStyle]}
              placeholderTextColor={theme.colors.text.muted}
              testID="scenario-sheet-setting-input"
            />
            <View style={styles.chipRow}>
              {merged.settings.map(s => (
                <Chip
                  key={s}
                  label={s}
                  selected={setting === s}
                  onPress={() => setSetting(prev => (prev === s ? '' : s))}
                  testID={`scenario-sheet-setting-${s}`}
                />
              ))}
            </View>
          </View>

          {/* Relationship — SelectPicker */}
          <View style={styles.section}>
            <ThemedText variant="secondary" size={13} weight="medium" style={styles.sectionLabel}>
              {t('relationship')}
            </ThemedText>
            <SelectPicker
              label={t('relationship')}
              value={relationship}
              options={merged.relationships}
              onChange={setRelationship}
            />
          </View>

          {/* Time of day — optional chips */}
          <View style={styles.section}>
            <ThemedText variant="secondary" size={13} weight="medium" style={styles.sectionLabel}>
              {t('timeOfDay')}
            </ThemedText>
            <View style={styles.chipRow}>
              {merged.timesOfDay.map(td => (
                <Chip
                  key={td}
                  label={td}
                  selected={timeOfDay === td}
                  onPress={() => setTimeOfDay(prev => (prev === td ? '' : td))}
                  testID={`scenario-sheet-time-${td}`}
                />
              ))}
            </View>
          </View>

          {/* Who speaks first — toggle (character default) */}
          <View style={styles.section}>
            <ThemedText variant="secondary" size={13} weight="medium" style={styles.sectionLabel}>
              {t('whoStarts')}
            </ThemedText>
            <View style={styles.toggleRow}>
              {(['character', 'user'] as const).map(actor => {
                const selected = whoFirst === actor;
                return (
                  <TouchableOpacity
                    key={actor}
                    onPress={() => setWhoFirst(actor)}
                    testID={`scenario-sheet-who-${actor}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    style={[
                      styles.toggleButton,
                      {
                        borderColor: selected ? accent : theme.colors.border.default,
                        backgroundColor: selected ? accent + '1A' : 'transparent',
                      },
                    ]}
                  >
                    <ThemedText size={14} variant={selected ? 'accent' : 'primary'}>
                      {actor === 'character' ? 'Character' : 'User'}
                    </ThemedText>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Scene premise — multiline free text */}
          <View style={styles.section}>
            <ThemedText variant="secondary" size={13} weight="medium" style={styles.sectionLabel}>
              {t('premise')}
            </ThemedText>
            <TextInput
              value={premise}
              onChangeText={setPremise}
              multiline
              numberOfLines={4}
              style={[styles.premiseInput, inputStyle]}
              placeholderTextColor={theme.colors.text.muted}
              testID="scenario-sheet-premise-input"
            />
          </View>
        </ScrollView>

        {/* Actions */}
        <View style={styles.actions}>
          <ThemedButton
            variant="ghost"
            label={t('surpriseMe')}
            onPress={handleSurpriseMe}
            testID="scenario-sheet-surprise"
            style={styles.actionButton}
          />
          <ThemedButton
            variant="primary"
            label={generating ? t('generating') : t('generate')}
            onPress={handleGenerate}
            disabled={generating}
            testID="scenario-sheet-generate"
            style={styles.actionButton}
          />
        </View>
      </>
    );

  return (
    <Portal>
      <Modal
        visible={open}
        onDismiss={onClose}
        style={styles.modalWrapper}
        contentContainerStyle={styles.sheet}
        testID="scenario-sheet"
      >
        {reduceMotion ? (
          <View testID="scenario-sheet-content-static" style={styles.sheetShell}>
            {renderSheetBody()}
          </View>
        ) : (
          <Animated.View
            testID="scenario-sheet-content-slide"
            style={[
              styles.sheetShell,
              { transform: [{ translateY: slideY }] },
            ]}
          >
            {renderSheetBody()}
          </Animated.View>
        )}
      </Modal>
    </Portal>
  );
};

const styles = StyleSheet.create({
  modalWrapper: {
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: 'transparent',
    maxHeight: '88%',
  },
  sheetShell: {
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#151d30', // opaque fallback — prevents transparency
  },
  sheetRadius: {
    borderRadius: 20,
  },
  topStripe: {
    height: 2,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
    marginTop: 8,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  title: {
    letterSpacing: 0.3,
  },
  subtitle: {
    marginTop: 2,
  },
  scroll: {
    flexShrink: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 4,
  },
  section: {
    marginBottom: 16,
  },
  sectionLabel: {
    marginBottom: 8,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
  },
  textInput: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
    fontSize: 15,
  },
  premiseInput: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 96,
    fontSize: 15,
    textAlignVertical: 'top',
  },
  toggleRow: {
    flexDirection: 'row',
    gap: 10,
  },
  toggleButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 12,
  },
  actionButton: {
    minWidth: 120,
    height: 46,
  },
});
