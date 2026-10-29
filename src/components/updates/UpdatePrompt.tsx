/**
 * UpdatePrompt — the headless APP update prompt + in-app download dialog
 * (plan 7-10 §4; owner ruling 2026-10-20 replaced the top banner with an
 * automatic dialog; the progress/cold-start UX landed with "Auto-Update UX
 * phases 1+2").
 *
 * The embedded engine only updates WITH the app, so there is no runtime engine
 * update to announce — this component surfaces the APP update only. It owns
 * three pieces of UX:
 *
 *   1. the automatic "Update available / Download and install app vY now?"
 *      alert (themed, via `useAppAlert`);
 *   2. the progress dialog ({@link UpdateDownloadModal}) driven by the
 *      observable `apkSelfUpdate` state — downloading → ready → installing, with
 *      Cancel / Install / Retry / Open settings wired straight to the service;
 *   3. cold-start pickup of a download that survived a previous session
 *      (`findPendingApkDownload`): a complete artifact offers Install, a partial
 *      one offers Resume.
 *
 * Behavior:
 *   - prompts AUTOMATICALLY, at most ONCE per version per app session (a ref,
 *     so repeated state emissions / foreground re-checks / cache refreshes never
 *     re-open the dialog); Cancel is session-only — NOTHING is persisted, so the
 *     next cold start asks again (owner decision). The legacy persisted
 *     dismissal API stays in the service but is deliberately not consulted.
 *   - the same ref also gates the cold-start pickup, so a pending download can
 *     never produce a second dialog for a version the prompt already covered
 *     (and vice versa).
 *   - never prompts over the lock screen: it re-runs when the lock state
 *     changes, so the dialog appears once the app is unlocked. The progress
 *     dialog is hidden while locked too (the download itself keeps running).
 *   - never prompts on the store variant (the listing owns updates).
 *   - confirm runs the in-app APK self-update ONLY on the Android sideload
 *     channel with a manifest download URL; store channel / iOS / self-update
 *     unavailable → open the download (or notes) URL in the browser.
 *   - no install-in-flight ref anymore: `beginApkSelfUpdate` self-guards against
 *     a second concurrent run, so a double confirm is already a no-op.
 *
 * Renders the progress dialog (or `null`); it is mounted once at the app root
 * (App.tsx).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAppAlert } from '../../contexts/AppAlertContext';
import { useBiometricLock } from '../../contexts/BiometricLockContext';
import {
  getUpdateState,
  onUpdateStateChange,
} from '../../services/updates/UpdateAvailableService';
import type {
  AppUpdateInfo,
  UpdateState,
} from '../../services/updates/UpdateAvailableService';
import { isApkSelfUpdateAvailable } from '../../config/appChannel';
import { isStoreVariant } from '../../config/appVariant';
import {
  INSTALL_PERMISSION_REQUIRED,
  beginApkSelfUpdate,
  cancelApkSelfUpdate,
  findPendingApkDownload,
  getApkDownloadState,
  installDownloadedApk,
  onApkDownloadStateChange,
  openInstallPermissionSettings,
} from '../../services/updates/apkSelfUpdate';
import type { ApkDownloadState } from '../../services/updates/apkSelfUpdate';
import { UpdateDownloadModal } from './UpdateDownloadModal';
import { createLogger } from '../../utils/logger';

const log = createLogger('[UpdatePrompt]');

export const UpdatePrompt: React.FC = () => {
  const { t } = useTranslation('updates');
  const { showAlert } = useAppAlert();
  const { isLocked } = useBiometricLock();
  const [state, setState] = useState<UpdateState>(() => getUpdateState());
  const [download, setDownload] = useState<ApkDownloadState>(() =>
    getApkDownloadState(),
  );
  // Last version a dialog was shown for — SESSION-ONLY dedupe (never persisted).
  // Shared by the automatic prompt AND the cold-start pickup.
  const promptedVersionRef = useRef<string | null>(null);
  // The cold-start scan runs at most once per session (and only after unlock).
  const pickupCheckedRef = useRef(false);

  useEffect(() => onUpdateStateChange(setState), []);

  // Seed from the current snapshot, then follow every emission. Seeding matters
  // when the mount happens mid-download (e.g. a hot reload during a run).
  useEffect(() => {
    setDownload(getApkDownloadState());
    return onApkDownloadStateChange(setDownload);
  }, []);

  const handleConfirm = useCallback((update: AppUpdateInfo) => {
    if (isApkSelfUpdateAvailable() && update.downloadUrl) {
      // Fire-and-forget: the service never throws; the modal takes over as soon
      // as the first state emission arrives (permission failures included).
      void beginApkSelfUpdate(update.version, update.downloadUrl);
      return;
    }
    // Store channel / iOS / self-update unavailable → open the download (or
    // notes) URL in the browser.
    const url = update.downloadUrl ?? update.notesUrl;
    if (url) void Linking.openURL(url).catch(() => undefined);
  }, []);

  // ── 1. Automatic prompt (once per version per session) ──────────────────
  useEffect(() => {
    // Store variant (plan 7-14): the store listing owns updates.
    if (isStoreVariant()) return;
    // Never prompt over the lock screen — re-runs when the app unlocks.
    if (isLocked) return;

    const update = state.appUpdate;
    if (!update) return;
    // At most once per version per session (Cancel asks again next launch).
    if (promptedVersionRef.current === update.version) return;
    promptedVersionRef.current = update.version;

    showAlert(t('selfUpdate.title'), t('selfUpdate.body', { version: update.version }), [
      { text: t('selfUpdate.cancel'), style: 'cancel' },
      { text: t('selfUpdate.confirm'), onPress: () => handleConfirm(update) },
    ]);
  }, [state, isLocked, showAlert, t, handleConfirm]);

  // ── 2. Cold-start pickup of a persisted download ────────────────────────
  useEffect(() => {
    if (!isApkSelfUpdateAvailable()) return;
    if (isStoreVariant()) return;
    if (isLocked) return;
    if (pickupCheckedRef.current) return;
    pickupCheckedRef.current = true;

    let cancelled = false;
    void (async () => {
      const pending = await findPendingApkDownload();
      if (cancelled || !pending) return;
      // Same dedupe as the auto-prompt: never two dialogs for one version.
      if (promptedVersionRef.current === pending.version) return;
      promptedVersionRef.current = pending.version;

      if (pending.complete) {
        showAlert(
          t('selfUpdate.pickupReadyTitle'),
          t('selfUpdate.pickupReadyBody', { version: pending.version }),
          [
            { text: t('selfUpdate.notNow'), style: 'cancel' },
            {
              text: t('selfUpdate.installNow'),
              onPress: () => {
                // Sequential on purpose: `beginApkSelfUpdate` resolves once the
                // artifact is `ready`, which is the precondition for install.
                void (async () => {
                  await beginApkSelfUpdate(pending.version, pending.url);
                  await installDownloadedApk();
                })();
              },
            },
          ],
        );
        return;
      }

      const body =
        pending.percent == null
          ? t('selfUpdate.resumeBodyUnknown', { version: pending.version })
          : t('selfUpdate.resumeBody', {
              version: pending.version,
              percent: pending.percent,
            });
      log.info(`Offering to resume the interrupted download of ${pending.version}`);
      showAlert(t('selfUpdate.resumeTitle'), body, [
        { text: t('selfUpdate.notNow'), style: 'cancel' },
        {
          text: t('selfUpdate.resume'),
          onPress: () => void beginApkSelfUpdate(pending.version, pending.url),
        },
      ]);
    })();

    return () => {
      cancelled = true;
    };
  }, [isLocked, showAlert, t]);

  // ── 3. The progress dialog ──────────────────────────────────────────────
  // Hidden while locked (the lock screen owns the display); the download keeps
  // running and the dialog reappears — at whatever phase it reached — on unlock.
  const showDownloadModal = !isLocked && download.phase !== 'idle';

  if (!showDownloadModal) return null;

  const progress = download.progress;

  return (
    <UpdateDownloadModal
      state={download}
      permissionErrorCode={INSTALL_PERMISSION_REQUIRED}
      onCancel={() => void cancelApkSelfUpdate()}
      onInstall={() => void installDownloadedApk()}
      onRetry={() => {
        if (progress) void beginApkSelfUpdate(progress.version, progress.url);
      }}
      onOpenSettings={() => void openInstallPermissionSettings()}
    />
  );
};

export default UpdatePrompt;
