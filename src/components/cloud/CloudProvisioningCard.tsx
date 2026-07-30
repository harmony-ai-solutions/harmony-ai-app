/**
 * CloudProvisioningCard — coarse-stage provisioning visualisation.
 *
 * Maps CloudSessionStatus + WS-connected state to a single coarse UI stage
 * (NO sub-phase labels — decision 3). Shows elapsed time during provisioning,
 * and a Retry CTA on failed.
 *
 * "Connected ✓" derives from `isConnected` (WS layer via useSyncConnection),
 * NOT from a cloud-session status (decision 2).
 */

import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { StatusPulseDot, type RadarState } from './StatusPulseDot';
import { ThemedText } from '../themed/ThemedText';
import { ThemedButton } from '../themed/ThemedButton';
import type {
  CloudSessionStatus,
  CloudSessionInfo,
} from '../../services/cloud/CloudSessionService';

// ── Pure helpers (exported for testability) ───────────────────────────────

/**
 * Maps CloudSessionStatus + WS state to a RadarState for the pulse dot.
 * Coarse stages only — no sub-phase labels.
 */
export function classifyCloudStage(
  status: CloudSessionStatus,
  isConnected: boolean,
): RadarState {
  switch (status) {
    case 'idle':
      return 'idle';
    case 'requesting':
      return 'connecting';
    case 'provisioning':
      return 'waiting';
    case 'ready':
      return isConnected ? 'connected' : 'connecting';
    case 'failed':
      return 'error';
    default:
      return 'idle';
  }
}

/**
 * Calculate elapsed seconds between two timestamps.
 * Pure function — no side effects; easy to test.
 */
export function calcElapsedSeconds(
  requestedAt?: number,
  stoppedAt?: number,
): number {
  if (!requestedAt) return 0;
  const end = stoppedAt ?? Date.now();
  return Math.max(0, Math.floor((end - requestedAt) / 1000));
}

// ── Hook ─────────────────────────────────────────────────────────────────

/**
 * Elapsed timer hook — ticks every second while provisioning is active.
 * Returns elapsed seconds since `requestedAt`, stopping at `stoppedAt`.
 */
export function useElapsed(
  requestedAt?: number,
  stoppedAt?: number,
): number {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!requestedAt) {
      setElapsed(0);
      return;
    }

    const tick = () => {
      setElapsed(calcElapsedSeconds(requestedAt, stoppedAt));
    };

    tick();
    if (!stoppedAt) {
      const interval = setInterval(tick, 1000);
      return () => clearInterval(interval);
    }
  }, [requestedAt, stoppedAt]);

  return elapsed;
}

// ── Component ────────────────────────────────────────────────────────────

export type { CloudSessionStatus, CloudSessionInfo };

interface CloudProvisioningCardProps {
  /** Current cloud session status from CloudSessionService. */
  status: CloudSessionStatus;
  /** Optional info payload with session metadata. */
  info?: CloudSessionInfo;
  /** Whether the sync WebSocket is currently connected. */
  isConnected: boolean;
  /** Called when the user taps Retry (only shown on failed). */
  onRetry: () => void;
  /** Disables the Retry button while a retry is in flight. */
  isRetrying: boolean;
  /** Theme accent color for the pulse dot. */
  accentColor: string;
  /**
   * Translation function bound to the `auth` namespace.
   * Passed in so parent can use whichever t-factory suits; if omitted
   * the component falls back to a simple internal map (EN only).
   */
  ta?: (key: string, opts?: Record<string, any>) => string;
}

/**
 * Fallback EN-only labels when no ta() is provided (e.g. in tests).
 */
const FALLBACK_LABELS: Record<string, string> = {
  cloud_idle: 'Disconnected',
  cloud_requesting: 'Requesting secure session…',
  cloud_preparing: 'Preparing secure session…',
  cloud_establishing: 'Establishing secure connection…',
  cloud_connected: 'Connected ✓',
  cloud_failed_prefix: 'Couldn\'t start session: ',
  cloud_retry: 'Retry',
  cloud_elapsed_active: 'Preparing for {{seconds}}s',
  cloud_elapsed_done: 'Ready in {{seconds}}s',
};

const fallbackTa = (key: string, opts?: Record<string, any>): string => {
  let msg = FALLBACK_LABELS[key] ?? key;
  if (opts?.seconds !== undefined) {
    msg = msg.replace('{{seconds}}', String(opts.seconds));
  }
  if (opts?.reason !== undefined) {
    msg = msg.replace('{{reason}}', String(opts.reason));
  }
  return msg;
};

export const CloudProvisioningCard: React.FC<CloudProvisioningCardProps> = ({
  status,
  info,
  isConnected,
  onRetry,
  isRetrying,
  accentColor,
  ta,
}) => {
  const t = ta ?? fallbackTa;
  const radarState = classifyCloudStage(status, isConnected);

  // Stop the timer when ready or on failed
  const stopAt =
    status === 'ready' ? info?.readyAt : undefined;

  const elapsed = useElapsed(info?.requestedAt, stopAt);

  // ── Stage label ──
  let stageLabel: string;
  switch (status) {
    case 'idle':
      stageLabel = t('cloud_idle');
      break;
    case 'requesting':
      stageLabel = t('cloud_requesting');
      break;
    case 'provisioning':
      stageLabel = t('cloud_preparing');
      break;
    case 'ready':
      stageLabel = isConnected
        ? t('cloud_connected')
        : t('cloud_establishing');
      break;
    case 'failed':
      stageLabel = `${t('cloud_failed_prefix')}${info?.failureReason ?? ''}`;
      break;
    default:
      stageLabel = '';
  }

  // Determine if the elapsed counter should be shown
  const showElapsed =
    status === 'provisioning' ||
    (elapsed > 0 && status === 'ready');

  return (
    <View style={styles.card} accessibilityRole="alert" accessibilityLabel={stageLabel}>
      <View style={styles.statusRow}>
        <StatusPulseDot
          radarState={radarState}
          accentColor={accentColor}
          size={8}
          glowSize={12}
        />
        <ThemedText
          size={12}
          variant={radarState === 'error' ? 'primary' : 'secondary'}
          style={[
            styles.statusText,
            radarState === 'error' && { color: '#F44336' },
          ]}
        >
          {stageLabel}
        </ThemedText>
      </View>

      {/* Elapsed counter — shown during provisioning or after ready */}
      {showElapsed && (
        <ThemedText size={11} variant="muted" style={styles.elapsed}>
          {status === 'provisioning'
            ? t('cloud_elapsed_active', { seconds: elapsed })
            : t('cloud_elapsed_done', { seconds: elapsed })}
        </ThemedText>
      )}

      {/* Retry button on failed */}
      {status === 'failed' && (
        <ThemedButton
          label={t('cloud_retry')}
          onPress={onRetry}
          variant="outline"
          disabled={isRetrying}
          style={styles.retryButton}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    width: '100%',
    alignItems: 'center',
    paddingVertical: 8,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusText: {
    textAlign: 'center',
  },
  elapsed: {
    marginTop: 4,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 12,
    alignSelf: 'center',
    minWidth: 160,
  },
});
