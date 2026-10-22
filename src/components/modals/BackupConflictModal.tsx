/**
 * BackupConflictModal — the cloud-backup generation-guard conflict sheet
 * (owner ruling 2026-10-17).
 *
 * When this device's backup was HELD because another device wrote the cloud
 * manifest, the app surfaces this sheet instead of silently overwriting it. It
 * shows the other device's label, when it synced and the generation it holds,
 * plus a sync-group awareness hint. The user chooses: push mine (overwrite the
 * cloud backup), pull theirs (restore this device from the cloud backup), or
 * cancel (keep the conflict pending).
 *
 * Presentational only — the caller owns the orchestrator side effects. Built on
 * plain RN `Modal` (the app's sheet language) with the themed primitives.
 */

import React from 'react';
import { Modal, StyleSheet, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { ThemedView } from '../themed/ThemedView';
import { ThemedButton } from '../themed/ThemedButton';
import type { PendingConflict } from '../../services/backup/backupTypes';

export interface BackupConflictModalProps {
  visible: boolean;
  /** The held conflict to present; renders nothing when null. */
  conflict: PendingConflict | null;
  /** True while a resolve action runs (disables the buttons). */
  busy?: boolean;
  /** "Push mine (replace cloud backup)" — re-run the backup with overwrite. */
  onPushMine: () => void;
  /** "Pull theirs (restore, replaces this device's data)". */
  onPullTheirs: () => void;
  /** Dismiss; the conflict stays pending and re-surfaces on the next open. */
  onCancel: () => void;
}

export const BackupConflictModal: React.FC<BackupConflictModalProps> = ({
  visible,
  conflict,
  busy = false,
  onPushMine,
  onPullTheirs,
  onCancel,
}) => {
  const { t } = useTranslation('backup');
  const { theme } = useAppTheme();

  if (!theme || !conflict) return null;

  const device = conflict.remoteDeviceLabel || t('conflictDeviceUnknown');
  const syncedAt = conflict.remoteSyncedAt
    ? new Date(conflict.remoteSyncedAt).toLocaleString()
    : t('conflictUnknownTime');

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
      testID="backup-conflict-modal"
    >
      <View style={styles.overlay}>
        <ThemedView style={styles.sheet}>
          <View style={styles.grabber} />

          <View style={styles.header}>
            <Icon name="cloud-alert" size={22} color={theme.colors.accent.primary} />
            <ThemedText weight="bold" size={18} style={styles.title} testID="backup-conflict-title">
              {t('conflictTitle')}
            </ThemedText>
          </View>

          <ThemedText size={13} style={styles.body} testID="backup-conflict-body">
            {t('conflictBody', { device, syncedAt, generation: conflict.remoteGeneration })}
          </ThemedText>

          {conflict.remoteSyncGroupFingerprint ? (
            <View style={styles.hintBox} testID="backup-conflict-syncgroup">
              <Icon name="account-group-outline" size={16} color={theme.colors.accent.primary} />
              <ThemedText size={12} style={styles.hintText}>
                {t('conflictSyncGroupHint')}
              </ThemedText>
            </View>
          ) : null}

          <View style={styles.buttons}>
            <ThemedButton
              label={busy ? t('working') : t('conflictPushMine')}
              icon="cloud-upload"
              onPress={onPushMine}
              disabled={busy}
              testID="backup-conflict-push"
            />
            <ThemedButton
              label={t('conflictPullTheirs')}
              icon="cloud-download"
              variant="outline"
              onPress={onPullTheirs}
              disabled={busy}
              testID="backup-conflict-pull"
            />
            <TouchableOpacity
              style={styles.cancel}
              onPress={onCancel}
              disabled={busy}
              accessibilityRole="button"
              testID="backup-conflict-cancel"
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
  body: { lineHeight: 19 },
  hintBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderRadius: 10,
    padding: 12,
    marginTop: 2,
    backgroundColor: 'rgba(124,58,237,0.12)',
  },
  hintText: { flex: 1, lineHeight: 17 },
  buttons: { gap: 8, marginTop: 8 },
  cancel: { alignItems: 'center', paddingVertical: 10 },
});
