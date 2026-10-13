import React, { useCallback, useState } from 'react';
import { View, StyleSheet, ScrollView, TextInput } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../contexts/ThemeContext';
import { useToast } from '../../contexts/AppToastContext';
import { ThemedText } from '../../components/themed/ThemedText';
import { ThemedView } from '../../components/themed/ThemedView';
import { ScreenHeader } from '../../components/themed/ScreenHeader';
import { ThemedButton } from '../../components/themed/ThemedButton';
import { ThemedCard } from '../../components/themed/ThemedCard';
import { SelectPicker } from '../../components/config/SelectPicker';
import {
  backupOrchestrator,
  BACKUP_TARGET_OPTIONS,
} from '../../services/backup/BackupOrchestrator';
import type { BackupSettings, BackupTargetType } from '../../services/backup/backupTypes';
import { pickBackupFolder } from '../../services/backup/backupNative';
import { createLogger } from '../../utils/logger';
import { hapticLightPress } from '../../utils/haptics';
import type { RootStackParamList } from '../../navigation/AppNavigator';

const log = createLogger('[RestoreOnboardingScreen]');

/**
 * RestoreOnboardingScreen — the fresh-install restore flow (plan 2-6 step 5).
 * The user picks the target + supplies any unlock material (recovery code /
 * passphrase; W1 is automatic when signed in); the engine verifies the artifact
 * and assembles it into the engine's restore-staging dir, and the app swaps it
 * in on next start.
 */
export const RestoreOnboardingScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { t } = useTranslation('backup');
  const { theme } = useAppTheme();
  const { showToast } = useToast();

  const [targetType, setTargetType] = useState<BackupTargetType>('local-folder');
  const [folderLabel, setFolderLabel] = useState('');
  const [folderUri, setFolderUri] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [restored, setRestored] = useState<string | null>(null);

  const handlePickFolder = useCallback(async () => {
    hapticLightPress();
    const picked = await pickBackupFolder();
    if (!picked) return;
    setFolderUri(picked.uri);
    setFolderLabel(picked.label);
  }, []);

  const handleRestore = useCallback(async () => {
    hapticLightPress();
    setBusy(true);
    try {
      const base = await backupOrchestrator.getSettings();
      const settings: BackupSettings = {
        ...base,
        targetType,
        localFolderUri: folderUri || base.localFolderUri,
      };
      const res = await backupOrchestrator.restore(settings, {
        recoveryCode: recoveryCode.trim() || undefined,
        passphrase: passphrase || undefined,
      });
      setRestored(res.dataDir);
      showToast(t('restoreDone'));
    } catch (e: any) {
      log.warn('restore failed:', e?.message ?? e);
      showToast(t('restoreFailed', { message: e?.message ?? String(e) }));
    } finally {
      setBusy(false);
    }
  }, [targetType, folderUri, recoveryCode, passphrase, showToast, t]);

  if (!theme) return null;
  const accentPrimary = theme.colors.accent.primary;
  const textPrimary = theme.colors.text.primary;
  const textMuted = theme.colors.text.muted;
  const inputBg = theme.colors.background.surface;

  const targetOptions = BACKUP_TARGET_OPTIONS.map((o) => ({
    id: o.id,
    name: o.v1 ? t(o.labelKey) : `${t(o.labelKey)} (${t('comingSoon')})`,
  }));

  const canRestore =
    !busy && (recoveryCode.trim().length > 0 || passphrase.length > 0) &&
    (targetType !== 'local-folder' || !!folderUri);

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader title={t('restoreTitle')} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <ThemedText variant="secondary" size={13} style={styles.intro}>{t('restoreIntro')}</ThemedText>

        <ThemedCard accentStripe style={styles.card}>
          <View style={styles.cardHeader}>
            <Icon name="cloud-download-outline" size={18} color={accentPrimary} />
            <ThemedText weight="medium" size={15} style={styles.cardTitle}>{t('targetSection')}</ThemedText>
          </View>
          <SelectPicker
            label={t('targetLabel')}
            value={targetType}
            options={targetOptions}
            onChange={(id: string) => setTargetType(id as BackupTargetType)}
          />
          {targetType === 'local-folder' && (
            <>
              <ThemedButton
                label={folderUri ? t('changeFolder') : t('chooseFolder')}
                icon="folder-outline"
                variant="outline"
                onPress={handlePickFolder}
                style={styles.actionButton}
                testID="restore-pick-folder"
              />
              {folderLabel ? (
                <ThemedText variant="muted" size={11} style={styles.fieldHint}>{folderLabel}</ThemedText>
              ) : null}
            </>
          )}
        </ThemedCard>

        <ThemedCard accentStripe style={styles.card}>
          <View style={styles.cardHeader}>
            <Icon name="key-variant" size={18} color={accentPrimary} />
            <ThemedText weight="medium" size={15} style={styles.cardTitle}>{t('recoverySection')}</ThemedText>
          </View>
          <ThemedText variant="secondary" size={12} style={styles.helpText}>{t('restoreRecoveryHelp')}</ThemedText>
          <View style={[styles.fieldBody, { backgroundColor: inputBg }]}>
            <TextInput
              style={[styles.fieldInput, { color: textPrimary }]}
              value={recoveryCode}
              onChangeText={setRecoveryCode}
              placeholder={t('recoveryPlaceholder')}
              placeholderTextColor={textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <ThemedText weight="medium" size={13} style={styles.fieldLabel}>{t('passphraseLabel')}</ThemedText>
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
        </ThemedCard>

        <ThemedButton
          label={busy ? t('restoring') : t('restoreButton')}
          icon="cloud-download"
          onPress={handleRestore}
          disabled={!canRestore}
          style={styles.actionButton}
          testID="restore-run"
        />

        {restored ? (
          <ThemedCard style={styles.card} testID="restore-success">
            <View style={styles.cardHeader}>
              <Icon name="check-circle-outline" size={18} color="#4caf82" />
              <ThemedText weight="medium" size={15} style={styles.cardTitle}>{t('restoreDoneTitle')}</ThemedText>
            </View>
            <ThemedText variant="secondary" size={12} style={styles.helpText}>{t('restoreDoneHelp')}</ThemedText>
            <ThemedText variant="muted" size={11} style={styles.mono}>{restored}</ThemedText>
          </ThemedCard>
        ) : null}

        <ThemedText variant="muted" size={12} style={styles.footerText}>{t('restoreFooter')}</ThemedText>
      </ScrollView>
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 40, gap: 16 },
  intro: { lineHeight: 19 },
  card: { gap: 12 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { flex: 1 },
  fieldLabel: { marginTop: 8, marginBottom: 6, marginLeft: 2 },
  fieldBody: { borderRadius: 12, overflow: 'hidden' },
  fieldInput: { paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontWeight: '500' },
  fieldHint: { marginTop: 6, marginLeft: 2, lineHeight: 15 },
  helpText: { lineHeight: 18 },
  mono: { fontFamily: 'monospace', marginTop: 6 },
  actionButton: { marginTop: 4 },
  footerText: { textAlign: 'center', paddingHorizontal: 16 },
});
