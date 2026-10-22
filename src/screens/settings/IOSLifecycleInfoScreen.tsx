/**
 * IOSLifecycleInfoScreen — the honest-limits info entry for the iOS blind-tick
 * lifecycle (task 4-3, step 6).
 *
 * iOS decides when the embedded engine may wake: a best-effort hourly keepalive
 * push and a system-decided overnight `BGProcessingTask`. Neither is guaranteed.
 * This screen tells the user the truth — cadence is best-effort, correctness is
 * guaranteed (state converges on every wake) — and shows the current session's
 * honored/missed wake counters (the observation-week read, step 7).
 *
 * It is informational only: there is no toggle (the OS owns the policy).
 */

import React from 'react';
import { View, StyleSheet, ScrollView, Platform } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../../components/themed/ThemedText';
import { ThemedView } from '../../components/themed/ThemedView';
import { ScreenHeader } from '../../components/themed/ScreenHeader';
import { ThemedCard } from '../../components/themed/ThemedCard';
import { iosLifecycleTelemetry } from '../../services/engine/IOSLifecycleTelemetry';

/** One titled explanation block. */
function InfoBlock({ icon, title, body }: { icon: string; title: string; body: string }) {
  const { theme } = useAppTheme();
  if (!theme) return null;
  return (
    <View style={styles.block}>
      <View style={styles.blockHeader}>
        <Icon name={icon} size={18} color={theme.colors.accent.primary} />
        <ThemedText weight="medium" size={15} style={styles.blockTitle}>
          {title}
        </ThemedText>
      </View>
      <ThemedText variant="secondary" size={12} style={styles.body}>
        {body}
      </ThemedText>
    </View>
  );
}

export const IOSLifecycleInfoScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { theme } = useAppTheme();
  const { t } = useTranslation('lifecycle');

  if (!theme) return null;

  // The in-memory honored/missed counters for this app session (iOS only).
  const snapshot = Platform.OS === 'ios' ? iosLifecycleTelemetry.snapshot() : null;

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader title={t('title')} onBack={() => navigation.goBack()} />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <ThemedCard elevated accentStripe style={styles.card} testID="lifecycle-intro">
          <ThemedText variant="secondary" size={13} style={styles.intro}>
            {t('intro')}
          </ThemedText>
        </ThemedCard>

        <ThemedCard style={styles.card} testID="lifecycle-best-effort">
          <InfoBlock icon="clock-outline" title={t('bestEffortTitle')} body={t('bestEffortBody')} />
        </ThemedCard>

        <ThemedCard style={styles.card} testID="lifecycle-overnight">
          <InfoBlock icon="weather-night" title={t('overnightTitle')} body={t('overnightBody')} />
        </ThemedCard>

        <ThemedCard style={styles.card} testID="lifecycle-correctness">
          <InfoBlock
            icon="shield-check-outline"
            title={t('correctnessTitle')}
            body={t('correctnessBody')}
          />
        </ThemedCard>

        <ThemedCard style={styles.card} testID="lifecycle-relay">
          <InfoBlock icon="bell-outline" title={t('relayTitle')} body={t('relayBody')} />
        </ThemedCard>

        {snapshot && (
          <ThemedCard style={styles.card} testID="lifecycle-telemetry">
            <View style={styles.blockHeader}>
              <Icon name="chart-line" size={18} color={theme.colors.accent.primary} />
              <ThemedText weight="medium" size={15} style={styles.blockTitle}>
                {t('telemetryTitle')}
              </ThemedText>
            </View>
            <View style={styles.detailRow}>
              <ThemedText variant="secondary" size={13}>{t('telemetryKeepalive')}</ThemedText>
              <ThemedText size={13}>
                {t('telemetryHonoredMissed', {
                  honored: snapshot.keepaliveHonored,
                  missed: snapshot.keepaliveMissed,
                })}
              </ThemedText>
            </View>
            <View style={styles.detailRow}>
              <ThemedText variant="secondary" size={13}>{t('telemetryOvernight')}</ThemedText>
              <ThemedText size={13}>
                {t('telemetryHonoredMissed', {
                  honored: snapshot.maintenanceHonored,
                  missed: snapshot.maintenanceMissed,
                })}
              </ThemedText>
            </View>
          </ThemedCard>
        )}

        <ThemedText variant="muted" size={12} style={styles.footer}>
          {t('footer')}
        </ThemedText>
      </ScrollView>
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 40, gap: 14 },
  card: { gap: 12 },
  intro: { lineHeight: 19 },
  block: { gap: 8 },
  blockHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  blockTitle: { flex: 1 },
  body: { lineHeight: 18 },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  footer: { textAlign: 'center', paddingHorizontal: 16, marginTop: 4 },
});
