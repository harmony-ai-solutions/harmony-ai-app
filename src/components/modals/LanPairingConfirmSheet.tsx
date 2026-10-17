/**
 * LanPairingConfirmSheet — the post-scan LAN confirmation sheet (plan 7-15 §A3).
 *
 * After the phone scans a desktop LAN QR it shows this bottom sheet before
 * applying anything: the desktop's `name`, the transport `mode` in plain
 * language with a short certificate fingerprint (first 8 hex chars), and the
 * dataset. When the payload carries an `enrollment` block AND the phone is
 * signed out, it offers to reuse the desktop's account
 * ("Use «u***@example.com» from this desktop").
 *
 * Confirming applies ONE `PUT /api/sync/client` patch (addresses + mode +
 * fingerprint + single-use secret) and, when offered, runs the enrollment
 * exchange — the caller owns both side effects. The sheet is intentionally
 * presentational (no engine/auth imports) so it is trivially testable.
 *
 * Built on plain RN `Modal` (the app's sheet language; no react-native-paper
 * dependency here) with the themed primitives.
 */

import React from 'react';
import { Modal, StyleSheet, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { ThemedView } from '../themed/ThemedView';
import { ThemedButton } from '../themed/ThemedButton';
import type { LanSyncPairingPayload } from '../../services/sync/syncCloudTypes';

/** Short (first 8 hex chars) certificate fingerprint for display, or ''. */
export function shortFingerprint(fingerprint: string | undefined): string {
  if (!fingerprint) return '';
  const hex = fingerprint.replace(/^sha256:/i, '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  return hex.slice(0, 8);
}

/** i18n key for the plain-language security-mode label. */
function modeLabelKey(mode: string): string {
  switch (mode) {
    case 'secure':
      return 'modeLabelSecure';
    case 'insecure-ssl':
      return 'modeLabelInsecureSsl';
    case 'unencrypted':
      return 'modeLabelUnencrypted';
    default:
      return 'modeLabelUnknown';
  }
}

/** i18n key for the one-line security hint. */
function modeHintKey(mode: string): string {
  switch (mode) {
    case 'secure':
      return 'securityHintSecure';
    case 'insecure-ssl':
      return 'securityHintInsecureSsl';
    case 'unencrypted':
      return 'securityHintUnencrypted';
    default:
      return '';
  }
}

export interface LanPairingConfirmSheetProps {
  visible: boolean;
  payload: LanSyncPairingPayload | null;
  /** Whether the phone is signed in (controls the enrollment offer line). */
  signedIn: boolean;
  /** True while the pair/enroll action runs (disables the buttons). */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const LanPairingConfirmSheet: React.FC<LanPairingConfirmSheetProps> = ({
  visible,
  payload,
  signedIn,
  busy = false,
  onConfirm,
  onCancel,
}) => {
  const { t } = useTranslation('desktopSync');
  const { theme } = useAppTheme();

  if (!theme || !payload) return null;

  const short = shortFingerprint(payload.fingerprint);
  const offerEnrollment = !!payload.enrollment && !signedIn;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
      testID="lan-confirm-sheet"
    >
      <View style={styles.overlay}>
        <ThemedView style={styles.sheet}>
          <View style={styles.grabber} />

          <View style={styles.header}>
            <Icon name="lan-connect" size={22} color={theme.colors.accent.primary} />
            <ThemedText weight="bold" size={18} style={styles.title} testID="lan-confirm-name">
              {t('lanConfirmTitle', { name: payload.name })}
            </ThemedText>
          </View>

          <View style={styles.row}>
            <View style={styles.rowLabel}>
              <Icon name="shield-lock-outline" size={15} color={theme.colors.text.muted} />
              <ThemedText variant="muted" size={13}>{t('lanConfirmModeLabel')}</ThemedText>
            </View>
            <ThemedText size={13} style={styles.rowValue} testID="lan-confirm-mode">
              {t(modeLabelKey(payload.mode))}
            </ThemedText>
          </View>
          <ThemedText variant="muted" size={11} style={styles.hint}>
            {t(modeHintKey(payload.mode))}
          </ThemedText>

          {short ? (
            <View style={styles.row}>
              <View style={styles.rowLabel}>
                <Icon name="fingerprint" size={15} color={theme.colors.text.muted} />
                <ThemedText variant="muted" size={13}>{t('lanConfirmFingerprintLabel')}</ThemedText>
              </View>
              <ThemedText size={13} style={styles.mono} testID="lan-confirm-fingerprint">
                {short}
              </ThemedText>
            </View>
          ) : null}

          <View style={styles.row}>
            <View style={styles.rowLabel}>
              <Icon name="database-outline" size={15} color={theme.colors.text.muted} />
              <ThemedText variant="muted" size={13}>{t('lanConfirmDatasetLabel')}</ThemedText>
            </View>
            <ThemedText size={12} numberOfLines={1} style={styles.mono} testID="lan-confirm-dataset">
              {payload.dataset_id}
            </ThemedText>
          </View>

          {offerEnrollment && payload.enrollment ? (
            <View style={styles.offerBox} testID="lan-confirm-enroll-offer">
              <Icon name="account-arrow-right-outline" size={16} color={theme.colors.accent.primary} />
              <ThemedText size={12} style={styles.offerText}>
                {t('lanConfirmEnrollOffer', { account: payload.enrollment.account_hint })}
              </ThemedText>
            </View>
          ) : null}

          <ThemedText variant="muted" size={11} style={styles.note} testID="lan-confirm-note">
            {t('lanConfirmNote')}
          </ThemedText>

          <View style={styles.buttons}>
            <ThemedButton
              label={busy ? t('pairing') : t('lanConfirmButton')}
              icon="link-variant"
              onPress={onConfirm}
              disabled={busy}
              testID="lan-confirm-button"
            />
            <TouchableOpacity
              style={styles.cancel}
              onPress={onCancel}
              disabled={busy}
              accessibilityRole="button"
              testID="lan-confirm-cancel"
            >
              <ThemedText size={13} variant="secondary">{t('common:cancel')}</ThemedText>
            </TouchableOpacity>
          </View>
        </ThemedView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 28,
    gap: 10,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
    marginBottom: 8,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { flex: 1 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  rowLabel: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowValue: { textAlign: 'right' },
  mono: { maxWidth: '60%' },
  hint: { marginLeft: 21, lineHeight: 15 },
  offerBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderRadius: 10,
    padding: 12,
    marginTop: 4,
    backgroundColor: 'rgba(124,58,237,0.12)',
  },
  offerText: { flex: 1, lineHeight: 17 },
  note: { marginTop: 2 },
  buttons: { gap: 8, marginTop: 8 },
  cancel: { alignItems: 'center', paddingVertical: 10 },
});
