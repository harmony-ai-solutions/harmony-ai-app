/**
 * UpdateDownloadModal — the themed in-app APK download dialog ("Auto-Update UX
 * phases 1+2").
 *
 * PRESENTATIONAL by design: it never imports `apkSelfUpdate`. It receives the
 * service's observable snapshot (structurally — see {@link UpdateDownloadModalState})
 * plus callbacks, so the whole dialog can be rendered from a fixture in tests.
 * `UpdatePrompt` owns the wiring; this file owns the pixels.
 *
 * Visual language mirrors AppAlertModal exactly (obsidian-glass LinearGradient
 * card, gradient accent stripe, 1dp gradient borders, ThemedText / ThemedButton,
 * MaterialCommunityIcons badge) so the update flow reads as part of the same
 * dialog family rather than a bolted-on screen.
 *
 * The dialog is NEVER backdrop-dismissable: there is no `onDismiss` — the
 * service's phase drives whether it exists at all (`idle` renders nothing), and
 * Cancel/Install/Retry are the only exits. That keeps the UI and the service
 * from desyncing (a "closed" modal would simply re-open on the next emission).
 *
 * Phases (`state.phase`):
 *   - `downloading`  — title + download icon, version pill, determinate bar with
 *     `23.5 MB / 50.1 MB · 47%` meta, or an ActivityIndicator + bytes-only meta
 *     when the server reported no total (`percent === null`) — plus Cancel.
 *   - `ready`        — ✓-complete pill + version, bar at 100%, `50.1 MB ·
 *     complete` meta, primary Install.
 *   - `installing`   — the ready card with a disabled "Installing…" button and a
 *     small inline spinner (the system installer owns the screen from here).
 *   - `failed`       — generic failures show `installFailed` + Retry/Cancel; the
 *     {@link INSTALL_PERMISSION_REQUIRED} sentinel shows `permissionNeeded` with
 *     Cancel / Open settings / Retry (Retry re-checks the permission, so it
 *     proceeds once the user granted it in the system settings).
 */

import React from 'react';
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';
import { ThemedText } from '../themed/ThemedText';
import { ThemedButton } from '../themed/ThemedButton';
import { useAppTheme } from '../../contexts/ThemeContext';

// ── Types ───────────────────────────────────────────────────────────────

/**
 * The download phase as this dialog understands it. Mirrors the service's
 * `ApkDownloadPhase` (including `idle`, so the parent can pass its state object
 * through without a cast) — `idle` renders nothing.
 */
export type UpdateDownloadPhase =
  | 'idle'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'failed';

/** Structural copy of the service's `ApkDownloadProgress` (extra fields are fine). */
export interface UpdateDownloadProgress {
  version: string;
  bytesFetched: number;
  /** null when the server did not report a total → indeterminate bar. */
  contentLength: number | null;
  /** 0–100, or null when the total is unknown. */
  percent: number | null;
}

/** Structural copy of the service's `ApkDownloadState`. */
export interface UpdateDownloadModalState {
  phase: UpdateDownloadPhase;
  progress: UpdateDownloadProgress | null;
  error: string | null;
}

export interface UpdateDownloadModalProps {
  /** The current download snapshot (service state, passed through verbatim). */
  state: UpdateDownloadModalState;
  /** Cancel the download (or leave the failed card). */
  onCancel: () => void;
  /** Launch the system installer for the `ready` artifact. */
  onInstall: () => void;
  /** Retry the download after a failure (also re-checks the install permission). */
  onRetry: () => void;
  /** Open the per-app "install unknown apps" settings page. */
  onOpenSettings: () => void;
  /**
   * The service's `INSTALL_PERMISSION_REQUIRED` sentinel. Injected (with the
   * real value as the default) so this presentation component keeps zero
   * imports from the service while still recognising the permission case.
   */
  permissionErrorCode?: string;
}

// ── Byte formatting ─────────────────────────────────────────────────────

const BYTES_PER_KB = 1024;
const BYTES_PER_MB = 1024 * 1024;
const BYTES_PER_GB = 1024 * 1024 * 1024;

/**
 * Human-readable byte count for the progress meta line: `512 B`, `1.5 KB`,
 * `23.5 MB`, `1.2 GB`. Always one decimal above the byte tier so the digits do
 * not jump width while the download runs (paired with `tabular-nums`).
 * Non-finite / non-positive values degrade to `0 B` rather than `NaN MB`.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < BYTES_PER_KB) return `${Math.round(bytes)} B`;
  if (bytes < BYTES_PER_MB) return `${(bytes / BYTES_PER_KB).toFixed(1)} KB`;
  if (bytes < BYTES_PER_GB) return `${(bytes / BYTES_PER_MB).toFixed(1)} MB`;
  return `${(bytes / BYTES_PER_GB).toFixed(1)} GB`;
}

// ── Component ───────────────────────────────────────────────────────────

export const UpdateDownloadModal: React.FC<UpdateDownloadModalProps> = ({
  state,
  onCancel,
  onInstall,
  onRetry,
  onOpenSettings,
  permissionErrorCode = 'install_permission_required',
}) => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('updates');

  if (!theme || state.phase === 'idle') return null;

  const { phase, progress, error } = state;
  const isFailure = phase === 'failed';
  const isPermissionFailure = isFailure && error === permissionErrorCode;
  const isReadyish = phase === 'ready' || phase === 'installing';
  const isInstalling = phase === 'installing';
  const percent = progress?.percent ?? null;

  // ── Palette ────────────────────────────────────────────────────────────
  const accent = theme.colors.accent.primary;
  const accentSecondary =
    theme.colors.accent.secondary ?? theme.colors.accent.primaryHover;
  const statusColor = isFailure
    ? theme.colors.status.error
    : isReadyish
    ? theme.colors.status.success
    : accent;
  const stripeColors: [string, string] = isFailure
    ? [theme.colors.status.error, theme.colors.status.error]
    : isReadyish
    ? [theme.colors.status.success, theme.colors.status.success]
    : [accent, accentSecondary];
  const tintColor = isFailure
    ? theme.colors.status.error
    : isReadyish
    ? theme.colors.status.success
    : accent;

  // ── Copy ──────────────────────────────────────────────────────────────
  const title = isFailure
    ? t('selfUpdate.failedTitle')
    : isReadyish
    ? t('selfUpdate.readyTitle')
    : t('selfUpdate.downloadingTitle');

  let body: string | null = null;
  if (isFailure) {
    body = isPermissionFailure
      ? t('selfUpdate.permissionNeeded')
      : t('selfUpdate.installFailed', { message: error ?? '' });
  } else if (isReadyish && progress) {
    body = t('selfUpdate.readyBody', { version: progress.version });
  }

  let meta: string | null = null;
  if (progress && !isFailure) {
    if (isReadyish) {
      meta = t('selfUpdate.readyMeta', {
        size: formatBytes(progress.contentLength ?? progress.bytesFetched),
      });
    } else if (percent != null && progress.contentLength != null) {
      meta = t('selfUpdate.progressMeta', {
        downloaded: formatBytes(progress.bytesFetched),
        total: formatBytes(progress.contentLength),
        percent,
      });
    } else {
      meta = t('selfUpdate.progressMetaNoTotal', {
        downloaded: formatBytes(progress.bytesFetched),
      });
    }
  }

  const iconName = isFailure
    ? isPermissionFailure
      ? 'shield-alert'
      : 'alert-circle'
    : isReadyish
    ? 'check-circle'
    : 'download';

  // Determinate fill width (typed as a percentage string for RN's DimensionValue).
  const clampedPercent = Math.min(100, Math.max(0, percent ?? 0));
  const fillWidth: `${number}%` = `${clampedPercent}%`;

  return (
    <Modal
      visible={true}
      transparent={true}
      animationType="fade"
      // Android back: while downloading it means "cancel" (the same promise the
      // Cancel button makes); elsewhere the service phase owns the dialog.
      onRequestClose={phase === 'downloading' ? onCancel : undefined}
    >
      {/* ── Overlay — backdrop taps are inert (no onDismiss by design) ── */}
      <View style={styles.overlay}>
        <TouchableWithoutFeedback onPress={() => {}}>
          <View style={styles.modalShadow} testID="update-download-modal">
            {/* ── Obsidian Glass card background ── */}
            <LinearGradient
              colors={[
                theme.colors.background.elevated,
                theme.colors.background.surface,
              ]}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={styles.modal}
            >
              {/* Prismatic tint overlay */}
              <LinearGradient
                colors={[tintColor + '10', 'transparent']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0.6 }}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              />

              {/* ── Accent stripe at top ── */}
              <LinearGradient
                colors={stripeColors}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.accentStripe}
              />

              {/* ── Icon badge ── */}
              <View style={styles.iconContainer}>
                <LinearGradient
                  colors={[statusColor + '22', statusColor + '10']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.iconBadge}
                >
                  <Icon name={iconName} size={28} color={statusColor} />
                </LinearGradient>
              </View>

              {/* ── Title ── */}
              <ThemedText size={18} weight="bold" style={styles.title}>
                {title}
              </ThemedText>

              {/* ── Pills: completion state + version ── */}
              {progress ? (
                <View style={styles.pillRow}>
                  {isReadyish ? (
                    <View
                      style={[
                        styles.pill,
                        {
                          borderColor: theme.colors.status.success + '55',
                          backgroundColor: theme.colors.status.success + '18',
                        },
                      ]}
                    >
                      <Icon
                        name="check"
                        size={13}
                        color={theme.colors.status.success}
                      />
                      <ThemedText
                        size={12}
                        weight="medium"
                        style={{ color: theme.colors.status.success }}
                      >
                        {t('selfUpdate.complete')}
                      </ThemedText>
                    </View>
                  ) : null}
                  <View
                    style={[
                      styles.pill,
                      {
                        borderColor: theme.colors.border.default,
                        backgroundColor: theme.colors.background.base + '66',
                      },
                    ]}
                  >
                    <ThemedText variant="secondary" size={12} weight="medium">
                      {progress.version}
                    </ThemedText>
                  </View>
                </View>
              ) : null}

              {/* ── Body (failure detail / ready copy) ── */}
              {body ? (
                <ThemedText
                  variant="secondary"
                  size={13}
                  style={styles.body}
                >
                  {body}
                </ThemedText>
              ) : null}

              {/* ── Progress ── */}
              {progress && !isFailure ? (
                <View style={styles.progressArea}>
                  {percent != null ? (
                    <View
                      style={[
                        styles.progressTrack,
                        { backgroundColor: theme.colors.border.default },
                      ]}
                      testID="update-download-progress-track"
                    >
                      <View
                        testID="update-download-progress-fill"
                        style={[
                          styles.progressFill,
                          { width: fillWidth, backgroundColor: statusColor },
                        ]}
                      />
                    </View>
                  ) : (
                    <View style={styles.indeterminateRow}>
                      <ActivityIndicator
                        size="small"
                        color={accent}
                        testID="update-download-indeterminate"
                      />
                    </View>
                  )}
                  {meta ? (
                    <View style={styles.metaRow}>
                      <ThemedText
                        variant="secondary"
                        size={12}
                        style={styles.meta}
                      >
                        {meta}
                      </ThemedText>
                      {isInstalling ? (
                        <ActivityIndicator
                          size="small"
                          color={statusColor}
                          testID="update-download-installing-spinner"
                        />
                      ) : null}
                    </View>
                  ) : null}
                </View>
              ) : null}

              {/* ── Buttons ── */}
              <View style={styles.buttonArea}>
                {isFailure ? (
                  <>
                    <View style={styles.buttonRow}>
                      <ThemedButton
                        label={t('selfUpdate.cancel')}
                        variant="outline"
                        onPress={onCancel}
                        style={styles.rowButton}
                        testID="update-download-cancel"
                      />
                      {isPermissionFailure ? (
                        <ThemedButton
                          label={t('selfUpdate.openSettings')}
                          variant="outline"
                          onPress={onOpenSettings}
                          style={styles.rowButton}
                          testID="update-download-open-settings"
                        />
                      ) : null}
                    </View>
                    <ThemedButton
                      label={t('selfUpdate.retry')}
                      variant="primary"
                      onPress={onRetry}
                      style={styles.primaryButton}
                      testID="update-download-retry"
                    />
                  </>
                ) : isReadyish ? (
                  <ThemedButton
                    label={
                      isInstalling
                        ? t('selfUpdate.installing')
                        : t('selfUpdate.installNow')
                    }
                    variant="primary"
                    onPress={onInstall}
                    disabled={isInstalling}
                    testID="update-download-install"
                  />
                ) : (
                  <ThemedButton
                    label={t('selfUpdate.cancel')}
                    variant="outline"
                    onPress={onCancel}
                    testID="update-download-cancel"
                  />
                )}
              </View>
            </LinearGradient>
          </View>
        </TouchableWithoutFeedback>
      </View>
    </Modal>
  );
};

// ── Styles ──────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalShadow: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 12,
  },
  modal: {
    borderRadius: 18,
    padding: 28,
    alignItems: 'center',
    overflow: 'hidden',
  },
  accentStripe: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
  },
  iconContainer: {
    marginBottom: 14,
  },
  iconBadge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    textAlign: 'center',
    marginBottom: 10,
  },
  pillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 12,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  body: {
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 14,
  },
  progressArea: {
    alignSelf: 'stretch',
    marginBottom: 20,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  indeterminateRow: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
  },
  meta: {
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  buttonArea: {
    alignSelf: 'stretch',
    gap: 10,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  rowButton: {
    flex: 1,
    minWidth: 0,
    height: 44,
  },
  primaryButton: {
    height: 44,
  },
});

export default UpdateDownloadModal;
