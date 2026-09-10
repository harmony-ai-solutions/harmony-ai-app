/**
 * TtsTestPanel — TTS playback test block for the TTS config editor
 * (persona-modules 2-3, reworked 2026-09-02).
 *
 * ## Transport (eventserver, NOT HTTP)
 *
 * The app must NOT call the engine's management server over HTTP (not
 * cloud-reachable). This panel INITs an AI entity in a transient `debug`
 * session (engine 1-3) → sends the EXISTING `TTS_GENERATE_SPEECH` event with
 * `tts_output_type: "binary"` → awaits the `ENTITY_UTTERANCE` response → plays
 * the inline audio via the app's existing AudioPlayer. The engine synthesizes
 * with the entity's SYNCED TTS config.
 *
 * ## Entity context (documented finding)
 *
 * TTS only works in the context of an AI entity + its module config. The panel
 * lives on ModuleConfigEditScreen's TTS branch, but that screen is opened with
 * route params `{ moduleType, configId }` ONLY — there is no entity binding in
 * any current entry path (CreateAIScreen / EntityModuleSelectorWithActions and
 * VoiceInputSettingsScreen both omit it). Because the screen genuinely has no
 * AI entity context, the panel is DISABLED there with a hint ("Open this
 * config from an AI profile to test"). The panel accepts an optional `entityId`
 * prop so a future entity-bound entry path can enable it.
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
import { runTest, ModuleTestSessionError } from '../../services/voiceInput/moduleTestSessionService';
import { hapticLightPress } from '../../utils/haptics';
import { createLogger } from '../../utils/logger';

const log = createLogger('[TtsTestPanel]');

type TtsPhase = 'idle' | 'synthesizing' | 'playing' | 'error';

interface TtsTestPanelProps {
  /** The AI entity whose saved TTS config should be tested. Disables when absent. */
  entityId?: string;
}

export const TtsTestPanel: React.FC<TtsTestPanelProps> = ({ entityId }) => {
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

    // No entity context → nothing to INIT, no way to synthesize.
    if (!entityId) return;

    if (!text.trim()) return;

    hapticLightPress();
    setPhase('synthesizing');
    setError(null);
    try {
      const payload = await runTest(entityId, async ({ sendEvent, awaitEvent }) => {
        await sendEvent({
          event_type: 'TTS_GENERATE_SPEECH',
          payload: {
            utterance: {
              type: 'UTTERANCE_COMBINED',
              content: text.trim(),
              entity_id: entityId,
            },
            tts_output_type: 'binary',
          },
        });
        const resp = await awaitEvent('ENTITY_UTTERANCE', {
          predicate: (e) => e.payload?.audio,
        });
        return resp?.payload ?? null;
      });

      if (!payload?.audio) {
        throw new ModuleTestSessionError('No audio returned');
      }
      await AudioPlayer.playAudio(payload.audio, payload.audio_type || 'audio/wav');
      setPhase('playing');
    } catch (err: any) {
      setPhase('error');
      setError(
        err instanceof ModuleTestSessionError
          ? err.message
          : t('ttsError', { message: err?.message ?? '' }),
      );
      log.error('TTS test failed:', err);
    }
  }, [phase, text, entityId, t]);

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

  // ── No entity context → disabled test panel with a hint ──
  if (!entityId) {
    return (
      <View style={styles.wrapper}>
        <View style={styles.offlineRow}>
          <Icon name="information-outline" size={20} color={theme.colors.text.muted} />
          <ThemedText size={13} variant="muted" style={styles.offlineText} testID="tts-needs-entity">
            {t('ttsNeedsEntityHint')}
          </ThemedText>
        </View>
        <ThemedText size={12} variant="muted">
          {t('usesSavedConfig')}
        </ThemedText>
      </View>
    );
  }

  return (
    <View style={styles.wrapper}>
      {/* ── Saved-config note (eventserver transport tests the SYNCED config) ── */}
      <ThemedText size={12} variant="muted">
        {t('usesSavedConfig')}
      </ThemedText>

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
