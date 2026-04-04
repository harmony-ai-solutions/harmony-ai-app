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

import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
  TouchableOpacity,
  Image,
  Modal,
  FlatList,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Appbar } from 'react-native-paper';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { launchImageLibrary } from 'react-native-image-picker';
import { v4 as uuidv4 } from 'uuid';

import { RootStackParamList } from '../navigation/AppNavigator';
import { useAppTheme } from '../contexts/ThemeContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedText } from '../components/themed/ThemedText';
import { ThemedButton } from '../components/themed/ThemedButton';

import {
  createCharacterProfile,
  createCharacterImage,
} from '../database/repositories/characters';
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

  return (
    <View style={pickerStyles.row}>
      <ThemedText size={13} variant="secondary" style={pickerStyles.label}>
        {label}
      </ThemedText>
      <TouchableOpacity
        style={[
          pickerStyles.selector,
          {
            borderColor: theme.colors.border.default,
            backgroundColor: theme.colors.background.base,
          },
        ]}
        onPress={() => setModalVisible(true)}
        activeOpacity={0.7}
      >
        <ThemedText size={14} variant="primary" style={{ flex: 1 }}>
          {selectedLabel}
        </ThemedText>
        <ThemedText size={14} variant="muted">
          ▾
        </ThemedText>
      </TouchableOpacity>

      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <TouchableOpacity
          style={pickerStyles.modalOverlay}
          activeOpacity={1}
          onPress={() => setModalVisible(false)}
        >
          <View
            style={[
              pickerStyles.modalSheet,
              { backgroundColor: theme.colors.background.elevated },
            ]}
          >
            <ThemedText weight="bold" size={15} style={pickerStyles.modalTitle}>
              {label}
            </ThemedText>
            <FlatList
              data={options}
              keyExtractor={item => item.value}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    pickerStyles.modalItem,
                    item.value === value && {
                      backgroundColor: theme.colors.accent.primary + '22',
                    },
                  ]}
                  onPress={() => {
                    onChange(item.value);
                    setModalVisible(false);
                  }}
                >
                  <ThemedText
                    size={14}
                    variant={item.value === value ? 'accent' : 'primary'}
                    weight={item.value === value ? 'medium' : 'normal'}
                  >
                    {item.label}
                  </ThemedText>
                  {item.value === value && (
                    <ThemedText size={14} variant="accent">
                      ✓
                    </ThemedText>
                  )}
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const pickerStyles = StyleSheet.create({
  row: {
    marginBottom: 12,
  },
  label: {
    marginBottom: 4,
  },
  selector: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
  },
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
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// CreateAIScreen
// ─────────────────────────────────────────────────────────────────────────────

export const CreateAIScreen: React.FC<Props> = ({ route, navigation }) => {
  const { theme } = useAppTheme();

  // ── Core fields ──────────────────────────────────────────────────────────────
  const [name, setName] = useState('');
  const [personality, setPersonality] = useState('');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [avatarBase64, setAvatarBase64] = useState<string | null>(null);
  const [avatarMimeType, setAvatarMimeType] = useState<string>('image/jpeg');

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
      console.error('Failed to pick avatar:', err);
    }
  };

  // ── Save & Create ────────────────────────────────────────────────────────────
  const handleCreate = async () => {
    if (!name.trim()) {
      Alert.alert('Name Required', 'Please give your AI a name.');
      return;
    }

    setIsSaving(true);
    try {
      const profileId = uuidv4();
      const entityId = name.trim();

      // 1. Create character profile
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

      // 2. Add avatar image if selected
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

      // 3. Create entity with alias = name
      await createEntity({
        id: entityId,
        alias: '',
        character_profile_id: profileId,
        lifecycle_config: '{}',
      });

      // 4. Create entity module mapping
      await createEntityModuleMapping({
        entity_id: entityId,
        backend_config_id: backendConfigId ? parseInt(backendConfigId, 10) : null,
        cognition_config_id: cognitionConfigId ? parseInt(cognitionConfigId, 10) : null,
        tts_config_id: ttsConfigId ? parseInt(ttsConfigId, 10) : null,
        stt_config_id: sttConfigId ? parseInt(sttConfigId, 10) : null,
        vision_config_id: visionConfigId ? parseInt(visionConfigId, 10) : null,
        rag_config_id: ragConfigId ? parseInt(ragConfigId, 10) : null,
        imagination_config_id: imaginationConfigId ? parseInt(imaginationConfigId, 10) : null,
        movement_config_id: movementConfigId ? parseInt(movementConfigId, 10) : null,
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
      navigation.replace('ChatDetail', {
        partnerEntityId: entityId,
        partnerCharacterId: profileId,
        impersonatedEntityId: impersonatedEntityId ?? 'user',
      });
    } catch (err: any) {
      Alert.alert(
        'Error',
        'Failed to create AI partner: ' + (err?.message ?? 'Unknown error'),
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
      <Appbar.Header
        style={[
          styles.header,
          { backgroundColor: theme.colors.background.surface },
        ]}
      >
        <Appbar.BackAction
          color={theme.colors.text.primary}
          onPress={() => navigation.goBack()}
        />
        <Appbar.Content
          title="Create AI Partner"
          titleStyle={{ color: theme.colors.text.primary, fontWeight: 'bold' }}
        />
      </Appbar.Header>

      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Avatar Picker ── */}
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
                    + Photo
                  </ThemedText>
                  <ThemedText size={11} variant="muted">
                    (optional)
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
                  Change photo
                </ThemedText>
              </TouchableOpacity>
            )}
          </View>

          {/* ── Name field ── */}
          <View style={styles.fieldGroup}>
            <ThemedText size={13} variant="secondary" style={styles.fieldLabel}>
              Name *
            </ThemedText>
            <TextInput
              style={[styles.input, inputStyle]}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Aria, Max, Luna..."
              placeholderTextColor={theme.colors.text.muted}
              returnKeyType="next"
              autoCorrect={false}
            />
          </View>

          {/* ── Personality field ── */}
          <View style={styles.fieldGroup}>
            <ThemedText size={13} variant="secondary" style={styles.fieldLabel}>
              Personality (optional)
            </ThemedText>
            <TextInput
              style={[styles.input, styles.multilineInput, inputStyle]}
              value={personality}
              onChangeText={setPersonality}
              placeholder="e.g. Helpful, playful, curious..."
              placeholderTextColor={theme.colors.text.muted}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
          </View>

          {/* ── Advanced Settings toggle ── */}
          <TouchableOpacity
            style={[
              styles.advancedToggle,
              {
                backgroundColor: theme.colors.background.elevated,
                borderColor: theme.colors.border.default,
              },
            ]}
            onPress={() => setShowAdvanced(prev => !prev)}
            activeOpacity={0.7}
          >
            <ThemedText size={14} weight="medium" variant="primary">
              {showAdvanced ? '▾' : '▸'} Advanced Settings
            </ThemedText>
          </TouchableOpacity>

          {/* ── Advanced Settings panel ── */}
          {showAdvanced && (
            <View
              style={[
                styles.advancedPanel,
                {
                  backgroundColor: theme.colors.background.elevated,
                  borderColor: theme.colors.border.default,
                },
              ]}
            >
              {/* Loading indicator */}
              {hasAnyConfigs === null && (
                <View style={styles.loadingRow}>
                  <ActivityIndicator
                    size="small"
                    color={theme.colors.accent.primary}
                  />
                  <ThemedText
                    size={13}
                    variant="muted"
                    style={{ marginLeft: 8 }}
                  >
                    Loading module configs...
                  </ThemedText>
                </View>
              )}

              {/* No configs warning */}
              {hasAnyConfigs === false && (
                <View style={styles.noConfigsBox}>
                  <ThemedText
                    size={14}
                    variant="muted"
                    weight="bold"
                    style={styles.noConfigsWarning}
                  >
                    ⚠ No AI modules configured.
                  </ThemedText>
                  <ThemedText
                    size={13}
                    variant="muted"
                    style={styles.noConfigsDetail}
                  >
                    Connect to Harmony Link or Cloud to configure AI backends.
                  </ThemedText>
                  <TouchableOpacity
                    onPress={() => navigation.navigate('ConnectionSetup')}
                    style={styles.connectionSetupLink}
                  >
                    <ThemedText size={13} variant="accent" weight="medium">
                      → Connection Setup
                    </ThemedText>
                  </TouchableOpacity>
                </View>
              )}

              {/* Module pickers — only shown when configs exist */}
              {hasAnyConfigs === true && (
                <>
                  <ModuleConfigPicker
                    label="Backend"
                    options={backendOptions}
                    value={backendConfigId}
                    onChange={setBackendConfigId}
                  />
                  <ModuleConfigPicker
                    label="Cognition"
                    options={cognitionOptions}
                    value={cognitionConfigId}
                    onChange={setCognitionConfigId}
                  />
                  <ModuleConfigPicker
                    label="Text-to-Speech (TTS)"
                    options={ttsOptions}
                    value={ttsConfigId}
                    onChange={setTtsConfigId}
                  />
                  <ModuleConfigPicker
                    label="Speech-to-Text (STT)"
                    options={sttOptions}
                    value={sttConfigId}
                    onChange={setSttConfigId}
                  />
                  <ModuleConfigPicker
                    label="Memory / RAG"
                    options={ragOptions}
                    value={ragConfigId}
                    onChange={setRagConfigId}
                  />
                  <ModuleConfigPicker
                    label="Movement"
                    options={movementOptions}
                    value={movementConfigId}
                    onChange={setMovementConfigId}
                  />
                  <ModuleConfigPicker
                    label="Vision"
                    options={visionOptions}
                    value={visionConfigId}
                    onChange={setVisionConfigId}
                  />                  
                  <ModuleConfigPicker
                    label="Imagination"
                    options={imaginationOptions}
                    value={imaginationConfigId}
                    onChange={setImaginationConfigId}
                  />                  
                </>
              )}
            </View>
          )}

          {/* ── Create button ── */}
          <View style={styles.ctaSection}>
            {isSaving ? (
              <ActivityIndicator
                size="large"
                color={theme.colors.accent.primary}
              />
            ) : (
              <ThemedButton
                label="Start Chatting  →"
                onPress={handleCreate}
                variant="primary"
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

  // ── Advanced toggle ──
  advancedToggle: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 2,
  },

  // ── Advanced panel ──
  advancedPanel: {
    borderWidth: 1,
    borderTopWidth: 0,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    padding: 16,
    marginBottom: 20,
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
