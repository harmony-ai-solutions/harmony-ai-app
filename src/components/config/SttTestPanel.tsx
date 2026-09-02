/**
 * SttTestPanel — self-contained "Test your configuration" block for STT/VAD
 * config UIs (persona-modules 2-2). Records from the mic → POSTs to the engine
 * test endpoint (phase 1-2 pinned contract) → renders the transcript, duration
 * and VAD segment bars. The engine runs the *configured* provider.
 *
 * Props: `draftConfig` (provider_type / provider_config_id / module_config) and
 * an optional `enabled` flag (defaults true). When offline, it renders an
 * informative "Connect to Harmony Link to test" state — it never fabricates a
 * result.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { useSyncConnection } from '../../contexts/SyncConnectionContext';
// Base tint for the VAD timeline track (bar colors are inline via theme).
const VAD_TRACK_TINT = 'rgba(127,127,127,0.2)';
import { ThemedText } from '../themed/ThemedText';
import { ThemedButton } from '../themed/ThemedButton';
import AudioRecorder from '../../services/AudioRecorder';
import { testStt, ModuleTestError, VadSegment, ModuleTestDraftConfig } from '../../services/voiceInput/moduleTestClient';
import { hapticLightPress } from '../../utils/haptics';
import { createLogger } from '../../utils/logger';

const log = createLogger('[SttTestPanel]');

type RecorderPhase = 'idle' | 'recording' | 'processing' | 'done' | 'error';

interface SttTestPanelProps {
  draftConfig: ModuleTestDraftConfig;
  enabled?: boolean;
}

export interface SttTestPanelResult {
  transcript: string;
  vad_segments: VadSegment[];
  duration_ms: number;
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
  draftConfig,
  enabled = true,
}) => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('voiceInput');
  const { isConnected } = useSyncConnection();

  const [phase, setPhase] = useState<RecorderPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SttTestPanelResult | null>(null);
  const [recordingMs, setRecordingMs] = useState(0);
  const recordingStartRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const handleStart = useCallback(async () => {
    if (!enabled || isBusy) return;
    try {
      hapticLightPress();
      await AudioRecorder.startRecording();
      setPhase('recording');
      setError(null);
      setResult(null);
      startTimer();
    } catch (err: any) {
      setPhase('error');
      setError(t('permissionDenied'));
      log.error('Failed to start recording:', err);
    }
  }, [enabled, isBusy, startTimer, t]);

  const handleStop = useCallback(async () => {
    if (phase !== 'recording') return;
    try {
      stopTimer();
      const recorded = await AudioRecorder.stopRecording();
      setPhase('processing');
      const res = await testStt(draftConfig, recorded.data, recorded.mimeType);
      setResult(res);
      setPhase('done');
    } catch (err: any) {
      setPhase('error');
      setError(
        err instanceof ModuleTestError
          ? err.message
          : t('testError', { message: err?.message ?? '' }),
      );
      log.error('STT test failed:', err);
    }
  }, [phase, draftConfig, stopTimer, t]);

  const handlePress = useCallback(() => {
    if (phase === 'recording') {
      handleStop();
    } else {
      handleStart();
    }
  }, [phase, handleStart, handleStop]);

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
      {/* ── Record / Stop button ── */}
      <View style={styles.actionsRow}>
        <ThemedButton
          label={
            phase === 'recording'
              ? t('stopButton')
              : phase === 'processing'
                ? t('processing')
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
      </View>

      {/* ── Result: transcript / duration / VAD bars ── */}
      {phase === 'done' && result && (
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
