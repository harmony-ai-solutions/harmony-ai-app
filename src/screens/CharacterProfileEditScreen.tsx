import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  RefreshControl,
  Share,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemedCard } from '../components/themed/ThemedCard';
import { SectionHeader } from '../components/themed/SectionHeader';
import { ScreenHeader } from '../components/themed/ScreenHeader';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { launchImageLibrary } from 'react-native-image-picker';
import { useTranslation } from 'react-i18next';
import { v4 as uuidv4 } from 'uuid';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import RNFS from 'react-native-fs';
import { RootStackParamList } from '../navigation/AppNavigator';
import { useAppTheme } from '../contexts/ThemeContext';
import { useAppAlert } from '../contexts/AppAlertContext';
import { useBiometricLock } from '../contexts/BiometricLockContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedText } from '../components/themed/ThemedText';
import { ThemedButton } from '../components/themed/ThemedButton';
import { hapticLightPress } from '../utils/haptics';
import { ProfileImagePicker } from '../components/characters/ProfileImagePicker';
import { GreetingBubble } from '../components/chat/GreetingBubble';
import { GreetingEditor } from '../components/character-card/GreetingEditor';
import { AlternateGreetingsManager } from '../components/character-card/AlternateGreetingsManager';
import { LorebookViewerSheet } from '../components/character-card/LorebookViewerSheet';
import { CreatorAttributionBadge } from '../components/character-card/CreatorAttributionBadge';
import { TagChips } from '../components/character-card/TagChips';
import { MacroHighlighter } from '../components/character-card/MacroHighlighter';
import { SheetModal } from '../components/character-card/SheetModal';
import { LifecycleConfigEditor } from '../components/character-card/LifecycleConfigEditor';
import type { LifecycleConfig } from '../components/character-card/LifecycleConfigEditor';
import {
  countConstantEntries,
  parseJsonColumn,
  parseLorebook,
} from '../components/character-card/lorebook';
import {
  getCharacterProfile,
  createCharacterProfile,
  updateCharacterProfile,
  getCharacterImages,
  createCharacterImage,
  deleteCharacterImage,
  setPrimaryImage,
  getAllCharacterProfiles,
  setCharacterProfileSource,
} from '../database/repositories/characters';
import { getAllEntities, getEntityByCharacterProfileId } from '../database/repositories/entities';
import { getActiveInteractionsByEntity } from '../database/repositories/interactions';
import ChatPreferencesService from '../services/ChatPreferencesService';
import EntitySessionService from '../services/EntitySessionService';
import { CharacterProfile, CharacterImage } from '../database/models';
import { createLogger } from '../utils/logger';
import {
  exportProfileToCardV3,
  exportToJSON,
  exportToPNG,
} from '../utils/charactercard/exporter';
import { utf8Encode } from '../utils/charactercard/pngWriter';
import { uint8ArrayToBase64 } from '../database/base64';

const log = createLogger('[CharacterProfileEditScreen]');

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'CharacterProfileEdit'>;

export const CharacterProfileEditScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { theme } = useAppTheme();
  const { showAlert } = useAppAlert();
  const { withExternalFlow } = useBiometricLock();
  const { t } = useTranslation('characters');
  const { bottom: safeBottom } = useSafeAreaInsets();

  const { profileId } = route.params ?? {};
  const isEditMode = !!profileId;

  // ── Profile fields ─────────────────────────────────────────────────────────
  const [name, setName] = useState('');
  const [nickname, setNickname] = useState('');
  const [description, setDescription] = useState('');
  const [personality, setPersonality] = useState('');
  const [voiceCharacteristics, setVoiceCharacteristics] = useState('');
  const [typingSpeedWpm, setTypingSpeedWpm] = useState('60');
  const [audioResponseChance, setAudioResponseChance] = useState('50');
  const [basePrompt, setBasePrompt] = useState('');
  const [scenario, setScenario] = useState('');

  // Character Card V3 standard fields (camelCase local state ↔ snake_case DB,
  // §A12). New sections added in 3-5.
  const [firstMes, setFirstMes] = useState('');
  const [alternateGreetings, setAlternateGreetings] = useState<string[]>([]);
  const [mesExample, setMesExample] = useState('');
  const [postHistoryInstructions, setPostHistoryInstructions] = useState('');
  const [creatorNotes, setCreatorNotes] = useState('');
  const [creator, setCreator] = useState('');
  const [characterVersion, setCharacterVersion] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [extensions, setExtensions] = useState<Record<string, unknown>>({});
  const [assets, setAssets] = useState<unknown[] | null>(null);
  const [cardProvenance, setCardProvenance] = useState<Record<string, unknown> | null>(null);
  const [characterBook, setCharacterBook] = useState<string | null>(null);

  // ── Lifecycle config (defaults inherited by AI characters/entities) ──────────
  const [lifecycleConfig, setLifecycleConfig] = useState<LifecycleConfig>({});

  // ── Images ──────────────────────────────────────────────────────────────────
  const [images, setImages] = useState<CharacterImage[]>([]);
  const [primaryImageId, setPrimaryImageId] = useState<string | null>(null);

  // ── UI state ────────────────────────────────────────────────────────────────
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingProfile, setIsLoadingProfile] = useState(isEditMode);
  const [refreshing, setRefreshing] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [lorebookOpen, setLorebookOpen] = useState(false);
  const [showOpeningPreview, setShowOpeningPreview] = useState(false);
  const [showExportSheet, setShowExportSheet] = useState(false);
  const [testState, setTestState] = useState<'idle' | 'generating' | 'ready'>('idle');
  const [testGreeting, setTestGreeting] = useState('');

  // Roleplay entity resolution ({{user}}) + library tags for TagChips.
  const [impersonatedEntityId, setImpersonatedEntityId] = useState('user');
  const [impersonatedEntityName, setImpersonatedEntityName] = useState('{{user}}');
  const [libraryTags, setLibraryTags] = useState<string[]>([]);

  // ── Load existing profile ───────────────────────────────────────────────────
  useEffect(() => {
    if (isEditMode && profileId) {
      loadProfile(profileId);
    }
  }, [profileId]);

  // Resolve the roleplay entity ({{user}}) + existing library tags once.
  useEffect(() => {
    (async () => {
      try {
        const allEntities = await getAllEntities();
        const stored = await ChatPreferencesService.getGlobalImpersonatedEntity();
        const id =
          stored && allEntities.some(e => e.id === stored)
            ? stored
            : (allEntities.find(e => e.id === 'user')?.id ??
              allEntities[0]?.id ??
              'user');
        const ent = allEntities.find(e => e.id === id);
        setImpersonatedEntityId(id);
        setImpersonatedEntityName(ent?.alias ?? id);
      } catch {
        setImpersonatedEntityId('user');
        setImpersonatedEntityName('{{user}}');
      }
      try {
        const all = await getAllCharacterProfiles();
        const allTags = [
          ...new Set(all.flatMap(p => parseJsonColumn<string[]>(p.tags) ?? [])),
        ];
        setLibraryTags(allTags);
      } catch {
        // Non-critical — suggestions stay empty.
      }
    })();
  }, []);

  const loadProfile = async (id: string) => {
    setIsLoadingProfile(true);
    try {
      const profile = await getCharacterProfile(id);
      if (!profile) return;

      setName(profile.name);
      setDescription(profile.description ?? '');
      setPersonality(profile.personality ?? '');
      setVoiceCharacteristics(profile.voice_characteristics ?? '');
      setTypingSpeedWpm(String(profile.typing_speed_wpm ?? 60));
      setAudioResponseChance(
        String(profile.audio_response_chance_percent ?? 50),
      );
      setBasePrompt(profile.base_prompt ?? '');
      setScenario(profile.scenario ?? '');

      // Character Card V3 fields — snake_case DB → camelCase state (§A12).
      setFirstMes(profile.first_mes ?? '');
      setAlternateGreetings(parseJsonColumn<string[]>(profile.alternate_greetings) ?? []);
      setMesExample(profile.mes_example ?? '');
      setPostHistoryInstructions(profile.post_history_instructions ?? '');
      setCreatorNotes(profile.creator_notes ?? '');
      setCreator(profile.creator ?? '');
      setCharacterVersion(profile.character_version ?? '');
      setNickname(profile.nickname ?? '');
      setTags(parseJsonColumn<string[]>(profile.tags) ?? []);
      setExtensions(parseJsonColumn<Record<string, unknown>>(profile.extensions) ?? {});
      setAssets(parseJsonColumn<unknown[]>(profile.assets));
      setCardProvenance(parseJsonColumn<Record<string, unknown>>(profile.card_provenance));
      setCharacterBook(profile.character_book ?? null);

      // Lifecycle config (snake_case JSON column → typed object)
      setLifecycleConfig(
        parseJsonColumn<LifecycleConfig>(profile.lifecycle_config) ?? {},
      );

      // Load images
      const imgs = await getCharacterImages(id);
      setImages(imgs);
      const primary = imgs.find(img => img.is_primary === true);
      setPrimaryImageId(primary?.id ?? null);
    } catch (err) {
      log.error('Failed to load profile:', err);
      showAlert(t('common:error'), t('loadFailed'));
    } finally {
      setIsLoadingProfile(false);
    }
  };

  const onRefresh = useCallback(async () => {
    if (!isEditMode || !profileId) return;
    setRefreshing(true);
    await loadProfile(profileId);
    setRefreshing(false);
  }, [isEditMode, profileId]);

  // ── Derived values ──────────────────────────────────────────────────────────
  const charName = nickname.trim() || name.trim() || '{{char}}';
  const lorebook = parseLorebook(characterBook);
  const loreEntryCount = lorebook?.entries.length ?? 0;
  const loreConstantCount = countConstantEntries(lorebook);
  const loreSummary = `${loreEntryCount} ${t('lorebookEntries', { count: loreEntryCount })} · ${loreConstantCount} ${t('lorebookConstant')}`;
  const provenanceSource = (() => {
    if (!cardProvenance || !Array.isArray(cardProvenance.source)) return null;
    return cardProvenance.source as string[];
  })();

  // ── Save ────────────────────────────────────────────────────────────────────
  const buildProfileFields = () => {
    const typingWpm = parseInt(typingSpeedWpm, 10);
    const audioChance = parseInt(audioResponseChance, 10);
    return {
      name: name.trim(),
      description: description.trim() || '',
      personality: personality.trim() || '',
      voice_characteristics: voiceCharacteristics.trim() || '',
      typing_speed_wpm: isNaN(typingWpm) ? 60 : typingWpm,
      audio_response_chance_percent: isNaN(audioChance) ? 50 : audioChance,
      base_prompt: basePrompt.trim() || '',
      scenario: scenario.trim() || '',
      // camelCase state → snake_case DB (§A12). JSON columns use the mapper's
      // convention (`JSON.stringify(x ?? null)` — lossless, engine-parity).
      first_mes: firstMes.trim() || '',
      mes_example: mesExample.trim() || '',
      alternate_greetings: JSON.stringify(alternateGreetings.length ? alternateGreetings : null),
      post_history_instructions: postHistoryInstructions.trim() || '',
      creator_notes: creatorNotes.trim() || '',
      creator: creator.trim() || '',
      character_version: characterVersion.trim() || '',
      nickname: nickname.trim() || '',
      tags: JSON.stringify(tags.length ? tags : null),
      extensions: JSON.stringify(extensions),
      assets: JSON.stringify(assets),
      card_provenance: cardProvenance ? JSON.stringify(cardProvenance) : '',
      character_book: characterBook ?? '',
      lifecycle_config: JSON.stringify(lifecycleConfig),
    };
  };

  const handleSave = async () => {
    if (!name.trim()) {
      showAlert('Validation', t('validationName'));
      return;
    }

    const typingWpm = parseInt(typingSpeedWpm, 10);
    if (isNaN(typingWpm) || typingWpm < 1 || typingWpm > 200) {
      showAlert('Validation', t('validationTypingSpeed'));
      return;
    }

    const audioChance = parseInt(audioResponseChance, 10);
    if (isNaN(audioChance) || audioChance < 0 || audioChance > 100) {
      showAlert('Validation', t('validationAudioChance'));
      return;
    }

    setIsSaving(true);
    try {
      if (isEditMode && profileId) {
        // updateCharacterProfile takes a full CharacterProfile object
        // Fetch current to preserve fields not managed in this form
        const current = await getCharacterProfile(profileId);
        if (!current) throw new Error('Profile not found');

        await updateCharacterProfile({
          ...current,
          ...buildProfileFields(),
        });
      } else {
        const newId = uuidv4();
        await createCharacterProfile({
          id: newId,
          ...buildProfileFields(),
          vision_config_id: null,
        });
        // Tag as user-created so it is hidden from the Discover community grid
        await setCharacterProfileSource(newId, 'user');
      }
      navigation.goBack();
    } catch (err) {
      log.error('Failed to save profile:', err);
      showAlert(t('common:error'), t('saveFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  // ── Export (4-4) — JSON / PNG ccv3 ────────────────────────────────────────
  /**
   * Lift the CURRENT form state (what the user sees) into a V3 card and share
   * it. Uses the same column mapping as the persisted profile
   * (`buildProfileFields`), so unsaved edits export too.
   */
  const buildExportProfile = (): CharacterProfile => {
    const fields = buildProfileFields();
    return {
      id: profileId ?? 'export',
      ...fields,
      vision_config_id: null,
      created_at: new Date(),
      updated_at: new Date(),
      deleted_at: null,
    };
  };

  const sanitizeExportFilename = (raw: string): string => {
    const cleaned = raw
      .trim()
      .replace(/[^a-zA-Z0-9 _-]/g, '_')
      .replace(/\s+/g, ' ')
      .replace(/_+/g, '_');
    return cleaned || 'character';
  };

  const handleExport = async (kind: 'json' | 'png') => {
    if (!name.trim()) {
      showAlert('Validation', t('validationName'));
      return;
    }
    try {
      const card = exportProfileToCardV3(buildExportProfile(), images);
      const filename = sanitizeExportFilename(name);
      const ext = kind === 'json' ? 'json' : 'png';
      const base64 =
        kind === 'json'
          ? uint8ArrayToBase64(utf8Encode(exportToJSON(card)))
          : uint8ArrayToBase64(exportToPNG(card));
      const path = `${RNFS.CachesDirectoryPath}/${filename}.${ext}`;
      await RNFS.writeFile(path, base64, 'base64');

      // No RN file-share dependency is installed (INTEGRATIONS.md): iOS shares
      // a file:// URL attachment; Android has no built-in file share without
      // extra native modules, so the path is passed in the message and the
      // success alert surfaces the saved location either way.
      await Share.share(
        Platform.OS === 'ios'
          ? { url: `file://${path}`, title: filename }
          : { message: `file://${path}`, title: filename },
        { dialogTitle: t('exportCard') },
      );
      setShowExportSheet(false);
    } catch (err) {
      log.error('Failed to export card:', err);
      showAlert(t('common:error'), t('exportFailed'));
    }
  };

  // ── [Preview opening] / [Test scenario generation] ─────────────────────────
  const handleTestScenario = useCallback(async () => {
    if (testState === 'generating') return;
    if (!profileId) {
      showAlert(t('saveFirst'), t('testScenarioNeedsSavedProfile'));
      return;
    }
    try {
      const entity = await getEntityByCharacterProfileId(profileId);
      if (!entity) {
        showAlert(t('common:error'), t('testScenarioNoEntity'));
        return;
      }
      const interactions = await getActiveInteractionsByEntity(entity.id);
      const interactionId = interactions[0]?.id;
      if (!interactionId) {
        showAlert(t('common:error'), t('testScenarioUnavailable'));
        return;
      }
      setTestState('generating');
      const result = await EntitySessionService.generateGreeting({
        entityId: entity.id,
        targetEntityId: impersonatedEntityId,
        interactionId,
        mode: 'directed',
      });
      setTestGreeting(result.greeting);
      setTestState('ready');
    } catch (err) {
      log.warn('Test scenario generation failed (engine gate):', err);
      showAlert(t('common:error'), t('testScenarioUnavailable'));
      setTestState('idle');
    }
  }, [profileId, testState, impersonatedEntityId, showAlert, t]);

  const handleUseTestGreeting = () => {
    setFirstMes(testGreeting);
    setTestGreeting('');
    setTestState('idle');
  };

  const handleDiscardTestGreeting = () => {
    setTestGreeting('');
    setTestState('idle');
  };

  // ── Alternate greeting operations ───────────────────────────────────────────
  const handleAddAlternate = () => {
    setAlternateGreetings(prev => [...prev, '']);
  };

  const handleRemoveAlternate = (index: number) => {
    setAlternateGreetings(prev => prev.filter((_, i) => i !== index));
  };

  const handleMoveAlternate = (index: number, direction: -1 | 1) => {
    setAlternateGreetings(prev => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const handleEditAlternate = (index: number, value: string) => {
    setAlternateGreetings(prev => {
      if (!value.trim()) {
        return prev.filter((_, i) => i !== index);
      }
      return prev.map((g, i) => (i === index ? value : g));
    });
  };

  const handlePromoteToDefault = (greeting: string) => {
    setAlternateGreetings(prev => {
      const next = prev.filter(g => g !== greeting);
      if (firstMes.trim()) {
        next.push(firstMes);
      }
      return next;
    });
    setFirstMes(greeting);
  };

  // ── Image operations ────────────────────────────────────────────────────────
  const handleAddImage = async () => {
    if (!profileId) {
      showAlert(
        t('saveFirst'),
        t('saveFirstMessage'),
      );
      return;
    }

    try {
      // The system image picker backgrounds the app while open — run it as an
      // external flow so the app-lock is suspended for the round-trip.
      const result = await withExternalFlow(() =>
        launchImageLibrary({
          mediaType: 'photo',
          includeBase64: true,
          quality: 0.8,
        }),
      );

      if (result.assets && result.assets[0]) {
        const asset = result.assets[0];
        const mimeType = asset.type ?? 'image/jpeg';
        const base64Data = asset.base64;

        if (!base64Data) {
          showAlert(t('common:error'), t('imageError'));
          return;
        }

        const isFirstImage = images.length === 0;
        const now = new Date();
        const newImageId = await createCharacterImage({
          character_profile_id: profileId,
          image_data: base64Data,
          mime_type: mimeType,
          description: '',
          is_primary: isFirstImage,
          display_order: images.length,
          vl_model_interpretation: '',
          vl_model: '',
          updated_at: now,
        });

        // Reload images to get the full object back
        const refreshed = await getCharacterImages(profileId);
        setImages(refreshed);

        if (isFirstImage) {
          const newPrimary = refreshed.find(img => img.id === newImageId);
          setPrimaryImageId(newPrimary?.id ?? null);
        }
      }
    } catch (err) {
      log.error('Failed to add image:', err);
      showAlert(t('common:error'), t('addImageFailed'));
    }
  };

  const handleSetPrimary = async (imageId: string) => {
    if (!profileId) return;
    try {
      await setPrimaryImage(profileId, imageId);
      setPrimaryImageId(imageId);
      // Update local image state to reflect new primary
      setImages(prev =>
        prev.map(img => ({ ...img, is_primary: img.id === imageId })),
      );
    } catch (err) {
      log.error('Failed to set primary image:', err);
      showAlert(t('common:error'), t('setPrimaryFailed'));
    }
  };

  const handleDeleteImage = async (imageId: string) => {
    try {
      await deleteCharacterImage(imageId);
      const remaining = images.filter(img => img.id !== imageId);
      setImages(remaining);

      if (primaryImageId === imageId) {
        const newPrimary = remaining[0] ?? null;
        setPrimaryImageId(newPrimary?.id ?? null);
        // Update primary in DB if there's a replacement and we have a profileId
        if (newPrimary && profileId) {
          await setPrimaryImage(profileId, newPrimary.id).catch(() => {});
        }
      }
    } catch (err) {
      log.error('Failed to delete image:', err);
      showAlert(t('common:error'), t('deleteImageFailed'));
    }
  };

  // ── Section / field renderers ────────────────────────────────────────────────
  const renderSection = (title: string, children: React.ReactNode) => {
    if (!theme) return null;
    return (
      <ThemedCard elevated accentStripe style={styles.section}>
        <SectionHeader title={title} style={styles.sectionHeaderInCard} />
        <View style={styles.sectionContent}>
          {children}
        </View>
      </ThemedCard>
    );
  };

  const renderField = (
    label: string,
    input: React.ReactNode,
    required = false,
  ) => (
    <View style={styles.field}>
      <ThemedText size={13} variant="secondary" style={styles.fieldLabel}>
        {label}
        {required ? ' *' : ''}
      </ThemedText>
      {input}
    </View>
  );

  const inputStyle = () => {
    if (!theme) return {};
    return {
      color: theme.colors.text.primary,
      borderColor: theme.colors.border.default,
      backgroundColor: theme.colors.background.base,
    };
  };

  if (!theme) return null;

  if (isLoadingProfile) {
    return (
      <ThemedView style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.colors.accent.primary} />
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      {/* Header */}
      <ScreenHeader
        title={isEditMode ? t('editProfile') : t('createProfile')}
        onBack={() => navigation.goBack()}
        right={
          isSaving ? (
            <ActivityIndicator
              size="small"
              color={theme.colors.accent.primary}
            />
          ) : (
            <TouchableOpacity
              onPress={() => {
                hapticLightPress();
                handleSave();
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="Save profile"
              accessibilityRole="button"
            >
              <Icon name="check" size={24} color={theme.colors.accent.primary} />
            </TouchableOpacity>
          )
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
          {/* ── IDENTITY ── */}
          {renderSection(
            t('identity'),
            <>
              {renderField(
                'Name',
                <TextInput
                  style={[styles.input, inputStyle()]}
                  value={name}
                  onChangeText={setName}
                  placeholder={t('namePlaceholder')}
                  placeholderTextColor={theme.colors.text.muted}
                  returnKeyType="next"
                  testID="character-name-input"
                  accessibilityLabel="Character name"
                />,
                true,
              )}

              {renderField(
                t('nickname'),
                <TextInput
                  style={[styles.input, inputStyle()]}
                  value={nickname}
                  onChangeText={setNickname}
                  placeholder={t('nicknamePlaceholder')}
                  placeholderTextColor={theme.colors.text.muted}
                  testID="nickname-input"
                />,
              )}

              {renderField(
                'Description',
                <TextInput
                  style={[styles.input, styles.multilineInput, inputStyle()]}
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Brief description of this character"
                  placeholderTextColor={theme.colors.text.muted}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />,
              )}
            </>,
          )}

          {/* ── VOICE & PERSONA ── */}
          {renderSection(
            t('voiceAndPersona'),
            <>
              {renderField(
                'Personality',
                <TextInput
                  style={[styles.input, styles.multilineInput, inputStyle()]}
                  value={personality}
                  onChangeText={setPersonality}
                  placeholder="Personality traits and demeanor"
                  placeholderTextColor={theme.colors.text.muted}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />,
              )}

              {renderField(
                'Voice Characteristics',
                <TextInput
                  style={[styles.input, styles.multilineInput, inputStyle()]}
                  value={voiceCharacteristics}
                  onChangeText={setVoiceCharacteristics}
                  placeholder={t('voicePlaceholder')}
                  placeholderTextColor={theme.colors.text.muted}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />,
              )}

              {renderField(
                t('mesExample'),
                <>
                  <TextInput
                    style={[styles.input, styles.multilineInput, inputStyle()]}
                    value={mesExample}
                    onChangeText={setMesExample}
                    placeholder={t('mesExampleHint')}
                    placeholderTextColor={theme.colors.text.muted}
                    multiline
                    numberOfLines={4}
                    textAlignVertical="top"
                    testID="mes-example-input"
                  />
                  <ThemedText variant="muted" size={12}>
                    {t('mesExampleHint')}
                  </ThemedText>
                </>,
              )}
            </>,
          )}


          {/* ── IMAGES ── */}
          {renderSection(
            'IMAGES',
            <View style={styles.imagesSection}>
              {isEditMode && profileId ? (
                <>
                  <ProfileImagePicker
                    images={images}
                    primaryImageId={primaryImageId}
                    onAddImage={handleAddImage}
                    onSetPrimary={handleSetPrimary}
                    onDeleteImage={handleDeleteImage}
                  />
                  <ThemedText variant="muted" size={12} style={styles.imageHint}>
                    {images.length > 0
                      ? `${images.length} image${images.length !== 1 ? 's' : ''} · Tap to view · Hold for options`
                      : 'Tap + to add images'}
                  </ThemedText>
                </>
              ) : (
                <ThemedText variant="muted" size={13} style={styles.imageHint}>
                  Save the profile first to add images.
                </ThemedText>
              )}
            </View>,
          )}


          {/* ── GREETING ── */}
          {renderSection(
            t('greetingSection'),
            <>
              <GreetingEditor
                value={firstMes}
                onChange={setFirstMes}
                charName={charName}
                userName={impersonatedEntityName}
              />
              <AlternateGreetingsManager
                alternateGreetings={alternateGreetings}
                firstMes={firstMes}
                charName={charName}
                userName={impersonatedEntityName}
                onAdd={handleAddAlternate}
                onRemove={handleRemoveAlternate}
                onMove={handleMoveAlternate}
                onEdit={handleEditAlternate}
                onPromoteToDefault={handlePromoteToDefault}
              />
            </>,
          )}

          {/* ── Action bar: preview opening / test scenario generation / export ── */}
          <View style={styles.actionBar}>
            <ThemedButton
              variant="outline"
              label={t('previewOpening')}
              onPress={() => setShowOpeningPreview(true)}
              style={styles.actionBarButton}
              testID="preview-opening-button"
            />
            <ThemedButton
              variant="primary"
              label={testState === 'generating' ? t('testScenarioGenerating') : t('testScenario')}
              onPress={handleTestScenario}
              disabled={testState === 'generating'}
              style={styles.actionBarButton}
              testID="test-scenario-button"
            />
            <ThemedButton
              variant="outline"
              label={t('exportCard')}
              onPress={() => setShowExportSheet(true)}
              style={styles.actionBarButton}
              testID="export-card-button"
            />
          </View>

          {testState === 'ready' && testGreeting ? (
            <ThemedCard elevated accentTint style={styles.testResultCard}>
              <SectionHeader title={t('testScenario')} />
              <View style={styles.testResultBody}>
                <GreetingBubble
                  text={testGreeting}
                  charName={charName}
                  userName={impersonatedEntityName}
                  theme={theme}
                />
                <View style={styles.testResultActions}>
                  <ThemedButton
                    variant="ghost"
                    label={t('testScenarioDiscard')}
                    onPress={handleDiscardTestGreeting}
                    style={styles.testResultButton}
                    testID="test-scenario-discard"
                  />
                  <ThemedButton
                    variant="primary"
                    label={t('testScenarioUseThis')}
                    onPress={handleUseTestGreeting}
                    style={styles.testResultButton}
                    testID="test-scenario-use"
                  />
                </View>
              </View>
            </ThemedCard>
          ) : null}

          {/* ── SCENARIO ── */}
          {renderSection(
            t('scenarioSection'),
            <>
              {renderField(
                'Scenario',
                <TextInput
                  style={[styles.input, styles.multilineInput, inputStyle()]}
                  value={scenario}
                  onChangeText={setScenario}
                  placeholder={t('scenarioPlaceholder')}
                  placeholderTextColor={theme.colors.text.muted}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />,
              )}
            </>,
          )}

          {/* ── LOREBOOK ── */}
          {renderSection(
            t('lorebookSection'),
            <>
              <TouchableOpacity
                onPress={() => setLorebookOpen(true)}
                accessibilityRole="button"
                style={[styles.lorebookCard, { borderColor: theme.colors.border.default }]}
                testID="lorebook-summary-card"
              >
                <Icon
                  name="book-open-variant"
                  size={22}
                  color={theme.colors.accent.primary}
                />
                <View style={styles.lorebookCardText}>
                  <ThemedText size={14} weight="bold">
                    {t('lorebook')}
                  </ThemedText>
                  <ThemedText variant="muted" size={12}>
                    {loreSummary}
                  </ThemedText>
                </View>
                <Icon name="chevron-right" size={22} color={theme.colors.text.muted} />
              </TouchableOpacity>
            </>,
          )}

          {/* ── LIFECYCLE ── */}
          {renderSection(
            t('lifecycleSection'),
            <View style={styles.lifecycleSection}>
              <View
                style={[
                  styles.defaultsBanner,
                  {
                    borderColor: theme.colors.accent.primary + '40',
                    backgroundColor: theme.colors.accent.primary + '14',
                  },
                ]}>
                <Icon
                  name="information-outline"
                  size={15}
                  color={theme.colors.accent.primary}
                  style={styles.defaultsBannerIcon}
                />
                <ThemedText
                  variant="secondary"
                  size={12}
                  style={styles.defaultsBannerText}>
                  {t('lifecycle.defaultsNote')}
                </ThemedText>
              </View>
              <LifecycleConfigEditor
                config={lifecycleConfig}
                onChange={setLifecycleConfig}
              />
            </View>,
          )}

          {/* ── ADVANCED (collapsible) ── */}
          {renderSection(
            t('advanced'),
            <>
              <TouchableOpacity
                style={styles.advancedToggle}
                onPress={() => setAdvancedOpen(prev => !prev)}
                accessibilityRole="button"
                accessibilityState={{ expanded: advancedOpen }}
                testID="advanced-toggle"
              >
                <ThemedText size={14} weight="bold" variant="accent">
                  {t('advancedHint')}
                </ThemedText>
                <ThemedText variant="muted" size={12}>
                  {advancedOpen ? '▴' : '▾'}
                </ThemedText>
              </TouchableOpacity>
              {advancedOpen && (
                <View style={styles.advancedBody}>
                  {renderField(
                    t('postHistoryInstructions'),
                    <>
                      <TextInput
                        style={[styles.input, styles.multilineInput, inputStyle()]}
                        value={postHistoryInstructions}
                        onChangeText={setPostHistoryInstructions}
                        placeholder={t('postHistoryHint')}
                        placeholderTextColor={theme.colors.text.muted}
                        multiline
                        numberOfLines={4}
                        textAlignVertical="top"
                        testID="post-history-input"
                      />
                      <ThemedText variant="muted" size={12}>
                        {t('postHistoryHint')}
                      </ThemedText>
                      <MacroHighlighter
                        text={postHistoryInstructions}
                        numberOfLines={2}
                        testID="post-history-macro-highlight"
                      />
                    </>,
                  )}

                  {renderField(
                    t('basePrompt'),
                    <>
                      <TextInput
                        style={[styles.input, styles.multilineInput, inputStyle()]}
                        value={basePrompt}
                        onChangeText={setBasePrompt}
                        placeholder={t('basePromptPlaceholder')}
                        placeholderTextColor={theme.colors.text.muted}
                        multiline
                        numberOfLines={5}
                        textAlignVertical="top"
                        testID="base-prompt-input"
                      />
                      <ThemedText variant="muted" size={12}>
                        {t('originalMacroHint')}
                      </ThemedText>
                      <MacroHighlighter
                        text={basePrompt}
                        numberOfLines={2}
                        testID="base-prompt-macro-highlight"
                      />
                    </>,
                  )}


                  <View style={styles.numericRow}>
                    <View style={styles.numericField}>
                      <ThemedText
                        size={13}
                        variant="secondary"
                        numberOfLines={1}
                        style={styles.numericFieldLabel}
                      >
                        Typing Speed (WPM)
                      </ThemedText>
                      <TextInput
                        style={[styles.input, styles.numericInput, inputStyle()]}
                        value={typingSpeedWpm}
                        onChangeText={setTypingSpeedWpm}
                        placeholder="60"
                        placeholderTextColor={theme.colors.text.muted}
                        keyboardType="numeric"
                        returnKeyType="done"
                      />
                    </View>

                    <View style={styles.numericField}>
                      <ThemedText
                        size={13}
                        variant="secondary"
                        numberOfLines={1}
                        style={styles.numericFieldLabel}
                      >
                        Audio Chance (%)
                      </ThemedText>
                      <TextInput
                        style={[styles.input, styles.numericInput, inputStyle()]}
                        value={audioResponseChance}
                        onChangeText={setAudioResponseChance}
                        placeholder="50"
                        placeholderTextColor={theme.colors.text.muted}
                        keyboardType="numeric"
                        returnKeyType="done"
                      />
                    </View>
                  </View>
                </View>
              )}
            </>,
          )}

          {/* ── ATTRIBUTION ── */}
          {renderSection(
            t('attributionSection'),
            <>
              <CreatorAttributionBadge
                creator={creator.trim() || null}
                creatorNotes={creatorNotes.trim() || null}
                characterVersion={characterVersion.trim() || null}
                source={provenanceSource}
                provenance={cardProvenance}
              />
              {renderField(
                t('tags'),
                <TagChips
                  tags={tags}
                  onChange={setTags}
                  suggestions={libraryTags}
                  testID="profile-tag-chips"
                />,
              )}
            </>,
          )}

          {/* Bottom save button */}
          <ThemedButton
            variant="primary"
            label={isSaving ? t('savingProfile') : t('saveProfile')}
            onPress={handleSave}
            disabled={isSaving}
            style={styles.saveButton}
            testID="save-profile-button"
          />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* [Preview opening] — mock chat-start (macros resolved, no persistence). */}
      <SheetModal
        open={showOpeningPreview}
        onClose={() => setShowOpeningPreview(false)}
        testID="opening-preview"
      >
        <View style={styles.previewHeader}>
          <ThemedText size={18} weight="bold" style={styles.previewTitle}>
            {t('previewOpeningTitle')}
          </ThemedText>
          <ThemedText variant="muted" size={12}>
            {t('previewOnly')}
          </ThemedText>
        </View>
        <View style={styles.previewBody}>
          <GreetingBubble
            text={firstMes}
            charName={charName}
            userName={impersonatedEntityName}
            theme={theme}
          />
        </View>
        <View style={styles.previewActions}>
          <ThemedButton
            variant="ghost"
            label={t('common:done')}
            onPress={() => setShowOpeningPreview(false)}
            style={styles.previewActionButton}
            testID="opening-preview-close"
          />
        </View>
      </SheetModal>

      {/* Export sheet (4-4) — JSON / PNG ccv3 */}
      <SheetModal
        open={showExportSheet}
        onClose={() => setShowExportSheet(false)}
        testID="export-sheet"
      >
        <View style={styles.exportSheetHeader}>
          <ThemedText size={18} weight="bold" style={styles.exportSheetTitle}>
            {t('exportCard')}
          </ThemedText>
          <ThemedText variant="muted" size={12}>
            {t('exportSheetHint')}
          </ThemedText>
        </View>
        <View style={styles.exportSheetActions}>
          <ThemedButton
            variant="outline"
            label={t('exportAsJSON')}
            onPress={() => handleExport('json')}
            style={styles.exportSheetButton}
            testID="export-json"
          />
          <ThemedButton
            variant="outline"
            label={t('exportAsPNG')}
            onPress={() => handleExport('png')}
            style={styles.exportSheetButton}
            testID="export-png"
          />
          <ThemedButton
            variant="ghost"
            label={t('common:cancel')}
            onPress={() => setShowExportSheet(false)}
            style={styles.exportSheetButton}
            testID="export-cancel"
          />
        </View>
      </SheetModal>

      {/* Lorebook editor sheet */}
      <LorebookViewerSheet
        open={lorebookOpen}
        onClose={() => setLorebookOpen(false)}
        characterBook={characterBook}
        onChange={setCharacterBook}
      />
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { elevation: 4 },
  headerAction: { marginRight: 12 },
  keyboardAvoid: { flex: 1 },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
    gap: 16,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Section
  section: {
    padding: 0,
    overflow: 'hidden',
  },
  sectionHeaderInCard: {
    // SectionHeader sits flush at the top of the card (no extra margin)
  },
  sectionContent: {
    padding: 16,
    gap: 12,
  },
  sectionTitle: {
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 4,
  },

  // Fields
  field: {
    gap: 6,
  },
  fieldLabel: {
    letterSpacing: 0.2,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  multilineInput: {
    minHeight: 80,
    paddingTop: 10,
  },

  // Numeric row (side-by-side)
  numericRow: {
    flexDirection: 'row',
    gap: 12,
  },
  numericField: {
    flex: 1,
    gap: 6,
  },
  numericFieldLabel: {
    letterSpacing: 0.2,
    height: 18,
  },
  numericInput: {
    textAlign: 'center',
  },

  // Action bar ([Preview opening] / [Test scenario generation])
  actionBar: {
    flexDirection: 'row',
    gap: 12,
  },
  actionBarButton: {
    flex: 1,
    height: 46,
  },

  // Test scenario result
  testResultCard: {
    padding: 0,
    overflow: 'hidden',
  },
  testResultBody: {
    padding: 16,
    gap: 12,
  },
  testResultActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  testResultButton: {
    minWidth: 130,
    height: 44,
  },

  // Lorebook summary card
  lorebookCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  lorebookCardText: {
    flex: 1,
    gap: 2,
  },

  // Advanced collapsible
  advancedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  advancedBody: {
    gap: 12,
  },

  // Preview opening modal
  previewHeader: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 2,
  },
  previewTitle: {
    letterSpacing: 0.3,
  },
  previewBody: {
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  previewActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 12,
  },
  previewActionButton: {
    minWidth: 120,
    height: 46,
  },

  // Export sheet
  exportSheetHeader: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 2,
  },
  exportSheetTitle: {
    letterSpacing: 0.3,
  },
  exportSheetActions: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
    gap: 10,
  },
  exportSheetButton: {
    width: '100%',
    height: 46,
  },

  // Images section
  imagesSection: {
    gap: 8,
  },
  imageHint: {
    marginTop: 4,
  },

  // Lifecycle section
  lifecycleSection: {
    gap: 12,
  },
  defaultsBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  defaultsBannerIcon: {
    marginTop: 1,
  },
  defaultsBannerText: {
    flex: 1,
    lineHeight: 17,
  },

  // Save button
  saveButton: {
    marginTop: 8,
    width: '100%',
  },
});
