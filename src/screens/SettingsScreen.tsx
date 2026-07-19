import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Appbar } from 'react-native-paper';
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
import { ThemedAppbar } from '../components/themed/ThemedAppbar';
import { SettingsMenu } from '../components/navigation/SettingsMenu';

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

  const [menuVisible, setMenuVisible] = useState(false);
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
      <ThemedAppbar style={styles.header}>
        <Appbar.Content
          title={t('title')}
          titleStyle={{ color: theme.colors.text.primary, fontWeight: 'bold' }}
        />
        <Appbar.Action
          icon="menu"
          color={theme.colors.text.primary}
          onPress={() => setMenuVisible(true)}
        />
      </ThemedAppbar>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 100 + safeBottom }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Connection Card ── */}
        <TouchableOpacity
          onPress={() => navigation.navigate('ConnectionSetup')}
          activeOpacity={0.7}
        >
          <ThemedCard elevated accentStripe style={styles.card}>
            <SectionHeader title={t('connection')} style={styles.sectionHeader} />

            <View style={styles.row}>
              <ThemedText variant="secondary">{t('type')}</ThemedText>
              <ThemedText weight="bold">{connectionType}</ThemedText>
            </View>

            <View style={styles.row}>
              <ThemedText variant="secondary">{t('status')}</ThemedText>
              <View style={styles.statusRow}>
                <View
                  style={[
                    styles.statusDot,
                    { backgroundColor: connectionStatusColor },
                  ]}
                />
                <ThemedText weight="bold">{connectionStatusText}</ThemedText>
              </View>
            </View>

            <View style={[styles.row, styles.tapHintRow]}>
              <ThemedText variant="muted" size={11}>{t('configureConnection')}</ThemedText>
              <Icon name="chevron-right" size={18} color={theme.colors.text.muted} />
            </View>
          </ThemedCard>
        </TouchableOpacity>

        {/* ── Sync Card ── */}
        <TouchableOpacity
          onPress={() => navigation.navigate('SyncSettings')}
          activeOpacity={0.7}
        >
          <ThemedCard elevated accentStripe style={styles.card}>
            <SectionHeader title={t('sync')} style={styles.sectionHeader} />

            <View style={styles.row}>
              <ThemedText variant="secondary">{t('lastSync')}</ThemedText>
              <ThemedText weight="bold">{lastSyncTime}</ThemedText>
            </View>

            <View style={styles.row}>
              <ThemedText variant="secondary">{t('status')}</ThemedText>
              <ThemedText weight="bold">{syncStatusText}</ThemedText>
            </View>

            <View style={[styles.row, styles.tapHintRow]}>
              <ThemedText variant="muted" size={11}>{t('syncSettings')}</ThemedText>
              <Icon name="chevron-right" size={18} color={theme.colors.text.muted} />
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
          />
          <SettingsLinkRow
            icon="palette"
            label={t('appearanceTheme')}
            onPress={() => navigation.navigate('ThemeSettings')}
            theme={theme}
            badge="⭐"
          />
        </ThemedCard>

        {/* ── Development Card (DEV only) ── */}
        {__DEV__ && (
          <ThemedCard elevated accentStripe style={styles.card}>
            <SectionHeader title={t('development')} style={styles.sectionHeader} />
            <SettingsLinkRow
              icon="test-tube"
              label={t('databaseTests')}
              badge="DEV"
              onPress={() => navigation.navigate('DatabaseTests')}
              theme={theme}
            />
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

      <SettingsMenu
        visible={menuVisible}
        onClose={() => setMenuVisible(false)}
        onNavigate={screen => navigation.navigate(screen as any)}
      />
    </ThemedView>
  );
};

// ─── Local helper component ──────────────────────────────────────────────────

interface SettingsLinkRowProps {
  icon: string;
  label: string;
  onPress: () => void;
  theme: any;
  badge?: string;
}

const SettingsLinkRow: React.FC<SettingsLinkRowProps> = ({
  icon,
  label,
  onPress,
  theme,
  badge,
}) => (
  <TouchableOpacity
    style={styles.linkRow}
    onPress={onPress}
    activeOpacity={0.7}
  >
    <Icon
      name={icon}
      size={22}
      color={theme.colors.accent.primary}
      style={styles.linkIcon}
    />
    <ThemedText style={styles.linkLabel}>{label}</ThemedText>
    {badge && (
      <ThemedText variant="muted" size={12} style={styles.badge}>
        {badge}
      </ThemedText>
    )}
    <Icon name="chevron-right" size={20} color={theme.colors.text.muted} />
  </TouchableOpacity>
);

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { elevation: 4 },
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
    // Remove default padding from ThemedCard since SectionHeader has its own
    marginTop: 0,
  },
  cardContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 12,
  },
  tapHintRow: {
    paddingTop: 4,
    paddingBottom: 12,
    justifyContent: 'flex-end',
    gap: 4,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
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
  linkIcon: {
    marginRight: 14,
  },
  linkLabel: {
    flex: 1,
    fontSize: 15,
  },
  badge: {
    marginRight: 8,
  },
});
