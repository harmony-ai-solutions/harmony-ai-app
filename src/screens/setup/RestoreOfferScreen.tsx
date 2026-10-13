import React, { useCallback } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../../components/themed/ThemedText';
import { ThemedView } from '../../components/themed/ThemedView';
import { ScreenHeader } from '../../components/themed/ScreenHeader';
import { ThemedButton } from '../../components/themed/ThemedButton';
import { ThemedCard } from '../../components/themed/ThemedCard';
import { formatBytes } from '../settings/BackupSettingsScreen';
import { markRestoreOfferSeen } from '../../services/backup/restoreOnboarding';
import { hapticLightPress } from '../../utils/haptics';
import type { RootStackParamList } from '../../navigation/AppNavigator';

/**
 * RestoreOfferScreen — the skippable fresh-install restore offer (plan 2-6 §5,
 * wired in 5-3). Shown once after a fresh install's first sign-in when a backup
 * was found (see `services/backup/restoreOnboarding`). Non-blocking: "Start
 * fresh" records the offer as resolved and returns to the normal post-sign-in
 * destination; "Restore" opens the existing `RestoreOnboardingScreen`.
 */
export const RestoreOfferScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'RestoreOffer'>>();
  const { t } = useTranslation('backup');
  const { theme } = useAppTheme();

  const offer = route.params?.offer;

  const handleRestore = useCallback(() => {
    hapticLightPress();
    void markRestoreOfferSeen();
    navigation.replace('RestoreOnboarding');
  }, [navigation]);

  const handleStartFresh = useCallback(() => {
    hapticLightPress();
    void markRestoreOfferSeen();
    navigation.navigate('MainTabs', { screen: 'MyProfile' });
  }, [navigation]);

  if (!theme) return null;

  const accentPrimary = theme.colors.accent.primary;
  const textMuted = theme.colors.text.muted;

  const targetLabel = offer ? t(offer.labelKey) : '';
  const dateLabel = offer?.createdAt
    ? new Date(offer.createdAt).toLocaleDateString()
    : t('offerUnknownDate');
  const sizeLabel = offer?.totalBytes ? formatBytes(offer.totalBytes) : '—';

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader title={t('offerTitle')} onBack={handleStartFresh} />
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={[styles.heroOrb, { backgroundColor: accentPrimary }]}>
            <Icon name="cloud-download-outline" size={34} color="#fff" />
          </View>
        </View>

        <ThemedText variant="secondary" size={13} style={styles.intro}>
          {t('offerIntro')}
        </ThemedText>

        <ThemedCard accentStripe style={styles.card} testID="restore-offer-details">
          <View style={styles.detailRow}>
            <View style={styles.detailLabel}>
              <Icon name="cloud-outline" size={14} color={textMuted} />
              <ThemedText variant="muted" size={13}>{t('targetStatusLabel')}</ThemedText>
            </View>
            <ThemedText size={13} testID="restore-offer-target">{targetLabel}</ThemedText>
          </View>
          <View style={styles.detailDivider} />
          <View style={styles.detailRow}>
            <View style={styles.detailLabel}>
              <Icon name="calendar-clock" size={14} color={textMuted} />
              <ThemedText variant="muted" size={13}>{t('offerDateLabel')}</ThemedText>
            </View>
            <ThemedText size={13} testID="restore-offer-date">{dateLabel}</ThemedText>
          </View>
          <View style={styles.detailDivider} />
          <View style={styles.detailRow}>
            <View style={styles.detailLabel}>
              <Icon name="database-outline" size={14} color={textMuted} />
              <ThemedText variant="muted" size={13}>{t('offerSizeLabel')}</ThemedText>
            </View>
            <ThemedText size={13} testID="restore-offer-size">{sizeLabel}</ThemedText>
          </View>
          {offer?.generation != null ? (
            <>
              <View style={styles.detailDivider} />
              <View style={styles.detailRow}>
                <View style={styles.detailLabel}>
                  <Icon name="layers-outline" size={14} color={textMuted} />
                  <ThemedText variant="muted" size={13}>{t('offerGenerationLabel')}</ThemedText>
                </View>
                <ThemedText size={13} testID="restore-offer-generation">{offer.generation}</ThemedText>
              </View>
            </>
          ) : null}
        </ThemedCard>

        <ThemedButton
          label={t('offerRestoreButton')}
          icon="cloud-download"
          onPress={handleRestore}
          style={styles.actionButton}
          testID="restore-offer-restore"
        />
        <ThemedButton
          label={t('offerStartFresh')}
          variant="outline"
          onPress={handleStartFresh}
          style={styles.actionButton}
          testID="restore-offer-start-fresh"
        />

        <ThemedText variant="muted" size={12} style={styles.footerText}>
          {t('offerFooter')}
        </ThemedText>
      </ScrollView>
    </ThemedView>
  );
};

const ORB_SIZE = 84;

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 40, gap: 16 },
  hero: { alignItems: 'center', marginTop: 4, marginBottom: 4 },
  heroOrb: {
    width: ORB_SIZE,
    height: ORB_SIZE,
    borderRadius: ORB_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  intro: { lineHeight: 19, textAlign: 'center', paddingHorizontal: 8 },
  card: { gap: 4 },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  detailLabel: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  detailDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.05)', marginVertical: 2 },
  actionButton: { marginTop: 4 },
  footerText: { textAlign: 'center', paddingHorizontal: 16 },
});
