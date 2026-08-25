/**
 * EditProfileScreen — edit the user's profile (display name, username, bio,
 * avatar).
 *
 * Cloud-first: display name persists via AuthService → `PATCH /v1/auth/me`
 * (the backend accepts display_name ONLY). Username / bio / avatar upload
 * cannot persist yet — those fields render disabled with a "coming soon" hint
 * (honest stub, no shadow storage). They are extension items (Phase 9):
 * username/bio in PATCH + an avatar upload endpoint + avatar_url in responses.
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { useAppAlert } from '../contexts/AppAlertContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedText } from '../components/themed/ThemedText';
import { ThemedButton } from '../components/themed/ThemedButton';
import { ThemedCard } from '../components/themed/ThemedCard';
import { ScreenHeader } from '../components/themed/ScreenHeader';
import { ProfileAvatar } from '../components/profile/ProfileAvatar';
import AuthService from '../services/auth/AuthService';
import { createLogger } from '../utils/logger';

const log = createLogger('[EditProfileScreen]');

export const EditProfileScreen: React.FC = () => {
  const { theme } = useAppTheme();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const navigation = useNavigation();
  const { t } = useTranslation('profile');
  const { user, status, refreshUser } = useAuth();
  const { showAlert } = useAppAlert();

  // ── Form state ─────────────────────────────────────────────────────────
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // ── Load current values ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user) return;
      try {
        if (cancelled) return;
        // Cloud-first: display name from auth. Username/bio/avatar have no
        // backend fields yet — shown read-only with a "coming soon" hint.
        setDisplayName(user.display_name ?? '');
        setUsername('');
        setBio('');
        setAvatarUri(user.avatar_url ?? null);
        setLoaded(true);
      } catch (err) {
        log.error('Failed to load profile for editing:', err);
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // ── Save ───────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!user) return;
    if (!displayName.trim()) {
      showAlert(t('common:error'), t('updateFailed', { message: 'Display name required' }));
      return;
    }

    setIsSaving(true);
    try {
      // Persist the display name to the cloud (PATCH /v1/auth/me accepts
      // display_name ONLY), then re-fetch the profile so useAuth().user (and
      // MyProfileScreen's header) reflects the new name.
      await AuthService.updateDisplayName(displayName.trim());
      await refreshUser();
      showAlert(t('profileUpdated'), undefined, [{ text: 'OK' }]);
      navigation.goBack();
    } catch (err) {
      log.error('Failed to save profile:', err);
      showAlert(t('common:error'), t('updateFailed', { message: ' ' }));
    } finally {
      setIsSaving(false);
    }
  }, [user, displayName, navigation, showAlert, t, refreshUser]);

  // ── Guard: not signed in (after all hooks) ─────────────────────────────
  if (!user) {
    return (
      <ThemedView style={styles.container}>
        <ScreenHeader title={t('editTitle')} onBack={() => navigation.goBack()} />
        <View style={styles.notAuthed}>
          <ThemedText variant="muted">{t('signInHint')}</ThemedText>
        </View>
      </ThemedView>
    );
  }

  if (!theme || !loaded) return null;

  const inputStyle = {
    color: theme.colors.text.primary,
    borderColor: theme.colors.border.default,
    backgroundColor: theme.colors.background.base,
  };

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader title={t('editTitle')} onBack={() => navigation.goBack()} />

      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: 40 + safeBottom }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Avatar block ── */}
          <View style={styles.avatarSection}>
            <ProfileAvatar name={displayName || 'User'} uri={avatarUri} size={112} />

            <View style={styles.avatarActions}>
              <ThemedButton
                label={t('changeAvatar')}
                onPress={() => {}}
                disabled
                variant="outline"
                icon="camera-outline"
                style={styles.avatarBtn}
                testID="change-avatar-button"
              />
              {avatarUri && (
                <ThemedButton
                  label={t('removeAvatar')}
                  onPress={() => {}}
                  disabled
                  variant="ghost"
                  icon="close"
                  style={styles.avatarBtn}
                />
              )}
            </View>
            <ThemedText size={11} variant="muted" hierarchy="caption" style={styles.fieldHint}>
              {t('avatarComingSoon')}
            </ThemedText>
          </View>

          {/* ── Fields ── */}
          <ThemedCard style={styles.formCard}>
            {/* Display name — persists via PATCH /v1/auth/me */}
            <View style={styles.fieldGroup}>
              <ThemedText size={13} variant="secondary" style={styles.fieldLabel}>
                {t('displayName')}
              </ThemedText>
              <TextInput
                style={[styles.input, inputStyle]}
                value={displayName}
                onChangeText={setDisplayName}
                placeholder={t('displayNamePlaceholder')}
                placeholderTextColor={theme.colors.text.muted}
                autoCapitalize="words"
                autoCorrect={false}
                editable={!isSaving}
              />
            </View>

            {/* Username — no backend field yet (honest stub) */}
            <View style={styles.fieldGroup}>
              <ThemedText size={13} variant="secondary" style={styles.fieldLabel}>
                {t('username')}
              </ThemedText>
              <View style={styles.usernameRow}>
                <ThemedText variant="muted" size={15}>
                  @
                </ThemedText>
                <TextInput
                  style={[styles.input, inputStyle, styles.usernameInput]}
                  value={username}
                  onChangeText={setUsername}
                  placeholder={t('usernamePlaceholder')}
                  placeholderTextColor={theme.colors.text.muted}
                  editable={false}
                />
              </View>
              <ThemedText size={11} variant="muted" hierarchy="caption" style={styles.fieldHint}>
                {t('usernameComingSoon')}
              </ThemedText>
            </View>

            {/* Bio — no backend field yet (honest stub) */}
            <View style={styles.fieldGroup}>
              <ThemedText size={13} variant="secondary" style={styles.fieldLabel}>
                {t('bio')}
              </ThemedText>
              <TextInput
                style={[styles.input, inputStyle, styles.bioInput]}
                value={bio}
                onChangeText={setBio}
                placeholder={t('bioPlaceholder')}
                placeholderTextColor={theme.colors.text.muted}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                editable={false}
              />
              <ThemedText size={11} variant="muted" hierarchy="caption" style={styles.fieldHint}>
                {t('bioComingSoon')}
              </ThemedText>
            </View>
          </ThemedCard>

          {/* ── Save ── */}
          <ThemedButton
            label={isSaving ? t('saveChanges') : t('saveChanges')}
            onPress={handleSave}
            disabled={isSaving || status === 'loading'}
            icon="content-save-outline"
            style={styles.saveButton}
            testID="save-profile-button"
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  keyboardAvoid: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
  },
  // ── Avatar ──
  avatarSection: {
    alignItems: 'center',
    marginBottom: 20,
    gap: 14,
  },
  avatarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  avatarBtn: {
    minWidth: 130,
  },
  // ── Form ──
  formCard: {
    gap: 16,
  },
  fieldGroup: {
    gap: 6,
  },
  fieldLabel: {
    marginBottom: 0,
  },
  fieldHint: {
    marginTop: 2,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    minHeight: 44,
  },
  usernameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  usernameInput: {
    flex: 1,
  },
  bioInput: {
    minHeight: 96,
  },
  saveButton: {
    marginTop: 20,
  },
  notAuthed: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
});

export default EditProfileScreen;
