import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView, TextInput, RefreshControl } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../contexts/ThemeContext';
import { useAppAlert } from '../../contexts/AppAlertContext';
import { useToast } from '../../contexts/AppToastContext';
import { ThemedText } from '../../components/themed/ThemedText';
import { ThemedView } from '../../components/themed/ThemedView';
import { ScreenHeader } from '../../components/themed/ScreenHeader';
import { ThemedButton } from '../../components/themed/ThemedButton';
import { ThemedCard } from '../../components/themed/ThemedCard';
import { SettingsToggleRow } from '../../components/settings/SettingsRows';
import { SelectPicker } from '../../components/config/SelectPicker';
import { BackupConflictModal } from '../../components/modals/BackupConflictModal';
import {
  backupOrchestrator,
  BACKUP_TARGET_OPTIONS,
} from '../../services/backup/BackupOrchestrator';
import { BACKUP_CADENCES } from '../../services/backup/backupTypes';
import type { BackupSettings, BackupTargetType, PendingConflict } from '../../services/backup/backupTypes';
import { pickBackupFolder, isBackupNativeAvailable } from '../../services/backup/backupNative';
import { createLogger } from '../../utils/logger';
import { formatBytes } from '../../utils/formatBytes';
import { hapticLightPress } from '../../utils/haptics';
import type { RootStackParamList } from '../../navigation/AppNavigator';

const log = createLogger('[BackupSettingsScreen]');

// Human-readable byte size (MB/KB) — shared util (plan 7-6 also uses it for the
// relay buffer row). Re-exported here for the existing importers/tests.
export { formatBytes } from '../../utils/formatBytes';

/** Mask a recovery code into 8 groups of 4 for readable display. */
export function groupRecoveryCode(code: string): string {
  return (code.match(/.{1,8}/g) ?? []).join(' ');
}

/**
 * BackupSettingsScreen — the user-owned-storage backup configuration surface
 * (plan 2-6 step 3). Target picker, cadence, Wi-Fi-only, size display, "back up
 * now", recovery-code display/regenerate, passphrase opt-in, per-target status.
 * Honest-limits copy per research §3.5.
 */
export const BackupSettingsScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { t } = useTranslation('backup');
  const { theme } = useAppTheme();
  const { showAlert } = useAppAlert();
  const { showToast } = useToast();

  const [settings, setSettings] = useState<BackupSettings | null>(null);
  const [targetAvailable, setTargetAvailable] = useState(false);
  const [targetDetail, setTargetDetail] = useState('');
  const [recoveryCode, setRecoveryCode] = useState<string>('');
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [cloudQuota, setCloudQuota] = useState<{ usedBytes: number; quotaMb: number } | null>(null);
  // Generation-guard conflict (owner ruling 2026-10-17): the persisted pending
  // conflict drives the modal; it stays pending until the user resolves it.
  const [pendingConflict, setPendingConflict] = useState<PendingConflict | null>(null);
  const [conflictVisible, setConflictVisible] = useState(false);
  const [conflictBusy, setConflictBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await backupOrchestrator.getSettings();
      setSettings(s);
      const conflict = s.pendingConflict ?? null;
      setPendingConflict(conflict);
      if (conflict) setConflictVisible(true);
      const signed = await backupOrchestrator.isSignedIn();
      setSignedIn(signed);
      const status = await backupOrchestrator.probeTarget(s);
      setTargetAvailable(status.available);
      setTargetDetail(status.available ? status.account || '' : status.detail || '');
      const code = await backupOrchestrator.getRecoveryCode().catch(() => '');
      setRecoveryCode(code);
      // Hosted-target quota (plan 7-5) — only when signed in.
      setCloudQuota(signed ? await backupOrchestrator.getCloudQuota() : null);
    } catch (e: any) {
      log.warn('load failed:', e?.message ?? e);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const patch = useCallback(async (p: Partial<BackupSettings>) => {
    const next = await backupOrchestrator.updateSettings(p);
    setSettings(next);
    await backupOrchestrator.scheduleIfEnabled();
    return next;
  }, []);

  const handlePickFolder = useCallback(async () => {
    hapticLightPress();
    const picked = await pickBackupFolder();
    if (!picked) {
      if (!isBackupNativeAvailable()) showToast(t('folderPickerUnavailable'));
      return;
    }
    await patch({ targetType: 'local-folder', localFolderUri: picked.uri, localFolderLabel: picked.label });
    await load();
  }, [patch, load, showToast, t]);

  const handleBackupNow = useCallback(async () => {
    hapticLightPress();
    if (!settings) return;
    setBusy(true);
    try {
      const size = await backupOrchestrator.estimateBackupSize().catch(() => settings.lastTotalBytes ?? 0);
      const opt = BACKUP_TARGET_OPTIONS.find((o) => o.id === settings.targetType);
      const targetLabel = opt ? t(opt.labelKey) : settings.targetType;
      showAlert(
        t('estimateTitle'),
        t('estimateMessage', { size: formatBytes(size), target: targetLabel }),
        [
          { text: t('common:cancel'), style: 'cancel' },
          {
            text: t('backUpNowConfirm'),
            onPress: async () => {
              try {
                const res = await backupOrchestrator.backUpNow();
                if (res.held) {
                  // A held run means another device wrote the cloud manifest —
                  // surface the conflict modal instead of a success toast.
                  setPendingConflict(res.held);
                  setConflictVisible(true);
                } else {
                  showToast(res.skipped ? t('backupSkipped') : t('backupDone', { size: formatBytes(res.totalBytes) }));
                }
                await load();
              } catch (e: any) {
                showToast(t('backupFailed', { message: e?.message ?? String(e) }));
              }
            },
          },
        ],
      );
    } catch (e: any) {
      showToast(t('backupFailed', { message: e?.message ?? String(e) }));
    } finally {
      setBusy(false);
    }
  }, [settings, showAlert, showToast, load, t]);

  const handleRegenerate = useCallback(() => {
    showAlert(t('regenerateTitle'), t('regenerateWarning'), [
      { text: t('common:cancel'), style: 'cancel' },
      {
        text: t('regenerateConfirm'),
        style: 'destructive',
        onPress: async () => {
          try {
            const code = await backupOrchestrator.resetRecoveryCode();
            setRecoveryCode(code);
            showToast(t('regenerateDone'));
          } catch (e: any) {
            showToast(t('backupFailed', { message: e?.message ?? String(e) }));
          }
        },
      },
    ]);
  }, [showAlert, showToast, t]);

  const handlePassphraseToggle = useCallback(
    async (enabled: boolean) => {
      if (!enabled) {
        await backupOrchestrator.clearPassphrase();
        setPassphrase('');
        setSettings((s) => (s ? { ...s, passphraseEnabled: false } : s));
        return;
      }
      if (!passphrase) {
        showToast(t('passphraseRequired'));
        return;
      }
      await backupOrchestrator.setPassphrase(passphrase);
      setSettings((s) => (s ? { ...s, passphraseEnabled: true } : s));
    },
    [passphrase, showToast, t],
  );

  // ── Cloud-backup conflict (generation guard, owner ruling 2026-10-17) ──

  /** "Push mine": re-run the backup with the overwrite policy. */
  const handleConflictPushMine = useCallback(async () => {
    hapticLightPress();
    setConflictBusy(true);
    try {
      const res = await backupOrchestrator.backUpNow({ onConflict: 'overwrite' });
      if (res.held) {
        // Still held (another device raced us) — keep the conflict pending.
        setPendingConflict(res.held);
        setConflictVisible(true);
      } else {
        setPendingConflict(null);
        setConflictVisible(false);
        showToast(res.skipped ? t('backupSkipped') : t('backupDone', { size: formatBytes(res.totalBytes) }));
      }
      await load();
    } catch (e: any) {
      showToast(t('backupFailed', { message: e?.message ?? String(e) }));
    } finally {
      setConflictBusy(false);
    }
  }, [showToast, load, t]);

  /**
   * "Pull theirs": run the existing restore flow (the same warning the restore
   * screen surfaces) against the configured target, then clear the conflict.
   */
  const handleConflictPullTheirs = useCallback(() => {
    hapticLightPress();
    if (!settings) return;
    showAlert(t('restoreTitle'), t('restoreFooter'), [
      { text: t('common:cancel'), style: 'cancel' },
      {
        text: t('conflictPullConfirm'),
        style: 'destructive',
        onPress: async () => {
          setConflictBusy(true);
          try {
            await backupOrchestrator.restore(settings);
            await backupOrchestrator.clearPendingConflict();
            setPendingConflict(null);
            setConflictVisible(false);
            showToast(t('restoreDone'));
            await load();
          } catch (e: any) {
            showToast(t('restoreFailed', { message: e?.message ?? String(e) }));
          } finally {
            setConflictBusy(false);
          }
        },
      },
    ]);
  }, [settings, showAlert, showToast, load, t]);

  /** Cancel: dismiss but keep the conflict pending so it re-surfaces. */
  const handleConflictCancel = useCallback(() => {
    setConflictVisible(false);
  }, []);

  if (!theme || !settings) return null;

  const accentPrimary = theme.colors.accent.primary;
  const textPrimary = theme.colors.text.primary;
  const textMuted = theme.colors.text.muted;
  const inputBg = theme.colors.background.surface;

  const targetOptions = BACKUP_TARGET_OPTIONS.filter(
    (o) => !o.requiresSignIn || signedIn,
  ).map((o) => ({
    id: o.id,
    name: o.v1 ? t(o.labelKey) : `${t(o.labelKey)} (${t('comingSoon')})`,
  }));

  const cloudQuotaText = cloudQuota
    ? t('cloudQuotaUsage', {
        used: formatBytes(cloudQuota.usedBytes),
        quota: cloudQuota.quotaMb > 0 ? `${cloudQuota.quotaMb} MB` : '∞',
      })
    : t('cloudQuotaUnknown');

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader title={t('title')} onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[accentPrimary]}
            tintColor={accentPrimary}
            progressBackgroundColor={theme.colors.background.surface}
          />
        }
      >
        {/* ── Status card ─────────────────────────────────────────────── */}
        <ThemedCard accentStripe style={styles.card}>
          <View style={styles.cardHeader}>
            <Icon name="cloud-upload-outline" size={18} color={accentPrimary} />
            <ThemedText weight="medium" size={15} style={styles.cardTitle}>
              {t('statusSection')}
            </ThemedText>
          </View>
          <View style={styles.detailRow}>
            <ThemedText variant="muted" size={13}>{t('lastBackup')}</ThemedText>
            <ThemedText size={13}>{settings.lastBackupAt ? new Date(settings.lastBackupAt).toLocaleString() : t('never')}</ThemedText>
          </View>
          <View style={styles.detailDivider} />
          <View style={styles.detailRow}>
            <ThemedText variant="muted" size={13}>{t('sizeLabel')}</ThemedText>
            <ThemedText size={13} testID="backup-size">{formatBytes(settings.lastTotalBytes)}</ThemedText>
          </View>
          <View style={styles.detailDivider} />
          <View style={styles.detailRow}>
            <ThemedText variant="muted" size={13}>{t('targetStatusLabel')}</ThemedText>
            <ThemedText size={13} testID="backup-target-status">{targetAvailable ? targetDetail || t('statusReady') : targetDetail || t('statusUnavailable')}</ThemedText>
          </View>
          {settings.targetType === 'soulbits-cloud' ? (
            <>
              <View style={styles.detailDivider} />
              <View style={styles.detailRow}>
                <ThemedText variant="muted" size={13}>{t('cloudQuotaLabel')}</ThemedText>
                <ThemedText size={13} testID="backup-cloud-quota">{cloudQuotaText}</ThemedText>
              </View>
            </>
          ) : null}
          {settings.lastError ? (
            <ThemedText variant="muted" size={12} style={styles.errorText}>{settings.lastError}</ThemedText>
          ) : null}
          {pendingConflict ? (
            <>
              <View style={styles.detailDivider} />
              <View style={styles.conflictNotice} testID="backup-conflict-notice">
                <Icon name="cloud-alert" size={16} color={accentPrimary} />
                <ThemedText size={12} style={styles.conflictNoticeText}>
                  {t('conflictNotice')}
                </ThemedText>
                <ThemedButton
                  label={t('conflictReview')}
                  variant="outline"
                  onPress={() => {
                    hapticLightPress();
                    setConflictVisible(true);
                  }}
                  style={styles.conflictReviewButton}
                  testID="backup-conflict-review"
                />
              </View>
            </>
          ) : null}
        </ThemedCard>

        {/* ── Target + cadence ────────────────────────────────────────── */}
        <ThemedCard accentStripe style={styles.card}>
          <View style={styles.cardHeader}>
            <Icon name="cloud-outline" size={18} color={accentPrimary} />
            <ThemedText weight="medium" size={15} style={styles.cardTitle}>
              {t('targetSection')}
            </ThemedText>
          </View>

          <SettingsToggleRow
            icon="cloud-sync"
            label={t('enabledLabel')}
            value={settings.enabled}
            onValueChange={(v) => patch({ enabled: v })}
            theme={theme}
          />

          <View style={styles.fieldWrapper}>
            <ThemedText weight="medium" size={13} style={styles.fieldLabel}>{t('targetLabel')}</ThemedText>
            <SelectPicker
              label={t('targetLabel')}
              value={settings.targetType}
              options={targetOptions}
              onChange={(id: string) => patch({ targetType: id as BackupTargetType })}
            />
          </View>

          {settings.targetType === 'local-folder' && (
            <>
              <ThemedButton
                label={settings.localFolderUri ? t('changeFolder') : t('chooseFolder')}
                icon="folder-outline"
                variant="outline"
                onPress={handlePickFolder}
                style={styles.actionButton}
                testID="backup-pick-folder"
              />
              {settings.localFolderLabel ? (
                <ThemedText variant="muted" size={11} style={styles.fieldHint}>{settings.localFolderLabel}</ThemedText>
              ) : null}
            </>
          )}

          <View style={styles.fieldWrapper}>
            <ThemedText weight="medium" size={13} style={styles.fieldLabel}>{t('cadenceLabel')}</ThemedText>
            <SelectPicker
              label={t('cadenceLabel')}
              value={settings.cadence}
              options={BACKUP_CADENCES.map((c) => ({ id: c.id, name: t(c.labelKey) }))}
              onChange={(id: string) => patch({ cadence: id as BackupSettings['cadence'] })}
            />
          </View>

          <SettingsToggleRow
            icon="wifi"
            label={t('wifiOnlyLabel')}
            value={settings.wifiOnly}
            onValueChange={(v) => patch({ wifiOnly: v })}
            theme={theme}
          />
          <SettingsToggleRow
            icon="battery-charging"
            label={t('chargingOnlyLabel')}
            value={settings.chargingOnly}
            onValueChange={(v) => patch({ chargingOnly: v })}
            theme={theme}
          />

          <ThemedButton
            label={busy ? t('working') : t('backUpNow')}
            icon="cloud-upload"
            onPress={handleBackupNow}
            disabled={
              busy ||
              (!settings.localFolderUri && settings.targetType === 'local-folder') ||
              (settings.targetType === 'soulbits-cloud' && !signedIn)
            }
            style={styles.actionButton}
            testID="backup-now"
          />
        </ThemedCard>

        {/* ── Recovery code ───────────────────────────────────────────── */}
        <ThemedCard accentStripe style={styles.card}>
          <View style={styles.cardHeader}>
            <Icon name="key-variant" size={18} color={accentPrimary} />
            <ThemedText weight="medium" size={15} style={styles.cardTitle}>
              {t('recoverySection')}
            </ThemedText>
          </View>
          <ThemedText variant="secondary" size={12} style={styles.helpText}>{t('recoveryHelp')}</ThemedText>
          <View style={[styles.codeBox, { backgroundColor: inputBg }]}>
            <ThemedText size={13} style={styles.mono} testID="backup-recovery-code">
              {recoveryCode ? groupRecoveryCode(recoveryCode) : '—'}
            </ThemedText>
          </View>
          <ThemedButton
            label={t('regenerateButton')}
            icon="refresh"
            variant="outline"
            onPress={handleRegenerate}
            style={styles.actionButton}
            testID="backup-regenerate"
          />
        </ThemedCard>

        {/* ── Passphrase (W4, opt-in) ─────────────────────────────────── */}
        <ThemedCard accentStripe style={styles.card}>
          <View style={styles.cardHeader}>
            <Icon name="lock-outline" size={18} color={accentPrimary} />
            <ThemedText weight="medium" size={15} style={styles.cardTitle}>
              {t('passphraseSection')}
            </ThemedText>
          </View>
          <ThemedText variant="secondary" size={12} style={styles.helpText}>{t('passphraseHelp')}</ThemedText>
          <View style={[styles.fieldBody, { backgroundColor: inputBg }]}>
            <TextInput
              style={[styles.fieldInput, { color: textPrimary }]}
              value={passphrase}
              onChangeText={setPassphrase}
              placeholder={t('passphrasePlaceholder')}
              placeholderTextColor={textMuted}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <SettingsToggleRow
            icon="shield-key-outline"
            label={t('passphraseToggle')}
            value={settings.passphraseEnabled}
            onValueChange={handlePassphraseToggle}
            theme={theme}
          />
        </ThemedCard>

        {/* ── Honest limits (research §3.5) ───────────────────────────── */}
        <ThemedCard style={styles.card} testID="backup-honest-limits">
          <View style={styles.cardHeader}>
            <Icon name="information-outline" size={18} color={accentPrimary} />
            <ThemedText weight="medium" size={15} style={styles.cardTitle}>{t('honestTitle')}</ThemedText>
          </View>
          <ThemedText variant="secondary" size={12} style={styles.helpText}>{t('honestW1')}</ThemedText>
          <ThemedText variant="secondary" size={12} style={styles.helpText}>{t('honestAlways')}</ThemedText>
        </ThemedCard>

        <ThemedText variant="muted" size={12} style={styles.footerText}>{t('footer')}</ThemedText>
      </ScrollView>

      <BackupConflictModal
        visible={conflictVisible}
        conflict={pendingConflict}
        busy={conflictBusy}
        onPushMine={handleConflictPushMine}
        onPullTheirs={handleConflictPullTheirs}
        onCancel={handleConflictCancel}
      />
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 40, gap: 16 },
  card: { gap: 12 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { flex: 1 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  detailDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.05)', marginVertical: 2 },
  fieldWrapper: { marginBottom: 6 },
  fieldLabel: { marginBottom: 6, marginLeft: 2 },
  fieldBody: { borderRadius: 12, overflow: 'hidden' },
  fieldInput: { paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontWeight: '500' },
  fieldHint: { marginTop: 6, marginLeft: 2, lineHeight: 15 },
  codeBox: { borderRadius: 12, padding: 14, marginTop: 4 },
  mono: { fontFamily: 'monospace', letterSpacing: 1, lineHeight: 20 },
  helpText: { lineHeight: 18 },
  errorText: { marginTop: 6 },
  conflictNotice: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  conflictNoticeText: { flex: 1, lineHeight: 16 },
  conflictReviewButton: { marginTop: 0 },
  actionButton: { marginTop: 4 },
  footerText: { textAlign: 'center', paddingHorizontal: 16 },
});
