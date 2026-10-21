/**
 * TtsTestPanel — TTS playback test studio for the TTS config editor
 * (persona-modules 2-3, reworked Phase 3-5 and again for the player rework).
 *
 * ## One transport — stateless direct synthesis
 *
 * The panel posts the live form settings to
 * `POST /api/module-configs/tts/test-speech` and plays the returned
 * `audio_base64`. This lets users test voice cloning, pitch/speed and voice
 * design immediately on the config editor, without saving a module config or
 * binding an AI entity.
 *
 * The entity-bound eventserver path (`INIT_ENTITY` + `TTS_GENERATE_SPEECH`) was
 * REMOVED by owner decision (2026-10-21): a saved config reaches the entity
 * anyway when it is spawned for a chat/game turn, so the panel never needs to
 * bother the entity — and the stateless route always tests the form state the
 * user is looking at.
 *
 * The `provider` field is REQUIRED by that route (engine
 * `management/routes_modules.go` → `normalizeTTSProvider`: missing/unknown →
 * "provider is required"/"unsupported provider type", surfaced as an error
 * status), so until a provider is selected the panel renders an honest
 * "select a provider" hint instead of a button that could only fail.
 *
 * The player state is the same as before: the synthesized audio is kept as
 * `lastAudio: { base64, mime }` plus the `lastSynthText` it was synthesized
 * from, so the sample can be replayed or downloaded without another engine
 * round-trip.
 *
 * ## Player row (rework)
 *
 * `phase` is `'idle' | 'synthesizing' | 'playing' | 'paused' | 'error'`.
 * `AudioPlayer.playAudio` resolves at playback START (it only calls
 * `TrackPlayer.play()`), so completion is detected the same way ChatBubble does:
 * a 250 ms poll of `AudioPlayer.getProgress()` / `getState()` while `playing`;
 * the first state that is neither `'playing'` nor `'buffering'` means the
 * utterance ended → back to `idle` with the audio still loaded.
 *
 *  - idle (no audio) → full-width gradient "▶ Synthesize & Play Sample".
 *  - synthesizing → spinner + label (inputs disabled) + disabled download.
 *  - playing / paused → compact player row: 30×30 play/pause bubble, a seek
 *    slider (`AudioPlayer.seekTo`), and a `0:03 / 0:12` time label, followed by
 *    the format badge (the ACTUAL sample format, sniffed from its bytes) and the
 *    download button.
 *  - finished → footer returns to the synthesize button (audio stays loaded):
 *    pressing it with UNCHANGED text replays instantly (the queue is REBUILT
 *    from the kept bytes — an external reset can outlive the panel's state),
 *    edited text re-synthesizes.
 *
 * Duration comes up-front from the static `getDurationFromBase64` parser (which
 * sniffs the container, so declared-vs-actual mismatches — e.g. mp3 declared but
 * WAV bytes returned — still yield a duration) and falls back to the polled
 * progress duration.
 *
 * ## Download
 *
 * The 28×28 icon button next to the format badge writes the kept base64 to the
 * cache directory with `react-native-fs` and opens the OS share sheet with
 * `react-native-share` — the same write+share pattern as
 * `shareDiagnostics.shareDiagnosticsReport`. A cancelled share sheet is not an
 * error (`failOnCancel: false`); real failures surface through the panel's
 * error text.
 *
 * ## Tags
 *
 * `paralinguisticTags` (e.g. Chatterbox Turbo's `[laughter]`, `[sigh]`) render
 * as quick-insert chips above the sample text. At most `MAX_INLINE_TAGS` chips
 * render inline; a dashed "[+ N more]" chip opens `TtsTagPickerModal` with the
 * searchable full list, and picking a row appends the tag through the same
 * `insertTag` path as a chip press.
 *
 * ## Keep-awake
 *
 * The screen is kept on ONLY while audio is actually `playing` (never while
 * paused/idle/synthesizing) via the first-party `KeepScreenOn` native helper
 * (`src/services/keepScreenOn.ts`). Without it the OS dims and sleeps the
 * screen mid-listen → AppState `background` → the biometric lock re-arms.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Slider from '@react-native-community/slider';
import { useTranslation } from 'react-i18next';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import { useAppTheme } from '../../contexts/ThemeContext';
import { useSyncConnection } from '../../contexts/SyncConnectionContext';
import { ThemedText } from '../themed/ThemedText';
import AudioPlayer, { AudioPlayer as AudioPlayerClass } from '../../services/AudioPlayer';
import { engineApiClient } from '../../services/engine/EngineApiClient';
import {
  activateKeepScreenOn,
  deactivateKeepScreenOn,
} from '../../services/keepScreenOn';
import { formatDuration } from '../../utils/formatDuration';
import {
  audioMimeFor,
  detectAudioFormat,
  type AudioFormat,
} from '../../utils/audioFormat';
import { hapticLightPress } from '../../utils/haptics';
import { createLogger } from '../../utils/logger';
import { TtsTagPickerModal } from './TtsTagPickerModal';
import { paralinguisticTagTestId } from './paralinguisticTagTestIds';

export { paralinguisticTagTestId };

const log = createLogger('[TtsTestPanel]');

/** Inline chip ceiling; the rest live behind the "[+ N more]" picker chip. */
const MAX_INLINE_TAGS = 20;

/** How often completion is polled while audio plays (ChatBubble parity). */
const PROGRESS_POLL_MS = 250;

type TtsPhase = 'idle' | 'synthesizing' | 'playing' | 'paused' | 'error';

/** The last synthesized sample, kept so it can be replayed and downloaded. */
interface SynthesizedAudio {
  base64: string;
  mime: string;
}

export interface TtsTestPanelProps {
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

/** File extension for a shareable sample, derived from its mime type. */
function audioFileExtension(mime: string): string {
  const value = (mime || '').toLowerCase();
  if (value.includes('mpeg') || value.includes('mp3')) return 'mp3';
  if (value.includes('ogg')) return 'ogg';
  if (value.includes('opus')) return 'opus';
  if (value.includes('flac')) return 'flac';
  if (value.includes('aac')) return 'aac';
  if (value.includes('mp4') || value.includes('m4a')) return 'm4a';
  return 'wav';
}

/** Badge label for a stored sample mime (`audio/mpeg` → `MP3`, `audio/wav` → `WAV`). */
function formatLabelForMime(mime: string): string {
  return audioFileExtension(mime).toUpperCase();
}

/** True when a DECLARED mime already names the sniffed format. */
function declaredMimeMatchesFormat(mime: string, format: AudioFormat): boolean {
  const value = (mime || '').toLowerCase();
  switch (format) {
    case 'wav':
      return value.includes('wav');
    case 'mp3':
      return value.includes('mpeg') || value.includes('mp3');
    case 'ogg':
      return value.includes('ogg') || value.includes('opus');
    case 'flac':
      return value.includes('flac');
    default:
      return true;
  }
}

/**
 * Trust the BYTES, not the declared label.
 *
 * The TTS API currently declares mp3 but returns WAV bytes (backend bug), so a
 * declared-mime-only sample got an mp3 data-URI / filename / badge and a dead
 * duration parse. Sniff the actual container once, log the mismatch, and keep
 * the actual mime — every downstream consumer (badge, download extension,
 * share type, duration parser) reads `SynthesizedAudio.mime`.
 */
function resolveSynthesizedAudio(
  base64: string,
  declaredMime: string,
): SynthesizedAudio {
  const format = detectAudioFormat(base64);
  if (format === 'unknown') {
    return { base64, mime: declaredMime };
  }
  if (!declaredMimeMatchesFormat(declaredMime, format)) {
    log.warn(
      `TTS sample declared ${declaredMime} but bytes are ${format.toUpperCase()} — using the actual format (backend format bug)`,
    );
  }
  return { base64, mime: audioMimeFor(format) };
}

/** Prefer `playBase64Audio` when available; fall back to `playAudio`. */
async function playSynthesizedAudio(audio: string, mime: string): Promise<void> {
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

/**
 * Immediate duration for a just-synthesized sample.
 *
 * The service's parser is a STATIC class method while the module's default
 * export is an INSTANCE, so the static is reached through the class. Test
 * doubles attach the same function to the default export instead, so prefer it
 * when present. Always resolves (a parse failure just means the polled progress
 * duration is used instead).
 */
async function parseAudioDuration(base64: string, mime: string): Promise<number | null> {
  const instance = AudioPlayer as unknown as {
    getDurationFromBase64?: (audio: string, mimeType: string) => Promise<number | null>;
  };
  try {
    if (typeof instance.getDurationFromBase64 === 'function') {
      return await instance.getDurationFromBase64(base64, mime);
    }
    return await AudioPlayerClass.getDurationFromBase64(base64, mime);
  } catch (error) {
    log.warn('Could not determine audio duration up-front:', error);
    return null;
  }
}

export const TtsTestPanel: React.FC<TtsTestPanelProps> = ({
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
  /** The kept sample + the exact text it was synthesized from (replay guard). */
  const [lastAudio, setLastAudio] = useState<SynthesizedAudio | null>(null);
  const [lastSynthText, setLastSynthText] = useState('');
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [tagPickerVisible, setTagPickerVisible] = useState(false);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isOffline = !isConnected;
  // The test-speech route always needs a provider type (see the header note).
  const canSynthesize = Boolean(providerType);

  // ── Screen keep-awake — ONLY while audio is actually playing ──────────
  // Pausing/idle/synthesizing releases it (paused playback has no audio
  // output, so the display may sleep); unmount always releases.
  useEffect(() => {
    if (phase === 'playing') {
      activateKeepScreenOn();
    }
    return () => {
      deactivateKeepScreenOn();
    };
  }, [phase]);

  // ── Completion polling (ChatBubble parity) ────────────────────────────
  // `AudioPlayer.playAudio` resolves at playback START, so the only reliable
  // "the utterance ended" signal is the player's own state leaving
  // playing/buffering. Also mirrors the live position + duration into state.
  useEffect(() => {
    if (phase !== 'playing') {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
      return;
    }

    progressIntervalRef.current = setInterval(async () => {
      try {
        const progress = await AudioPlayer.getProgress();
        setPosition(progress.position);
        if (progress.duration > 0) {
          setDuration(progress.duration);
        }

        // Auto-stop when playback finishes.
        const state = await AudioPlayer.getState();
        if (state !== 'playing' && state !== 'buffering') {
          if (progressIntervalRef.current) {
            clearInterval(progressIntervalRef.current);
            progressIntervalRef.current = null;
          }
          setPhase('idle');
          setPosition(0);
        }
      } catch (err) {
        // Playback might have stopped or encountered an error.
        log.debug('Playback progress poll failed:', err);
        if (progressIntervalRef.current) {
          clearInterval(progressIntervalRef.current);
          progressIntervalRef.current = null;
        }
        setPhase('idle');
        setPosition(0);
      }
    }, PROGRESS_POLL_MS);

    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
    };
  }, [phase]);

  /** Synthesize the sample over the stateless test-speech API and play it. */
  const synthesize = useCallback(async () => {
    if (!canSynthesize || !providerType) return;
    const spoken = text.trim();
    if (!spoken) return;

    hapticLightPress();
    setPhase('synthesizing');
    setError(null);
    try {
      const res = await engineApiClient.testTtsSpeech({
        text: spoken,
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
      const result = resolveSynthesizedAudio(audio, audioMime(res.format));
      await playSynthesizedAudio(result.base64, result.mime);

      // Duration up-front so the seeker is correct on the very first frame;
      // the polled progress duration takes over if the parse failed.
      const knownDuration = await parseAudioDuration(result.base64, result.mime);
      setDuration(knownDuration != null && knownDuration > 0 ? knownDuration : 0);
      setLastAudio(result);
      setLastSynthText(spoken);
      setPosition(0);
      setPhase('playing');
    } catch (err: any) {
      setPhase('error');
      setError(t('ttsError', { message: err?.message ?? '' }));
      log.error('TTS test failed:', err);
    }
  }, [
    text,
    providerType,
    accountId,
    capability,
    canSynthesize,
    t,
  ]);

  /**
   * Big-button handler: instant replay when the kept sample was synthesized
   * from the CURRENT text, otherwise a fresh synthesis (the text was edited).
   */
  const handlePlay = useCallback(async () => {
    if (phase === 'synthesizing') return;

    if (lastAudio && lastSynthText === text.trim()) {
      hapticLightPress();
      setError(null);
      try {
        // Rebuild the queue from the kept sample — never seekTo(0)+resume().
        // An entity-session teardown (whole-app ON_STOP) resets the shared
        // TrackPlayer singleton while this panel stays mounted, so the panel's
        // "a sample is loaded" state can outlive the actual queue; resuming a
        // reset player made the control look dead with no way to regenerate
        // (owner device, 2026-10-21). playSynthesizedAudio reloads the bytes,
        // so replay stays instant (no re-synthesis).
        await playSynthesizedAudio(lastAudio.base64, lastAudio.mime);
        setPosition(0);
        setPhase('playing');
      } catch (err: any) {
        log.warn('Failed to replay synthesized audio:', err);
        setPhase('error');
        setError(t('ttsError', { message: err?.message ?? '' }));
      }
      return;
    }

    await synthesize();
  }, [phase, lastAudio, lastSynthText, text, synthesize, t]);

  /** Player-row play/pause bubble. */
  const handleTogglePlayback = useCallback(async () => {
    hapticLightPress();
    if (phase === 'playing') {
      try {
        await AudioPlayer.pause();
        setPhase('paused');
      } catch (err) {
        log.warn('Failed to pause playback:', err);
      }
      return;
    }
    if (phase === 'paused') {
      try {
        await AudioPlayer.resume();
        setPhase('playing');
      } catch (err) {
        log.warn('Failed to resume playback:', err);
      }
    }
  }, [phase]);

  /** Seeker — update the label immediately, then seek the loaded track. */
  const handleSeek = useCallback(async (value: number) => {
    setPosition(value);
    try {
      await AudioPlayer.seekTo(value);
    } catch (err) {
      log.warn('Failed to seek synthesized audio:', err);
    }
  }, []);

  /** Write the kept sample to the cache dir and open the OS share sheet. */
  const handleDownload = useCallback(async () => {
    if (!lastAudio) return;
    hapticLightPress();
    setError(null);
    try {
      const filename = `soulbits-tts-sample-${Date.now()}.${audioFileExtension(lastAudio.mime)}`;
      const dir = RNFS.CachesDirectoryPath || RNFS.DocumentDirectoryPath;
      const path = `${dir}/${filename}`;
      await RNFS.writeFile(path, lastAudio.base64, 'base64');
      await Share.open({
        title: 'Soulbits voice sample',
        subject: 'Soulbits voice sample',
        type: lastAudio.mime,
        url: `file://${path}`,
        filename,
        failOnCancel: false,
      });
    } catch (err: any) {
      // A cancelled share sheet resolves (failOnCancel: false) — only real
      // failures land here.
      log.warn('Failed to save/share the TTS sample:', err);
      setError(t('downloadFailed', { message: err?.message ?? '' }));
    }
  }, [lastAudio, t]);

  if (!theme) return null;

  // ── No provider selected yet → nothing to synthesize with ──
  // `POST /api/module-configs/tts/test-speech` REQUIRES `provider`
  // (engine `normalizeTTSProvider` → "provider is required"), so a
  // provider-less request could ONLY fail. Rather than a button that silently
  // errors, show the honest precondition.
  if (!providerType) {
    return (
      <View style={styles.wrapper}>
        <View style={styles.offlineRow}>
          <Icon name="information-outline" size={20} color={theme.colors.text.muted} />
          <ThemedText size={13} variant="muted" style={styles.offlineText} testID="tts-needs-provider">
            {t('ttsNeedsProviderHint')}
          </ThemedText>
        </View>
      </View>
    );
  }

  const isBusy = phase === 'synthesizing';
  const isPlaying = phase === 'playing';
  const isPaused = phase === 'paused';
  const hasAudio = lastAudio !== null;
  const showPlayerRow = hasAudio && (isPlaying || isPaused);
  const canDownload = hasAudio && !isBusy;
  // Prefer the STORED sample's actual mime (sniffed from the bytes) once audio
  // exists; before synthesis fall back to the declared capability format.
  const declaredFormatLabel = String(
    capability?.format ?? capability?.audio_format ?? 'wav',
  )
    .replace(/^audio\//, '')
    .toUpperCase();
  const formatLabel = hasAudio
    ? formatLabelForMime(lastAudio.mime)
    : declaredFormatLabel;

  const insertTag = (tag: string) => {
    if (isBusy) return;
    hapticLightPress();
    setText((prev) => (prev.trim() ? `${prev.trimEnd()} ${tag}` : tag));
  };

  // Inline chip cap: everything past MAX_INLINE_TAGS moves behind the picker.
  const inlineTags = paralinguisticTags.slice(0, MAX_INLINE_TAGS);
  const hiddenTagCount = paralinguisticTags.length - inlineTags.length;

  return (
    <View style={styles.wrapper}>
      {/* ── Offline notice (non-blocking: the engine HTTP route may still answer) ── */}
      {isOffline ? (
        <>
          <View style={styles.offlineRow} testID="tts-offline-notice">
            <Icon name="link-off" size={16} color={theme.colors.text.muted} />
            <ThemedText size={12} variant="muted" style={styles.offlineText}>
              {t('ttsOfflineTitle')}
            </ThemedText>
          </View>
          <ThemedText size={12} variant="muted">
            {t('ttsOfflineHint')}
          </ThemedText>
        </>
      ) : null}

      {/* ── Paralinguistic quick-insert chips (`tag-pill`) ── */}
      {paralinguisticTags.length > 0 ? (
        <View style={styles.tagRow} testID="tts-tag-chips">
          {inlineTags.map((tag) => (
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
          {hiddenTagCount > 0 ? (
            <TouchableOpacity
              testID="tts-tag-more"
              onPress={() => {
                if (isBusy) return;
                hapticLightPress();
                setTagPickerVisible(true);
              }}
              disabled={isBusy}
              accessibilityRole="button"
              accessibilityLabel={t('tagMore', { count: hiddenTagCount })}
              style={[styles.tagChip, styles.tagChipMore, isBusy ? styles.disabled : null]}
            >
              <ThemedText size={10.5} style={[styles.tagChipText, styles.tagChipMoreText]}>
                {t('tagMore', { count: hiddenTagCount })}
              </ThemedText>
            </TouchableOpacity>
          ) : null}
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

      {/* ── Player row / synthesize button + format badge + download ── */}
      <View style={styles.footerRow}>
        {showPlayerRow ? (
          <>
            <TouchableOpacity
              testID="tts-play-toggle"
              onPress={handleTogglePlayback}
              accessibilityRole="button"
              accessibilityLabel={isPlaying ? t('pause') : t('play')}
              style={styles.playToggle}
            >
              <Icon name={isPlaying ? 'pause' : 'play'} size={15} color="#E9D5FF" />
            </TouchableOpacity>
            <Slider
              testID="tts-seek-slider"
              style={styles.seekSlider}
              minimumValue={0}
              maximumValue={Math.max(duration, 0.1)}
              value={position}
              minimumTrackTintColor="#D946EF"
              maximumTrackTintColor="rgba(148,163,184,0.25)"
              thumbTintColor="#E9D5FF"
              onSlidingComplete={handleSeek}
            />
            <ThemedText size={10.5} style={styles.timeLabel} testID="tts-time-label">
              {`${formatDuration(position)} / ${formatDuration(duration)}`}
            </ThemedText>
          </>
        ) : (
          <TouchableOpacity
            testID="tts-play-button"
            onPress={handlePlay}
            disabled={isBusy || !canSynthesize}
            accessibilityRole="button"
            accessibilityLabel={t('play')}
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
                {isBusy ? t('synthesizing') : t('synthesizePlay')}
              </ThemedText>
            </LinearGradient>
          </TouchableOpacity>
        )}

        <View style={styles.formatBadge}>
          <ThemedText size={10} style={styles.formatBadgeText}>
            {formatLabel}
          </ThemedText>
        </View>

        <TouchableOpacity
          testID="tts-download-button"
          onPress={handleDownload}
          disabled={!canDownload}
          accessibilityRole="button"
          accessibilityLabel={t('downloadSample')}
          style={[styles.downloadButton, !canDownload ? styles.disabled : null]}
        >
          <Icon
            name="download-outline"
            size={15}
            color={canDownload ? '#E9D5FF' : '#94A3B8'}
          />
        </TouchableOpacity>
      </View>

      {/* ── Error state (synthesis or sample download/share) ── */}
      {error && (
        <ThemedText size={13} variant="primary" style={{ color: theme.colors.status.error }} testID="tts-error">
          {error}
        </ThemedText>
      )}

      {/* ── Full paralinguistic-tag list (searchable) ── */}
      <TtsTagPickerModal
        visible={tagPickerVisible}
        tags={paralinguisticTags}
        onClose={() => setTagPickerVisible(false)}
        onPick={(tag) => {
          insertTag(tag);
          setTagPickerVisible(false);
        }}
      />
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
  tagChipMore: {
    borderStyle: 'dashed',
  },
  tagChipText: {
    color: '#E9D5FF',
    fontFamily: 'monospace',
  },
  tagChipMoreText: {
    color: '#94A3B8',
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
  playToggle: {
    width: 30,
    height: 30,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(168,85,247,0.45)',
    backgroundColor: 'rgba(168,85,247,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  seekSlider: {
    flex: 1,
    height: 30,
  },
  timeLabel: {
    color: '#94A3B8',
    fontFamily: 'monospace',
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
  downloadButton: {
    width: 28,
    height: 28,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.2)',
    backgroundColor: '#070B14',
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.55 },
});
