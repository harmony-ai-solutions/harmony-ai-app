/**
 * EditProfileScreen — edit the user's profile (display name, username, bio,
 * avatar).
 *
 * Local-first: the editable extras (username / bio / avatar) are persisted to
 * AsyncStorage via UserProfileStore (scoped per user id). Display name comes
 * from the cloud UserProfile — updated optimistically on the client and
 * merged into AuthContext via a profile refresh.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
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
import { launchImageLibrary } from 'react-native-image-picker';
import { useAppTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { useAppAlert } from '../contexts/AppAlertContext';
import { useBiometricLock } from '../contexts/BiometricLockContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedText } from '../components/themed/ThemedText';
import { ThemedButton } from '../components/themed/ThemedButton';
import { ThemedCard } from '../components/themed/ThemedCard';
import { ScreenHeader } from '../components/themed/ScreenHeader';
import { ProfileAvatar } from '../components/profile/ProfileAvatar';
import UserProfileStore from '../services/profile/UserProfileStore';
import { createLogger } from '../utils/logger';

const log = createLogger('[EditProfileScreen]');

export const EditProfileScreen: React.FC = () => {
  const { theme } = useAppTheme();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const navigation = useNavigation();
  const { t } = useTranslation('profile');
  const { user, status } = useAuth();
  const { showAlert } = useAppAlert();
  const { withExternalFlow } = useBiometricLock();

  // ── Form state ─────────────────────────────────────────────────────────
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const usernameRef = useRef<TextInput>(null);
  const bioRef = useRef<TextInput>(null);

  // ── Load current values ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user) return;
      try {
        const local = await UserProfileStore.getLocalProfile(user.id);
        if (cancelled) return;
        setDisplayName(user.display_name ?? '');
        setUsername(local.username ?? '');
        setBio(local.bio ?? '');
        setAvatarUri(local.avatar_data_url ?? user.avatar_url ?? null);
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

  // ── Avatar handling ────────────────────────────────────────────────────
  const handlePickAvatar = async () => {
    try {
      const result = await withExternalFlow(() =>
        launchImageLibrary({
          mediaType: 'photo',
          includeBase64: true,
          quality: 0.8,
        }),
      );

      if (result.assets && result.assets[0]?.base64) {
        const asset = result.assets[0];
        const mimeType = asset.type ?? 'image/jpeg';
        setAvatarUri(`data:${mimeType};base64,${asset.base64}`);
      }
    } catch (err) {
      log.error('Failed to pick avatar:', err);
      showAlert(t('common:error'), t('updateFailed', { message: '' }));
    }
  };

  const handleRemoveAvatar = () => {
    setAvatarUri(null);
  };

  // ── Save ───────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!user) return;
    if (!displayName.trim()) {
      showAlert(t('common:error'), t('updateFailed', { message: 'Display name required' }));
      return;
    }

    setIsSaving(true);
    try {
      // Persist locally-scoped extras (display name / username / bio / avatar)
      // per user id. The backend has no PATCH /v1/auth/me yet, so the display
      // name is stored locally and preferred by MyProfileScreen over the
      // cloud value.
      await UserProfileStore.saveLocalProfile(user.id, {
        displayName: displayName.trim(),
        username: username.trim(),
        bio: bio.trim(),
        avatar_data_url: avatarUri,
      });

      showAlert(t('profileUpdated'), undefined, [{ text: 'OK' }]);
      navigation.goBack();
    } catch (err) {
      log.error('Failed to save profile:', err);
      showAlert(t('common:error'), t('updateFailed', { message: ' ' }));
    } finally {
      setIsSaving(false);
    }
  }, [user, displayName, username, bio, avatarUri, navigation, showAlert, t]);

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
                onPress={handlePickAvatar}
                variant="outline"
                icon="camera-outline"
                style={styles.avatarBtn}
                testID="change-avatar-button"
              />
              {avatarUri && (
                <ThemedButton
                  label={t('removeAvatar')}
                  onPress={handleRemoveAvatar}
                  variant="ghost"
                  icon="close"
                  style={styles.avatarBtn}
                />
              )}
            </View>
          </View>

          {/* ── Fields ── */}
          <ThemedCard style={styles.formCard}>
            {/* Display name */}
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
                returnKeyType="next"
                onSubmitEditing={() => usernameRef.current?.focus()}
                editable={!isSaving}
              />
            </View>

            {/* Username */}
            <View style={styles.fieldGroup}>
              <ThemedText size={13} variant="secondary" style={styles.fieldLabel}>
                {t('username')}
              </ThemedText>
              <View style={styles.usernameRow}>
                <ThemedText variant="muted" size={15}>
                  @
                </ThemedText>
                <TextInput
                  ref={usernameRef}
                  style={[styles.input, inputStyle, styles.usernameInput]}
                  value={username}
                  onChangeText={setUsername}
                  placeholder={t('usernamePlaceholder')}
                  placeholderTextColor={theme.colors.text.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="username"
                  returnKeyType="next"
                  onSubmitEditing={() => bioRef.current?.focus()}
                  editable={!isSaving}
                />
              </View>
              <ThemedText size={11} variant="muted" hierarchy="caption" style={styles.fieldHint}>
                {t('usernameHint')}
              </ThemedText>
            </View>

            {/* Bio */}
            <View style={styles.fieldGroup}>
              <ThemedText size={13} variant="secondary" style={styles.fieldLabel}>
                {t('bio')}
              </ThemedText>
              <TextInput
                ref={bioRef}
                style={[styles.input, inputStyle, styles.bioInput]}
                value={bio}
                onChangeText={setBio}
                placeholder={t('bioPlaceholder')}
                placeholderTextColor={theme.colors.text.muted}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                editable={!isSaving}
              />
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
