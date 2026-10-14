/**
 * EngineContractGate — the blocking "engine too old" card (plan 7-10 §3).
 *
 * When the RUNNING engine's contract version is below the app's
 * `ENGINE_CONTRACT_VERSION`, the app would call endpoints the engine does not
 * serve. Rather than crash, we render a BLOCKING card (same design language as
 * the DesktopSyncScreen rejected card) with a channel-aware action:
 *
 *   - Android sideload → direct download of the latest app (the engine only
 *     updates WITH the app);
 *   - store channel / iOS → the portal INSTALLATION instructions.
 *
 * Store variant (plan 7-14): the store listing owns updates, and steering a
 * store user to the portal/sideload install instructions is a store-policy
 * violation — so in store builds the card renders a NEUTRAL, non-linked caption
 * ("update the app from your app store") instead of any external link.
 *
 * Mounted once at the app root (App.tsx), above the navigator. `contract` is
 * `'unknown'` on a probe failure — that never blocks (a canary that could not
 * run must not brick the app).
 */

import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Platform, Linking } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { ThemedCard } from '../themed/ThemedCard';
import { ThemedButton } from '../themed/ThemedButton';
import {
  getEngineVersionState,
  onEngineVersionStateChange,
} from '../../services/engine/EngineService';
import type { EngineVersionState } from '../../services/engine/EngineService';
import { getUpdateState } from '../../services/updates/UpdateAvailableService';
import { isApkSelfUpdateAvailable } from '../../config/appChannel';
import { isStoreVariant } from '../../config/appVariant';
import { RELEASES } from '../../config/cloud';
import { hexToRgba } from '../../utils/colorUtils';

/** The portal installation instructions (iOS / store channel). */
const PORTAL_INSTALLATION_URL =
  'https://github.com/harmony-ai-solutions/harmony-ai-app/blob/main/docs/INSTALLATION.md';

export const EngineContractGate: React.FC = () => {
  const { t } = useTranslation('updates');
  const { theme } = useAppTheme();
  const [state, setState] = useState<EngineVersionState>(() => getEngineVersionState());

  useEffect(() => onEngineVersionStateChange(setState), []);

  if (!theme || state.contract !== 'too_old') return null;

  const handleAction = () => {
    if (Platform.OS === 'android' && isApkSelfUpdateAvailable()) {
      const url = getUpdateState().appUpdate?.downloadUrl ?? RELEASES.baseUrl;
      void Linking.openURL(url).catch(() => undefined);
      return;
    }
    void Linking.openURL(PORTAL_INSTALLATION_URL).catch(() => undefined);
  };

  const accent = theme.colors.accent.primary;

  return (
    <View style={styles.overlay} testID="engine-contract-gate">
      <ThemedCard
        accentStripe
        style={[styles.card, { borderColor: hexToRgba(accent, 0.5) }]}
        testID="engine-contract-gate-card"
      >
        <View style={styles.row}>
          <Icon name="engine-off-outline" size={22} color={accent} />
          <ThemedText weight="bold" size={17} style={styles.title}>
            {t('tooOld.title')}
          </ThemedText>
        </View>
        <ThemedText variant="secondary" size={14} style={styles.body}>
          {t('tooOld.body')}
        </ThemedText>
        {isStoreVariant() ? (
          // Store variant (plan 7-14): NO external link at all — the store
          // listing owns updates. Neutral, non-linked caption only.
          <ThemedText variant="secondary" size={13} style={styles.body}>
            {t('tooOld.storeHint')}
          </ThemedText>
        ) : (
          <ThemedButton
            label={
              Platform.OS === 'ios'
                ? t('tooOld.iosPortalAction')
                : isApkSelfUpdateAvailable()
                  ? t('tooOld.sideloadAction')
                  : t('tooOld.storeAction')
            }
            icon="download"
            onPress={handleAction}
            style={styles.button}
            testID="engine-contract-gate-action"
          />
        )}
      </ThemedCard>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    zIndex: 20,
  },
  card: { gap: 12, borderWidth: 1, width: '100%', maxWidth: 420 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { flex: 1 },
  body: { lineHeight: 20 },
  button: { marginTop: 4 },
});

export default EngineContractGate;
