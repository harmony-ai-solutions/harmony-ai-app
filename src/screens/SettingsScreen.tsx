import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import ConnectionStateManager from './../services/ConnectionStateManager';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../contexts/ThemeContext';
import { useSyncConnection } from '../contexts/SyncConnectionContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedText } from '../components/themed/ThemedText';
import { ThemedCard } from '../components/themed/ThemedCard';
import { SectionHeader } from '../components/themed/SectionHeader';
import { ScreenHeader } from '../components/themed/ScreenHeader';
import { TAB_BAR_CONTENT_PAD } from '../components/navigation/GlassTabBar';
import { setHapticFeedbackEnabled } from '../utils/haptics';
import {
  SettingsLinkRow,
  SettingsToggleRow,
  SettingsDetailRow,
} from '../components/settings/SettingsRows';

type ConnectionType = 'Harmony Link' | 'Cloud' | 'Not configured';

// AsyncStorage keys for toggle settings
const STORAGE_KEYS = {
  PUSH_NOTIFICATIONS: '@harmony_setting_push_notifications',
  SOUND_EFFECTS: '@harmony_setting_sound_effects',
  HAPTIC_FEEDBACK: '@harmony_setting_haptic_feedback',
} as const;

export const SettingsScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { theme } = useAppTheme();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const { isConnected, connectionStatus } = useSyncConnection();
  const { t } = useTranslation('settings');

  const [connectionType, setConnectionType] =
    useState<ConnectionType>(t('common:notConfigured') as ConnectionType);
  const [lastSyncTime, setLastSyncTime] = useState<string>(t('never'));

  // Toggle states
  const [pushNotifications, setPushNotifications] = useState(false);
  const [soundEffects, setSoundEffects] = useState(true);
  const [hapticFeedback, setHapticFeedback] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    // Connection type
    const wsUrl = await AsyncStorage.getItem('harmony_ws_url');
    const wssUrl = await AsyncStorage.getItem('harmony_wss_url');
    if (wsUrl || wssUrl) {
      setConnectionType('Harmony Link' as ConnectionType);
    } else {
      setConnectionType(t('common:notConfigured') as ConnectionType);
    }

    // Last sync time — read the per-source watermark (legacy global key removed)
    const source = await ConnectionStateManager.getCurrentSource();
    const ts = await ConnectionStateManager.getLastSync(source);
    if (ts) {
      const date = new Date(ts * 1000);
      setLastSyncTime(date.toLocaleString());
    }
  }, [t]);

  useEffect(() => {
    loadData();
    loadToggleStates();
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    await loadToggleStates();
    setRefreshing(false);
  }, [loadData]);

  const loadToggleStates = async () => {
    try {
      const [push, sound, haptic] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.PUSH_NOTIFICATIONS),
        AsyncStorage.getItem(STORAGE_KEYS.SOUND_EFFECTS),
        AsyncStorage.getItem(STORAGE_KEYS.HAPTIC_FEEDBACK),
      ]);
      if (push !== null) setPushNotifications(push === 'true');
      if (sound !== null) setSoundEffects(sound === 'true');
      if (haptic !== null) setHapticFeedback(haptic === 'true');
    } catch {
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
    } catch {
      // ignore
    }
  };

  const connectionStatusColor = connectionStatus.color;

  const syncStatusText = isConnected ? t('upToDate') : t('offline');

  if (!theme) return null;

  return (
    <ThemedView style={styles.container}>
      {/* Header — back button returns to the tabs since Settings is pushed over them */}
      <ScreenHeader title={t('title')} onBack={() => navigation.goBack()} />

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: TAB_BAR_CONTENT_PAD + safeBottom }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[theme.colors.accent.primary]}
            tintColor={theme.colors.accent.primary}
            progressBackgroundColor={theme.colors.background.surface}
          />
        }
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
                  <ThemedText weight="medium" size={14}>{t(connectionStatus.textKey)}</ThemedText>
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

        {/* ── Account (submenu) ── */}
        <ThemedCard elevated accentStripe style={styles.card}>
          <SectionHeader title={t('account')} style={styles.sectionHeader} />
          <SettingsLinkRow
            icon="account-circle"
            label={t('account')}
            onPress={() => navigation.navigate('AccountSettings')}
            theme={theme}
          />
        </ThemedCard>

        {/* ── Appearance (submenu) ── */}
        <ThemedCard elevated accentStripe style={styles.card}>
          <SectionHeader title={t('appearance')} style={styles.sectionHeader} />
          <SettingsLinkRow
            icon="palette"
            label={t('appearance')}
            onPress={() => navigation.navigate('AppearanceSettings')}
            theme={theme}
          />
        </ThemedCard>

        {/* ── Voice input (shared-persona STT) — single global surface (2-1) ── */}
        <ThemedCard elevated accentStripe style={styles.card}>
          <SectionHeader title={t('voiceInputGroup')} style={styles.sectionHeader} />
          <SettingsLinkRow
            icon="microphone-outline"
            label={t('voiceInput')}
            onPress={() => navigation.navigate('VoiceInputSettings')}
            theme={theme}
          />
        </ThemedCard>

        {/* ── Notifications & Feedback (inline toggles) ── */}
        <ThemedCard elevated accentStripe style={styles.card}>
          <SectionHeader title={t('notifications')} style={styles.sectionHeader} />
          <SettingsToggleRow
            icon="bell"
            label={t('pushNotifications')}
            value={pushNotifications}
            onValueChange={(v) => toggleAndStore(STORAGE_KEYS.PUSH_NOTIFICATIONS, v, setPushNotifications)}
            theme={theme}
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
            onValueChange={(v) => {
              toggleAndStore(STORAGE_KEYS.HAPTIC_FEEDBACK, v, setHapticFeedback);
              setHapticFeedbackEnabled(v);
            }}
            theme={theme}
            showSeparator
          />
        </ThemedCard>

        {/* ── Help & Support (submenu) ── */}
        <ThemedCard elevated accentStripe style={styles.card}>
          <SectionHeader title={t('support')} style={styles.sectionHeader} />
          <SettingsLinkRow
            icon="help-circle"
            label={t('support')}
            onPress={() => navigation.navigate('HelpSupportSettings')}
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
});
