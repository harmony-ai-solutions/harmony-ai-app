/**
 * TtsTestPanel — TTS playback test studio for the TTS config editor
 * (persona-modules 2-3, reworked Phase 3-5).
 *
 * ## Two transports
 *
 * 1. **Entity-bound (eventserver):** when an `entityId` is available (and no
 *    `providerType` is supplied), the panel INITs a transient `debug` session,
 *    sends the existing `TTS_GENERATE_SPEECH` event with
 *    `tts_output_type: "binary"` and plays the `ENTITY_UTTERANCE` audio through
 *    the app's AudioPlayer. The engine synthesizes with the entity's SYNCED TTS
 *    config.
 *
 * 2. **Stateless direct synthesis (Phase 3-5):** when `providerType` is given —
 *    even if there is no `entityId` — the panel posts the live form settings to
 *    `POST /api/module-configs/tts/test-speech` and plays the returned
 *    `audio_base64`. This lets users test voice cloning, pitch/speed and voice
 *    design immediately on the config editor, without saving a module config or
 *    binding an AI entity.
 *
 * `paralinguisticTags` (e.g. Chatterbox Turbo's `[laughter]`, `[sigh]`) render
 * as quick-insert chips above the sample text.
 */

import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useTranslation } from 'react-i18next';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { useSyncConnection } from '../../contexts/SyncConnectionContext';
import { ThemedText } from '../themed/ThemedText';
import AudioPlayer from '../../services/AudioPlayer';
import { runTest, ModuleTestSessionError } from '../../services/voiceInput/moduleTestSessionService';
import { engineApiClient } from '../../services/engine/EngineApiClient';
import { hapticLightPress } from '../../utils/haptics';
import { createLogger } from '../../utils/logger';

const log = createLogger('[TtsTestPanel]');

type TtsPhase = 'idle' | 'synthesizing' | 'playing' | 'error';

export interface TtsTestPanelProps {
  /** The AI entity whose saved TTS config should be tested. */
  entityId?: string;
  /** Provider type for stateless direct synthesis (`testTtsSpeech`). */
  providerType?: string;
  /** Selected provider account id (direct synthesis). */
  accountId?: string | null;
  /** The live capability overlay (model, voice, cloning params, …). */
  capability?: Record<string, any>;
  /** Model-declared paralinguistic tags for quick insertion. */
  paralinguisticTags?: string[];
}

/** Normalize an engine `format` value into an audio mime type. */
function audioMime(format?: string): string {
  if (!format) return 'audio/wav';
  return format.includes('/') ? format : `audio/${format}`;
}

/** Prefer `playBase64Audio` when available; fall back to `playAudio`. */
async function playSynthesizedAudio(audio: string, format?: string): Promise<void> {
  const mime = audioMime(format);
  const player = AudioPlayer as unknown as {
    playBase64Audio?: (base64: string, mimeType?: string) => Promise<void>;
    playAudio: (base64: string, mimeType?: string) => Promise<void>;
  };
  if (typeof player.playBase64Audio === 'function') {
    await player.playBase64Audio(audio, mime);
    return;
  }
  await player.playAudio(audio, mime);
}

/** Turn a paralinguistic tag into a stable test id slug. */
export function paralinguisticTagTestId(tag: string): string {
  return `tts-tag-${tag
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()}`;
}

export const TtsTestPanel: React.FC<TtsTestPanelProps> = ({
  entityId,
  providerType,
  accountId,
  capability,
  paralinguisticTags = [],
}) => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('moduleConfig');
  const { isConnected } = useSyncConnection();

  const [phase, setPhase] = useState<TtsPhase>('idle');
  const [text, setText] = useState(() => t('sampleText'));
  const [error, setError] = useState<string | null>(null);

  const isOffline = !isConnected;
  const useDirectSynthesis = Boolean(providerType);
  const canSynthesize = Boolean(entityId) || useDirectSynthesis;

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

    if (!canSynthesize) return;
    if (!text.trim()) return;

    hapticLightPress();
    setPhase('synthesizing');
    setError(null);
    try {
      if (useDirectSynthesis) {
        // ── Stateless direct synthesis (no entity / no saved config) ──
        const res = await engineApiClient.testTtsSpeech({
          text: text.trim(),
          provider: providerType,
          provider_account_id: accountId ?? null,
          model: capability?.model,
          capability_json: capability,
          voice_config_file: capability?.voice_config_file,
        });
        const audio = res.audio_base64 || res.audio || res.data;
        if (!audio) {
          throw new Error('No audio returned');
        }
        await playSynthesizedAudio(audio, res.format);
        setPhase('playing');
        return;
      }

      // ── Entity-bound eventserver path ──
      const payload = await runTest(entityId as string, async ({ sendEvent, awaitEvent }) => {
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
  }, [
    phase,
    text,
    entityId,
    providerType,
    accountId,
    capability,
    useDirectSynthesis,
    canSynthesize,
    t,
  ]);

  if (!theme) return null;

  // Offline: only block the eventserver transport. Direct synthesis still has a
  // chance if the engine HTTP route is reachable.
  if (isOffline && !providerType) {
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
  const formatLabel = String(
    capability?.format ?? capability?.audio_format ?? 'wav',
  )
    .replace(/^audio\//, '')
    .toUpperCase();

  // ── No entity AND no direct provider → disabled test panel with a hint ──
  if (!entityId && !providerType) {
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

  const insertTag = (tag: string) => {
    if (isBusy) return;
    hapticLightPress();
    setText((prev) => (prev.trim() ? `${prev.trimEnd()} ${tag}` : tag));
  };

  return (
    <View style={styles.wrapper}>
      {/* ── Transport note (only when falling back to saved entity config) ── */}
      {!useDirectSynthesis ? (
        <ThemedText size={12} variant="muted">
          {t('usesSavedConfig')}
        </ThemedText>
      ) : null}

      {/* ── Paralinguistic quick-insert chips (`tag-pill`) ── */}
      {paralinguisticTags.length > 0 ? (
        <View style={styles.tagRow} testID="tts-tag-chips">
          {paralinguisticTags.map((tag) => (
            <TouchableOpacity
              key={tag}
              testID={paralinguisticTagTestId(tag)}
              onPress={() => insertTag(tag)}
              disabled={isBusy}
              accessibilityRole="button"
              accessibilityLabel={`Insert ${tag}`}
              style={[styles.tagChip, isBusy ? styles.disabled : null]}
            >
              <ThemedText size={10.5} style={styles.tagChipText}>
                {tag}
              </ThemedText>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {/* ── Sample text input (`sh-textarea`) ── */}
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        multiline
        numberOfLines={3}
        placeholder={t('sampleText')}
        placeholderTextColor="#64748B"
        editable={!isBusy}
        testID="tts-text-input"
      />

      {/* ── Synthesize / stop + monospace format badge ── */}
      <View style={styles.footerRow}>
        <TouchableOpacity
          testID="tts-play-button"
          onPress={handlePlay}
          disabled={isBusy || !canSynthesize}
          accessibilityRole="button"
          accessibilityLabel={
            phase === 'playing' ? t('stop') : t('play')
          }
          style={[
            styles.playButtonWrap,
            isBusy || !canSynthesize ? styles.disabled : null,
          ]}
        >
          <LinearGradient
            colors={['#D946EF', '#9333EA']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.playButton}
          >
            {isBusy ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : null}
            <ThemedText size={11.5} weight="medium" style={styles.playButtonText}>
              {phase === 'playing'
                ? `⏹ ${t('stop')}`
                : isBusy
                  ? t('synthesizing')
                  : '▶ Synthesize & Play Sample'}
            </ThemedText>
          </LinearGradient>
        </TouchableOpacity>
        <View style={styles.formatBadge}>
          <ThemedText size={10} style={styles.formatBadgeText}>
            {formatLabel}
          </ThemedText>
        </View>
      </View>

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
  wrapper: { gap: 10 },
  offlineRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  offlineText: { flex: 1 },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  tagChip: {
    backgroundColor: 'rgba(168, 85, 247, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.35)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tagChipText: {
    color: '#E9D5FF',
    fontFamily: 'monospace',
  },
  input: {
    backgroundColor: '#070B14',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.16)',
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingVertical: 9,
    color: '#E2E8F0',
    fontSize: 11.5,
    lineHeight: 16,
    minHeight: 66,
    textAlignVertical: 'top',
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  playButtonWrap: {
    flex: 1,
    borderRadius: 9,
    overflow: 'hidden',
  },
  playButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  playButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  formatBadge: {
    borderRadius: 7,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.16)',
    backgroundColor: '#070B14',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  formatBadgeText: {
    color: '#94A3B8',
    fontFamily: 'monospace',
    fontWeight: '600',
  },
  disabled: { opacity: 0.55 },
});
