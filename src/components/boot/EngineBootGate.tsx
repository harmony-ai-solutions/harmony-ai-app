/**
 * EngineBootGate — holds the branded splash until the embedded engine reports
 * ready (owner ruling 2026-10-18).
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The app UI mounts as soon as the app data layer hydrates (feature flags only —
 * see `DatabaseContext`), but the embedded engine boots in the BACKGROUND
 * (`attachEngineLifecycle`). After an install/update the engine can take ~13s to
 * come up (it may adopt a staged backup restore and re-encrypt the DB), so the
 * user used to land on empty/loading screens with no explanation. This gate
 * holds the branded splash over the whole navigation tree until the engine is
 * actually usable.
 *
 * ── Placement ───────────────────────────────────────────────────────────────
 * Wired in `App.tsx` AROUND `<AppNavigator>` (inside `AppShell`), so it wraps the
 * entire navigation tree — including `AuthGate`, which lives at the root of the
 * navigator. The engine gate is therefore OUTSIDE AuthGate: the boot splash is
 * the first thing visible, and only once the engine is ready does the navigator
 * (and AuthGate's own store splash) mount. Providers that must boot regardless
 * (DatabaseContext's engine-lifecycle attach, the update check, the backup
 * headless task) live ABOVE this gate and are unaffected.
 *
 * ── Status handling (owner ruling 2026-10-18) ────────────────────────────────
 *   ready                       → release (render children); latched, never re-gated
 *   null | starting | restarting | stopped | unsupported
 *                               → keep the splash with the status label
 *   failed                      → one automatic `restartEngine()`; a SECOND
 *                                 failure (or an auto-retry that rejects)
 *                                 surfaces the error panel with Retry +
 *                                 share-diagnostics, and waits for a manual retry
 *
 * `restartEngine()` already dedupes concurrent calls; the auto-retry is driven
 * from an effect (never re-entrantly from the status listener) and is guarded so
 * it fires at most once per boot.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedView } from '../themed/ThemedView';
import { ThemedText } from '../themed/ThemedText';
import { ThemedButton } from '../themed/ThemedButton';
import {
  getEngineStatus,
  onEngineStatusChange,
  restartEngine,
} from '../../services/engine/EngineService';
import { shareDiagnosticsReport } from '../../services/diagnostics/shareDiagnostics';
import { createLogger } from '../../utils/logger';
import type { EngineStatus } from '../../types/engineSidecar';
import { BootSplash } from './BootSplash';

const log = createLogger('[EngineBootGate]');

interface EngineBootGateProps {
  children: React.ReactNode;
}

export const EngineBootGate: React.FC<EngineBootGateProps> = ({ children }) => {
  const { t } = useTranslation('boot');
  const { theme } = useAppTheme();

  // Fast path: an already-ready engine releases immediately with no flash. The
  // `released` latch is one-way — once the app is usable a later runtime crash
  // must NOT yank the user back to the splash (that is the app's own concern).
  const [released, setReleased] = useState(() => getEngineStatus() === 'ready');
  const [status, setStatus] = useState<EngineStatus | null>(() => getEngineStatus());
  // Shown only for a FINAL failure (the second 'failed', or an auto-retry that
  // rejected outright). The first failure auto-retries and keeps the splash.
  const [errorVisible, setErrorVisible] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [sharing, setSharing] = useState(false);

  // Guards (refs so they never re-trigger renders / effects):
  //  - the single automatic retry is spent at most once per boot.
  //  - the current 'failed' episode is handled at most once.
  //  - a retry is never stacked (restartEngine also dedupes, belt-and-braces).
  const autoRetryUsedRef = useRef(false);
  const failedHandledRef = useRef(false);
  const retryInFlightRef = useRef(false);

  // ── Status subscription (skipped once released) ───────────────────────────
  useEffect(() => {
    if (released) return;
    const off = onEngineStatusChange(next => {
      setStatus(next);
      if (next === 'ready') setReleased(true);
    });
    return off;
  }, [released]);

  // ── Retry action (shared by the auto-retry and the panel button) ──────────
  const doRetry = useCallback(async () => {
    if (retryInFlightRef.current) return;
    retryInFlightRef.current = true;
    setRetrying(true);
    try {
      await restartEngine();
      // Success publishes a fresh connection → the status listener flips us to
      // 'ready' and the gate releases. Nothing else to do here.
    } catch (err) {
      // The retry itself failed (the host start rejected). There may be no
      // further 'failed' event to wait for, so surface the panel directly.
      log.warn('Engine restart failed:', err);
      setErrorVisible(true);
    } finally {
      retryInFlightRef.current = false;
      setRetrying(false);
    }
  }, []);

  // ── Failure policy: auto-retry once, then require a manual retry ──────────
  useEffect(() => {
    if (released) return;
    if (status !== 'failed') {
      // Leaving the failed state ends the episode, so a later failure is a NEW
      // one (and is eligible to show the panel).
      failedHandledRef.current = false;
      return;
    }
    if (failedHandledRef.current) return;
    failedHandledRef.current = true;

    if (!autoRetryUsedRef.current) {
      autoRetryUsedRef.current = true;
      // First failure: one automatic retry, splash stays up while it runs.
      void doRetry();
    } else {
      // A failure AFTER the auto-retry was spent → the panel.
      setErrorVisible(true);
    }
  }, [status, released, doRetry]);

  const handleShareDiagnostics = useCallback(async () => {
    if (sharing) return;
    setSharing(true);
    try {
      // Reuse the 7-11 diagnostics mechanism (the same one the Engine status
      // screen and log viewer use).
      await shareDiagnosticsReport({ entries: [], scope: 'full' });
    } catch (err) {
      log.warn('Diagnostics share failed:', err);
    } finally {
      setSharing(false);
    }
  }, [sharing]);

  // ── Render ────────────────────────────────────────────────────────────────
  if (released) {
    return <>{children}</>;
  }

  if (status === 'failed' && errorVisible) {
    return (
      <ThemedView variant="base" style={styles.panel} testID="engine-boot-error">
        <View style={styles.panelBody}>
          <ThemedText weight="bold" size={30} hierarchy="header" style={styles.brand}>
            Soulbits
          </ThemedText>

          <Icon
            name="alert-circle-outline"
            size={44}
            color={theme?.colors.status?.error ?? '#ff5252'}
            style={styles.icon}
          />

          <ThemedText
            variant="primary"
            size={20}
            weight="bold"
            hierarchy="header"
            style={styles.title}
          >
            {t('engineFailed')}
          </ThemedText>
          <ThemedText variant="secondary" size={14} style={styles.body}>
            {t('engineFailedBody')}
          </ThemedText>

          <View style={styles.actions}>
            <ThemedButton
              label={t('retry')}
              onPress={() => void doRetry()}
              disabled={retrying}
              icon="refresh"
              testID="engine-boot-retry"
            />
            <ThemedButton
              label={t('copyDiagnostics')}
              variant="secondary"
              onPress={() => void handleShareDiagnostics()}
              disabled={sharing}
              icon="share-variant"
              testID="engine-boot-diagnostics"
            />
          </View>
        </View>
      </ThemedView>
    );
  }

  // Booting: null / starting / restarting / stopped / unsupported all hold the
  // splash. 'stopped' deliberately reuses the SAME label (never dead-ends on a
  // "stopped" message while the engine is still coming up).
  return <BootSplash label={t('startingEngine')} testIDPrefix="engine-boot-splash" />;
};

const styles = StyleSheet.create({
  panel: {
    flex: 1,
  },
  panelBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  brand: {
    letterSpacing: 1,
    marginBottom: 24,
  },
  icon: {
    marginBottom: 16,
  },
  title: {
    textAlign: 'center',
    marginBottom: 8,
  },
  body: {
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 28,
  },
  actions: {
    width: '100%',
    maxWidth: 420,
    gap: 12,
  },
});

export default EngineBootGate;
