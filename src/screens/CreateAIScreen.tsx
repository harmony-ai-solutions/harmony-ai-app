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

import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  TextInput,
  ActivityIndicator,
  TouchableOpacity,
  Image,
  Modal,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import { ThemedCard } from '../components/themed/ThemedCard';
import { ScreenHeader } from '../components/themed/ScreenHeader';
import { SectionHeader } from '../components/themed/SectionHeader';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { launchImageLibrary } from 'react-native-image-picker';
import { v4 as uuidv4, v7 as uuidv7 } from 'uuid';
import { useTranslation } from 'react-i18next';
import { deriveParticipantKey, deriveScopeFromParticipants } from '../database/repositories/interactions';
import { createLogger } from '../utils/logger';

const log = createLogger('[CreateAIScreen]');

import { RootStackParamList } from '../navigation/AppNavigator';
import { useAppTheme } from '../contexts/ThemeContext';
import { useAppAlert } from '../contexts/AppAlertContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedText } from '../components/themed/ThemedText';
import { ThemedButton } from '../components/themed/ThemedButton';

import {
  createCharacterProfile,
  createCharacterImage,
  getAllCharacterProfiles,
  getCharacterImages,
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
  CognitionConfig,
  TTSConfig,
  STTConfig,
  VisionConfig,
  RAGConfig,
  ImaginationConfig,
  MovementConfig,
  BackendConfig,
  CharacterProfile,
} from '../database/models';
import ChatPreferencesService from '../services/ChatPreferencesService';
import { getAllEntities } from '../database/repositories/entities';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type Props = NativeStackScreenProps<RootStackParamList, 'CreateAI'>;

interface PickerOption {
  label: string;
  value: string; // '' means "Disabled / none"
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline ModuleConfigPicker component
// ─────────────────────────────────────────────────────────────────────────────

interface ModuleConfigPickerProps {
  label: string;
  options: PickerOption[];
  value: string;
  onChange: (value: string) => void;
}

const ModuleConfigPicker: React.FC<ModuleConfigPickerProps> = ({
  label,
  options,
  value,
  onChange,
}) => {
  const { theme } = useAppTheme();
  const [modalVisible, setModalVisible] = useState(false);

  if (!theme) return null;

  const selectedLabel =
    options.find(o => o.value === value)?.label ?? 'Disabled';
  const isDisabled = value === '';
  const accentPrimary = theme.colors.accent.primary;
  const accentSecondary =
    theme.colors.accent.secondary ?? theme.colors.accent.primaryHover;

  return (
    <View style={pickerStyles.row}>
      <ThemedText size={13} variant="secondary" style={pickerStyles.label}>
        {label}
      </ThemedText>

      {/* Selector button */}
      <TouchableOpacity
        style={[
          pickerStyles.selector,
          {
            borderColor: isDisabled
              ? theme.colors.border.default
              : accentPrimary + '66',
          },
        ]}
        onPress={() => setModalVisible(true)}
        activeOpacity={0.7}
      >
        <LinearGradient
          colors={
            isDisabled
              ? [theme.colors.background.elevated, theme.colors.background.surface]
              : [accentPrimary + '1A', theme.colors.background.elevated]
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
        {!isDisabled && (
          <LinearGradient
            colors={[accentPrimary, accentSecondary]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={pickerStyles.selectorPip}
          />
        )}
        <View style={pickerStyles.selectorInner}>
          <ThemedText
            size={14}
            variant={isDisabled ? 'muted' : 'primary'}
            style={{ flex: 1 }}
          >
            {selectedLabel}
          </ThemedText>
          <ThemedText size={18} variant={isDisabled ? 'muted' : 'accent'}>
            ▾
          </ThemedText>
        </View>
      </TouchableOpacity>

      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
      >
        <TouchableOpacity
          style={pickerStyles.modalOverlay}
          activeOpacity={1}
          onPress={() => setModalVisible(false)}
        >
          <TouchableOpacity activeOpacity={1} style={pickerStyles.sheetWrapper}>
            {/* Sheet gradient */}
            <LinearGradient
              colors={[
                theme.colors.background.elevated,
                theme.colors.background.surface,
              ]}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={[
                StyleSheet.absoluteFill,
                pickerStyles.sheetGradientRadius,
              ]}
            />
            {/* Drag handle */}
            <View style={pickerStyles.dragHandleContainer}>
              <View
                style={[
                  pickerStyles.dragHandle,
                  { backgroundColor: theme.colors.border.default },
                ]}
              />
            </View>
            {/* Accent stripe */}
            <LinearGradient
              colors={[
                accentPrimary + 'CC',
                accentSecondary + '66',
                'transparent',
              ]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={pickerStyles.sheetTopStripe}
            />
            {/* Title */}
            <View style={pickerStyles.modalTitleRow}>
              <ThemedText weight="bold" size={15}>
                {label}
              </ThemedText>
            </View>
            {/* Separator */}
            <View
              style={[
                pickerStyles.separator,
                { backgroundColor: theme.colors.border.default + '66' },
              ]}
            />
            {/* Options */}
            <FlatList
              data={options}
              keyExtractor={item => item.value}
              style={pickerStyles.optionsList}
              renderItem={({ item }) => {
                const isSelected = item.value === value;
                return (
                  <TouchableOpacity
                    style={[
                      pickerStyles.modalItem,
                      isSelected && {
                        backgroundColor: accentPrimary + '1A',
                      },
                    ]}
                    onPress={() => {
                      onChange(item.value);
                      setModalVisible(false);
                    }}
                    activeOpacity={0.65}
                  >
                    {isSelected && (
                      <LinearGradient
                        colors={[accentPrimary, accentSecondary]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 0, y: 1 }}
                        style={pickerStyles.itemAccentPip}
                      />
                    )}
                    <ThemedText
                      size={14}
                      variant={isSelected ? 'accent' : 'primary'}
                      weight={isSelected ? 'medium' : 'normal'}
                      style={{ flex: 1, paddingLeft: isSelected ? 10 : 0 }}
                    >
                      {item.label}
                    </ThemedText>
                    {isSelected && (
                      <ThemedText size={14} variant="accent">
                        ✓
                      </ThemedText>
                    )}
                  </TouchableOpacity>
                );
              }}
            />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const pickerStyles = StyleSheet.create({
  row: { gap: 6, marginBottom: 12 },
  label: { paddingLeft: 2 },
  selector: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    minHeight: 44,
    overflow: 'hidden',
  },
  selectorPip: {
    width: 3,
    alignSelf: 'stretch',
  },
  selectorInner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheetWrapper: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 36,
    maxHeight: '70%',
    overflow: 'hidden',
  },
  sheetGradientRadius: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  dragHandleContainer: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 4,
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    opacity: 0.5,
  },
  sheetTopStripe: { height: 2 },
  modalTitleRow: {
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
  },
  optionsList: { flexGrow: 0 },
  modalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  itemAccentPip: {
    width: 3,
    height: 20,
    borderRadius: 2,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// CreateAIScreen
// ─────────────────────────────────────────────────────────────────────────────

export const CreateAIScreen: React.FC<Props> = ({ route, navigation }) => {
  const { theme } = useAppTheme();
  const { showAlert } = useAppAlert();
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
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [selectedProfile, setSelectedProfile] =
    useState<CharacterProfile | null>(null);
  const [selectedProfileImageUri, setSelectedProfileImageUri] = useState<
    string | null
  >(null);
  const [profilePickerVisible, setProfilePickerVisible] = useState(false);

  // ── Advanced toggle ──────────────────────────────────────────────────────────
  const [showAdvanced, setShowAdvanced] = useState(false);

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
  const [cognitionConfigs, setCognitionConfigs] = useState<CognitionConfig[]>(
    [],
  );
  const [ttsConfigs, setTtsConfigs] = useState<TTSConfig[]>([]);
  const [sttConfigs, setSttConfigs] = useState<STTConfig[]>([]);
  const [visionConfigs, setVisionConfigs] = useState<VisionConfig[]>([]);
  const [ragConfigs, setRagConfigs] = useState<RAGConfig[]>([]);
  const [imaginationConfigs, setImaginationConfigs] = useState<ImaginationConfig[]>([]);
  const [movementConfigs, setMovementConfigs] = useState<MovementConfig[]>([]);
  const [backendConfigs, setBackendConfigs] = useState<BackendConfig[]>([]);
  // null = not yet loaded, false = loaded but empty, true = has at least one
  const [hasAnyConfigs, setHasAnyConfigs] = useState<boolean | null>(null);

  // ── UI state ─────────────────────────────────────────────────────────────────
  const [isSaving, setIsSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 800);
  }, []);

  // ── Load module configs when advanced panel first opens ──────────────────────
  useEffect(() => {
    if (showAdvanced && hasAnyConfigs === null) {
      loadModuleConfigs();
    }
  }, [showAdvanced]);

  const loadModuleConfigs = async () => {
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
      setCognitionConfigs(cognition);
      setTtsConfigs(tts);
      setSttConfigs(stt);
      setVisionConfigs(vision);
      setRagConfigs(rag);
      setImaginationConfigs(imagination);
      setMovementConfigs(movement);
      setBackendConfigs(backend);
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
  };

  // ── Avatar picker ────────────────────────────────────────────────────────────
  const handlePickAvatar = async () => {
    try {
      const result = await launchImageLibrary({
        mediaType: 'photo',
        includeBase64: true,
        quality: 0.7,
      });
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

  // ── Load existing profiles (for "use existing profile" mode) ─────────────────
  useEffect(() => {
    let cancelled = false;
    const loadProfiles = async () => {
      try {
        const profiles = await getAllCharacterProfiles();
        if (cancelled) return;
        setAllProfiles(profiles);

        // Honor prefillProfileId route param (e.g. "create partner from this profile")
        const prefillId = route.params?.prefillProfileId;
        if (prefillId) {
          const match = profiles.find(p => p.id === prefillId);
          if (match) {
            setSelectedProfileId(match.id);
            setSelectedProfile(match);
            setName(match.name);
            setPersonality(match.personality ?? '');
            await loadProfilePreviewImage(match.id);
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

  const loadProfilePreviewImage = async (profileId: string) => {
    try {
      const images = await getCharacterImages(profileId);
      const primary = images.find(img => img.is_primary === true);
      setSelectedProfileImageUri(
        primary ? createDataURL(primary.image_data, primary.mime_type) : null,
      );
    } catch {
      setSelectedProfileImageUri(null);
    }
  };

  const handleProfileSelect = async (profileId: string) => {
    const profile = allProfiles.find(p => p.id === profileId) ?? null;
    setSelectedProfileId(profileId);
    setSelectedProfile(profile);
    setSelectedProfileImageUri(null);
    setProfilePickerVisible(false);
    if (profile) {
      // Prefill the identity fields from the selected profile
      setName(profile.name);
      setPersonality(profile.personality ?? '');
      await loadProfilePreviewImage(profile.id);
    }
  };

  const handleProfileClear = () => {
    setSelectedProfileId('');
    setSelectedProfile(null);
    setSelectedProfileImageUri(null);
    setProfilePickerVisible(false);
  };

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

        // Note: description, personality, appearance, backstory, voice_characteristics
        // are NOT NULL in the schema — use empty string fallback, never null.
        await createCharacterProfile({
          id: profileId,
          name: name.trim(),
          description: personality.trim() || '',
          personality: personality.trim() || '',
          appearance: '',
          backstory: '',
          voice_characteristics: '',
          typing_speed_wpm: 60,
          audio_response_chance_percent: 50,
          vision_config_id: null,
          lifecycle_config: '{}',
          base_prompt: '',
          scenario: '',
          example_dialogues: '',
        });

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

      // 5. Resolve the impersonated entity for ChatDetail
      const allEntities = await getAllEntities();
      const storedId =
        await ChatPreferencesService.getGlobalImpersonatedEntity();
      let impersonatedEntityId = storedId;
      if (
        !impersonatedEntityId ||
        !allEntities.some(e => e.id === impersonatedEntityId)
      ) {
        const userEntity = allEntities.find(e => e.id === 'user');
        impersonatedEntityId = userEntity
          ? userEntity.id
          : (allEntities[0]?.id ?? 'user');
      }

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

  // ── Build picker options ─────────────────────────────────────────────────────
  const backendOptions: PickerOption[] = [
    { label: 'Disabled', value: '' },
    ...backendConfigs.map(c => ({ label: c.name, value: String(c.id) })),
  ];
  const cognitionOptions: PickerOption[] = [
    { label: 'Disabled', value: '' },
    ...cognitionConfigs.map(c => ({ label: c.name, value: String(c.id) })),
  ];
  const ttsOptions: PickerOption[] = [
    { label: 'Disabled', value: '' },
    ...ttsConfigs.map(c => ({ label: c.name, value: String(c.id) })),
  ];
  const sttOptions: PickerOption[] = [
    { label: 'Disabled', value: '' },
    ...sttConfigs.map(c => ({ label: c.name, value: String(c.id) })),
  ];
  const ragOptions: PickerOption[] = [
    { label: 'Disabled', value: '' },
    ...ragConfigs.map(c => ({ label: c.name, value: String(c.id) })),
  ];
  const movementOptions: PickerOption[] = [
    { label: 'Disabled', value: '' },
    ...movementConfigs.map(c => ({ label: c.name, value: String(c.id) })),
  ];
  const visionOptions: PickerOption[] = [
    { label: 'Disabled', value: '' },
    ...visionConfigs.map(c => ({ label: c.name, value: String(c.id) })),
  ];  
  const imaginationOptions: PickerOption[] = [
    { label: 'Disabled', value: '' },
    ...imaginationConfigs.map(c => ({ label: c.name, value: String(c.id) })),
  ];

  // ── Render guard ─────────────────────────────────────────────────────────────
  if (!theme) return null;

  // ── Styles derived from theme ────────────────────────────────────────────────
  const inputStyle = {
    color: theme.colors.text.primary,
    borderColor: theme.colors.border.default,
    backgroundColor: theme.colors.background.base,
  };

  return (
    <ThemedView style={styles.container}>
      {/* ── Header ── */}
      <ScreenHeader
        title={t('title')}
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
              colors={[theme.colors.accent.primary]}
              tintColor={theme.colors.accent.primary}
              progressBackgroundColor={theme.colors.background.surface}
            />
          }
        >
          {/* ── Character Profile section ── */}
          <ThemedCard elevated accentStripe style={styles.section}>
            <SectionHeader title={t('profileLabel')} />
            <View style={styles.sectionContent}>
              {/* Profile selector */}
              <TouchableOpacity
                style={[
                  styles.profileSelector,
                  {
                    borderColor: theme.colors.border.default,
                    backgroundColor: theme.colors.background.base,
                  },
                ]}
                onPress={() => setProfilePickerVisible(true)}
                activeOpacity={0.7}
              >
                <ThemedText
                  size={14}
                  variant={selectedProfile ? 'primary' : 'muted'}
                  style={styles.profileSelectorLabel}
                >
                  {selectedProfile ? selectedProfile.name : t('createNewProfile')}
                </ThemedText>
                <ThemedText size={14} variant="muted">
                  ▾
                </ThemedText>
              </TouchableOpacity>

              {/* Profile preview when an existing profile is linked */}
              {selectedProfile && (
                <View
                  style={[
                    styles.profilePreview,
                    {
                      backgroundColor: theme.colors.background.base,
                      borderColor: theme.colors.border.default,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.previewAvatar,
                      { backgroundColor: theme.colors.background.elevated },
                    ]}
                  >
                    {selectedProfileImageUri ? (
                      <Image
                        source={{ uri: selectedProfileImageUri }}
                        style={styles.previewAvatarImage}
                        resizeMode="cover"
                      />
                    ) : (
                      <Icon
                        name="account"
                        size={24}
                        color={theme.colors.text.muted}
                      />
                    )}
                  </View>
                  <View style={styles.previewText}>
                    <ThemedText weight="bold" size={14}>
                      {selectedProfile.name}
                    </ThemedText>
                    <ThemedText variant="muted" size={12} numberOfLines={1}>
                      {selectedProfile.description ?? t('noDescription')}
                    </ThemedText>
                  </View>
                  <TouchableOpacity
                    onPress={() =>
                      navigation.navigate('CharacterProfileEdit', {
                        profileId: selectedProfile.id,
                      })
                    }
                    style={styles.editProfileButton}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Icon
                      name="pencil"
                      size={18}
                      color={theme.colors.accent.primary}
                    />
                  </TouchableOpacity>
                </View>
              )}

              {/* Hint — only in "create new" mode */}
              {!selectedProfile && (
                <ThemedText variant="muted" size={12} style={styles.profileHint}>
                  {t('profileHint')}
                </ThemedText>
              )}
            </View>
          </ThemedCard>

          {/* ── Avatar Picker (only for new profiles) ── */}
          {!selectedProfile && (
            <View style={styles.avatarSection}>
            <TouchableOpacity
              style={[
                styles.avatarButton,
                {
                  borderColor: theme.colors.border.default,
                  backgroundColor: theme.colors.background.elevated,
                },
              ]}
              onPress={handlePickAvatar}
              activeOpacity={0.7}
            >
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
              ) : (
                <View style={styles.avatarPlaceholder}>
                  <ThemedText size={28} variant="muted">
                    📷
                  </ThemedText>
                  <ThemedText
                    size={12}
                    variant="muted"
                    style={styles.avatarHint}
                  >
                    {t('photo')}
                  </ThemedText>
                  <ThemedText size={11} variant="muted">
                    {t('common:optional')}
                  </ThemedText>
                </View>
              )}
            </TouchableOpacity>
            {avatarUri && (
              <TouchableOpacity
                onPress={handlePickAvatar}
                style={styles.changePhotoLink}
              >
                <ThemedText size={13} variant="accent">
                  {t('changePhoto')}
                </ThemedText>
              </TouchableOpacity>
            )}
          </View>
          )}

          {/* ── Name field (entity alias) ── */}
          <View style={styles.fieldGroup}>
            <ThemedText size={13} variant="secondary" style={styles.fieldLabel}>
              {t('nameLabel')}
            </ThemedText>
            <TextInput
              style={[styles.input, inputStyle]}
              value={name}
              onChangeText={setName}
              placeholder={t('namePlaceholder')}
              placeholderTextColor={theme.colors.text.muted}
              returnKeyType="next"
              autoCorrect={false}
            />
          </View>

          {/* ── Personality field (only for new profiles) ── */}
          {!selectedProfile && (
            <View style={styles.fieldGroup}>
              <ThemedText size={13} variant="secondary" style={styles.fieldLabel}>
                {t('personalityLabel')}
              </ThemedText>
              <TextInput
                style={[styles.input, styles.multilineInput, inputStyle]}
                value={personality}
                onChangeText={setPersonality}
                placeholder={t('personalityPlaceholder')}
                placeholderTextColor={theme.colors.text.muted}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
            </View>
          )}

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
                {/* Loading indicator */}
                {hasAnyConfigs === null && (
                  <View style={styles.loadingRow}>
                    <ActivityIndicator
                      size="small"
                      color={theme.colors.accent.primary}
                    />
                    <ThemedText size={13} variant="muted" style={{ marginLeft: 8 }}>
                      {t('loadingConfigs')}
                    </ThemedText>
                  </View>
                )}

                {/* No configs warning */}
                {hasAnyConfigs === false && (
                  <View style={styles.noConfigsBox}>
                    <ThemedText size={14} variant="muted" weight="bold" style={styles.noConfigsWarning}>
                      {t('noConfigsWarning')}
                    </ThemedText>
                    <ThemedText size={13} variant="muted" style={styles.noConfigsDetail}>
                      {t('noConfigsDetail')}
                    </ThemedText>
                    <TouchableOpacity
                      onPress={() => navigation.navigate('ConnectionSetup')}
                      style={styles.connectionSetupLink}
                    >
                      <ThemedText size={13} variant="accent" weight="medium">
                        {t('connectionSetup')}
                      </ThemedText>
                    </TouchableOpacity>
                  </View>
                )}

                {/* Module pickers */}
                {hasAnyConfigs === true && (
                  <>
                    <ModuleConfigPicker label={t('moduleBackend')} options={backendOptions} value={backendConfigId} onChange={setBackendConfigId} />
                    <ModuleConfigPicker label={t('moduleCognition')} options={cognitionOptions} value={cognitionConfigId} onChange={setCognitionConfigId} />
                    <ModuleConfigPicker label={t('moduleTTS')} options={ttsOptions} value={ttsConfigId} onChange={setTtsConfigId} />
                    <ModuleConfigPicker label={t('moduleSTT')} options={sttOptions} value={sttConfigId} onChange={setSttConfigId} />
                    <ModuleConfigPicker label={t('moduleRAG')} options={ragOptions} value={ragConfigId} onChange={setRagConfigId} />
                    <ModuleConfigPicker label={t('moduleMovement')} options={movementOptions} value={movementConfigId} onChange={setMovementConfigId} />
                    <ModuleConfigPicker label={t('moduleVision')} options={visionOptions} value={visionConfigId} onChange={setVisionConfigId} />
                    <ModuleConfigPicker label={t('moduleImagination')} options={imaginationOptions} value={imaginationConfigId} onChange={setImaginationConfigId} />
                  </>
                )}
              </View>
            )}
          </ThemedCard>

          {/* ── Create button ── */}
          <View style={styles.ctaSection}>
            {isSaving ? (
              <ActivityIndicator
                size="large"
                color={theme.colors.accent.primary}
              />
            ) : (
              <ThemedButton
                label={t('startChatting')}
                onPress={handleCreate}
                variant="primary"
                disabled={isSaving}
              />
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── Profile Picker Modal ── */}
      <Modal
        visible={profilePickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setProfilePickerVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setProfilePickerVisible(false)}
        >
          <View
            style={[
              styles.modalSheet,
              { backgroundColor: theme.colors.background.elevated },
            ]}
          >
            <ThemedText weight="bold" size={15} style={styles.modalTitle}>
              {t('selectProfile')}
            </ThemedText>

            <FlatList
              data={
                [
                  { id: '', name: t('createNewProfile') } as Pick<
                    CharacterProfile,
                    'id' | 'name'
                  >,
                  ...allProfiles,
                ] as Array<Pick<CharacterProfile, 'id' | 'name'>>
              }
              keyExtractor={item => item.id || 'new-profile'}
              renderItem={({ item }) => {
                const isNew = item.id === '';
                const isSelected = isNew
                  ? !selectedProfileId
                  : item.id === selectedProfileId;
                return (
                  <TouchableOpacity
                    style={[
                      styles.modalItem,
                      isSelected && {
                        backgroundColor: theme.colors.accent.primary + '22',
                      },
                    ]}
                    onPress={() => {
                      if (isNew) {
                        handleProfileClear();
                      } else {
                        handleProfileSelect(item.id);
                      }
                    }}
                  >
                    <ThemedText
                      size={14}
                      variant={
                        isSelected ? 'accent' : isNew ? 'muted' : 'primary'
                      }
                      weight={isSelected ? 'medium' : 'normal'}
                      style={styles.modalItemLabel}
                    >
                      {item.name}
                    </ThemedText>
                    {isSelected && (
                      <ThemedText size={14} variant="accent">
                        ✓
                      </ThemedText>
                    )}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </TouchableOpacity>
      </Modal>
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

  // ── Profile selector ──
  profileSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
    marginBottom: 12,
  },
  profileSelectorLabel: {
    flex: 1,
  },
  profileHint: {
    lineHeight: 16,
  },

  // ── Profile preview ──
  profilePreview: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
    gap: 12,
    marginBottom: 12,
  },
  previewAvatar: {
    width: 44,
    height: 44,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    flexShrink: 0,
  },
  previewAvatarImage: { width: '100%', height: '100%' },
  previewText: { flex: 1, gap: 2 },
  editProfileButton: { padding: 4 },

  // ── Modal ──
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 12,
    paddingBottom: 32,
    maxHeight: '70%',
  },
  modalTitle: {
    textAlign: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    marginBottom: 4,
  },
  modalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  modalItemLabel: {
    flex: 1,
  },

  // ── Avatar ──
  avatarSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  avatarButton: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    borderStyle: 'dashed',
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 60,
  },
  avatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarHint: {
    marginTop: 4,
  },
  changePhotoLink: {
    marginTop: 8,
  },

  // ── Fields ──
  fieldGroup: {
    marginBottom: 16,
  },
  fieldLabel: {
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    minHeight: 44,
  },
  multilineInput: {
    minHeight: 88,
    paddingTop: 10,
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

  // ── No configs ──
  noConfigsBox: {
    paddingVertical: 8,
  },
  noConfigsWarning: {
    marginBottom: 4,
  },
  noConfigsDetail: {
    marginBottom: 12,
    lineHeight: 18,
  },
  connectionSetupLink: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
  },

  // ── CTA ──
  ctaSection: {
    marginTop: 8,
    minHeight: 52,
    justifyContent: 'center',
  },
});
