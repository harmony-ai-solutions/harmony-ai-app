/**
 * TtsTestPanel — TTS playback test block for the TTS config editor
 * (persona-modules 2-3). Type text → "Play" → the engine synthesizes with the
 * *draft* config → playback via the app's existing audio player. Users hear
 * exactly what the entity would produce.
 *
 * Props: `draftConfig` (provider_type / provider_config_id / module_config).
 * Offline → an informative "Connect to Harmony Link to test" state (never
 * fabricates audio).
 */

import React, { useCallback, useState } from 'react';
import { View, TextInput, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { useSyncConnection } from '../../contexts/SyncConnectionContext';
import { ThemedText } from '../themed/ThemedText';
import { ThemedButton } from '../themed/ThemedButton';
import AudioPlayer from '../../services/AudioPlayer';
import { testTts, ModuleTestError, ModuleTestDraftConfig } from '../../services/voiceInput/moduleTestClient';
import { hapticLightPress } from '../../utils/haptics';
import { createLogger } from '../../utils/logger';

const log = createLogger('[TtsTestPanel]');

type TtsPhase = 'idle' | 'synthesizing' | 'playing' | 'error';

interface TtsTestPanelProps {
  draftConfig: ModuleTestDraftConfig;
}

export const TtsTestPanel: React.FC<TtsTestPanelProps> = ({ draftConfig }) => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('moduleConfig');
  const { isConnected } = useSyncConnection();

  const [phase, setPhase] = useState<TtsPhase>('idle');
  const [text, setText] = useState(() => t('sampleText'));
  const [error, setError] = useState<string | null>(null);

  if (!theme) return null;

  const isOffline = !isConnected;

  const handlePlay = useCallback(async () => {
    // Stop button while playing.
    if (phase === 'playing') {
      try {
        await AudioPlayer.stop();
      } catch (err) {
        log.warn('Failed to stop playback:', err);
      }
      setPhase('idle');
      return;
    }

    if (!text.trim()) return;

    hapticLightPress();
    setPhase('synthesizing');
    setError(null);
    try {
      const res = await testTts(draftConfig, text.trim());
      await AudioPlayer.playAudio(res.audio_base64, res.mime_type);
      setPhase('playing');
    } catch (err: any) {
      setPhase('error');
      setError(
        err instanceof ModuleTestError
          ? err.message
          : t('ttsError', { message: err?.message ?? '' }),
      );
      log.error('TTS test failed:', err);
    }
  }, [phase, text, draftConfig, t]);

  if (isOffline) {
    return (
      <View style={styles.wrapper}>
        <View style={styles.offlineRow}>
          <Icon name="link-off" size={20} color={theme.colors.text.muted} />
          <ThemedText size={13} variant="muted" style={styles.offlineText}>
            {t('ttsOfflineTitle')}
          </ThemedText>
        </View>
        <ThemedText size={12} variant="muted">
          {t('ttsOfflineHint')}
        </ThemedText>
      </View>
    );
  }

  const isBusy = phase === 'synthesizing';

  return (
    <View style={styles.wrapper}>
      {/* ── Sample text input ── */}
      <TextInput
        style={[
          styles.input,
          {
            color: theme.colors.text.primary,
            borderColor: theme.colors.border.default,
            backgroundColor: theme.colors.background.base,
          },
        ]}
        value={text}
        onChangeText={setText}
        multiline
        numberOfLines={3}
        placeholder={t('sampleText')}
        placeholderTextColor={theme.colors.text.muted}
        editable={!isBusy}
        testID="tts-text-input"
      />

      {/* ── Play / Stop ── */}
      <ThemedButton
        label={
          phase === 'playing'
            ? t('stop')
            : phase === 'synthesizing'
              ? t('synthesizing')
              : t('play')
        }
        onPress={handlePlay}
        disabled={isBusy}
        icon={phase === 'playing' ? 'stop' : 'play'}
        variant={phase === 'playing' ? 'outline' : 'primary'}
        testID="tts-play-button"
      />

      {/* ── Error state ── */}
      {phase === 'error' && error && (
        <ThemedText size={13} variant="primary" style={{ color: theme.colors.status.error }} testID="tts-error">
          {error}
        </ThemedText>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: { gap: 12 },
  offlineRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  offlineText: { flex: 1 },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    minHeight: 72,
    textAlignVertical: 'top',
  },
});
