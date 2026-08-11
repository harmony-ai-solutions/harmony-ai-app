/**
 * CreateAIScreen
 *
 * Guided entity creation wizard. Creates a CharacterProfile + Entity
 * (with alias) + EntityModuleMapping in one flow, then navigates directly
 * to ChatDetailScreen via navigation.replace() so back-button goes to
 * ChatList rather than returning here.
 *
 * Route params: { prefillProfileId?: string }
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  TextInput,
  ActivityIndicator,
  TouchableOpacity,
  Image,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemedCard } from '../components/themed/ThemedCard';
import { ScreenHeader } from '../components/themed/ScreenHeader';
import { SectionHeader } from '../components/themed/SectionHeader';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { launchImageLibrary } from 'react-native-image-picker';
import { v4 as uuidv4, v7 as uuidv7 } from 'uuid';
import { useTranslation } from 'react-i18next';
import { deriveParticipantKey, deriveScopeFromParticipants } from '../database/repositories/interactions';
import { createLogger } from '../utils/logger';

const log = createLogger('[CreateAIScreen]');

import { RootStackParamList } from '../navigation/AppNavigator';
import { useAppTheme } from '../contexts/ThemeContext';
import { useAppAlert } from '../contexts/AppAlertContext';
import { useBiometricLock } from '../contexts/BiometricLockContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedText } from '../components/themed/ThemedText';
import { ThemedButton } from '../components/themed/ThemedButton';
import { ThemedGradient } from '../components/themed/ThemedGradient';
import { EntityModuleSelectorWithActions } from '../components/entities/EntityModuleSelectorWithActions';
import { ProfilePickerCard } from '../components/characters/ProfilePickerCard';
import { hexToRgba } from '../utils/colorUtils';
import { hapticLightPress } from '../utils/haptics';
import { ModuleConfigOption } from '../components/entities/EntityModuleSelector';

import {
  createCharacterProfile,
  createCharacterImage,
  getAllCharacterProfiles,
  getCharacterImages,
  setCharacterProfileSource,
} from '../database/repositories/characters';
import { createDataURL } from '../database/base64';
import {
  createEntity,
  createEntityModuleMapping,
} from '../database/repositories/entities';
import {
  getAllCognitionConfigs,
  getAllTTSConfigs,
  getAllSTTConfigs,
  getAllVisionConfigs,
  getAllRAGConfigs,
  getAllImaginationConfigs,
  getAllMovementConfigs,
  getAllBackendConfigs,
} from '../database/repositories/modules';
import {
  CharacterProfile,
} from '../database/models';
import ChatPreferencesService from '../services/ChatPreferencesService';
import syncService from '../services/SyncService';
import { resolvePersonaId } from '../database/repositories/personas';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type Props = NativeStackScreenProps<RootStackParamList, 'CreateAI'>;

/** Item rendered in the profile picker carousel ("create new" + existing). */
type ProfilePickerItem = Pick<
  CharacterProfile,
  'id' | 'name' | 'description'
>;

// ─────────────────────────────────────────────────────────────────────────────
// CreateAIScreen
// ─────────────────────────────────────────────────────────────────────────────

export const CreateAIScreen: React.FC<Props> = ({ route, navigation }) => {
  const { theme } = useAppTheme();
  const { showAlert } = useAppAlert();
  const { withExternalFlow } = useBiometricLock();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const { t } = useTranslation('createAI');

  // ── Core fields ──────────────────────────────────────────────────────────────
  const [name, setName] = useState('');
  const [personality, setPersonality] = useState('');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [avatarBase64, setAvatarBase64] = useState<string | null>(null);
  const [avatarMimeType, setAvatarMimeType] = useState<string>('image/jpeg');

  // ── Existing profile selection ('' = create a new profile) ───────────────────
  const [allProfiles, setAllProfiles] = useState<CharacterProfile[]>([]);
  const [profileImages, setProfileImages] = useState<
    Record<string, string | null>
  >({});
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [selectedProfile, setSelectedProfile] =
    useState<CharacterProfile | null>(null);
  const [selectedProfileImageUri, setSelectedProfileImageUri] = useState<
    string | null
  >(null);

  // Carousel ref — scrolls to the selected card when the picker opens
  const pickerListRef = useRef<FlatList<ProfilePickerItem>>(null);

  // ── Advanced toggle ──────────────────────────────────────────────────────────
  const [showAdvanced, setShowAdvanced] = useState(false);
  // UI-only: tracks the currently focused identity field for accent highlighting
  const [focusedField, setFocusedField] = useState<'name' | 'personality' | null>(null);

  // ── Module config selections (string IDs for picker; '' = disabled) ──────────
  const [cognitionConfigId, setCognitionConfigId] = useState('');
  const [ttsConfigId, setTtsConfigId] = useState('');
  const [sttConfigId, setSttConfigId] = useState('');
  const [visionConfigId, setVisionConfigId] = useState('');
  const [ragConfigId, setRagConfigId] = useState('');
  const [imaginationConfigId, setImaginationConfigId] = useState('');
  const [movementConfigId, setMovementConfigId] = useState('');
  const [backendConfigId, setBackendConfigId] = useState('');

  // ── Available module config lists (loaded lazily) ───────────────────────────
  const [cognitionConfigs, setCognitionConfigs] = useState<ModuleConfigOption[]>([]);
  const [ttsConfigs, setTtsConfigs] = useState<ModuleConfigOption[]>([]);
  const [sttConfigs, setSttConfigs] = useState<ModuleConfigOption[]>([]);
  const [visionConfigs, setVisionConfigs] = useState<ModuleConfigOption[]>([]);
  const [ragConfigs, setRagConfigs] = useState<ModuleConfigOption[]>([]);
  const [imaginationConfigs, setImaginationConfigs] = useState<ModuleConfigOption[]>([]);
  const [movementConfigs, setMovementConfigs] = useState<ModuleConfigOption[]>([]);
  const [backendConfigs, setBackendConfigs] = useState<ModuleConfigOption[]>([]);
  // null = not yet loaded, false = loaded but empty, true = has at least one
  const [hasAnyConfigs, setHasAnyConfigs] = useState<boolean | null>(null);

  // ── UI state ─────────────────────────────────────────────────────────────────
  const [isSaving, setIsSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 800);
  }, []);

  // ── Load module configs: on advanced-panel open AND when returning from
  //    ModuleConfigEdit so freshly created configs appear immediately ──────────
  const loadModuleConfigs = useCallback(async () => {
    try {
      const [cognition, tts, stt, vision, rag, imagination, movement, backend] = await Promise.all([
        getAllCognitionConfigs(),
        getAllTTSConfigs(),
        getAllSTTConfigs(),
        getAllVisionConfigs(),
        getAllRAGConfigs(),
        getAllImaginationConfigs(),
        getAllMovementConfigs(),
        getAllBackendConfigs(),
      ]);
      const toOptions = (
        configs: Array<{ id: string; name: string }>,
      ): ModuleConfigOption[] => configs.map(c => ({ id: String(c.id), name: c.name }));
      setCognitionConfigs(toOptions(cognition));
      setTtsConfigs(toOptions(tts));
      setSttConfigs(toOptions(stt));
      setVisionConfigs(toOptions(vision));
      setRagConfigs(toOptions(rag));
      setImaginationConfigs(toOptions(imagination));
      setMovementConfigs(toOptions(movement));
      setBackendConfigs(toOptions(backend));
      setHasAnyConfigs(
        cognition.length > 0 ||
          tts.length > 0 ||
          stt.length > 0 ||
          vision.length > 0 ||
          rag.length > 0 ||
          imagination.length > 0 ||
          movement.length > 0 ||
          backend.length > 0,
      );
    } catch {
      setHasAnyConfigs(false);
    }
  }, []);

  // Load when advanced panel first opens
  useEffect(() => {
    if (showAdvanced && hasAnyConfigs === null) {
      loadModuleConfigs();
    }
  }, [showAdvanced, hasAnyConfigs, loadModuleConfigs]);

  // Reload whenever the screen regains focus (e.g. returning from ModuleConfigEdit)
  useFocusEffect(
    useCallback(() => {
      if (showAdvanced) {
        loadModuleConfigs();
      }
    }, [showAdvanced, loadModuleConfigs]),
  );

  // ── Avatar picker ────────────────────────────────────────────────────────────
  const handlePickAvatar = async () => {
    try {
      // The system image picker backgrounds the app while open — run it as an
      // external flow so the app-lock is suspended for the round-trip.
      const result = await withExternalFlow(() =>
        launchImageLibrary({
          mediaType: 'photo',
          includeBase64: true,
          quality: 0.7,
        }),
      );
      if (result.assets?.[0]) {
        const asset = result.assets[0];
        setAvatarUri(asset.uri ?? null);
        setAvatarBase64(asset.base64 ?? null);
        setAvatarMimeType(asset.type ?? 'image/jpeg');
      }
    } catch (err) {
      log.error('Failed to pick avatar:', err);
    }
  };

  // ── Load existing profiles + their primary images (for the picker carousel) ──
  useEffect(() => {
    let cancelled = false;
    const loadProfiles = async () => {
      try {
        const profiles = await getAllCharacterProfiles();
        if (cancelled) return;
        setAllProfiles(profiles);

        // Load the primary image for every profile so the carousel cards show
        // a live avatar preview before the user confirms any selection.
        const imageMap: Record<string, string | null> = {};
        await Promise.all(
          profiles.map(async profile => {
            try {
              const images = await getCharacterImages(profile.id);
              const primary = images.find(img => img.is_primary === true);
              imageMap[profile.id] = primary
                ? createDataURL(primary.image_data, primary.mime_type)
                : null;
            } catch {
              imageMap[profile.id] = null;
            }
          }),
        );
        if (cancelled) return;
        setProfileImages(imageMap);

        // Honor prefillProfileId route param (e.g. "create partner from this profile")
        const prefillId = route.params?.prefillProfileId;
        if (prefillId) {
          const match = profiles.find(p => p.id === prefillId);
          if (match) {
            setSelectedProfileId(match.id);
            setSelectedProfile(match);
            setName(match.name);
            setPersonality(match.personality ?? '');
            setSelectedProfileImageUri(imageMap[match.id] ?? null);
          }
        }
      } catch (err) {
        log.error('Failed to load character profiles:', err);
      }
    };
    loadProfiles();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleProfileSelect = async (profileId: string) => {
    const profile = allProfiles.find(p => p.id === profileId) ?? null;
    setSelectedProfileId(profileId);
    setSelectedProfile(profile);
    if (profile) {
      // Prefill the identity fields from the selected profile
      setName(profile.name);
      setPersonality(profile.personality ?? '');
      // Use the already-loaded carousel image (no extra DB round-trip)
      setSelectedProfileImageUri(profileImages[profile.id] ?? null);
    } else {
      setSelectedProfileImageUri(null);
    }
  };

  const handleProfileClear = () => {
    setSelectedProfileId('');
    setSelectedProfile(null);
    setSelectedProfileImageUri(null);
    // Reset the prefilled identity fields so the "create new profile" card
    // doesn't keep the previous profile's name/personality.
    setName('');
    setPersonality('');
  };

  // ── Carousel data: "Create new profile" card + one card per existing profile ──
  const pickerItems = useMemo(
    () =>
      [
        { id: '', name: t('createNewProfile'), description: '' } as ProfilePickerItem,
        ...allProfiles,
      ] as ProfilePickerItem[],
    [allProfiles, t],
  );

  const scrollToSelectedProfile = useCallback(
    (index: number) => {
      requestAnimationFrame(() => {
        pickerListRef.current?.scrollToIndex({
          index,
          animated: true,
          viewPosition: 0.5,
        });
      });
    },
    [],
  );

  // Whenever the picker list is ready, center the selected card
  const handlePickerListReady = useCallback(() => {
    const selectedIndex = pickerItems.findIndex(
      item => (item.id === '' ? !selectedProfileId : item.id === selectedProfileId),
    );
    if (selectedIndex >= 0) {
      scrollToSelectedProfile(selectedIndex);
    }
  }, [pickerItems, selectedProfileId, scrollToSelectedProfile]);

  // ── Save & Create ────────────────────────────────────────────────────────────
  const handleCreate = async () => {
    if (!name.trim()) {
      showAlert(t('nameRequired'), t('nameRequiredMessage'));
      return;
    }

    setIsSaving(true);
    try {
      const entityId = name.trim();

      // 1. Either link an existing character profile or create a new one
      let profileId: string;
      if (selectedProfileId) {
        // Reuse the pre-existing profile — do NOT create a new persona
        profileId = selectedProfileId;
      } else {
        profileId = uuidv4();

        // Note: description, personality, voice_characteristics are NOT NULL in the
        // schema — use empty string fallback, never null.
        await createCharacterProfile({
          id: profileId,
          name: name.trim(),
          description: personality.trim() || '',
          personality: personality.trim() || '',
          voice_characteristics: '',
          typing_speed_wpm: 60,
          audio_response_chance_percent: 50,
          vision_config_id: null,
          lifecycle_config: '{}',
          base_prompt: '',
          scenario: '',
        });
        // Tag as user-created so it is hidden from the Discover community grid
        await setCharacterProfileSource(profileId, 'user');

        // 2. Add avatar image if selected (only for newly created profiles)
        if (avatarBase64 && avatarMimeType) {
          const now = new Date();
          await createCharacterImage({
            character_profile_id: profileId,
            image_data: avatarBase64,
            mime_type: avatarMimeType,
            description: '',
            is_primary: true,
            display_order: 0,
            vl_model_interpretation: '',
            vl_model: '',
            updated_at: now,
          });
        }
      }

      // 3. Create entity with alias = name (unique among non-deleted entities)
      try {
        await createEntity({
          id: entityId,
          alias: name.trim(),
          character_profile_id: profileId,
          lifecycle_config: '{}',
          rag_reindex_required: 1,
        });
      } catch (err: any) {
        // SQLite unique constraint violation on alias
        if (
          err?.message?.includes('UNIQUE') ||
          err?.message?.includes('alias')
        ) {
          showAlert(
            t('aliasConflictTitle'),
            t('aliasConflictMessage'),
          );
          setIsSaving(false);
          return;
        }
        throw err;
      }

      // 4. Create entity module mapping
      await createEntityModuleMapping({
        entity_id: entityId,
        backend_config_id: backendConfigId ?? null,
        cognition_config_id: cognitionConfigId ?? null,
        tts_config_id: ttsConfigId ?? null,
        stt_config_id: sttConfigId ?? null,
        vision_config_id: visionConfigId ?? null,
        rag_config_id: ragConfigId ?? null,
        imagination_config_id: imaginationConfigId ?? null,
        movement_config_id: movementConfigId ?? null,
        deleted_at: null,
      });

      // 4b. Push the new entity (and its profile/mapping) to the engine and WAIT
      // for the sync to complete before navigating. Without this, the engine
      // doesn't know about the entity yet when ChatDetail sends INIT_ENTITY, so
      // it rejects with entity_not_defined (chat stuck on "Connecting...").
      // initiateSync() alone only resolves once SYNC_REQUEST is *sent*;
      // syncAndWait resolves on SYNC_FINALIZE so the engine has actually
      // ingested the data. Best-effort: resolves on completion, terminal failure,
      // or timeout — never blocks navigation forever. isSaving stays true so the
      // spinner shows during the wait.
      try {
        await syncService.syncAndWait({ timeoutMs: 45_000 });
      } catch (syncErr) {
        log.warn('Auto-sync after entity creation failed (non-critical):', syncErr);
      }

      // 5. Resolve the persona we chat as (only personas — never AI
      //    characters — are valid identities; falls back to 'user').
      const storedId =
        await ChatPreferencesService.getGlobalImpersonatedEntity();
      const impersonatedEntityId = await resolvePersonaId(storedId);

      // 6. Navigate to ChatDetail — replace so back goes to ChatList, not here
      const participantIds = [impersonatedEntityId ?? 'user', entityId];
      const scope = deriveScopeFromParticipants(participantIds);
      const participantKey = deriveParticipantKey(participantIds, impersonatedEntityId ?? 'user', scope);
      const tempInteractionId = uuidv7();
      navigation.replace('ChatDetail', {
        interactionId: tempInteractionId,
        participantKey,
        participantIds,
        entityId: impersonatedEntityId ?? 'user',
        entityName: name,
      });
    } catch (err: any) {
      showAlert(
        t('common:error'),
        t('createFailed', { message: err?.message ?? 'Unknown error' }),
      );
    } finally {
      setIsSaving(false);
    }
  };

  // ── Render guard ─────────────────────────────────────────────────────────────
  if (!theme) return null;

  // ── Styles derived from theme ────────────────────────────────────────────────
  const accent = theme.colors.accent.primary;
  const secondaryAccent = theme.colors.accent.secondary;
  const surfaceColor = theme.colors.background.surface;
  const baseColor = theme.colors.background.base;
  const inputTextStyle = { color: theme.colors.text.primary };

  const isNameFocused = focusedField === 'name';
  const isPersonalityFocused = focusedField === 'personality';

  return (
    <ThemedView style={styles.container}>
      {/* ── Header ── */}
      <ScreenHeader
        title={t('title')}
        subtitle={t('profileHint')}
        onBack={() => navigation.goBack()}
      />

      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: 40 + safeBottom }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[accent]}
              tintColor={accent}
              progressBackgroundColor={surfaceColor}
            />
          }
        >
          {/* ── Hero: Avatar (only for new profiles) ── */}
          {!selectedProfile && (
            <View style={styles.hero}>
              <Icon
                name="creation"
                size={16}
                color={hexToRgba(secondaryAccent, 0.8)}
                style={styles.heroSparkleL}
              />
              <Icon
                name="star-four-points"
                size={12}
                color={hexToRgba(accent, 0.55)}
                style={styles.heroSparkleR}
              />

              <TouchableOpacity
                onPress={() => {
                  hapticLightPress();
                  handlePickAvatar();
                }}
                activeOpacity={0.85}
                style={styles.avatarPressable}
              >
                <ThemedGradient gradient="primary" style={styles.avatarRing}>
                  <View
                    style={[
                      styles.avatarInner,
                      { backgroundColor: theme.colors.background.elevated },
                    ]}
                  >
                    {avatarUri ? (
                      <Image
                        source={{ uri: avatarUri }}
                        style={styles.avatarImage}
                        resizeMode="cover"
                      />
                    ) : (
                      <View style={styles.avatarPlaceholder}>
                        <Icon
                          name="account-outline"
                          size={46}
                          color={hexToRgba(accent, 0.9)}
                        />
                        <ThemedText size={12} variant="muted" style={styles.avatarHint}>
                          {t('photo')}
                        </ThemedText>
                      </View>
                    )}
                  </View>
                </ThemedGradient>

                {/* Camera badge */}
                <View
                  style={[
                    styles.cameraBadge,
                    {
                      backgroundColor: surfaceColor,
                      borderColor: baseColor,
                    },
                  ]}
                >
                  <Icon name="camera" size={16} color={accent} />
                </View>
              </TouchableOpacity>

              {avatarUri ? (
                <TouchableOpacity
                  onPress={() => {
                    hapticLightPress();
                    handlePickAvatar();
                  }}
                  style={styles.changePhotoLink}
                >
                  <ThemedText size={13} variant="accent">
                    {t('changePhoto')}
                  </ThemedText>
                </TouchableOpacity>
              ) : (
                <ThemedText size={12} variant="muted" style={styles.heroCaption}>
                  {t('common:optional')}
                </ThemedText>
              )}
            </View>
          )}

          {/* ── Hero: Selected existing profile ── */}
          {selectedProfile && (
            <View style={styles.hero}>
              <TouchableOpacity
                onPress={() => {
                  hapticLightPress();
                  // Recenter the carousel on the currently selected card
                  const index = pickerItems.findIndex(
                    item => item.id === selectedProfileId,
                  );
                  if (index >= 0) scrollToSelectedProfile(index);
                }}
                activeOpacity={0.85}
                style={styles.avatarPressable}
              >
                <ThemedGradient gradient="primary" style={styles.avatarRing}>
                  <View
                    style={[
                      styles.avatarInner,
                      { backgroundColor: theme.colors.background.elevated },
                    ]}
                  >
                    {selectedProfileImageUri ? (
                      <Image
                        source={{ uri: selectedProfileImageUri }}
                        style={styles.avatarImage}
                        resizeMode="cover"
                      />
                    ) : (
                      <Icon name="account" size={46} color={hexToRgba(accent, 0.9)} />
                    )}
                  </View>
                </ThemedGradient>
              </TouchableOpacity>

              <ThemedText
                size={24}
                weight="bold"
                hierarchy="header"
                style={styles.selectedName}
              >
                {selectedProfile.name}
              </ThemedText>
              <ThemedText
                variant="muted"
                size={13}
                style={styles.selectedDescription}
                numberOfLines={4}
              >
                {selectedProfile.description ?? t('noDescription')}
              </ThemedText>

            </View>
          )}

          {/* ── Character Profile card — visual picker carousel ── */}
          <ThemedCard elevated accentStripe style={styles.section}>
            <SectionHeader title={t('profileLabel')} />
            <View style={styles.sectionContent}>
              <FlatList
                ref={pickerListRef}
                data={pickerItems}
                keyExtractor={item => item.id || 'new-profile'}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.pickerListContent}
                onLayout={handlePickerListReady}
                onScrollToIndexFailed={() => {
                  // Scroll target may not be measured on first pass — the next
                  // onLayout/selection change recenters it.
                }}
                initialNumToRender={8}
                renderItem={({ item }) => {
                  const isNew = item.id === '';
                  const isSelected = isNew
                    ? !selectedProfileId
                    : item.id === selectedProfileId;
                  return (
                    <ProfilePickerCard
                      title={isNew ? t('createNewProfile') : item.name}
                      subtitle={
                        isNew
                          ? t('createNewProfileHint')
                          : item.description ?? t('noDescription')
                      }
                      imageUri={isNew ? null : profileImages[item.id] ?? null}
                      isNew={isNew}
                      isSelected={isSelected}
                      onPress={() => {
                        hapticLightPress();
                        if (isNew) {
                          handleProfileClear();
                        } else {
                          handleProfileSelect(item.id);
                        }
                      }}
                    />
                  );
                }}
              />
            </View>
          </ThemedCard>

          {/* ── Identity fields ── */}
          <View style={styles.fieldsSection}>
            {/* Name field (entity alias) */}
            <View style={styles.fieldGroup}>
              <ThemedText size={12} variant="secondary" weight="medium" style={styles.fieldLabel}>
                {t('nameLabel')}
              </ThemedText>
              <View
                style={[
                  styles.inputShell,
                  {
                    backgroundColor: hexToRgba(surfaceColor, 0.55),
                    borderColor: isNameFocused ? accent : theme.colors.border.default,
                  },
                ]}
              >
                <Icon
                  name="account-edit"
                  size={20}
                  color={isNameFocused ? accent : theme.colors.text.muted}
                />
                <TextInput
                  style={[styles.input, inputTextStyle]}
                  value={name}
                  onChangeText={setName}
                  onFocus={() => setFocusedField('name')}
                  onBlur={() => setFocusedField(null)}
                  placeholder={t('namePlaceholder')}
                  placeholderTextColor={theme.colors.text.muted}
                  returnKeyType="next"
                  autoCorrect={false}
                />
              </View>
            </View>

            {/* Personality field (only for new profiles) */}
            {!selectedProfile && (
              <View style={styles.fieldGroup}>
                <ThemedText size={12} variant="secondary" weight="medium" style={styles.fieldLabel}>
                  {t('personalityLabel')}
                </ThemedText>
                <View
                  style={[
                    styles.inputShell,
                    styles.multilineShell,
                    {
                      backgroundColor: hexToRgba(surfaceColor, 0.55),
                      borderColor: isPersonalityFocused
                        ? accent
                        : theme.colors.border.default,
                    },
                  ]}
                >
                  <Icon
                    name="message-text-outline"
                    size={20}
                    color={isPersonalityFocused ? accent : theme.colors.text.muted}
                    style={styles.multilineIcon}
                  />
                  <TextInput
                    style={[styles.input, styles.multilineInput, inputTextStyle]}
                    value={personality}
                    onChangeText={setPersonality}
                    onFocus={() => setFocusedField('personality')}
                    onBlur={() => setFocusedField(null)}
                    placeholder={t('personalityPlaceholder')}
                    placeholderTextColor={theme.colors.text.muted}
                    multiline
                    numberOfLines={3}
                    textAlignVertical="top"
                  />
                </View>
              </View>
            )}
          </View>

          {/* ── Advanced Settings card ── */}
          <ThemedCard elevated accentStripe accentTint style={styles.section}>
            <TouchableOpacity
              onPress={() => setShowAdvanced(prev => !prev)}
              activeOpacity={0.7}
            >
              <SectionHeader
                title={t('advancedSettings')}
                right={
                  <Icon
                    name={showAdvanced ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={theme.colors.text.muted}
                  />
                }
              />
            </TouchableOpacity>

            {showAdvanced && (
              <View style={styles.sectionContent}>
                {/* Loading indicator (only while first load is in flight) */}
                {hasAnyConfigs === null && (
                  <View style={styles.loadingRow}>
                    <ActivityIndicator
                      size="small"
                      color={accent}
                    />
                    <ThemedText size={13} variant="muted" style={{ marginLeft: 8 }}>
                      {t('loadingConfigs')}
                    </ThemedText>
                  </View>
                )}

                {/* Module pickers — always visible so configs can be
                    selected, created, or edited right here. The selector
                    falls back to "Disabled" when no config exists yet, and
                    the ＋ button opens ModuleConfigEdit to create one. */}
                <EntityModuleSelectorWithActions
                  label={t('moduleBackend')}
                  moduleType="backend"
                  configs={backendConfigs}
                  selectedId={backendConfigId}
                  onChange={setBackendConfigId}
                  isLoading={hasAnyConfigs === null}
                />
                <EntityModuleSelectorWithActions
                  label={t('moduleCognition')}
                  moduleType="cognition"
                  configs={cognitionConfigs}
                  selectedId={cognitionConfigId}
                  onChange={setCognitionConfigId}
                  isLoading={hasAnyConfigs === null}
                />
                <EntityModuleSelectorWithActions
                  label={t('moduleTTS')}
                  moduleType="tts"
                  configs={ttsConfigs}
                  selectedId={ttsConfigId}
                  onChange={setTtsConfigId}
                  isLoading={hasAnyConfigs === null}
                />
                <EntityModuleSelectorWithActions
                  label={t('moduleSTT')}
                  moduleType="stt"
                  configs={sttConfigs}
                  selectedId={sttConfigId}
                  onChange={setSttConfigId}
                  isLoading={hasAnyConfigs === null}
                />
                <EntityModuleSelectorWithActions
                  label={t('moduleRAG')}
                  moduleType="rag"
                  configs={ragConfigs}
                  selectedId={ragConfigId}
                  onChange={setRagConfigId}
                  isLoading={hasAnyConfigs === null}
                />
                <EntityModuleSelectorWithActions
                  label={t('moduleMovement')}
                  moduleType="movement"
                  configs={movementConfigs}
                  selectedId={movementConfigId}
                  onChange={setMovementConfigId}
                  isLoading={hasAnyConfigs === null}
                />
                <EntityModuleSelectorWithActions
                  label={t('moduleVision')}
                  moduleType="vision"
                  configs={visionConfigs}
                  selectedId={visionConfigId}
                  onChange={setVisionConfigId}
                  isLoading={hasAnyConfigs === null}
                />
                <EntityModuleSelectorWithActions
                  label={t('moduleImagination')}
                  moduleType="imagination"
                  configs={imaginationConfigs}
                  selectedId={imaginationConfigId}
                  onChange={setImaginationConfigId}
                  isLoading={hasAnyConfigs === null}
                />
              </View>
            )}
          </ThemedCard>

          {/* ── Create button ── */}
          <View style={styles.ctaSection}>
            {isSaving ? (
              <ActivityIndicator
                size="large"
                color={accent}
              />
            ) : (
              <ThemedButton
                label={t('startChatting')}
                onPress={handleCreate}
                variant="primary"
                icon="creation"
                disabled={isSaving}
              />
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    elevation: 0,
  },
  keyboardAvoid: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },

  // ── Hero avatar ──
  hero: {
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 28,
  },
  heroSparkleL: {
    position: 'absolute',
    top: 8,
    left: 36,
  },
  heroSparkleR: {
    position: 'absolute',
    top: 34,
    right: 42,
  },
  avatarPressable: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarRing: {
    width: 148,
    height: 148,
    borderRadius: 74,
    padding: 3,
  },
  avatarInner: {
    flex: 1,
    borderRadius: 71,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarHint: {
    marginTop: 6,
  },
  cameraBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  changePhotoLink: {
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  heroCaption: {
    marginTop: 10,
  },

  // ── Selected profile hero ──
  selectedName: {
    marginTop: 16,
    textAlign: 'center',
  },
  selectedDescription: {
    marginTop: 6,
    textAlign: 'center',
    lineHeight: 19,
    paddingHorizontal: 24,
  },

  // ── Profile picker carousel ──
  pickerListContent: {
    paddingHorizontal: 4,
    paddingVertical: 6,
  },

  // ── Identity fields ──
  fieldsSection: {
    marginBottom: 4,
  },
  fieldGroup: {
    marginBottom: 18,
  },
  fieldLabel: {
    marginBottom: 8,
    marginLeft: 4,
  },
  inputShell: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    gap: 10,
    minHeight: 52,
  },
  multilineShell: {
    alignItems: 'flex-start',
    paddingTop: 13,
  },
  multilineIcon: {
    marginTop: 2,
  },
  input: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 10,
    minHeight: 44,
  },
  multilineInput: {
    minHeight: 88,
  },

  // ── Section card ──
  section: {
    padding: 0,
    overflow: 'hidden',
    marginBottom: 16,
  },
  sectionContent: {
    padding: 16,
    gap: 0,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },

  // ── CTA ──
  ctaSection: {
    marginTop: 8,
    minHeight: 56,
    justifyContent: 'center',
  },
});
