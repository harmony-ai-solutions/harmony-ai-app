/**
 * NotificationSettingsScreen — the outreach notification delivery surface
 * (plan 7-12 §4d).
 *
 * Hosts the `notification_transport` picker: `auto | direct | cloud | off`
 * (default `auto`). In this phase the enforced effect is `off` silences all
 * local/in-app notifications; the other three allow them (the direct/cloud
 * distinction becomes meaningful once the wake relay + Firebase land — those
 * read the same `NotificationSettings` source of truth).
 *
 * Copy is deliberately "convenience" framing: cloud delivery is an offer when
 * signed in, never a requirement (§5).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { RootStackParamList } from '../../navigation/AppNavigator';
import { ScreenHeader } from '../../components/themed/ScreenHeader';
import { ThemedView } from '../../components/themed/ThemedView';
import { ThemedCard } from '../../components/themed/ThemedCard';
import { SectionHeader } from '../../components/themed/SectionHeader';
import { hexToRgba } from '../../utils/colorUtils';
import {
  getNotificationTransport,
  setNotificationTransport,
  type NotificationTransport,
} from '../../services/notifications/NotificationSettings';

type Props = NativeStackScreenProps<RootStackParamList, 'NotificationSettings'>;

interface TransportOption {
  value: NotificationTransport;
  icon: string;
  labelKey: string;
  descKey: string;
}

const TRANSPORT_OPTIONS: TransportOption[] = [
  { value: 'auto', icon: 'auto-fix', labelKey: 'transportAuto', descKey: 'transportAutoDesc' },
  { value: 'direct', icon: 'cellphone-link', labelKey: 'transportDirect', descKey: 'transportDirectDesc' },
  { value: 'cloud', icon: 'cloud-outline', labelKey: 'transportCloud', descKey: 'transportCloudDesc' },
  { value: 'off', icon: 'bell-off-outline', labelKey: 'transportOff', descKey: 'transportOffDesc' },
];

export const NotificationSettingsScreen: React.FC<Props> = ({ navigation }) => {
  const { t } = useTranslation('settings');
  const { theme } = useAppTheme();
  const [transport, setTransport] = useState<NotificationTransport>('auto');

  useEffect(() => {
    let active = true;
    void getNotificationTransport().then(value => {
      if (active) setTransport(value);
    });
    return () => {
      active = false;
    };
  }, []);

  const choose = useCallback(async (value: NotificationTransport) => {
    setTransport(value);
    await setNotificationTransport(value);
  }, []);

  if (!theme) return null;

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader title={t('notificationSettingsTitle')} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.sectionWrapper}>
          <ThemedCard elevated accentStripe>
            <SectionHeader title={t('notificationDelivery')} />
            <Text style={[styles.sectionDescription, { color: theme.colors.text.secondary }]}>
              {t('transportSectionDesc')}
            </Text>
            <View style={styles.optionContainer}>
              {TRANSPORT_OPTIONS.map(option => {
                const selected = transport === option.value;
                return (
                  <TouchableOpacity
                    key={option.value}
                    style={[
                      styles.optionCard,
                      {
                        borderColor: selected
                          ? theme.colors.accent.primary
                          : hexToRgba(theme.colors.border.default, 0.3),
                        backgroundColor: selected
                          ? hexToRgba(theme.colors.accent.primary, 0.1)
                          : theme.colors.background.elevated,
                      },
                    ]}
                    onPress={() => choose(option.value)}
                    activeOpacity={0.7}
                    testID={`transport-${option.value}`}
                  >
                    <View style={styles.optionHeader}>
                      <View
                        style={[
                          styles.iconPill,
                          { backgroundColor: hexToRgba(theme.colors.accent.primary, 0.12) },
                        ]}
                      >
                        <Icon name={option.icon} size={18} color={theme.colors.accent.primary} />
                      </View>
                      {selected && (
                        <Icon name="check-circle" size={20} color={theme.colors.accent.primary} />
                      )}
                    </View>
                    <Text style={[styles.optionLabel, { color: theme.colors.text.primary }]}>
                      {t(option.labelKey)}
                    </Text>
                    <Text style={[styles.optionDesc, { color: theme.colors.text.secondary }]}>
                      {t(option.descKey)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={[styles.note, { color: theme.colors.text.muted }]}>
              {t('transportConvenienceNote')}
            </Text>
          </ThemedCard>
        </View>
      </ScrollView>
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingTop: 16 },
  sectionWrapper: { paddingHorizontal: 16, marginBottom: 16 },
  sectionDescription: { fontSize: 14, marginBottom: 16, paddingHorizontal: 16 },
  optionContainer: { paddingHorizontal: 16, paddingBottom: 16, gap: 12 },
  optionCard: { borderWidth: 1.5, borderRadius: 12, padding: 14, gap: 6 },
  optionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  iconPill: { width: 34, height: 34, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  optionLabel: { fontSize: 16, fontWeight: '600' },
  optionDesc: { fontSize: 13, lineHeight: 18 },
  note: { fontSize: 12, lineHeight: 17, paddingHorizontal: 16, paddingBottom: 16 },
});

export default NotificationSettingsScreen;
