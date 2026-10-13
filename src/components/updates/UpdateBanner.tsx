/**
 * UpdateBanner — the non-blocking, dismissible update banner (plan 7-10 §4).
 *
 * Reads {@link getUpdateState} and renders up to two banners:
 *   - an ENGINE update ("Soulbits Engine vX is out — it arrives with the next
 *     app update.") — informational only (the embedded engine only updates WITH
 *     the app); and
 *   - an APP update ("App vY available") with an Update button. On the Android
 *     sideload channel the button runs the in-app APK self-update; on the store
 *     channel / iOS it opens the download (or notes) URL.
 *
 * Dismissal is per version and persisted (the service owns the storage).
 * Mounted once at the app root (App.tsx), above the navigator.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../contexts/ThemeContext';
import { useAppAlert } from '../../contexts/AppAlertContext';
import { ThemedText } from '../themed/ThemedText';
import { ThemedCard } from '../themed/ThemedCard';
import { ThemedButton } from '../themed/ThemedButton';
import { hexToRgba } from '../../utils/colorUtils';
import {
  dismissUpdate,
  getUpdateState,
  isUpdateDismissed,
  onUpdateStateChange,
} from '../../services/updates/UpdateAvailableService';
import type { UpdateState } from '../../services/updates/UpdateAvailableService';
import { isApkSelfUpdateAvailable } from '../../config/appChannel';
import {
  INSTALL_PERMISSION_REQUIRED,
  openInstallPermissionSettings,
  startApkSelfUpdate,
} from '../../services/updates/apkSelfUpdate';
import { createLogger } from '../../utils/logger';

const log = createLogger('[UpdateBanner]');

export const UpdateBanner: React.FC = () => {
  const { t } = useTranslation('updates');
  const { theme } = useAppTheme();
  const { showAlert } = useAppAlert();
  const [state, setState] = useState<UpdateState>(() => getUpdateState());
  const [busy, setBusy] = useState(false);

  useEffect(() => onUpdateStateChange(setState), []);

  const runSelfUpdate = useCallback(
    async (downloadUrl: string) => {
      setBusy(true);
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
        setBusy(false);
      }
    },
    [showAlert, t],
  );

  const handleAppUpdate = useCallback(
    (version: string, downloadUrl: string | null, notesUrl: string) => {
      if (isApkSelfUpdateAvailable() && downloadUrl) {
        showAlert(t('selfUpdate.title'), t('selfUpdate.body', { version }), [
          { text: t('selfUpdate.cancel'), style: 'cancel' },
          { text: t('selfUpdate.confirm'), onPress: () => void runSelfUpdate(downloadUrl) },
        ]);
        return;
      }
      const url = downloadUrl ?? notesUrl;
      if (url) void Linking.openURL(url).catch(() => undefined);
    },
    [runSelfUpdate, showAlert, t],
  );

  if (!theme) return null;

  const engineUpdate =
    state.engineUpdate && !isUpdateDismissed('engine', state.engineUpdate.version)
      ? state.engineUpdate
      : null;
  const appUpdate =
    state.appUpdate && !isUpdateDismissed('app', state.appUpdate.version)
      ? state.appUpdate
      : null;

  if (!engineUpdate && !appUpdate) return null;

  const accent = theme.colors.accent.primary;
  const border = hexToRgba(accent, 0.4);

  return (
    <View style={styles.container} pointerEvents="box-none">
      {engineUpdate ? (
        <ThemedCard style={[styles.card, { borderColor: border }]} testID="update-banner-engine">
          <View style={styles.row}>
            <Icon name="engine-outline" size={18} color={accent} />
            <ThemedText weight="medium" size={14} style={styles.title}>
              {t('engineBannerTitle', { version: engineUpdate.version })}
            </ThemedText>
            <TouchableOpacity
              onPress={() => void dismissUpdate('engine', engineUpdate.version)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              testID="update-banner-dismiss-engine"
            >
              <Icon name="close" size={16} color={theme.colors.text.muted} />
            </TouchableOpacity>
          </View>
          <ThemedText variant="secondary" size={13} style={styles.body}>
            {t('engineBannerBody')}
          </ThemedText>
        </ThemedCard>
      ) : null}

      {appUpdate ? (
        <ThemedCard style={[styles.card, { borderColor: border }]} testID="update-banner-app">
          <View style={styles.row}>
            <Icon name="cellphone-arrow-down" size={18} color={accent} />
            <ThemedText weight="medium" size={14} style={styles.title}>
              {t('appBannerTitle', { version: appUpdate.version })}
            </ThemedText>
            <TouchableOpacity
              onPress={() => void dismissUpdate('app', appUpdate.version)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              testID="update-banner-dismiss-app"
            >
              <Icon name="close" size={16} color={theme.colors.text.muted} />
            </TouchableOpacity>
          </View>
          <ThemedText variant="secondary" size={13} style={styles.body}>
            {t('appBannerBody')}
          </ThemedText>
          <ThemedButton
            label={busy ? t('selfUpdate.downloading') : t('updateButton')}
            icon="download"
            onPress={() => handleAppUpdate(appUpdate.version, appUpdate.downloadUrl, appUpdate.notesUrl)}
            disabled={busy}
            style={styles.button}
            testID="update-banner-app-update"
          />
        </ThemedCard>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    padding: 12,
    gap: 8,
    zIndex: 10,
  },
  card: { gap: 8, borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1 },
  body: { lineHeight: 18 },
  button: { marginTop: 4 },
});

export default UpdateBanner;
