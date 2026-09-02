/**
 * SttTestPanel — self-contained "Test your configuration" block for STT/VAD
 * config UIs (persona-modules 2-2 rework, live streaming 5-2).
 *
 * ## Transport (eventserver, NOT HTTP)
 *
 * The app must NOT call the engine's management server over HTTP (not
 * cloud-reachable). This panel drives the EXISTING STT events over a transient
 * `debug` engine session (engine 1-3); the engine runs the entity's SYNCED STT
 * config.
 *
 * ## Modes (UX documented in the phase doc)
 *
 * - **Live test (primary, default):** a reusable streaming session (5-2) pushes
 *   the mic's LIVE raw PCM chunks into a ring buffer while the engine pulls via
 *   `STT_FETCH_MICROPHONE` → `STT_FETCH_MICROPHONE_RESULT`; transcripts stream
 *   back as `STT_OUTPUT_TEXT` and accumulate live with an activity indicator.
 * - **Quick test (secondary):** the original one-shot `STT_INPUT_AUDIO` record
 *   → transcribe path — useful when no VAD is configured or for a single
 *   utterance. It renders `[]` VAD segments (no live VAD timeline in one-shot).
 *
 * Props: optional `enabled` (defaults true) and optional `entityId` (threaded by
 * edit-mode CreateAI, 5-1) — an explicit entity overrides persona resolution.
 * When offline it renders an informative "Connect to Harmony Link to test"
 * state — it never fabricates a result.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Buffer } from 'buffer';
import { v7 as uuidv7 } from 'uuid';
import { useAppTheme } from '../../contexts/ThemeContext';
import { useSyncConnection } from '../../contexts/SyncConnectionContext';
// Base tint for the VAD timeline track (bar colors are inline via theme).
const VAD_TRACK_TINT = 'rgba(127,127,127,0.2)';
import { ThemedText } from '../themed/ThemedText';
import { ThemedButton } from '../themed/ThemedButton';
import AudioRecorder from '../../services/AudioRecorder';
import ChatPreferencesService from '../../services/ChatPreferencesService';
import { resolvePersonaId } from '../../database/repositories/userEntities';
import { runTest, ModuleTestSessionError } from '../../services/voiceInput/moduleTestSessionService';
import { startAudioStream } from '../../services/streaming/streamingService';
import type { AudioStreamHandle } from '../../services/streaming/types';
import { hapticLightPress } from '../../utils/haptics';
import { createLogger } from '../../utils/logger';

const log = createLogger('[SttTestPanel]');

type RecorderPhase = 'idle' | 'recording' | 'processing' | 'done' | 'error';
type TestMode = 'live' | 'quick';

interface SttTestPanelProps {
  enabled?: boolean;
  /** Explicit entity context (edit-mode CreateAI threads the AI entity id).
   *  When present the STT config is tested against THAT entity; when absent the
   *  (shared) persona is resolved as today. */
  entityId?: string;
}

export interface VadSegment {
  start_ms: number;
  end_ms: number;
}

export interface SttTestPanelResult {
  transcript: string;
  vad_segments: VadSegment[];
  duration_ms: number;
}

export interface WavAudioParams {
  channels: number;
  bitDepth: number;
  sampleRate: number;
}

/** Fallback recorder params — the app records 16 kHz / 16-bit / mono (AudioRecorder). */
const DEFAULT_WAV_PARAMS: WavAudioParams = { channels: 1, bitDepth: 16, sampleRate: 16000 };

/**
 * Read the channels / bits-per-sample / sample-rate from a base64 WAV header
 * (RIFF). Pure + exported for unit testing. Returns null when the buffer is too
 * short or is not a RIFF/WAVE payload — callers fall back to DEFAULT_WAV_PARAMS.
 */
export function parseWavAudioParams(base64: string): WavAudioParams | null {
  try {
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length < 44) return null;
    const riff = buffer.toString('ascii', 0, 4);
    const wave = buffer.toString('ascii', 8, 12);
    if (riff !== 'RIFF' || wave !== 'WAVE') return null;
    return {
      channels: buffer.readUInt16LE(22),
      sampleRate: buffer.readUInt32LE(24),
      bitDepth: buffer.readUInt16LE(34),
    };
  } catch {
    return null;
  }
}

/**
 * Convert VAD segments to percentage widths/offsets for the bar timeline.
 * Pure + exported for unit testing. A segment outside [0, duration] is clamped;
 * a max < min yields a 0-width bar; empty segments/duration yields [].
 */
export function computeVadBars(
  segments: VadSegment[],
  durationMs: number,
): { left: number; width: number }[] {
  if (!segments || segments.length === 0 || !durationMs || durationMs <= 0) return [];
  return segments.map((s) => {
    const start = Math.max(0, s.start_ms);
    const end = Math.min(durationMs, s.end_ms);
    const left = Math.min(100, Math.max(0, (start / durationMs) * 100));
    const width = Math.min(100 - left, Math.max(0, ((end - start) / durationMs) * 100));
    return { left, width };
  });
}

export const SttTestPanel: React.FC<SttTestPanelProps> = ({
  enabled = true,
  entityId,
}) => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('voiceInput');
  const { isConnected } = useSyncConnection();

  const [mode, setMode] = useState<TestMode>('live');
  const [phase, setPhase] = useState<RecorderPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SttTestPanelResult | null>(null);
  // Live-stream accumulated transcript + activity indicator.
  const [liveText, setLiveText] = useState('');
  const [liveListening, setLiveListening] = useState(false);
  const [recordingMs, setRecordingMs] = useState(0);
  const recordingStartRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamHandleRef = useRef<AudioStreamHandle | null>(null);
  const unsubPcmRef = useRef<(() => void) | null>(null);

  if (!theme) return null;

  const isOffline = !isConnected;
  const isBusy = phase === 'recording' || phase === 'processing';

  const startTimer = useCallback(() => {
    recordingStartRef.current = Date.now();
    setRecordingMs(0);
    intervalRef.current = setInterval(() => {
      setRecordingMs(Date.now() - recordingStartRef.current);
    }, 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Clear the recording timer if the panel unmounts mid-recording (also keeps
  // the Jest timer out of the way).
  useEffect(() => stopTimer, [stopTimer]);

  // Resolve the entity whose (shared) STT config is tested. An explicit entityId
  // (edit-mode CreateAI) overrides; otherwise resolve the persona the user chats
  // as. resolvePersonaId sanitizes a stale/AI-character id to 'user'.
  const resolveTestEntityId = useCallback(async () => {
    return entityId ?? (await resolvePersonaId(await ChatPreferencesService.getGlobalImpersonatedEntity()));
  }, [entityId]);

  // ── Live test: open the streaming session, feed LIVE raw PCM from the mic ───
  const startLive = useCallback(async () => {
    const testEntityId = await resolveTestEntityId();
    // Open the engine stream session (STT_START_LISTEN) FIRST — the engine pulls
    // immediately, so the ring buffer's read-ahead wait holds until the mic feeds.
    const handle = await startAudioStream({
      entityId: testEntityId,
      deviceType: 'debug',
      format: DEFAULT_WAV_PARAMS,
      autoVad: true,
      resultMode: 'return',
      onTranscript: (transcript) => {
        setLiveText((prev) => (prev ? `${prev} ${transcript.text}` : transcript.text));
      },
      onError: (err) => log.error('Live stream error:', err),
    });
    streamHandleRef.current = handle;
    // Register the live PCM feed BEFORE the mic starts recording so no early chunk
    // is lost. The native `data` event is raw 16-bit PCM (no WAV header).
    unsubPcmRef.current = AudioRecorder.subscribeLivePcm((pcm) => handle.feedAudio(pcm));
    await AudioRecorder.startRecording();
    setPhase('recording');
    setLiveListening(true);
    startTimer();
  }, [resolveTestEntityId, startTimer]);

  const stopLive = useCallback(async () => {
    unsubPcmRef.current?.();
    unsubPcmRef.current = null;
    try {
      if (streamHandleRef.current) await streamHandleRef.current.stop();
    } catch (err) {
      log.warn('Live stream stop failed:', err);
    }
    streamHandleRef.current = null;
    try {
      await AudioRecorder.stopRecording();
    } catch (err) {
      log.warn('Failed to stop recorder:', err);
    }
    setLiveListening(false);
    setPhase('done');
  }, []);

  const handleStart = useCallback(async () => {
    if (!enabled || isBusy) return;
    try {
      hapticLightPress();
      setError(null);
      setResult(null);
      setLiveText('');
      if (mode === 'live') {
        await startLive();
      } else {
        await AudioRecorder.startRecording();
        setPhase('recording');
        startTimer();
      }
    } catch (err: any) {
      setPhase('error');
      const message = err?.message ?? '';
      setError(message.toLowerCase().includes('permission') ? t('permissionDenied') : t('testError', { message }));
      log.error('Failed to start test:', err);
    }
  }, [enabled, isBusy, mode, startLive, startTimer, t]);

  const handleStop = useCallback(async () => {
    if (phase !== 'recording') return;
    try {
      stopTimer();

      // ── Live path: teardown the stream + release the mic ──
      if (mode === 'live') {
        await stopLive();
        return;
      }

      // ── Quick path: one-shot record → transcribe ──
      const recorded = await AudioRecorder.stopRecording();
      setPhase('processing');

      const testEntityId = await resolveTestEntityId();

      // Derive WAV parameters from the recorder output header (fallback to the
      // recorder's fixed 16 kHz / 16-bit / mono).
      const params = parseWavAudioParams(recorded.data) ?? DEFAULT_WAV_PARAMS;

      const messageId = uuidv7();
      const transcript = await runTest(testEntityId, async ({ sendEvent, awaitEvent }) => {
        await sendEvent({
          event_type: 'STT_INPUT_AUDIO',
          payload: {
            message_id: messageId,
            audio_data: {
              audio_bytes: recorded.data,
              channels: params.channels,
              bit_depth: params.bitDepth,
              sample_rate: params.sampleRate,
            },
            result_mode: 'return',
          },
        });
        const resp = await awaitEvent('STT_OUTPUT_TEXT', {
          predicate: (e) => e.payload?.message_id === messageId,
        });
        return resp?.payload?.content ?? '';
      });

      setResult({
        transcript,
        vad_segments: [], // one-shot mode — VAD segments are a follow-up
        duration_ms: Math.round(recorded.duration * 1000),
      });
      setPhase('done');
    } catch (err: any) {
      setPhase('error');
      setError(
        err instanceof ModuleTestSessionError
          ? err.message
          : t('testError', { message: err?.message ?? '' }),
      );
      log.error('STT test failed:', err);
    }
  }, [phase, stopTimer, mode, stopLive, resolveTestEntityId, t]);

  const handlePress = useCallback(() => {
    if (phase === 'recording') {
      handleStop();
    } else {
      handleStart();
    }
  }, [phase, handleStart, handleStop]);

  // Guaranteed teardown on unmount (best-effort; never leaves the mic/stream up).
  useEffect(() => {
    return () => {
      unsubPcmRef.current?.();
      if (streamHandleRef.current) {
        streamHandleRef.current.stop().catch(() => undefined);
        streamHandleRef.current = null;
      }
      if (AudioRecorder.getRecordingStatus()) {
        AudioRecorder.stopRecording().catch(() => undefined);
      }
    };
  }, []);

  // ── Offline state ──
  if (isOffline) {
    return (
      <View style={styles.wrapper}>
        <View style={styles.offlineRow}>
          <Icon name="link-off" size={20} color={theme.colors.text.muted} />
          <ThemedText size={13} variant="muted" style={styles.offlineText}>
            {t('offlineTitle')}
          </ThemedText>
        </View>
        <ThemedText size={12} variant="muted">
          {t('offlineHint')}
        </ThemedText>
      </View>
    );
  }

  const bars = computeVadBars(result?.vad_segments ?? [], result?.duration_ms ?? 0);

  return (
    <View style={styles.wrapper}>
      {/* ── Saved-config note (eventserver transport tests the SYNCED config) ── */}
      <ThemedText size={12} variant="muted">
        {t('usesSavedConfig')}
      </ThemedText>

      {/* ── Mode segmented control: Live test (primary) / Quick test ── */}
      <View style={styles.modeSegmented}>
        {(['live', 'quick'] as TestMode[]).map((m) => (
          <TouchableOpacity
            key={m}
            style={[styles.modeSegment, mode === m && { backgroundColor: theme.colors.accent.primary }]}
            onPress={() => {
              if (phase !== 'recording' && phase !== 'processing') {
                hapticLightPress();
                setMode(m);
                setError(null);
                setResult(null);
                setLiveText('');
              }
            }}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityState={{ selected: mode === m }}
            testID={`stt-mode-${m}`}
          >
            <ThemedText
              size={13}
              weight="medium"
              variant={mode === m ? 'primary' : 'secondary'}
              style={mode === m ? styles.modeSegmentActiveText : undefined}
            >
              {m === 'live' ? t('liveTestLabel') : t('quickTestLabel')}
            </ThemedText>
          </TouchableOpacity>
        ))}
      </View>
      <ThemedText size={12} variant="muted">
        {mode === 'live' ? t('liveTestHint') : t('quickTestHint')}
      </ThemedText>

      {/* ── Record / Stop button ── */}
      <View style={styles.actionsRow}>
        <ThemedButton
          label={
            phase === 'recording'
              ? t('stopButton')
              : phase === 'processing'
                ? t('processing')
                : mode === 'live'
                  ? t('liveRecordButton')
                  : t('recordButton')
          }
          onPress={handlePress}
          disabled={phase === 'processing' || !enabled}
          icon={phase === 'recording' ? 'stop' : 'microphone'}
          variant={phase === 'recording' ? 'outline' : 'primary'}
          testID="stt-record-button"
        />
        {(phase === 'recording') && (
          <ThemedText size={12} variant="muted" style={styles.duration}>
            {Math.round(recordingMs / 1000)}s
          </ThemedText>
        )}
        {phase === 'processing' && (
          <ActivityIndicator size="small" color={theme.colors.accent.primary} />
        )}
        {phase === 'recording' && mode === 'live' && liveListening && (
          <View style={styles.liveActivityRow}>
            <Icon name="waveform" size={16} color={theme.colors.accent.primary} />
            <ThemedText size={12} variant="accent">{t('liveListening')}</ThemedText>
          </View>
        )}
      </View>

      {/* ── Live result: accumulated live transcript (visible while streaming) ── */}
      {(phase === 'recording' || phase === 'done') && mode === 'live' && (
        <View style={styles.resultSection}>
          <View style={styles.resultRow}>
            <ThemedText size={13} variant="secondary">{t('liveTranscriptLabel')}</ThemedText>
            <ThemedText size={14} weight="medium" style={styles.resultValue} testID="stt-live-transcript">
              {liveText || t('emptyTranscript')}
            </ThemedText>
          </View>
        </View>
      )}

      {/* ── Quick result: transcript / duration / VAD bars ── */}
      {phase === 'done' && mode === 'quick' && result && (
        <View style={styles.resultSection}>
          <View style={styles.resultRow}>
            <ThemedText size={13} variant="secondary">{t('transcriptLabel')}</ThemedText>
            <ThemedText size={14} weight="medium" style={styles.resultValue} testID="stt-transcript">
              {result.transcript || t('emptyTranscript')}
            </ThemedText>
          </View>
          <View style={styles.resultRow}>
            <ThemedText size={13} variant="secondary">{t('durationLabel')}</ThemedText>
            <ThemedText size={13} variant="primary">{result.duration_ms} ms</ThemedText>
          </View>

          <View style={styles.resultRow}>
            <ThemedText size={13} variant="secondary">{t('vadLabel')}</ThemedText>
          </View>
          {bars.length === 0 ? (
            <ThemedText size={12} variant="muted">{t('noVadSegments')}</ThemedText>
          ) : (
            <View style={styles.vadTimeline} testID="stt-vad-timeline">
              {bars.map((b, i) => (
                <View
                  key={i}
                  style={[
                    styles.vadBar,
                    {
                      left: `${b.left}%`,
                      width: `${b.width}%`,
                      backgroundColor: theme.colors.accent.primary,
                    },
                  ]}
                />
              ))}
            </View>
          )}
        </View>
      )}

      {/* ── Error state ── */}
      {phase === 'error' && error && (
        <ThemedText size={13} variant="primary" style={{ color: theme.colors.status.error }} testID="stt-error">
          {error}
        </ThemedText>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: { gap: 12 },
  actionsRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  duration: { minWidth: 36 },
  offlineRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  offlineText: { flex: 1 },
  modeSegmented: {
    flexDirection: 'row',
    borderRadius: 10,
    padding: 3,
    gap: 3,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(127,127,127,0.15)',
  },
  modeSegment: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
  },
  modeSegmentActiveText: {
    color: '#FFFFFF',
  },
  liveActivityRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  resultSection: { gap: 10 },
  resultRow: { gap: 4 },
  resultValue: { lineHeight: 20 },
  vadTimeline: {
    flexDirection: 'row',
    height: 16,
    borderRadius: 4,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: VAD_TRACK_TINT,
  },
  vadBar: { position: 'absolute', top: 0, bottom: 0, borderRadius: 2 },
});
