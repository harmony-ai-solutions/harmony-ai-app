/**
 * UpdatePrompt — the headless APP update prompt (plan 7-10 §4; owner ruling
 * 2026-10-20 replaced the top banner with an automatic dialog).
 *
 * The embedded engine only updates WITH the app, so there is no runtime engine
 * update to announce — this component surfaces the APP update only. When the
 * update service reports a newer app, it opens the themed dialog
 * ("Update available" / "Download and install app vY now?"). On the Android
 * sideload channel the confirm button runs the in-app APK self-update; on the
 * store channel / iOS it opens the download (or notes) URL.
 *
 * Behavior:
 *   - prompts AUTOMATICALLY, at most ONCE per version per app session (a ref,
 *     so repeated state emissions / foreground re-checks / cache refreshes never
 *     re-open the dialog); Cancel is session-only — NOTHING is persisted, so the
 *     next cold start asks again (owner decision). The legacy persisted
 *     dismissal API stays in the service but is deliberately not consulted.
 *   - never prompts over the lock screen: it re-runs when the lock state
 *     changes, so the dialog appears once the app is unlocked.
 *   - never prompts on the store variant (the listing owns updates).
 *
 * Renders `null`; it exists only to drive the dialog. Mounted once at the app
 * root (App.tsx).
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
  openInstallPermissionSettings,
  startApkSelfUpdate,
} from '../../services/updates/apkSelfUpdate';
import { createLogger } from '../../utils/logger';

const log = createLogger('[UpdatePrompt]');

export const UpdatePrompt: React.FC = () => {
  const { t } = useTranslation('updates');
  const { showAlert } = useAppAlert();
  const { isLocked } = useBiometricLock();
  const [state, setState] = useState<UpdateState>(() => getUpdateState());
  // Last version the dialog was shown for — SESSION-ONLY dedupe (never persisted).
  const promptedVersionRef = useRef<string | null>(null);
  // Confirm guard: block a second install while one is running.
  const installInFlightRef = useRef(false);

  useEffect(() => onUpdateStateChange(setState), []);

  const runSelfUpdate = useCallback(
    async (downloadUrl: string) => {
      if (installInFlightRef.current) return;
      installInFlightRef.current = true;
      try {
        await startApkSelfUpdate(downloadUrl);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        if (message === INSTALL_PERMISSION_REQUIRED) {
          showAlert(t('selfUpdate.title'), t('selfUpdate.permissionNeeded'), [
            { text: t('selfUpdate.cancel'), style: 'cancel' },
            {
              text: t('selfUpdate.openSettings'),
              onPress: () => void openInstallPermissionSettings(),
            },
          ]);
        } else {
          log.warn('self-update failed:', message);
          showAlert(t('selfUpdate.title'), t('selfUpdate.installFailed', { message }));
        }
      } finally {
        installInFlightRef.current = false;
      }
    },
    [showAlert, t],
  );

  const handleConfirm = useCallback(
    (update: AppUpdateInfo) => {
      if (installInFlightRef.current) return;
      if (isApkSelfUpdateAvailable() && update.downloadUrl) {
        void runSelfUpdate(update.downloadUrl);
        return;
      }
      // Store channel / iOS / self-update unavailable → open the download (or
      // notes) URL in the browser.
      const url = update.downloadUrl ?? update.notesUrl;
      if (url) void Linking.openURL(url).catch(() => undefined);
    },
    [runSelfUpdate],
  );

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

  return null;
};

export default UpdatePrompt;
