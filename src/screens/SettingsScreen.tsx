import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { RootStackParamList } from '../navigation/AppNavigator';
import { useAppTheme } from '../contexts/ThemeContext';
import { useSyncConnection } from '../contexts/SyncConnectionContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedText } from '../components/themed/ThemedText';
import { ThemedCard } from '../components/themed/ThemedCard';
import { SectionHeader } from '../components/themed/SectionHeader';
import { ScreenHeader } from '../components/themed/ScreenHeader';
import { TAB_BAR_CONTENT_PAD } from '../components/navigation/GlassTabBar';
import { hexToRgba } from '../utils/colorUtils';

// Tab-screen navigation: routes are dispatched to the parent root stack.
// Using 'any' here avoids CompositeNavigationProp boilerplate while
// React Navigation v7 resolves routes across nested navigators at runtime.
type Nav = NativeStackNavigationProp<RootStackParamList>;
type ConnectionType = 'Harmony Link' | 'Cloud' | 'Not configured';

export const SettingsScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { theme } = useAppTheme();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const { isConnected, isPaired, isReconnecting } = useSyncConnection();
  const { t } = useTranslation('settings');

  const [connectionType, setConnectionType] =
    useState<ConnectionType>(t('common:notConfigured') as ConnectionType);
  const [lastSyncTime, setLastSyncTime] = useState<string>(t('never'));

  useEffect(() => {
    const loadData = async () => {
      // Connection type
      const wsUrl = await AsyncStorage.getItem('harmony_ws_url');
      const wssUrl = await AsyncStorage.getItem('harmony_wss_url');
      if (wsUrl || wssUrl) {
        setConnectionType('Harmony Link' as ConnectionType);
      } else {
        setConnectionType(t('common:notConfigured') as ConnectionType);
      }

      // Last sync time
      const ts = await AsyncStorage.getItem('last_sync_timestamp');
      if (ts) {
        const date = new Date(parseInt(ts) * 1000);
        setLastSyncTime(date.toLocaleString());
      }
    };
    loadData();
  }, []);

  const connectionStatusText = isConnected
    ? t('connected')
    : isReconnecting
      ? t('reconnecting')
      : isPaired
        ? t('disconnected')
        : t('notPaired');

  const connectionStatusColor = isConnected
    ? (theme?.colors.status?.success ?? '#4caf50')
    : isReconnecting || isPaired
      ? (theme?.colors.status?.warning ?? '#ff9800')
      : (theme?.colors.status?.error ?? '#f44336');

  const syncStatusText = isConnected ? t('upToDate') : t('offline');

  if (!theme) return null;

  return (
    <ThemedView style={styles.container}>
      {/* Header */}
      <ScreenHeader title={t('title')} />

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: TAB_BAR_CONTENT_PAD + safeBottom }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Connection Card ── */}
        <TouchableOpacity
          onPress={() => navigation.navigate('ConnectionSetup')}
          activeOpacity={0.7}
          testID="settings-connection-card"
          accessibilityLabel="Connection settings"
        >
          <ThemedCard elevated accentStripe style={styles.card}>
            <SectionHeader title={t('connection')} style={styles.sectionHeader} />

            <SettingsDetailRow
              icon="lan-connect"
              label={t('type')}
              value={connectionType}
              theme={theme}
            />
            <SettingsDetailRow
              icon="pulse"
              label={t('status')}
              theme={theme}
              valueComponent={
                <View style={styles.statusRow}>
                  <View style={[styles.statusDot, { backgroundColor: connectionStatusColor }]} />
                  <ThemedText weight="medium" size={14}>{connectionStatusText}</ThemedText>
                </View>
              }
            />

            <View style={styles.tapHintRow}>
              <Icon name="chevron-right" size={16} color={theme.colors.text.muted} />
              <ThemedText variant="muted" size={11}>{t('configureConnection')}</ThemedText>
            </View>
          </ThemedCard>
        </TouchableOpacity>

        {/* ── Sync Card ── */}
        <TouchableOpacity
          onPress={() => navigation.navigate('SyncSettings')}
          activeOpacity={0.7}
          testID="settings-sync-card"
          accessibilityLabel="Sync settings"
        >
          <ThemedCard elevated accentStripe style={styles.card}>
            <SectionHeader title={t('sync')} style={styles.sectionHeader} />

            <SettingsDetailRow
              icon="clock-outline"
              label={t('lastSync')}
              value={lastSyncTime}
              theme={theme}
            />
            <SettingsDetailRow
              icon="cloud-check-outline"
              label={t('status')}
              value={syncStatusText}
              theme={theme}
            />

            <View style={styles.tapHintRow}>
              <Icon name="chevron-right" size={16} color={theme.colors.text.muted} />
              <ThemedText variant="muted" size={11}>{t('syncSettings')}</ThemedText>
            </View>
          </ThemedCard>
        </TouchableOpacity>

        {/* ── Account Card ── */}
        <ThemedCard elevated accentStripe style={styles.card}>
          <SectionHeader title={t('account')} style={styles.sectionHeader} />

          <SettingsLinkRow
            icon="account-circle"
            label={t('userProfile')}
            onPress={() => navigation.navigate('ProfileSettings')}
            theme={theme}
            showSeparator
          />
          <SettingsLinkRow
            icon="palette"
            label={t('appearanceTheme')}
            onPress={() => navigation.navigate('ThemeSettings')}
            theme={theme}
          />
        </ThemedCard>

        {/* ── Development Card (DEV only) ── */}
        {__DEV__ && (
          <ThemedCard elevated accentStripe style={styles.card}>
            <SectionHeader title={t('development')} style={styles.sectionHeader} />
            <SettingsLinkRow
              icon="database-eye"
              label={t('databaseTableViewer')}
              badge="DEV"
              onPress={() => navigation.navigate('DatabaseTableViewer')}
              theme={theme}
            />
          </ThemedCard>
        )}
      </ScrollView>

    </ThemedView>
  );
};

// ─── Local helper components ─────────────────────────────────────────────────

/** Shared icon pill — used by both SettingsDetailRow and SettingsLinkRow for visual consistency. */
const SettingsIconPill: React.FC<{ name: string; color: string; size?: number }> = ({
  name,
  color,
  size = 18,
}) => (
  <View style={[styles.iconPill, { backgroundColor: hexToRgba(color, 0.12) }]}>
    <Icon name={name} size={size} color={color} />
  </View>
);

interface SettingsDetailRowProps {
  icon: string;
  label: string;
  value?: string;
  valueComponent?: React.ReactNode;
  theme: any;
}

const SettingsDetailRow: React.FC<SettingsDetailRowProps> = ({
  icon,
  label,
  value,
  valueComponent,
  theme,
}) => (
  <View style={styles.detailRow}>
    <View style={styles.detailLabel}>
      <SettingsIconPill name={icon} color={theme.colors.accent.primary} size={16} />
      <ThemedText variant="secondary" size={13}>{label}</ThemedText>
    </View>
    {valueComponent ? (
      valueComponent
    ) : (
      <ThemedText weight="medium" size={14}>{value ?? '—'}</ThemedText>
    )}
  </View>
);

interface SettingsLinkRowProps {
  icon: string;
  label: string;
  onPress: () => void;
  theme: any;
  badge?: string;
  showSeparator?: boolean;
}

const SettingsLinkRow: React.FC<SettingsLinkRowProps> = ({
  icon,
  label,
  onPress,
  theme,
  badge,
  showSeparator,
}) => (
  <View>
    {showSeparator && (
      <View style={[styles.linkSeparator, { backgroundColor: hexToRgba(theme.colors.border.default, 0.3) }]} />
    )}
    <TouchableOpacity
      style={styles.linkRow}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <SettingsIconPill name={icon} color={theme.colors.accent.primary} size={20} />
      <ThemedText style={styles.linkLabel}>{label}</ThemedText>
      {badge && (
        <View style={[styles.badgeChip, { backgroundColor: hexToRgba(theme.colors.accent.primary, 0.15) }]}>
          <ThemedText variant="accent" size={11} weight="medium">
            {badge}
          </ThemedText>
        </View>
      )}
      <Icon name="chevron-right" size={20} color={theme.colors.text.muted} />
    </TouchableOpacity>
  </View>
);

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
    gap: 16,
  },
  card: {
    gap: 12,
    padding: 0,
    overflow: 'hidden',
  },
  sectionHeader: {
    marginTop: 0,
  },
  /* Icon pill — shared container for all settings icons */
  iconPill: {
    width: 34,
    height: 34,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  detailLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flex: 1,
  },
  tapHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    paddingHorizontal: 16,
    paddingBottom: 14,
    paddingTop: 4,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  linkSeparator: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 16,
  },
  linkLabel: {
    flex: 1,
    fontSize: 15,
  },
  badgeChip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginRight: 8,
  },
});
