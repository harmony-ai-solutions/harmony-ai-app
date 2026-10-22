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

  return (
    <View>
      <SelectPicker
        label={label}
        value={value}
        options={options}
        onChange={onChange}
        placeholder={t('voiceSelectPlaceholder')}
      />
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
