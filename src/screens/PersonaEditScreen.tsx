/**
 * PersonaEditScreen — create / edit a user persona.
 *
 * A persona is an Entity whose linked CharacterProfile is tagged source='user'
 * and whose primary character image is the persona's picture. This screen
 * reuses the full character-profile pipeline:
 *   - Create:  new character profile (tagged 'user') + entity (alias = name)
 *              + optional primary image
 *   - Edit:    update the linked character profile (name / description /
 *              personality) + manage the primary image
 *
 * After saving, the new/changed persona is pushed to the engine (best-effort
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
  createCharacterProfile,
  createCharacterImage,
  getCharacterProfile,
  getCharacterImages,
  setCharacterProfileSource,
  updateCharacterProfile,
  deleteCharacterImage,
} from '../database/repositories/characters';
import {
  createEntity,
  createEntityModuleMapping,
  updateEntity,
  deleteEntity,
  getEntity,
} from '../database/repositories/entities';
import { generateId } from '../utils/uuid';
import { createDataURL } from '../database/base64';
import syncService from '../services/SyncService';
import { RootStackParamList } from '../navigation/AppNavigator';
import { createLogger } from '../utils/logger';

const log = createLogger('[PersonaEditScreen]');

type PersonaEditRouteProp = RouteProp<RootStackParamList, 'PersonaEdit'>;

export const PersonaEditScreen: React.FC = () => {
  const { theme } = useAppTheme();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute<PersonaEditRouteProp>();
  const { t } = useTranslation('profile');
  const { showAlert } = useAppAlert();
  const { withExternalFlow } = useBiometricLock();

  const entityId = route.params?.entityId;
  const isEdit = !!entityId;

  // ── Form state ─────────────────────────────────────────────────────────
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [personality, setPersonality] = useState('');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const descriptionRef = useRef<TextInput>(null);
  const personalityRef = useRef<TextInput>(null);

  // ── Load existing persona for edit ─────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isEdit) {
        setLoaded(true);
        return;
      }
      try {
        const entity = await getEntity(entityId!);
        if (!entity || !entity.character_profile_id) {
          if (!cancelled) {
            showAlert(t('common:error'), t('personaSaveFailed', { message: 'Persona not found' }));
            navigation.goBack();
          }
          return;
        }
        const profile = await getCharacterProfile(entity.character_profile_id);
        if (!cancelled && profile) {
          setName(profile.name);
          setDescription(profile.description ?? '');
          setPersonality(profile.personality ?? '');
        }
        // Avatar
        const images = await getCharacterImages(entity.character_profile_id);
        if (!cancelled && images.length > 0) {
          const primary = images.find(img => img.is_primary) ?? images[0];
          setAvatarUri(createDataURL(primary.image_data, primary.mime_type));
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
  }, [isEdit, entityId, navigation, showAlert, t]);

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
      let profileId: string;

      if (isEdit) {
        // ── Edit path ──
        const entity = await getEntity(entityId!);
        if (!entity || !entity.character_profile_id) {
          throw new Error('Persona not found');
        }
        profileId = entity.character_profile_id;

        await updateCharacterProfile({
          id: profileId,
          name: name.trim(),
          description: description.trim() || null,
          personality: personality.trim() || null,
          appearance: null,
          backstory: null,
          voice_characteristics: null,
          base_prompt: null,
          scenario: null,
          example_dialogues: null,
          typing_speed_wpm: 60,
          audio_response_chance_percent: 50,
          vision_config_id: null,
          lifecycle_config: '{}',
          created_at: new Date(),
          updated_at: new Date(),
          deleted_at: null,
        });

        // Keep entity alias in sync with the persona name
        await updateEntity({
          ...entity,
          alias: name.trim(),
          updated_at: new Date(),
        });
      } else {
        // ── Create path ──
        profileId = generateId();
        await createCharacterProfile({
          id: profileId,
          name: name.trim(),
          description: description.trim() || '',
          personality: personality.trim() || '',
          appearance: '',
          backstory: '',
          voice_characteristics: '',
          base_prompt: '',
          scenario: '',
          example_dialogues: '',
          typing_speed_wpm: 60,
          audio_response_chance_percent: 50,
          vision_config_id: null,
          lifecycle_config: '{}',
        });
        // Tag as user-created so it appears as a persona + in My Profile
        await setCharacterProfileSource(profileId, 'user');

        // Entity id = name (mirrors CreateAI) with UNIQUE-alias conflict guard
        const entityIdNew = name.trim();
        try {
          await createEntity({
            id: entityIdNew,
            alias: name.trim(),
            character_profile_id: profileId,
            lifecycle_config: '{}',
            rag_reindex_required: 1,
          });
        } catch (err: any) {
          if (
            err?.message?.includes('UNIQUE') ||
            err?.message?.includes('alias')
          ) {
            showAlert(t('personaAliasConflict'));
            setIsSaving(false);
            return;
          }
          throw err;
        }

        await createEntityModuleMapping({
          entity_id: entityIdNew,
          backend_config_id: null,
          cognition_config_id: null,
          tts_config_id: null,
          stt_config_id: null,
          vision_config_id: null,
          rag_config_id: null,
          imagination_config_id: null,
          movement_config_id: null,
          deleted_at: null,
        });
      }

      // ── Avatar image handling ──
      if (avatarUri?.startsWith('data:')) {
        // New avatar picked → replace the existing primary (edit) or add first
        const match = avatarUri.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          const mimeType = match[1] || 'image/jpeg';
          const base64Data = match[2];
          const images = await getCharacterImages(profileId);

          // Remove existing primary (edit path)
          const primary = images.find(img => img.is_primary);
          if (primary) {
            await deleteCharacterImage(primary.id).catch(() => {});
          }

          await createCharacterImage({
            character_profile_id: profileId,
            image_data: base64Data,
            mime_type: mimeType,
            description: '',
            is_primary: true,
            display_order: 0,
            vl_model_interpretation: '',
            vl_model: '',
            updated_at: new Date(),
          });
        }
      } else if (isEdit && avatarUri === null) {
        // Avatar removed (edit path) — delete the existing primary image
        const images = await getCharacterImages(profileId);
        const primary = images.find(img => img.is_primary);
        if (primary) {
          await deleteCharacterImage(primary.id).catch(() => {});
        }
      }

      // ── Push to engine (best-effort) so chat INIT_ENTITY succeeds ──
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
  }, [
    isEdit,
    entityId,
    name,
    description,
    personality,
    avatarUri,
    navigation,
    showAlert,
    t,
  ]);

  // ── Delete persona ─────────────────────────────────────────────────────
  const handleDelete = useCallback(() => {
    if (!isEdit || !entityId) return;
    showAlert(t('personaDeleteConfirm'), t('personaDeleteConfirmHint'), [
      { text: t('common:cancel'), style: 'cancel' },
      {
        text: t('personaDelete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteEntity(entityId);
            showAlert(t('personaDeleted'), undefined, [{ text: 'OK' }]);
            navigation.goBack();
          } catch (err) {
            log.error('Failed to delete persona:', err);
            showAlert(t('common:error'), t('personaDeleteFailed'));
          }
        },
      },
    ]);
  }, [isEdit, entityId, navigation, showAlert, t]);

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
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              testID="delete-persona-button"
            >
              <Icon name="trash-can-outline" size={22} color={theme.colors.status.error} />
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
});

export default PersonaEditScreen;
