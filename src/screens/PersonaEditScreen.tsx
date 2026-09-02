/**
 * PersonaEditScreen — create / edit a user persona.
 *
 * A persona is the identity the USER chats AS. It stores ONLY identity fields:
 * name, description, personality and a picture — deliberately NO AI character
 * profile and NO AI module configs (that is the domain of AI characters, the
 * entities the user chats WITH).
 *
 * Internally the persona id doubles as an Entity id (alias = name, no linked
 * profile) so chat INIT_ENTITY resolves the persona as the "chatting as"
 * identity — the same way the built-in 'user' identity works.
 *
 * After saving, the backing entity is pushed to the engine (best-effort
 * syncAndWait) so INIT_ENTITY succeeds when chatting as this persona.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { launchImageLibrary } from 'react-native-image-picker';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../contexts/ThemeContext';
import { useAppAlert } from '../contexts/AppAlertContext';
import { useBiometricLock } from '../contexts/BiometricLockContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedText } from '../components/themed/ThemedText';
import { ThemedButton } from '../components/themed/ThemedButton';
import { ThemedCard } from '../components/themed/ThemedCard';
import { ScreenHeader } from '../components/themed/ScreenHeader';
import { ProfileAvatar } from '../components/profile/ProfileAvatar';
import {
  createUserPersona,
  getUserPersona,
  updateUserPersona,
  deleteUserPersona,
  resolvePersonaId,
} from '../database/repositories/userEntities';
import syncService from '../services/SyncService';
import ChatPreferencesService from '../services/ChatPreferencesService';
import { RootStackParamList } from '../navigation/AppNavigator';
import { createLogger } from '../utils/logger';

const log = createLogger('[PersonaEditScreen]');

type PersonaEditRouteProp = RouteProp<RootStackParamList, 'PersonaEdit'>;

/** Split a `data:<mime>;base64,<data>` URL into {mime, base64}, or null. */
function splitDataUrl(url: string): { mimeType: string; base64: string } | null {
  const match = url.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1] || 'image/jpeg', base64: match[2] };
}

export const PersonaEditScreen: React.FC = () => {
  const { theme } = useAppTheme();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<PersonaEditRouteProp>();
  const { t } = useTranslation('profile');
  const { showAlert } = useAppAlert();
  const { withExternalFlow } = useBiometricLock();

  const personaId = route.params?.entityId;
  const isEdit = !!personaId;
  // Built-in identity (A1): the `user` entity is load-bearing — its id is
  // FROZEN, it can never be deleted, but its name/description/personality/
  // avatar ARE editable (the engine-seeded "You" profile syncs down).
  const isBuiltIn = personaId === 'user';
  // Create-mode prefill ("create persona from this card", 5-4 §3) — identity
  // fields only; the source character card is untouched (P1).
  const prefill = route.params?.prefill;

  // ── Form state ─────────────────────────────────────────────────────────
  const [name, setName] = useState(() => prefill?.name ?? '');
  const [description, setDescription] = useState(() => prefill?.description ?? '');
  const [personality, setPersonality] = useState(() => prefill?.personality ?? '');
  const [avatarUri, setAvatarUri] = useState<string | null>(() => prefill?.avatarUri ?? null);
  const [isSaving, setIsSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // The resolved global "Chatting as" identity id (used to block deleting the
  // currently-active persona — review 2a). Loaded the same way ChatListScreen
  // does (`getGlobalImpersonatedEntity` + `resolvePersonaId`).
  const [activePersonaId, setActivePersonaId] = useState<string | null>(null);

  const descriptionRef = useRef<TextInput>(null);
  const personalityRef = useRef<TextInput>(null);

  // ── Load the active persona id (delete gate) ────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await ChatPreferencesService.getGlobalImpersonatedEntity();
        const resolved = await resolvePersonaId(stored);
        if (!cancelled) setActivePersonaId(resolved);
      } catch (err) {
        log.error('Failed to load active persona:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Load existing persona for edit ─────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isEdit) {
        setLoaded(true);
        return;
      }
      try {
        const persona = await getUserPersona(personaId!);
        if (!cancelled && persona) {
          setName(persona.name);
          setDescription(persona.description ?? '');
          setPersonality(persona.personality ?? '');
          setAvatarUri(persona.avatarUri);
        }
        if (!cancelled && !persona) {
          showAlert(t('common:error'), t('personaSaveFailed', { message: 'Persona not found' }));
          navigation.goBack();
        }
        if (!cancelled) setLoaded(true);
      } catch (err) {
        log.error('Failed to load persona for edit:', err);
        if (!cancelled) {
          showAlert(t('common:error'), t('personaSaveFailed', { message: '' }));
          navigation.goBack();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isEdit, personaId, navigation, showAlert, t]);

  // ── Avatar ─────────────────────────────────────────────────────────────
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
      log.error('Failed to pick persona picture:', err);
      showAlert(t('common:error'), t('personaSaveFailed', { message: '' }));
    }
  };

  const handleRemoveAvatar = () => setAvatarUri(null);

  // ── Save ───────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      showAlert(t('personaNameRequired'));
      return;
    }

    setIsSaving(true);
    try {
      let avatar: { image_data: string; mime_type: string } | null = null;
      if (avatarUri?.startsWith('data:')) {
        const split = splitDataUrl(avatarUri);
        if (split) {
          avatar = { image_data: split.base64, mime_type: split.mimeType };
        }
      }

      if (isEdit) {
        await updateUserPersona(personaId!, {
          name: name.trim(),
          description: description.trim(),
          personality: personality.trim(),
          avatar,
        });
      } else {
        await createUserPersona({
          name: name.trim(),
          description: description.trim(),
          personality: personality.trim(),
          avatar,
        });
      }

      // ── Push the backing entity to the engine (best-effort) so chat
      //    INIT_ENTITY succeeds when chatting as this persona. ──
      try {
        await syncService.syncAndWait({ timeoutMs: 45_000 });
      } catch (syncErr) {
        log.warn('Auto-sync after persona save failed (non-critical):', syncErr);
      }

      showAlert(t('personaSaved'), undefined, [{ text: 'OK' }]);
      navigation.goBack();
    } catch (err) {
      log.error('Failed to save persona:', err);
      showAlert(t('common:error'), t('personaSaveFailed', { message: ' ' }));
    } finally {
      setIsSaving(false);
    }
  }, [isEdit, personaId, name, description, personality, avatarUri, navigation, showAlert, t]);

  // ── Delete gate (review 2a) ────────────────────────────────────────────
  // A non-built-in persona that is the CURRENTLY-ACTIVE global impersonated
  // identity cannot be deleted (would strand the user with a stale pref).
  const isActivePersona = !!personaId && activePersonaId === personaId;
  const canDelete = isEdit && !isBuiltIn && !isActivePersona;
  const deleteHint = isBuiltIn
    ? t('persona:deleteProtected')
    : isActivePersona
      ? t('persona:deleteActiveProtected')
      : null;

  // ── Delete persona ─────────────────────────────────────────────────────
  const handleDelete = useCallback(() => {
    if (!isEdit || !personaId) return;
    if (isBuiltIn) {
      // A1: the built-in `user` identity is load-bearing and never deletable.
      showAlert(t('persona:deleteProtected'));
      return;
    }
    if (isActivePersona) {
      // Review 2a: the currently-active persona can't be deleted mid-identity.
      showAlert(t('persona:deleteActiveProtected'));
      return;
    }
    showAlert(t('personaDeleteConfirm'), t('personaDeleteConfirmHint'), [
      { text: t('common:cancel'), style: 'cancel' },
      {
        text: t('personaDelete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteUserPersona(personaId);
            // 5-4 §2: if the deleted persona was the global impersonated
            // identity, reset the preference to the built-in 'user'.
            try {
              const stored = await ChatPreferencesService.getGlobalImpersonatedEntity();
              if (stored === personaId) {
                await ChatPreferencesService.setGlobalImpersonatedEntity('user');
              }
            } catch (prefErr) {
              log.warn('Failed to reset impersonation pref after persona delete:', prefErr);
            }
            showAlert(t('personaDeleted'), undefined, [{ text: 'OK' }]);
            navigation.goBack();
          } catch (err) {
            log.error('Failed to delete persona:', err);
            showAlert(t('common:error'), t('personaDeleteFailed'));
          }
        },
      },
    ]);
  }, [isEdit, isBuiltIn, isActivePersona, personaId, navigation, showAlert, t]);

  if (!theme || !loaded) return null;

  const inputStyle = {
    color: theme.colors.text.primary,
    borderColor: theme.colors.border.default,
    backgroundColor: theme.colors.background.base,
  };

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader
        title={isEdit ? t('personaEditTitle') : t('personaCreateTitle')}
        onBack={() => navigation.goBack()}
        right={
          isEdit ? (
            <TouchableOpacity
              onPress={handleDelete}
              disabled={!canDelete}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              testID="delete-persona-button"
              accessibilityRole="button"
              accessibilityState={{ disabled: !canDelete }}
            >
              <Icon
                name="trash-can-outline"
                size={22}
                color={!canDelete ? theme.colors.text.disabled : theme.colors.status.error}
              />
            </TouchableOpacity>
          ) : undefined
        }
      />

      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: 40 + safeBottom }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Picture block ── */}
          <View style={styles.pictureSection}>
            <ProfileAvatar name={name || 'Persona'} uri={avatarUri} size={112} />

            <View style={styles.pictureActions}>
              <ThemedButton
                label={t('personaPictureChange')}
                onPress={handlePickAvatar}
                variant="outline"
                icon="camera-outline"
                style={styles.pictureBtn}
                testID="persona-change-picture"
              />
              {avatarUri && (
                <ThemedButton
                  label={t('personaPictureRemove')}
                  onPress={handleRemoveAvatar}
                  variant="ghost"
                  icon="close"
                  style={styles.pictureBtn}
                />
              )}
            </View>
          </View>

          {/* ── Fields ── */}
          <ThemedCard style={styles.formCard}>
            {/* Name */}
            <View style={styles.fieldGroup}>
              <ThemedText size={13} variant="secondary" style={styles.fieldLabel}>
                {t('personaName')}
              </ThemedText>
              <TextInput
                style={[styles.input, inputStyle]}
                value={name}
                onChangeText={setName}
                placeholder={t('personaNamePlaceholder')}
                placeholderTextColor={theme.colors.text.muted}
                autoCapitalize="words"
                autoCorrect={false}
                returnKeyType="next"
                onSubmitEditing={() => descriptionRef.current?.focus()}
                editable={!isSaving}
              />
            </View>

            {/* Description */}
            <View style={styles.fieldGroup}>
              <ThemedText size={13} variant="secondary" style={styles.fieldLabel}>
                {t('personaDescription')}
              </ThemedText>
              <TextInput
                ref={descriptionRef}
                style={[styles.input, inputStyle]}
                value={description}
                onChangeText={setDescription}
                placeholder={t('personaDescriptionPlaceholder')}
                placeholderTextColor={theme.colors.text.muted}
                returnKeyType="next"
                onSubmitEditing={() => personalityRef.current?.focus()}
                editable={!isSaving}
              />
            </View>

            {/* Personality */}
            <View style={styles.fieldGroup}>
              <ThemedText size={13} variant="secondary" style={styles.fieldLabel}>
                {t('personaPersonality')}
              </ThemedText>
              <TextInput
                ref={personalityRef}
                style={[styles.input, inputStyle, styles.personalityInput]}
                value={personality}
                onChangeText={setPersonality}
                placeholder={t('personaPersonalityPlaceholder')}
                placeholderTextColor={theme.colors.text.muted}
                multiline
                numberOfLines={5}
                textAlignVertical="top"
                editable={!isSaving}
              />
            </View>
          </ThemedCard>

          {/* ── Voice input (shared across all personas) — read-only info row.
                 Explicitly NOT per-persona editing (persona-modules 2-1). ── */}
          <ThemedCard style={styles.formCard}>
            <View style={styles.voiceInputRow}>
              <Icon
                name="microphone-outline"
                size={18}
                color={theme.colors.accent.primary}
              />
              <View style={styles.voiceInputCopy}>
                <ThemedText size={13} variant="secondary">
                  {t('voiceInputSharedHint')}
                </ThemedText>
              </View>
              <TouchableOpacity
                onPress={() => navigation.navigate('VoiceInputSettings')}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                testID="persona-voice-input-manage"
                accessibilityRole="button"
              >
                <ThemedText size={13} variant="accent" weight="medium">
                  {t('voiceInputManage')}
                </ThemedText>
              </TouchableOpacity>
            </View>
          </ThemedCard>

          {/* ── Delete-protection hint (built-in / active persona) ── */}
          {deleteHint ? (
            <ThemedText
              size={12}
              variant="muted"
              style={styles.deleteHint}
              testID="delete-persona-hint"
            >
              {deleteHint}
            </ThemedText>
          ) : null}

          {/* ── Save ── */}
          <ThemedButton
            label={isSaving ? '…' : t('saveChanges')}
            onPress={handleSave}
            disabled={isSaving}
            icon="content-save-outline"
            style={styles.saveButton}
            testID="save-persona-button"
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
  // ── Picture ──
  pictureSection: {
    alignItems: 'center',
    marginBottom: 20,
    gap: 14,
  },
  pictureActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  pictureBtn: {
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
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    minHeight: 44,
  },
  personalityInput: {
    minHeight: 110,
  },
  saveButton: {
    marginTop: 20,
  },
  deleteHint: {
    marginTop: 16,
    textAlign: 'center',
  },
  voiceInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
  },
  voiceInputCopy: {
    flex: 1,
  },
});

export default PersonaEditScreen;
