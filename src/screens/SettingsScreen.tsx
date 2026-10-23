import React, { useState, useEffect, useCallback } from 'react';
import { StyleSheet, ScrollView, RefreshControl, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
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
import {
  getEngineVersionState,
  onEngineVersionStateChange,
} from '../services/engine/EngineService';
import { engineApiClient } from '../services/engine/EngineApiClient';
import { needsRelayAuth } from '../services/sync/relayAuthRecovery';
import {
  ensurePersonaVoiceConfig,
  resolvePersonaVoice,
} from '../services/voiceInput/personaVoice';
import type { PersonaVoiceState } from '../services/voiceInput/personaVoice';
import { getUserEntities } from '../database/repositories';
import { createLogger } from '../utils/logger';
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

const log = createLogger('[SettingsScreen]');

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
  const { t: tDesktopSync } = useTranslation('desktopSync');
  const { showToast } = useToast();

  // Toggle states
  const [pushNotifications, setPushNotifications] = useState(false);
  const [soundEffects, setSoundEffects] = useState(true);
  const [hapticFeedback, setHapticFeedback] = useState(true);
  const [hideContentOnLockScreen, setHideContentOnLockScreenState] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Trailing value chips (READ-only summaries; failures simply omit a chip).
  const [voiceState, setVoiceState] = useState<PersonaVoiceState | null>(null);
  const [personaCount, setPersonaCount] = useState<number | null>(null);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [engineVersion, setEngineVersion] = useState<string | null>(
    () => getEngineVersionState().engineVersion,
  );
  const [desktopSyncState, setDesktopSyncState] = useState<string | null>(null);

  useEffect(() => {
    loadToggleStates();
  }, []);

  // Engine version is already probed at runtime (same source as Help > About).
  useEffect(() => onEngineVersionStateChange(s => setEngineVersion(s.engineVersion)), []);

  /**
   * Refresh the settings-tab value chips on focus (after editing voice input,
   * personas or desktop sync). Every summary is best-effort: a failed read
   * leaves its chip hidden instead of blocking the screen.
   */
  const loadSummary = useCallback(async () => {
    try {
      const [voice, personas] = await Promise.all([
        resolvePersonaVoice(),
        getUserEntities(),
      ]);
      setVoiceState(voice);
      setPersonaCount(personas.length);
    } catch (err) {
      log.warn('Failed to load voice/persona summary:', err);
    }

    try {
      const status = await engineApiClient.getSyncClientStatus();
      setDesktopSyncState(
        // Honest auth surface (2026-10-23): when the engine reports the relay
        // rejected our bearer, an authority label is a lie — the transport is
        // paused until the token is refreshed. The app-wide foreground
        // self-heal fixes it silently; until it does (or when the sign-in is
        // genuinely gone), this chip says so.
        needsRelayAuth(status)
          ? tDesktopSync('cloudSignInExpired')
          : status.config.enabled
            ? status.local_authoritative
              ? tDesktopSync('authorityThisDevice')
              : tDesktopSync('authorityPeer')
            : t('off'),
      );
    } catch {
      // Engine unavailable / sync not configured yet — omit the chip.
      setDesktopSyncState(null);
    }
  }, [t, tDesktopSync]);

  useFocusEffect(
    useCallback(() => {
      void loadSummary();
    }, [loadSummary]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadToggleStates(), loadSummary()]);
    setRefreshing(false);
  }, [loadSummary]);

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

  /**
   * Voice input row — a DIRECT jump into the pinned STT editor. The ensure step
   * runs first (explicit tap = allowed write): it reuses the linked config when
   * one exists, repairs a dangling link, or creates the fixed "Persona voice
   * input" config and links it with a REAL stt_config_id. It never writes a
   * NULL mapping row, so the engine's LWW wiring cannot be clobbered.
   */
  const handleVoiceInputPress = useCallback(async () => {
    if (voiceBusy) return;
    setVoiceBusy(true);
    try {
      const { configId } = await ensurePersonaVoiceConfig();
      navigation.navigate('ModuleConfigEdit', { moduleType: 'stt', configId });
    } catch (err) {
      log.error('Failed to open voice input config:', err);
      showToast(t('voiceInputUnavailable'));
    } finally {
      setVoiceBusy(false);
    }
  }, [voiceBusy, navigation, showToast, t]);

  if (!theme) return null;

  const voiceChip = voiceBusy
    ? '…'
    : voiceState
      ? voiceState.status === 'ok'
        ? voiceState.modelLabel
        : t('off')
      : undefined;
  const personaChip = personaCount != null ? String(personaCount) : undefined;

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
        {/* ── Account (submenu) — single row, no section header ── */}
        <ThemedCard elevated accentStripe style={styles.card}>
          <SettingsLinkRow
            icon="account-circle"
            label={t('account')}
            onPress={() => navigation.navigate('AccountSettings')}
            theme={theme}
          />
        </ThemedCard>

        {/* ── Appearance (submenu) — single row, no section header ── */}
        <ThemedCard elevated accentStripe style={styles.card}>
          <SettingsLinkRow
            icon="palette"
            label={t('appearance')}
            onPress={() => navigation.navigate('AppearanceSettings')}
            theme={theme}
          />
        </ThemedCard>

        {/* ── User chat settings: the shared voice input + persona identities ── */}
        <ThemedCard elevated accentStripe style={styles.card}>
          <SectionHeader title={t('userChatGroup')} style={styles.sectionHeader} />
          <SettingsLinkRow
            icon="microphone-outline"
            label={t('voiceInput')}
            value={voiceChip}
            onPress={() => void handleVoiceInputPress()}
            theme={theme}
          />
          <SettingsLinkRow
            icon="account-group-outline"
            label={t('personas')}
            value={personaChip}
            onPress={() => navigation.navigate('PersonaList')}
            theme={theme}
            showSeparator
          />
        </ThemedCard>

        {/* ── Providers (shared provider accounts: keys, endpoints, verify) ── */}
        <ThemedCard elevated accentStripe style={styles.card}>
          <SettingsLinkRow
            icon="key-variant"
            label={t('providers')}
            onPress={() => navigation.navigate('Providers')}
            theme={theme}
          />
        </ThemedCard>

        {/* ── Backup & sync: user-owned storage + desktop↔phone continuity ── */}
        <ThemedCard elevated accentStripe style={styles.card}>
          <SectionHeader title={t('backupSyncGroup')} style={styles.sectionHeader} />
          <SettingsLinkRow
            icon="cloud-upload-outline"
            label={t('backup')}
            onPress={() => navigation.navigate('BackupSettings')}
            theme={theme}
          />
          <SettingsLinkRow
            icon="sync"
            label={t('desktopSync')}
            value={desktopSyncState ?? undefined}
            onPress={() => navigation.navigate('DesktopSync')}
            theme={theme}
            showSeparator
          />
        </ThemedCard>

        {/* ── System (embedded Soulbits Engine status + app/engine logs) ── */}
        <ThemedCard elevated accentStripe style={styles.card}>
          <SectionHeader title={t('systemGroup')} style={styles.sectionHeader} />
          <SettingsLinkRow
            icon="engine-outline"
            label={t('engineStatus')}
            value={engineVersion ?? undefined}
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
          <SettingsLinkRow
            icon="text-box-outline"
            label={t('appLogs')}
            onPress={() => navigation.navigate('AppLog')}
            theme={theme}
            showSeparator
          />
        </ThemedCard>

        {/* ── Background presence (iOS blind-tick honest limits, 4-3) — single row ── */}
        {Platform.OS === 'ios' && (
          <ThemedCard elevated accentStripe style={styles.card}>
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

        {/* ── Help & Support (submenu) — single row, no section header ── */}
        <ThemedCard elevated accentStripe style={styles.card}>
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
    gap: 12,
  },
  card: {
    gap: 4,
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
