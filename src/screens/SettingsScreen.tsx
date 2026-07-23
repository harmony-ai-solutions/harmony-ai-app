import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import { Switch } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../contexts/ThemeContext';
import { useSyncConnection } from '../contexts/SyncConnectionContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedText } from '../components/themed/ThemedText';
import { ThemedCard } from '../components/themed/ThemedCard';
import { SectionHeader } from '../components/themed/SectionHeader';
import { ScreenHeader } from '../components/themed/ScreenHeader';
import { TAB_BAR_CONTENT_PAD } from '../components/navigation/GlassTabBar';
import { hexToRgba } from '../utils/colorUtils';

type ConnectionType = 'Harmony Link' | 'Cloud' | 'Not configured';

const APP_VERSION = '0.0.1';

// AsyncStorage keys for toggle settings
const STORAGE_KEYS = {
  PUSH_NOTIFICATIONS: '@harmony_setting_push_notifications',
  SOUND_EFFECTS: '@harmony_setting_sound_effects',
  HAPTIC_FEEDBACK: '@harmony_setting_haptic_feedback',
  CONTENT_FILTER: '@harmony_setting_content_filter',
  BIOMETRIC_LOCK: '@harmony_setting_biometric_lock',
} as const;

export const SettingsScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { theme } = useAppTheme();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const { isConnected, isPaired, isReconnecting } = useSyncConnection();
  const { t } = useTranslation('settings');

  const [connectionType, setConnectionType] =
    useState<ConnectionType>(t('common:notConfigured') as ConnectionType);
  const [lastSyncTime, setLastSyncTime] = useState<string>(t('never'));

  // Toggle states
  const [pushNotifications, setPushNotifications] = useState(false);
  const [soundEffects, setSoundEffects] = useState(true);
  const [hapticFeedback, setHapticFeedback] = useState(true);
  const [contentFilter, setContentFilter] = useState(true);
  const [biometricLock, setBiometricLock] = useState(false);

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
    loadToggleStates();
  }, []);

  const loadToggleStates = async () => {
    try {
      const [push, sound, haptic, filter, biometric] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.PUSH_NOTIFICATIONS),
        AsyncStorage.getItem(STORAGE_KEYS.SOUND_EFFECTS),
        AsyncStorage.getItem(STORAGE_KEYS.HAPTIC_FEEDBACK),
        AsyncStorage.getItem(STORAGE_KEYS.CONTENT_FILTER),
        AsyncStorage.getItem(STORAGE_KEYS.BIOMETRIC_LOCK),
      ]);
      if (push !== null) setPushNotifications(push === 'true');
      if (sound !== null) setSoundEffects(sound === 'true');
      if (haptic !== null) setHapticFeedback(haptic === 'true');
      if (filter !== null) setContentFilter(filter === 'true');
      if (biometric !== null) setBiometricLock(biometric === 'true');
    } catch (e) {
      // ignore — defaults are fine
    }
  };

  const toggleAndStore = async (
    key: string,
    value: boolean,
    setter: (v: boolean) => void,
  ) => {
    setter(value);
    try {
      await AsyncStorage.setItem(key, String(value));
    } catch (e) {
      // ignore
    }
  };

  const navigateToComingSoon = (titleKey: string, icon: string, descriptionKey: string) => {
    navigation.navigate('ComingSoon', { titleKey, icon, descriptionKey });
  };

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

        {/* ── Account & Security ── */}
        <ThemedCard elevated accentStripe style={styles.card}>
          <SectionHeader title={t('security')} style={styles.sectionHeader} />
          <SettingsLinkRow
            icon="account-circle"
            label={t('userProfile')}
            onPress={() => navigation.navigate('ProfileSettings')}
            theme={theme}
            showSeparator
          />
          <SettingsToggleRow
            icon="fingerprint"
            label={t('biometricLock')}
            value={biometricLock}
            onValueChange={(v) => toggleAndStore(STORAGE_KEYS.BIOMETRIC_LOCK, v, setBiometricLock)}
            theme={theme}
            showSeparator
          />
          <SettingsLinkRow
            icon="lock-reset"
            label={t('resetPassword')}
            onPress={() => navigateToComingSoon('resetPassword', 'lock-reset', 'comingSoonResetPassword')}
            theme={theme}
            showSeparator
          />
          <SettingsLinkRow
            icon="devices"
            label={t('activeSessions')}
            onPress={() => navigateToComingSoon('activeSessions', 'devices', 'comingSoonActiveSessions')}
            theme={theme}
            showSeparator
          />
          <SettingsLinkRow
            icon="delete-forever"
            label={t('deleteAccount')}
            onPress={() => navigateToComingSoon('deleteAccount', 'delete-forever', 'comingSoonDeleteAccount')}
            theme={theme}
            showSeparator
          />
          <SettingsLinkRow
            icon="account-cancel"
            label={t('blockedUsers')}
            onPress={() => navigateToComingSoon('blockedUsers', 'account-cancel', 'comingSoonBlockedUsers')}
            theme={theme}
          />
        </ThemedCard>

        {/* ── Notifications & Feedback ── */}
        <ThemedCard elevated accentStripe style={styles.card}>
          <SectionHeader title={t('notifications')} style={styles.sectionHeader} />
          <SettingsToggleRow
            icon="bell"
            label={t('pushNotifications')}
            value={pushNotifications}
            onValueChange={(v) => toggleAndStore(STORAGE_KEYS.PUSH_NOTIFICATIONS, v, setPushNotifications)}
            theme={theme}
            showSeparator
          />
          <SettingsToggleRow
            icon="bell-ring"
            label={t('soundEffects')}
            value={soundEffects}
            onValueChange={(v) => toggleAndStore(STORAGE_KEYS.SOUND_EFFECTS, v, setSoundEffects)}
            theme={theme}
            showSeparator
          />
          <SettingsToggleRow
            icon="vibrate"
            label={t('hapticFeedback')}
            value={hapticFeedback}
            onValueChange={(v) => toggleAndStore(STORAGE_KEYS.HAPTIC_FEEDBACK, v, setHapticFeedback)}
            theme={theme}
          />
        </ThemedCard>

        {/* ── Appearance & Display ── */}
        <ThemedCard elevated accentStripe style={styles.card}>
          <SectionHeader title={t('appearance')} style={styles.sectionHeader} />
          <SettingsLinkRow
            icon="palette"
            label={t('appearanceTheme')}
            onPress={() => navigation.navigate('ThemeSettings')}
            theme={theme}
            showSeparator
          />
          <SettingsLinkRow
            icon="translate"
            label={t('switchLanguage')}
            onPress={() => navigateToComingSoon('switchLanguage', 'translate', 'comingSoonSwitchLanguage')}
            theme={theme}
            showSeparator
          />
          <SettingsLinkRow
            icon="format-size"
            label={t('fontSize')}
            onPress={() => navigateToComingSoon('fontSize', 'format-size', 'comingSoonFontSize')}
            theme={theme}
            showSeparator
          />
          <SettingsLinkRow
            icon="cellphone"
            label={t('appIcon')}
            onPress={() => navigateToComingSoon('appIcon', 'cellphone', 'comingSoonAppIcon')}
            theme={theme}
          />
        </ThemedCard>

        {/* ── AI & Conversation ── */}
        <ThemedCard elevated accentStripe style={styles.card}>
          <SectionHeader title={t('aiConversation')} style={styles.sectionHeader} />
          <SettingsToggleRow
            icon="shield-check"
            label={t('contentFilter')}
            value={contentFilter}
            onValueChange={(v) => toggleAndStore(STORAGE_KEYS.CONTENT_FILTER, v, setContentFilter)}
            theme={theme}
            showSeparator
          />
          <SettingsLinkRow
            icon="swap-horizontal-bold"
            label={t('streamingResponses')}
            onPress={() => navigateToComingSoon('streamingResponses', 'swap-horizontal-bold', 'comingSoonStreamingResponses')}
            theme={theme}
          />
        </ThemedCard>

        {/* ── Billing & Purchases ── */}
        <ThemedCard elevated accentStripe style={styles.card}>
          <SectionHeader title={t('billing')} style={styles.sectionHeader} />
          <SettingsLinkRow
            icon="credit-card"
            label={t('manageSubscription')}
            onPress={() => navigateToComingSoon('manageSubscription', 'credit-card', 'comingSoonManageSubscription')}
            theme={theme}
            showSeparator
          />
          <SettingsLinkRow
            icon="restore"
            label={t('restorePurchases')}
            onPress={() => navigateToComingSoon('restorePurchases', 'restore', 'comingSoonRestorePurchases')}
            theme={theme}
          />
        </ThemedCard>

        {/* ── Support & Legal ── */}
        <ThemedCard elevated accentStripe style={styles.card}>
          <SectionHeader title={t('support')} style={styles.sectionHeader} />
          <SettingsLinkRow
            icon="help-circle"
            label={t('helpCenter')}
            onPress={() => navigateToComingSoon('helpCenter', 'help-circle', 'comingSoonHelpCenter')}
            theme={theme}
            showSeparator
          />
          <SettingsLinkRow
            icon="bug"
            label={t('reportBug')}
            onPress={() => navigateToComingSoon('reportBug', 'bug', 'comingSoonReportBug')}
            theme={theme}
            showSeparator
          />
          <SettingsLinkRow
            icon="file-document"
            label={t('termsOfService')}
            onPress={() => navigateToComingSoon('termsOfService', 'file-document', 'comingSoonTermsOfService')}
            theme={theme}
            showSeparator
          />
          <SettingsLinkRow
            icon="shield-account"
            label={t('privacyPolicy')}
            onPress={() => navigateToComingSoon('privacyPolicy', 'shield-account', 'comingSoonPrivacyPolicy')}
            theme={theme}
            showSeparator
          />
          <View>
            <View style={[styles.linkSeparator, { backgroundColor: hexToRgba(theme.colors.border.default, 0.3) }]} />
            <View style={styles.toggleRow}>
              <SettingsIconPill name="information" color={theme.colors.accent.primary} size={20} />
              <ThemedText style={styles.linkLabel}>{t('appVersion')}</ThemedText>
              <ThemedText style={styles.linkLabel} variant="secondary">{`Harmony AI Chat v${APP_VERSION}`}</ThemedText>
            </View>
          </View>
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

/** Shared icon pill — used by all settings rows for visual consistency. */
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

interface SettingsToggleRowProps {
  icon: string;
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  theme: any;
  showSeparator?: boolean;
}

const SettingsToggleRow: React.FC<SettingsToggleRowProps> = ({
  icon,
  label,
  value,
  onValueChange,
  theme,
  showSeparator,
}) => (
  <View>
    {showSeparator && (
      <View style={[styles.linkSeparator, { backgroundColor: hexToRgba(theme.colors.border.default, 0.3) }]} />
    )}
    <View style={styles.toggleRow}>
      <SettingsIconPill name={icon} color={theme.colors.accent.primary} size={20} />
      <ThemedText style={styles.linkLabel}>{label}</ThemedText>
      <Switch
        value={value}
        onValueChange={onValueChange}
        color={theme.colors.accent.primary}
      />
    </View>
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
  toggleRow: {
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
