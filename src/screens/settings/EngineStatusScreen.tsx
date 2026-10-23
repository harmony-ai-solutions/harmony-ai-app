/**
 * EngineStatusScreen — the Settings surface for the embedded engine's status
 * (Settings → Engine → "Engine status").
 *
 * The app embeds the Soulbits Engine (an Android sidecar process / an iOS
 * in-process module). This screen answers the owner's question — "is the
 * engine running, and on which ports?" — and links to the existing log viewer
 * (`EngineLogScreen`, plan 7-11) plus a share-diagnostics action. It also
 * carries the two manual lifecycle controls (restart; Android-only stop), which
 * reuse the app-wide `EngineService`/`EngineLifecycle` surfaces — no new status
 * machinery lives here.
 *
 * Data sources (all reused, none invented):
 *   - connection + lifecycle status + last exit → `EngineService`
 *     (fed by the platform host's readiness/lifecycle events)
 *   - versions → `DeviceInfo.getVersion()`, `getEngineVersionState()` and
 *     `ENGINE_CONTRACT_VERSION` (the SAME probes the About rows use)
 *   - diagnostics export → `shareDiagnosticsReport` (the 7-11 mechanism)
 *
 * Privacy: the loopback token is only ever shown as present/absent — its value
 * is NEVER rendered (it is a per-process secret; the same posture the log
 * viewer and the management client take).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView, Platform, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import DeviceInfo from 'react-native-device-info';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedView } from '../../components/themed/ThemedView';
import { ThemedText } from '../../components/themed/ThemedText';
import { ThemedCard } from '../../components/themed/ThemedCard';
import { SectionHeader } from '../../components/themed/SectionHeader';
import { ScreenHeader } from '../../components/themed/ScreenHeader';
import {
  SettingsDetailRow,
  SettingsLinkRow,
} from '../../components/settings/SettingsRows';
import { ENGINE_CONTRACT_VERSION } from '../../services/engine/engineContract';
import {
  getEngineConnection,
  getEngineStatus,
  getEngineVersionState,
  getLastEngineExit,
  onEngineConnectionChange,
  onEngineExitChange,
  onEngineStatusChange,
  onEngineVersionStateChange,
  restartEngine,
} from '../../services/engine/EngineService';
import { requestEngineStop } from '../../services/engine/EngineLifecycle';
import type { EngineConnection, EngineVersionState } from '../../services/engine/EngineService';
import type { EngineExitInfo, EngineStatus } from '../../types/engineSidecar';
import { shareDiagnosticsReport } from '../../services/diagnostics/shareDiagnostics';
import { createLogger } from '../../utils/logger';

const log = createLogger('[EngineStatusScreen]');

/** App version, or a dash when the native module is unavailable (tests/web). */
function safeAppVersion(): string {
  try {
    return DeviceInfo.getVersion();
  } catch {
    return '—';
  }
}

/** The status label + accent colour for a lifecycle status (or "unknown"). */
function statusMeta(
  status: EngineStatus | null,
  t: (key: string) => string,
  theme: any,
): { label: string; color: string } {
  switch (status) {
    case 'ready':
      return { label: t('state.ready'), color: theme.colors.status.success };
    case 'starting':
      return { label: t('state.starting'), color: theme.colors.status.warning };
    case 'restarting':
      return { label: t('state.restarting'), color: theme.colors.status.warning };
    case 'failed':
      return { label: t('state.failed'), color: theme.colors.status.error };
    case 'stopped':
      return { label: t('state.stopped'), color: theme.colors.text.muted };
    case 'unsupported':
      return { label: t('state.unsupported'), color: theme.colors.text.muted };
    default:
      return { label: t('state.unknown'), color: theme.colors.text.muted };
  }
}

export const EngineStatusScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { theme } = useAppTheme();
  const { t } = useTranslation('engineStatus');

  const [connection, setConnection] = useState<EngineConnection | null>(() =>
    getEngineConnection(),
  );
  const [engineStatus, setEngineStatus] = useState<EngineStatus | null>(() =>
    getEngineStatus(),
  );
  const [lastExit, setLastExit] = useState<EngineExitInfo | null>(() =>
    getLastEngineExit(),
  );
  const [versionState, setVersionState] = useState<EngineVersionState>(() =>
    getEngineVersionState(),
  );
  const [sharing, setSharing] = useState(false);

  // Live subscriptions: connection (readiness), lifecycle status, last exit and
  // the running-engine version. The screen reflects the same single source the
  // rest of the app reads.
  useEffect(() => {
    const offConnection = onEngineConnectionChange(setConnection);
    const offStatus = onEngineStatusChange(setEngineStatus);
    const offExit = onEngineExitChange(setLastExit);
    const offVersion = onEngineVersionStateChange(setVersionState);
    return () => {
      offConnection();
      offStatus();
      offExit();
      offVersion();
    };
  }, []);

  const share = useCallback(async () => {
    if (sharing) return;
    setSharing(true);
    try {
      // Reuse the 7-11 diagnostics mechanism (header + log dump). The status
      // screen has no log rows of its own; the report still carries the
      // app/engine/contract versions + device context.
      await shareDiagnosticsReport({ entries: [], scope: 'full' });
    } catch (err) {
      log.warn('Diagnostics share failed:', err);
    } finally {
      setSharing(false);
    }
  }, [sharing]);

  // Restart uses the SAME deduped surface the boot gate uses. No confirmation:
  // the engine is back in seconds and nothing is lost.
  const restart = useCallback(async () => {
    try {
      await restartEngine();
    } catch (err) {
      log.warn('Engine restart failed:', err);
    }
  }, []);

  // Stop is the one destructive-ish action: confirm once (it ends whatever the
  // engine is doing), then dispatch the lifecycle's existing stop request.
  const confirmStop = useCallback(() => {
    Alert.alert(t('stopConfirmTitle'), t('stopConfirmBody'), [
      { text: t('stopConfirmCancel'), style: 'cancel' },
      {
        text: t('stopConfirmAction'),
        style: 'destructive',
        onPress: () => {
          void requestEngineStop().catch(err => log.warn('Engine stop failed:', err));
        },
      },
    ]);
  }, [t]);

  if (!theme) return null;

  const connected = connection !== null;
  // A live connection IS readiness; otherwise surface the host's lifecycle
  // status (or "not started" when nothing has been observed yet).
  const displayStatus: EngineStatus | null = connected ? 'ready' : engineStatus;
  const meta = statusMeta(displayStatus, t, theme);
  const unknown = t('valueUnknown');
  // The observed lifecycle already says whether an action is running; the rows
  // simply reflect it (no detection of our own).
  const engineBusy = engineStatus === 'starting' || engineStatus === 'restarting';

  const appVersion = safeAppVersion();
  const engineVersion = versionState.engineVersion ?? t('updates:about.unknown');
  const showLastExit = lastExit !== null && (engineStatus === 'failed' || engineStatus === 'restarting');

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader title={t('title')} onBack={() => navigation.goBack()} />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Live engine status ── */}
        <ThemedCard elevated accentStripe style={styles.card}>
          <SectionHeader title={t('statusSection')} style={styles.sectionHeader} />

          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: meta.color }]} />
            <ThemedText size={15} weight="medium" testID="engine-status-state">
              {meta.label}
            </ThemedText>
          </View>

          {connected ? (
            <View testID="engine-status-details">
              <SettingsDetailRow
                icon="ip-network-outline"
                label={t('detail.bind')}
                value={connection.bind || unknown}
                theme={theme}
              />
              <SettingsDetailRow
                icon="web"
                label={t('detail.wsPort')}
                value={String(connection.wsPort)}
                theme={theme}
              />
              <SettingsDetailRow
                icon="shield-lock-outline"
                label={t('detail.wssPort')}
                value={connection.wssPort > 0 ? String(connection.wssPort) : unknown}
                theme={theme}
              />
              <SettingsDetailRow
                icon="server"
                label={t('detail.adminPort')}
                value={String(connection.adminPort)}
                theme={theme}
              />
              <SettingsDetailRow
                icon="identifier"
                label={t('detail.pid')}
                value={connection.pid > 0 ? String(connection.pid) : unknown}
                theme={theme}
              />
              <SettingsDetailRow
                icon="folder-outline"
                label={t('detail.dataDir')}
                value={connection.dataDir || unknown}
                theme={theme}
              />
              <SettingsDetailRow
                icon="key-outline"
                label={t('detail.loopbackToken')}
                value={connection.token ? t('detail.tokenPresent') : t('detail.tokenAbsent')}
                theme={theme}
              />
            </View>
          ) : (
            <View style={styles.hintBox} testID="engine-status-hint">
              <ThemedText variant="secondary" size={13}>
                {engineStatus === 'failed'
                  ? t('hint.failed')
                  : engineStatus === 'starting' || engineStatus === 'restarting'
                  ? t('hint.starting')
                  : t('hint.notStarted')}
              </ThemedText>
            </View>
          )}
        </ThemedCard>

        {/* ── Last exit (failure diagnosis) ── */}
        {showLastExit && lastExit && (
          <ThemedCard elevated accentStripe style={styles.card}>
            <SectionHeader title={t('lastExitSection')} style={styles.sectionHeader} />
            <SettingsDetailRow
              icon="information-outline"
              label={t('lastExit.reason')}
              value={lastExit.expected ? t('lastExit.expected') : t('lastExit.unexpected')}
              theme={theme}
            />
            <SettingsDetailRow
              icon="numeric"
              label={t('lastExit.code')}
              value={lastExit.code === null ? unknown : String(lastExit.code)}
              theme={theme}
            />
            <SettingsDetailRow
              icon="flash-alert-outline"
              label={t('lastExit.signal')}
              value={lastExit.signal === null ? unknown : String(lastExit.signal)}
              theme={theme}
            />
            <SettingsDetailRow
              icon="restart"
              label={t('lastExit.restartAttempt')}
              value={String(lastExit.restartAttempt)}
              theme={theme}
            />
            <SettingsDetailRow
              icon="autorenew"
              label={t('lastExit.willRestart')}
              value={lastExit.willRestart ? t('lastExit.yes') : t('lastExit.no')}
              theme={theme}
            />
          </ThemedCard>
        )}

        {/* ── Versions (same probes as the About rows) ── */}
        <ThemedCard elevated accentStripe style={styles.card}>
          <SectionHeader title={t('versionsSection')} style={styles.sectionHeader} />
          <SettingsDetailRow
            icon="information"
            label={t('versions.app')}
            value={appVersion}
            theme={theme}
          />
          <SettingsDetailRow
            icon="engine-outline"
            label={t('versions.engine')}
            value={engineVersion}
            theme={theme}
          />
          <SettingsDetailRow
            icon="file-code-outline"
            label={t('versions.contract')}
            value={ENGINE_CONTRACT_VERSION}
            theme={theme}
          />
        </ThemedCard>

        {/* ── Actions ── */}
        <ThemedCard elevated accentStripe style={styles.card}>
          <SectionHeader title={t('actionsSection')} style={styles.sectionHeader} />
          <SettingsLinkRow
            icon="refresh"
            label={t('restart')}
            onPress={() => void restart()}
            theme={theme}
            disabled={engineBusy}
            loading={engineBusy}
            testID="engine-status-restart-button"
          />
          {/* Android keeps the sidecar alive in the background, so a manual stop
              needs an explicit control. On iOS the engine already stops when the
              app is backgrounded — no row. */}
          {Platform.OS === 'android' && (
            <SettingsLinkRow
              icon="stop-circle-outline"
              label={t('stop')}
              subtitle={t('stopHint')}
              onPress={confirmStop}
              theme={theme}
              showSeparator
              disabled={engineBusy}
              loading={engineBusy}
              testID="engine-status-stop-button"
            />
          )}
          <SettingsLinkRow
            icon="text-box-search-outline"
            label={t('viewLogs')}
            onPress={() => navigation.navigate('EngineLog')}
            theme={theme}
            showSeparator
          />
          <SettingsLinkRow
            icon="share-variant"
            label={t('share')}
            onPress={() => void share()}
            theme={theme}
            showSeparator
          />
        </ThemedCard>
      </ScrollView>
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
    gap: 16,
  },
  card: {
    gap: 0,
    padding: 0,
    overflow: 'hidden',
  },
  sectionHeader: {
    marginTop: 0,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  hintBox: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
});

export default EngineStatusScreen;
