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
 * When offline it renders an informative "Connect to Soulbits Engine to test"
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
import { ThemedText } from '../themed/ThemedText';
import AudioRecorder from '../../services/AudioRecorder';
import ChatPreferencesService from '../../services/ChatPreferencesService';
import { resolvePersonaId } from '../../database/repositories';
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
  // Live AutoVAD (`STT_SPEECH_STARTED` / `STT_SPEECH_STOPPED`) state + segments.
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [liveVadSegments, setLiveVadSegments] = useState<VadSegment[]>([]);
  const recordingStartRef = useRef(0);
  const streamStartRef = useRef(0);
  const vadStartRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamHandleRef = useRef<AudioStreamHandle | null>(null);
  const unsubPcmRef = useRef<(() => void) | null>(null);

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
  /**
   * Handle one AutoVAD gate transition. `timestampMs` is the local receipt time;
   * segments are tracked relative to the stream start so the timeline bars are
   * meaningful regardless of wall-clock offsets.
   */
  const handleVoiceActivity = useCallback((speaking: boolean, timestampMs: number) => {
    const start = streamStartRef.current || timestampMs;
    const elapsed = Math.max(0, timestampMs - start);
    if (speaking) {
      if (vadStartRef.current === null) vadStartRef.current = elapsed;
      setIsVoiceActive(true);
      return;
    }
    setIsVoiceActive(false);
    if (vadStartRef.current === null) return;
    const segmentStart = vadStartRef.current;
    vadStartRef.current = null;
    setLiveVadSegments((prev) => [
      ...prev,
      { start_ms: segmentStart, end_ms: Math.max(segmentStart, elapsed) },
    ]);
  }, []);

  const startLive = useCallback(async () => {
    // Start timestamp BEFORE opening the stream so early VAD events land
    // relative to the true stream start.
    streamStartRef.current = Date.now();
    vadStartRef.current = null;
    setLiveVadSegments([]);
    setIsVoiceActive(false);

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
      onVoiceActivity: handleVoiceActivity,
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
  }, [resolveTestEntityId, startTimer, handleVoiceActivity]);

  const stopLive = useCallback(async () => {
    // Close an utterance that was still active when the user stopped.
    if (vadStartRef.current !== null) {
      const segmentStart = vadStartRef.current;
      vadStartRef.current = null;
      const segmentEnd = Math.max(
        segmentStart,
        Date.now() - (streamStartRef.current || Date.now()),
      );
      setLiveVadSegments((prev) => [
        ...prev,
        { start_ms: segmentStart, end_ms: segmentEnd },
      ]);
    }
    setIsVoiceActive(false);
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
      setLiveVadSegments([]);
      setIsVoiceActive(false);
      vadStartRef.current = null;
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

  if (!theme) return null;

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
  // Live timeline: span the recorded duration (or the last segment end) so bars
  // appear in real time, before the 1s recording tick.
  const lastLiveSegmentEnd = liveVadSegments.reduce(
    (max, segment) => Math.max(max, segment.end_ms),
    0,
  );
  const liveBars = computeVadBars(
    liveVadSegments,
    Math.max(recordingMs, lastLiveSegmentEnd, 1),
  );

  return (
    <View style={styles.wrapper}>
      {/* ── Mode bar (Live AutoVAD / One-Shot) ── */}
      <View style={styles.headerRow}>
        <ThemedText size={10.5} style={styles.sectionLabel}>
          Stream Mode
        </ThemedText>
        <View style={styles.modeSegmented}>
          {(['live', 'quick'] as TestMode[]).map((m) => (
            <TouchableOpacity
              key={m}
              style={[styles.modeSegment, mode === m ? styles.modeSegmentActive : null]}
              onPress={() => {
                if (phase !== 'recording' && phase !== 'processing') {
                  hapticLightPress();
                  setMode(m);
                  setError(null);
                  setResult(null);
                  setLiveText('');
                  setLiveVadSegments([]);
                  setIsVoiceActive(false);
                  vadStartRef.current = null;
                }
              }}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityState={{ selected: mode === m }}
              testID={`stt-mode-${m}`}
            >
              <ThemedText
                size={10}
                style={mode === m ? styles.modeSegmentActiveText : styles.modeSegmentText}
              >
                {m === 'live' ? 'Live AutoVAD' : 'One-Shot'}
              </ThemedText>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* ── Dark AutoVAD status pill with glowing dot ── */}
      {mode === 'live' ? (
        <View testID="stt-live-vad-status" style={styles.vadPill}>
          <View
            style={[
              styles.glowDot,
              {
                backgroundColor: isVoiceActive ? '#22C55E' : '#F59E0B',
                shadowColor: isVoiceActive ? '#22C55E' : '#F59E0B',
              },
            ]}
          />
          <ThemedText
            size={11}
            numberOfLines={1}
            style={[
              styles.vadPillText,
              { color: isVoiceActive ? '#4ADE80' : '#94A3B8' },
            ]}
          >
            {isVoiceActive
              ? 'STT_SPEECH_STARTED · Voice Detected'
              : 'STT_SPEECH_STOPPED · Waiting for voice…'}
          </ThemedText>
          {phase === 'recording' && liveListening ? (
            <ThemedText size={9.5} style={styles.listeningText}>
              {t('liveListening')}
            </ThemedText>
          ) : null}
        </View>
      ) : null}

      {/* ── Live VAD speech segments ── */}
      {mode === 'live' ? (
        <View style={styles.vadSection}>
          <View style={styles.vadLabelRow}>
            <ThemedText size={10.5} style={styles.vadLabel}>
              Live VAD Speech Segments
            </ThemedText>
            <ThemedText size={10} style={styles.vadCount}>
              {`${liveVadSegments.length} utterances`}
            </ThemedText>
          </View>
          <View style={styles.vadTimeline} testID="stt-vad-timeline">
            {liveBars.map((b, i) => (
              <View
                key={i}
                testID={`stt-live-vad-bar-${i}`}
                style={[
                  styles.vadBar,
                  { left: `${b.left}%`, width: `${b.width}%` },
                ]}
              />
            ))}
          </View>
        </View>
      ) : null}

      {/* ── Live transcript → dark `sh-textarea` box ── */}
      {mode === 'live' ? (
        <View style={styles.transcriptBox}>
          <ThemedText size={9.5} style={styles.transcriptHint}>
            [transcribed on speech stop]
          </ThemedText>
          <ThemedText size={11.5} style={styles.transcriptText} testID="stt-live-transcript">
            {liveText || t('emptyTranscript')}
          </ThemedText>
        </View>
      ) : null}

      {/* ── Quick result: transcript / duration / VAD bars ── */}
      {phase === 'done' && mode === 'quick' && result && (
        <View style={styles.resultSection}>
          <View style={styles.transcriptBox}>
            <ThemedText size={9.5} style={styles.transcriptHint}>
              {`${result.duration_ms} ms · ${t('transcriptLabel')}`}
            </ThemedText>
            <ThemedText size={11.5} style={styles.transcriptText} testID="stt-transcript">
              {result.transcript || t('emptyTranscript')}
            </ThemedText>
          </View>
          <View style={styles.vadSection}>
            <View style={styles.vadLabelRow}>
              <ThemedText size={10.5} style={styles.vadLabel}>
                {t('vadLabel')}
              </ThemedText>
            </View>
            {bars.length === 0 ? (
              <ThemedText size={10.5} style={styles.emptyVadText}>
                {t('noVadSegments')}
              </ThemedText>
            ) : (
              <View style={styles.vadTimeline} testID="stt-vad-timeline">
                {bars.map((b, i) => (
                  <View
                    key={i}
                    style={[
                      styles.vadBar,
                      { left: `${b.left}%`, width: `${b.width}%` },
                    ]}
                  />
                ))}
              </View>
            )}
          </View>
        </View>
      )}

      {/* ── Start / Stop realtime stream ── */}
      <TouchableOpacity
        testID="stt-record-button"
        onPress={handlePress}
        disabled={phase === 'processing' || !enabled}
        accessibilityRole="button"
        style={[
          styles.recordButton,
          phase === 'recording' ? styles.recordButtonActive : null,
          phase === 'processing' || !enabled ? styles.disabled : null,
        ]}
      >
        {phase === 'processing' ? (
          <ActivityIndicator size="small" color="#E879F9" />
        ) : null}
        <ThemedText
          size={11.5}
          numberOfLines={1}
          style={phase === 'recording' ? styles.recordButtonActiveText : styles.recordButtonText}
        >
          {phase === 'recording'
            ? `⏹ ${t('stopButton')}`
            : phase === 'processing'
              ? t('processing')
              : mode === 'live'
                ? `🎙️ ${t('liveRecordButton')}`
                : `🎙️ ${t('recordButton')}`}
        </ThemedText>
        {phase === 'recording' && mode === 'live' ? (
          <ThemedText size={10} style={styles.recordDuration}>
            {`${Math.round(recordingMs / 1000)}s`}
          </ThemedText>
        ) : null}
      </TouchableOpacity>

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
  wrapper: { gap: 8 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  sectionLabel: {
    flex: 1,
    color: '#94A3B8',
    fontWeight: '600',
  },
  offlineRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  offlineText: { flex: 1 },
  modeSegmented: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: '#070B14',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.16)',
    borderRadius: 8,
    padding: 2,
  },
  modeSegment: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  modeSegmentActive: {
    backgroundColor: 'rgba(232, 121, 249, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(232, 121, 249, 0.38)',
  },
  modeSegmentText: { color: '#64748B', fontWeight: '600' },
  modeSegmentActiveText: { color: '#E879F9', fontWeight: '700' },

  // ── AutoVAD status pill (`stt-live-vad-status`) ──
  vadPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: 'rgba(7, 11, 20, 0.7)',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.16)',
    borderRadius: 9,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  glowDot: {
    width: 9,
    height: 9,
    borderRadius: 999,
    shadowOpacity: 0.9,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  vadPillText: { flex: 1, fontWeight: '700' },
  listeningText: { color: '#E879F9', fontWeight: '600' },

  // ── VAD timeline (`vad-track`) ──
  vadSection: { gap: 5 },
  vadLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  vadLabel: { color: '#CBD5E1', fontWeight: '600' },
  vadCount: { color: '#4ADE80', fontWeight: '600' },
  vadTimeline: {
    flexDirection: 'row',
    height: 20,
    borderRadius: 6,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.16)',
    backgroundColor: 'rgba(148, 163, 184, 0.14)',
  },
  vadBar: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    borderRadius: 4,
    backgroundColor: '#22C55E',
    opacity: 0.85,
  },
  emptyVadText: { color: '#64748B' },

  // ── Transcript (`sh-textarea`) ──
  transcriptBox: {
    backgroundColor: '#070B14',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.16)',
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingVertical: 8,
    gap: 3,
    minHeight: 52,
  },
  transcriptHint: { color: '#64748B' },
  transcriptText: { color: '#E2E8F0', lineHeight: 17 },
  resultSection: { gap: 8 },

  // ── Start / stop button (`btn-outline-dark`) ──
  recordButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    width: '100%',
    backgroundColor: 'rgba(15, 22, 38, 0.9)',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 9,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  recordButtonActive: {
    backgroundColor: 'rgba(236, 72, 153, 0.14)',
    borderColor: 'rgba(236, 72, 153, 0.5)',
  },
  recordButtonText: { color: '#E879F9', fontWeight: '600' },
  recordButtonActiveText: { color: '#f472b6', fontWeight: '600' },
  recordDuration: { color: '#94A3B8', fontWeight: '600' },
  disabled: { opacity: 0.55 },
});
