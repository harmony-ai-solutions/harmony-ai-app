/**
 * VoicePicker — the account-scoped ElevenLabs voice picker (provider-registry
 * 6-3, plan §3.2/§6.3).
 *
 * ElevenLabs voices are per-ACCOUNT and live-only (never catalogued — SYNTHESIS
 * §3): the options come from the `voices` envelope of the models route
 * (`POST /api/providers/models`), which the parent slot fetches on demand. Until
 * a fetch has run (or when the account exposes no voices) the field falls back
 * to free text so a voice id can still be entered.
 *
 * A saved voice absent from the fetched list is kept selectable and flagged
 * stale (revalidation, plan §3.2) — never dropped.
 */

import React from 'react';
import { View, TextInput, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { useKeyboardAwareFocus } from '../themed/KeyboardAwareScrollView';
import { SelectPicker } from './SelectPicker';
import type { VoiceInfoDto } from '../../services/engine/EngineApiClient';

/** Test id for the free-text voice-id fallback input. */
export const VOICE_INPUT_TESTID = 'voice-picker-input';

/** Test id for the stale-voice marker. */
export const VOICE_STALE_TESTID = 'voice-picker-stale';

interface VoicePickerProps {
  value: string;
  onChange: (voiceId: string) => void;
  label: string;
  /** Live-fetched account voices (null = not fetched yet). */
  voices?: VoiceInfoDto[] | null;
  /** True when the saved voice is absent from the fetched list. */
  stale?: boolean;
}

export const VoicePicker: React.FC<VoicePickerProps> = ({
  value,
  onChange,
  label,
  voices,
  stale = false,
}) => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('moduleConfig');
  const onInputFocus = useKeyboardAwareFocus();

  if (!theme) return null;

  const renderStale = () => {
    if (!stale) return null;
    return (
      <View
        testID={VOICE_STALE_TESTID}
        style={[styles.stale, { borderColor: theme.colors.status.warning }]}
      >
        <ThemedText size={11} style={{ color: theme.colors.status.warning }}>
          {t('voiceStale')}
        </ThemedText>
      </View>
    );
  };

  // Not fetched / no voices → free text (enter the id manually).
  if (!voices || voices.length === 0) {
    return (
      <View>
        <TextInput
          style={[
            styles.input,
            {
              color: theme.colors.text.primary,
              borderColor: theme.colors.border.default,
              backgroundColor: theme.colors.background.base,
            },
          ]}
          value={value}
          onChangeText={onChange}
          onFocus={onInputFocus}
          placeholder={t('voiceCustom')}
          placeholderTextColor={theme.colors.text.muted}
          testID={VOICE_INPUT_TESTID}
        />
        <ThemedText variant="muted" size={11} style={styles.hint}>
          {t('voiceFetchHint')}
        </ThemedText>
        {renderStale()}
      </View>
    );
  }

  const options = voices.map((v) => ({ id: v.voice_id, name: v.name || v.voice_id }));
  // Keep a saved-but-unlisted voice selectable (per-account catalogue drift).
  if (value && !options.find((o) => o.id === value)) {
    options.push({ id: value, name: value });
  }

  // The account catalogue is always shown, but it is NOT model-scoped (a voice
  // id works across model families; only `verified_languages` names the models
  // a voice was verified for). The free-text input below stays available so a
  // voice id copied from the ElevenLabs dashboard — or a brand-new cloned voice
  // missing from a stale fetch — can always be entered.
  return (
    <View>
      <SelectPicker
        label={label}
        value={value}
        options={options}
        onChange={onChange}
        placeholder={t('voiceSelectPlaceholder')}
      />
      <ThemedText size={12} variant="secondary" style={styles.customLabel}>
        {t('voiceCustom')}
      </ThemedText>
      <TextInput
        style={[
          styles.input,
          {
            color: theme.colors.text.primary,
            borderColor: theme.colors.border.default,
            backgroundColor: theme.colors.background.base,
          },
        ]}
        value={value}
        onChangeText={onChange}
        onFocus={onInputFocus}
        placeholder={t('voiceCustomPlaceholder')}
        placeholderTextColor={theme.colors.text.muted}
        autoCapitalize="none"
        autoCorrect={false}
        testID={VOICE_INPUT_TESTID}
      />
      <ThemedText variant="muted" size={11} style={styles.hint}>
        {t('voiceCustomHint')}
      </ThemedText>
      {renderStale()}
    </View>
  );
};

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    minHeight: 44,
  },
  customLabel: {
    marginTop: 10,
    marginBottom: 4,
  },
  hint: {
    marginTop: 4,
  },
  stale: {
    marginTop: 6,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
});
