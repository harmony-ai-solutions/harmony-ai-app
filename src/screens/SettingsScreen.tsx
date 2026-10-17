import React, { useState, useEffect, useCallback } from 'react';
import { StyleSheet, ScrollView, RefreshControl, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../contexts/ThemeContext';
import { useToast } from '../contexts/AppToastContext';
import {
  isNotificationAuthorized,
  requestNotificationPermission,
} from '../services/notifications/NotificationPermission';
import {
  getHideContentOnLockScreen,
  setHideContentOnLockScreen,
} from '../services/notifications/NotificationSettings';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedCard } from '../components/themed/ThemedCard';
import { SectionHeader } from '../components/themed/SectionHeader';
import { ScreenHeader } from '../components/themed/ScreenHeader';
import { TAB_BAR_CONTENT_PAD } from '../components/navigation/GlassTabBar';
import { setHapticFeedbackEnabled } from '../utils/haptics';
import {
  SettingsLinkRow,
  SettingsToggleRow,
} from '../components/settings/SettingsRows';

// AsyncStorage keys for toggle settings
const STORAGE_KEYS = {
  PUSH_NOTIFICATIONS: '@soulbits_setting_push_notifications',
  SOUND_EFFECTS: '@soulbits_setting_sound_effects',
  HAPTIC_FEEDBACK: '@soulbits_setting_haptic_feedback',
} as const;

export const SettingsScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { theme } = useAppTheme();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const { t } = useTranslation('settings');
  const { t: tLifecycle } = useTranslation('lifecycle');
  const { showToast } = useToast();

  // Toggle states
  const [pushNotifications, setPushNotifications] = useState(false);
  const [soundEffects, setSoundEffects] = useState(true);
  const [hapticFeedback, setHapticFeedback] = useState(true);
  const [hideContentOnLockScreen, setHideContentOnLockScreenState] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadToggleStates();
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadToggleStates();
    setRefreshing(false);
  }, []);

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
      // Lock-screen hide-content lives in the notification-settings service
      // (single source of truth, plan 7-12 §4d) — read it through that seam.
      setHideContentOnLockScreenState(await getHideContentOnLockScreen());
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

  /**
   * Push-notifications toggle. Persists the preference and requests display
   * authorization at this natural point (the first push-relevant setting) —
   * without it visible banners are dropped. iOS: `UNUserNotificationCenter`
   * authorization; Android: the `POST_NOTIFICATIONS` runtime grant (API 33+,
   * implicit below). When the user denies it we keep the preference and surface
   * an i18n hint so they can re-enable it in system settings later.
   */
  const handlePushToggle = async (value: boolean) => {
    await toggleAndStore(STORAGE_KEYS.PUSH_NOTIFICATIONS, value, setPushNotifications);
    if (!value) return;
    const status = await requestNotificationPermission();
    if (!isNotificationAuthorized(status)) {
      showToast(t('notificationsPermissionDenied'));
    }
  };

  /**
   * Lock-screen "hide content" toggle (plan 7-12 §4d). Persisted through the
   * notification-settings service so the events-WS client and the later
   * wake-relay composer read the SAME preference.
   */
  const handleHideContentToggle = async (value: boolean) => {
    setHideContentOnLockScreenState(value);
    await setHideContentOnLockScreen(value);
  };

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

        {/* ── Desktop sync (changeset-v1 LAN sync config + status, 3-5) ── */}
        <ThemedCard elevated accentStripe style={styles.card}>
          <SectionHeader title={t('desktopSyncGroup')} style={styles.sectionHeader} />
          <SettingsLinkRow
            icon="sync"
            label={t('desktopSync')}
            onPress={() => navigation.navigate('DesktopSync')}
            theme={theme}
          />
        </ThemedCard>

        {/* ── Engine (embedded Soulbits Engine status + log viewer) ── */}
        <ThemedCard elevated accentStripe style={styles.card}>
          <SectionHeader title={t('engineGroup')} style={styles.sectionHeader} />
          <SettingsLinkRow
            icon="engine-outline"
            label={t('engineStatus')}
            onPress={() => navigation.navigate('EngineStatus')}
            theme={theme}
          />
          <SettingsLinkRow
            icon="text-box-search-outline"
            label={t('engineLogs')}
            onPress={() => navigation.navigate('EngineLog')}
            theme={theme}
            showSeparator
          />
        </ThemedCard>

        {/* ── Backup & restore (user-owned-storage continuity, 2-6) ── */}
        <ThemedCard elevated accentStripe style={styles.card}>
          <SectionHeader title={t('backupGroup')} style={styles.sectionHeader} />
          <SettingsLinkRow
            icon="cloud-upload-outline"
            label={t('backup')}
            onPress={() => navigation.navigate('BackupSettings')}
            theme={theme}
          />
        </ThemedCard>

        {/* ── Background presence (iOS blind-tick honest limits, 4-3) ── */}
        {Platform.OS === 'ios' && (
          <ThemedCard elevated accentStripe style={styles.card}>
            <SectionHeader title={tLifecycle('settingsGroup')} style={styles.sectionHeader} />
            <SettingsLinkRow
              icon="weather-night"
              label={tLifecycle('settingsRow')}
              onPress={() => navigation.navigate('IOSLifecycleInfo')}
              theme={theme}
            />
          </ThemedCard>
        )}

        {/* ── Notifications & Feedback (inline toggles) ── */}
        <ThemedCard elevated accentStripe style={styles.card}>
          <SectionHeader title={t('notifications')} style={styles.sectionHeader} />
          <SettingsToggleRow
            icon="bell"
            label={t('pushNotifications')}
            value={pushNotifications}
            onValueChange={handlePushToggle}
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
          {/* Lock-screen preview vs generic body (plan 7-12 §4d, ruled preview question). */}
          <SettingsToggleRow
            icon="message-off-outline"
            label={t('hideContentOnLockScreen')}
            value={hideContentOnLockScreen}
            onValueChange={handleHideContentToggle}
            theme={theme}
            showSeparator
          />
          {/* Outreach delivery transport (plan 7-12 §4d/§5) — dedicated picker. */}
          <SettingsLinkRow
            icon="send-outline"
            label={t('notificationDelivery')}
            onPress={() => navigation.navigate('NotificationSettings')}
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
