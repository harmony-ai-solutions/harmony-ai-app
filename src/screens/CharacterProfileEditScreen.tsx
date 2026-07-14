import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Appbar } from 'react-native-paper';
import { ThemedAppbar } from '../components/themed/ThemedAppbar';
import { ThemedCard } from '../components/themed/ThemedCard';
import { SectionHeader } from '../components/themed/SectionHeader';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { launchImageLibrary } from 'react-native-image-picker';
import { useTranslation } from 'react-i18next';
import { v4 as uuidv4 } from 'uuid';
import { RootStackParamList } from '../navigation/AppNavigator';
import { useAppTheme } from '../contexts/ThemeContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedText } from '../components/themed/ThemedText';
import { ThemedButton } from '../components/themed/ThemedButton';
import { ProfileImagePicker } from '../components/characters/ProfileImagePicker';
import {
  getCharacterProfile,
  createCharacterProfile,
  updateCharacterProfile,
  getCharacterImages,
  createCharacterImage,
  deleteCharacterImage,
  setPrimaryImage,
} from '../database/repositories/characters';
import { CharacterImage } from '../database/models';
import { createLogger } from '../utils/logger';

const log = createLogger('[CharacterProfileEditScreen]');

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'CharacterProfileEdit'>;

export const CharacterProfileEditScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { theme } = useAppTheme();
  const { t } = useTranslation('characters');
  const { bottom: safeBottom } = useSafeAreaInsets();

  const { profileId } = route.params ?? {};
  const isEditMode = !!profileId;

  // ── Profile fields ─────────────────────────────────────────────────────────
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [personality, setPersonality] = useState('');
  const [appearance, setAppearance] = useState('');
  const [backstory, setBackstory] = useState('');
  const [voiceCharacteristics, setVoiceCharacteristics] = useState('');
  const [typingSpeedWpm, setTypingSpeedWpm] = useState('60');
  const [audioResponseChance, setAudioResponseChance] = useState('50');
  const [basePrompt, setBasePrompt] = useState('');
  const [scenario, setScenario] = useState('');
  const [exampleDialogues, setExampleDialogues] = useState('');

  // ── Images ──────────────────────────────────────────────────────────────────
  const [images, setImages] = useState<CharacterImage[]>([]);
  const [primaryImageId, setPrimaryImageId] = useState<number | null>(null);

  // ── UI state ────────────────────────────────────────────────────────────────
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingProfile, setIsLoadingProfile] = useState(isEditMode);

  // ── Load existing profile ───────────────────────────────────────────────────
  useEffect(() => {
    if (isEditMode && profileId) {
      loadProfile(profileId);
    }
  }, [profileId]);

  const loadProfile = async (id: string) => {
    setIsLoadingProfile(true);
    try {
      const profile = await getCharacterProfile(id);
      if (!profile) return;

      setName(profile.name);
      setDescription(profile.description ?? '');
      setPersonality(profile.personality ?? '');
      setAppearance(profile.appearance ?? '');
      setBackstory(profile.backstory ?? '');
      setVoiceCharacteristics(profile.voice_characteristics ?? '');
      setTypingSpeedWpm(String(profile.typing_speed_wpm ?? 60));
      setAudioResponseChance(
        String(profile.audio_response_chance_percent ?? 50),
      );
      setBasePrompt(profile.base_prompt ?? '');
      setScenario(profile.scenario ?? '');
      setExampleDialogues(profile.example_dialogues ?? '');

      // Load images
      const imgs = await getCharacterImages(id);
      setImages(imgs);
      const primary = imgs.find(img => img.is_primary === true);
      setPrimaryImageId(primary?.id ?? null);
    } catch (err) {
      log.error('Failed to load profile:', err);
      Alert.alert(t('common:error'), t('loadFailed'));
    } finally {
      setIsLoadingProfile(false);
    }
  };

  // ── Save ────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Validation', 'Name is required.');
      return;
    }

    const typingWpm = parseInt(typingSpeedWpm, 10);
    if (isNaN(typingWpm) || typingWpm < 1 || typingWpm > 200) {
      Alert.alert('Validation', 'Typing speed must be between 1 and 200 WPM.');
      return;
    }

    const audioChance = parseInt(audioResponseChance, 10);
    if (isNaN(audioChance) || audioChance < 0 || audioChance > 100) {
      Alert.alert(
        'Validation',
        'Audio response chance must be between 0 and 100.',
      );
      return;
    }

    setIsSaving(true);
    try {
      if (isEditMode && profileId) {
        // updateCharacterProfile takes a full CharacterProfile object
        // Fetch current to preserve fields not managed in this form
        const current = await getCharacterProfile(profileId);
        if (!current) throw new Error('Profile not found');

        // description, personality, appearance, backstory, voice_characteristics
        // are NOT NULL in the schema — fall back to '' not null.
        await updateCharacterProfile({
          ...current,
          name: name.trim(),
          description: description.trim() || '',
          personality: personality.trim() || '',
          appearance: appearance.trim() || '',
          backstory: backstory.trim() || '',
          voice_characteristics: voiceCharacteristics.trim() || '',
          typing_speed_wpm: typingWpm,
          audio_response_chance_percent: audioChance,
          base_prompt: basePrompt.trim() || null,
          scenario: scenario.trim() || null,
          example_dialogues: exampleDialogues.trim() || null,
        });
      } else {
        const newId = uuidv4();
        await createCharacterProfile({
          id: newId,
          name: name.trim(),
          description: description.trim() || '',
          personality: personality.trim() || '',
          appearance: appearance.trim() || '',
          backstory: backstory.trim() || '',
          voice_characteristics: voiceCharacteristics.trim() || '',
          typing_speed_wpm: typingWpm,
          audio_response_chance_percent: audioChance,
          vision_config_id: null,
          lifecycle_config: null,
          base_prompt: basePrompt.trim() || null,
          scenario: scenario.trim() || null,
          example_dialogues: exampleDialogues.trim() || null,
        });
      }
      navigation.goBack();
    } catch (err) {
      log.error('Failed to save profile:', err);
      Alert.alert(t('common:error'), t('saveFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  // ── Image operations ────────────────────────────────────────────────────────
  const handleAddImage = async () => {
    if (!profileId) {
      Alert.alert(
        t('saveFirst'),
        t('saveFirstMessage'),
      );
      return;
    }

    try {
      const result = await launchImageLibrary({
        mediaType: 'photo',
        includeBase64: true,
        quality: 0.8,
      });

      if (result.assets && result.assets[0]) {
        const asset = result.assets[0];
        const mimeType = asset.type ?? 'image/jpeg';
        const base64Data = asset.base64;

        if (!base64Data) {
          Alert.alert(t('common:error'), t('imageError'));
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
      Alert.alert(t('common:error'), t('addImageFailed'));
    }
  };

  const handleSetPrimary = async (imageId: number) => {
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
      Alert.alert(t('common:error'), t('setPrimaryFailed'));
    }
  };

  const handleDeleteImage = async (imageId: number) => {
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
      Alert.alert(t('common:error'), t('deleteImageFailed'));
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
      {/* Appbar */}
      <ThemedAppbar style={styles.header}>
        <Appbar.BackAction
          color={theme.colors.text.primary}
          onPress={() => navigation.goBack()}
        />
        <Appbar.Content
          title={isEditMode ? t('editProfile') : t('createProfile')}
          titleStyle={{ color: theme.colors.text.primary, fontWeight: 'bold' }}
        />
        {isSaving ? (
          <ActivityIndicator
            size="small"
            color={theme.colors.accent.primary}
            style={styles.headerAction}
          />
        ) : (
          <Appbar.Action
            icon="check"
            color={theme.colors.accent.primary}
            onPress={handleSave}
          />
        )}
      </ThemedAppbar>

      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: 40 + safeBottom }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── BASIC INFORMATION ── */}
          {renderSection(
            'BASIC INFORMATION',
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
                />,
                true,
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
                'Appearance',
                <TextInput
                  style={[styles.input, styles.multilineInput, inputStyle()]}
                  value={appearance}
                  onChangeText={setAppearance}
                  placeholder={t('appearancePlaceholder')}
                  placeholderTextColor={theme.colors.text.muted}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />,
              )}

              {renderField(
                'Backstory',
                <TextInput
                  style={[styles.input, styles.multilineInput, inputStyle()]}
                  value={backstory}
                  onChangeText={setBackstory}
                  placeholder={t('backstoryPlaceholder')}
                  placeholderTextColor={theme.colors.text.muted}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                />,
              )}
            </>,
          )}

          {/* ── VOICE & BEHAVIOR ── */}
          {renderSection(
            'VOICE & BEHAVIOR',
            <>
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

              <View style={styles.numericRow}>
                <View style={styles.numericField}>
                  <ThemedText
                    size={13}
                    variant="secondary"
                    style={styles.fieldLabel}
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
                    style={styles.fieldLabel}
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
            </>,
          )}

          {/* ── PROMPTS & SCENARIO ── */}
          {renderSection(
            'PROMPTS & SCENARIO',
            <>
              {renderField(
                'Base Prompt',
                <TextInput
                  style={[styles.input, styles.multilineInput, inputStyle()]}
                  value={basePrompt}
                  onChangeText={setBasePrompt}
                  placeholder={t('basePromptPlaceholder')}
                  placeholderTextColor={theme.colors.text.muted}
                  multiline
                  numberOfLines={5}
                  textAlignVertical="top"
                />,
              )}

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

              {renderField(
                'Example Dialogues',
                <TextInput
                  style={[styles.input, styles.multilineInput, inputStyle()]}
                  value={exampleDialogues}
                  onChangeText={setExampleDialogues}
                  placeholder={t('exampleDialoguesPlaceholder')}
                  placeholderTextColor={theme.colors.text.muted}
                  multiline
                  numberOfLines={5}
                  textAlignVertical="top"
                />,
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
                    <ThemedText
                      variant="muted"
                      size={12}
                      style={styles.imageHint}
                    >
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

          {/* Bottom save button */}
          <ThemedButton
            variant="primary"
            label={isSaving ? 'Saving...' : 'Save Profile'}
            onPress={handleSave}
            disabled={isSaving}
            style={styles.saveButton}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
};

// ── Styles ────────────────────────────────────────────────────────────────────

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
  numericInput: {
    textAlign: 'center',
  },

  // Images section
  imagesSection: {
    gap: 8,
  },
  imageHint: {
    marginTop: 4,
  },

  // Save button
  saveButton: {
    marginTop: 8,
  },
});
