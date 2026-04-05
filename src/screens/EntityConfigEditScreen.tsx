/**
 * EntityConfigEditScreen
 *
 * Edit screen for a fully configured entity. Allows changing the alias,
 * linking/changing a character profile, and configuring module bindings
 * for each module type. Includes a "Danger Zone" delete section.
 *
 * Route params: { entityId?: string }
 * entityId is always set when navigating here from EntityConfigScreen.
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
  KeyboardAvoidingView,
  Platform,
  Modal,
  FlatList,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { Appbar } from 'react-native-paper';
import { ThemedAppbar } from '../components/themed/ThemedAppbar';
import { ThemedCard } from '../components/themed/ThemedCard';
import { SectionHeader } from '../components/themed/SectionHeader';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { RootStackParamList } from '../navigation/AppNavigator';
import { useAppTheme } from '../contexts/ThemeContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedText } from '../components/themed/ThemedText';
import {
  EntityModuleSelector,
  ModuleConfigOption,
} from '../components/entities/EntityModuleSelector';

import {
  getEntity,
  updateEntityFields,
  getEntityModuleMapping,
  createOrUpdateEntityModuleMapping,
  deleteEntity,
} from '../database/repositories/entities';
import {
  getAllCharacterProfiles,
  getCharacterImages,
} from '../database/repositories/characters';
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
import { createDataURL } from '../database/base64';
import { CharacterProfile } from '../database/models';

type Props = NativeStackScreenProps<RootStackParamList, 'EntityConfigEdit'>;

export const EntityConfigEditScreen: React.FC<Props> = ({
  route,
  navigation,
}) => {
  const { theme } = useAppTheme();
  const { entityId } = route.params ?? {};

  // ── Identity ──────────────────────────────────────────────────────────────
  const [alias, setAlias] = useState('');

  // ── Character profile ─────────────────────────────────────────────────────
  const [allProfiles, setAllProfiles] = useState<CharacterProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>('');
  const [selectedProfile, setSelectedProfile] =
    useState<CharacterProfile | null>(null);
  const [selectedProfileImageUri, setSelectedProfileImageUri] = useState<
    string | null
  >(null);
  const [profilePickerVisible, setProfilePickerVisible] = useState(false);

  // ── Module configs — available options ────────────────────────────────────
  const [cognitionConfigs, setCognitionConfigs] = useState<ModuleConfigOption[]>([]);
  const [ttsConfigs, setTtsConfigs] = useState<ModuleConfigOption[]>([]);
  const [sttConfigs, setSttConfigs] = useState<ModuleConfigOption[]>([]);
  const [visionConfigs, setVisionConfigs] = useState<ModuleConfigOption[]>([]);
  const [ragConfigs, setRagConfigs] = useState<ModuleConfigOption[]>([]);
  const [imaginationConfigs, setImaginationConfigs] = useState<ModuleConfigOption[]>([]);
  const [movementConfigs, setMovementConfigs] = useState<ModuleConfigOption[]>([]);
  const [backendConfigs, setBackendConfigs] = useState<ModuleConfigOption[]>([]);

  // ── Module configs — selected values ('' = disabled) ─────────────────────
  const [cognitionId, setCognitionId] = useState('');
  const [ttsId, setTtsId] = useState('');
  const [sttId, setSttId] = useState('');
  const [visionId, setVisionId] = useState('');
  const [ragId, setRagId] = useState('');
  const [imaginationId, setImaginationId] = useState('');
  const [movementId, setMovementId] = useState('');
  const [backendId, setBackendId] = useState('');

  // ── UI state ──────────────────────────────────────────────────────────────
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // ── Load on mount ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (entityId) {
      loadEntityData(entityId);
    }
  }, [entityId]);

  const loadProfileImage = async (profileId: string) => {
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

  const loadEntityData = async (id: string) => {
    setIsLoading(true);
    try {
      // Load entity
      const entity = await getEntity(id);
      if (!entity) {
        Alert.alert('Error', 'Entity not found.');
        navigation.goBack();
        return;
      }
      setAlias(entity.alias ?? '');

      // Load all profiles for the selector
      const profiles = await getAllCharacterProfiles();
      setAllProfiles(profiles);

      // Pre-select current profile
      if (entity.character_profile_id) {
        setSelectedProfileId(entity.character_profile_id);
        const profile =
          profiles.find(p => p.id === entity.character_profile_id) ?? null;
        setSelectedProfile(profile);
        if (profile) {
          await loadProfileImage(profile.id);
        }
      }

      // Load module mapping
      const mapping = await getEntityModuleMapping(id);
      if (mapping) {
        setCognitionId(
          mapping.cognition_config_id != null
            ? String(mapping.cognition_config_id)
            : '',
        );
        setTtsId(
          mapping.tts_config_id != null ? String(mapping.tts_config_id) : '',
        );
        setSttId(
          mapping.stt_config_id != null ? String(mapping.stt_config_id) : '',
        );
        setVisionId(
          mapping.vision_config_id != null
            ? String(mapping.vision_config_id)
            : '',
        );
        setRagId(
          mapping.rag_config_id != null ? String(mapping.rag_config_id) : '',
        );
        setImaginationId(
          mapping.imagination_config_id != null
            ? String(mapping.imagination_config_id)
            : '',
        );
        setMovementId(
          mapping.movement_config_id != null
            ? String(mapping.movement_config_id)
            : '',
        );
        setBackendId(
          mapping.backend_config_id != null
            ? String(mapping.backend_config_id)
            : '',
        );
      }

      // Load available module configs
      const [cognition, tts, stt, vision, rag, imagination, movement, backend] = await Promise.all(
        [
          getAllCognitionConfigs(),
          getAllTTSConfigs(),
          getAllSTTConfigs(),
          getAllVisionConfigs(),
          getAllRAGConfigs(),
          getAllImaginationConfigs(),
          getAllMovementConfigs(),
          getAllBackendConfigs(),
        ],
      );
      setCognitionConfigs(cognition);
      setTtsConfigs(tts);
      setSttConfigs(stt);
      setVisionConfigs(vision);
      setRagConfigs(rag);
      setImaginationConfigs(imagination);
      setMovementConfigs(movement);
      setBackendConfigs(backend);
    } catch (err) {
      console.error('Failed to load entity:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // ── Profile selection handler ─────────────────────────────────────────────
  const handleProfileChange = async (profileId: string) => {
    const prevProfile = selectedProfile;
    setSelectedProfileId(profileId);
    const profile = allProfiles.find(p => p.id === profileId) ?? null;
    setSelectedProfile(profile);
    setSelectedProfileImageUri(null);
    if (profile) {
      await loadProfileImage(profile.id);
      // Auto-update alias to match profile name if alias is empty or matched old profile
      if (!alias || alias === prevProfile?.name) {
        setAlias(profile.name);
      }
    }
    setProfilePickerVisible(false);
  };

  const handleClearProfile = () => {
    setSelectedProfileId('');
    setSelectedProfile(null);
    setSelectedProfileImageUri(null);
    setProfilePickerVisible(false);
  };

  // ── Save logic ────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!entityId) return;

    setIsSaving(true);
    try {
      // Update entity fields (alias + character profile link).
      // The DB unique partial index enforces alias uniqueness; catch the error for user feedback.
      try {
        await updateEntityFields(entityId, {
          alias: alias.trim() || '',
          character_profile_id: selectedProfileId || null,
        });
      } catch (err: any) {
        // SQLite unique constraint violation message
        if (
          err?.message?.includes('UNIQUE') ||
          err?.message?.includes('alias')
        ) {
          Alert.alert(
            'Alias Conflict',
            'That alias is already taken by another entity.',
          );
        } else {
          Alert.alert('Error', err?.message ?? 'Failed to save entity.');
        }
        setIsSaving(false);
        return;
      }

      // Update module mapping
      await createOrUpdateEntityModuleMapping({
        entity_id: entityId,
        backend_config_id: backendId ? parseInt(backendId, 10) : null,
        cognition_config_id: cognitionId ? parseInt(cognitionId, 10) : null,
        tts_config_id: ttsId ? parseInt(ttsId, 10) : null,
        stt_config_id: sttId ? parseInt(sttId, 10) : null,
        vision_config_id: visionId ? parseInt(visionId, 10) : null,
        rag_config_id: ragId ? parseInt(ragId, 10) : null,
        imagination_config_id: imaginationId ? parseInt(imaginationId, 10) : null,
        movement_config_id: movementId ? parseInt(movementId, 10) : null,
      });

      navigation.goBack();
    } catch (err) {
      Alert.alert('Error', 'Failed to save entity settings.');
    } finally {
      setIsSaving(false);
    }
  };

  // ── Delete entity ─────────────────────────────────────────────────────────
  const handleDelete = () => {
    Alert.alert(
      'Delete Entity',
      'This will permanently remove the entity configuration. Chat history will be preserved but the entity will no longer be accessible.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteEntity(entityId!);
              navigation.navigate('EntityConfig');
            } catch {
              Alert.alert('Error', 'Failed to delete entity.');
            }
          },
        },
      ],
    );
  };

  // ── Profile preview card ──────────────────────────────────────────────────
  const renderProfilePreview = () => {
    if (!selectedProfile) return null;
    return (
      <View
        style={[
          styles.profilePreview,
          {
            backgroundColor: theme!.colors.background.base,
            borderColor: theme!.colors.border.default,
          },
        ]}
      >
        <View
          style={[
            styles.previewAvatar,
            { backgroundColor: theme!.colors.background.elevated },
          ]}
        >
          {selectedProfileImageUri ? (
            <Image
              source={{ uri: selectedProfileImageUri }}
              style={styles.previewAvatarImage}
              resizeMode="cover"
            />
          ) : (
            <Icon name="account" size={24} color={theme!.colors.text.muted} />
          )}
        </View>
        <View style={styles.previewText}>
          <ThemedText weight="bold" size={14}>
            {selectedProfile.name}
          </ThemedText>
          <ThemedText variant="muted" size={12} numberOfLines={1}>
            {selectedProfile.description ?? 'No description'}
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
          <Icon name="pencil" size={18} color={theme!.colors.accent.primary} />
        </TouchableOpacity>
      </View>
    );
  };

  // ── Render guard ──────────────────────────────────────────────────────────
  if (!theme) return null;

  if (isLoading) {
    return (
      <ThemedView style={styles.container}>
        <ThemedAppbar style={styles.header}>
          <Appbar.BackAction
            color={theme.colors.text.primary}
            onPress={() => navigation.goBack()}
          />
          <Appbar.Content
            title="Entity Settings"
            titleStyle={{
              color: theme.colors.text.primary,
              fontWeight: 'bold',
            }}
          />
        </ThemedAppbar>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.colors.accent.primary} />
        </View>
      </ThemedView>
    );
  }

  const profileSelectorLabel =
    selectedProfile?.name ?? 'Select a character profile…';

  return (
    <ThemedView style={styles.container}>
      {/* ── Header ── */}
      <ThemedAppbar style={styles.header}>
        <Appbar.BackAction
          color={theme.colors.text.primary}
          onPress={() => navigation.goBack()}
        />
        <Appbar.Content
          title="Entity Settings"
          titleStyle={{ color: theme.colors.text.primary, fontWeight: 'bold' }}
        />
        {isSaving ? (
          <ActivityIndicator
            size="small"
            color={theme.colors.accent.primary}
            style={styles.savingIndicator}
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
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Identity Section ── */}
          <ThemedCard elevated accentStripe style={styles.section}>
            <SectionHeader title="Identity" />
            <View style={styles.sectionContent}>

            <ThemedText size={13} variant="secondary" style={styles.fieldLabel}>
              Name / Alias
            </ThemedText>
            <TextInput
              style={[
                styles.input,
                {
                  color: theme.colors.text.primary,
                  borderColor: theme.colors.border.default,
                  backgroundColor: theme.colors.background.base,
                },
              ]}
              value={alias}
              onChangeText={setAlias}
              placeholder="Entity alias (must be unique)"
              placeholderTextColor={theme.colors.text.muted}
              autoCorrect={false}
              autoCapitalize="none"
            />
            <ThemedText variant="muted" size={11} style={styles.fieldHint}>
              Must be unique. Defaults to profile name if left blank.
            </ThemedText>
            </View>
          </ThemedCard>

          {/* ── Character Profile Section ── */}
          <ThemedCard elevated accentStripe style={styles.section}>
            <SectionHeader title="Character Profile" />
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
                style={{ flex: 1 }}
              >
                {profileSelectorLabel}
              </ThemedText>
              <ThemedText size={14} variant="muted">
                ▾
              </ThemedText>
            </TouchableOpacity>

            {/* Profile preview */}
            {renderProfilePreview()}
            </View>
          </ThemedCard>

          {/* ── Module Configuration Section ── */}
          <ThemedCard elevated accentStripe style={styles.section}>
            <SectionHeader title="Module Configuration" />
            <View style={styles.sectionContent}>

            <EntityModuleSelector
              label="Backend"
              configs={backendConfigs}
              selectedId={backendId}
              onChange={setBackendId}
            />
            <EntityModuleSelector
              label="Cognition"
              configs={cognitionConfigs}
              selectedId={cognitionId}
              onChange={setCognitionId}
            />
            <EntityModuleSelector
              label="Text-to-Speech (TTS)"
              configs={ttsConfigs}
              selectedId={ttsId}
              onChange={setTtsId}
            />
            <EntityModuleSelector
              label="Speech-to-Text (STT)"
              configs={sttConfigs}
              selectedId={sttId}
              onChange={setSttId}
            />
            <EntityModuleSelector
              label="Memory / RAG"
              configs={ragConfigs}
              selectedId={ragId}
              onChange={setRagId}
            />
            <EntityModuleSelector
              label="Movement"
              configs={movementConfigs}
              selectedId={movementId}
              onChange={setMovementId}
            />
            <EntityModuleSelector
              label="Vision"
              configs={visionConfigs}
              selectedId={visionId}
              onChange={setVisionId}
            />            
            <EntityModuleSelector
              label="Imagination"
              configs={imaginationConfigs}
              selectedId={imaginationId}
              onChange={setImaginationId}
            />
            </View>
          </ThemedCard>

          {/* ── Danger Zone ── */}
          <ThemedCard
            elevated
            style={[
              styles.section,
              styles.dangerSection,
              { borderColor: theme.colors.status.error },
            ]}
          >
            <SectionHeader
              title="Danger Zone"
              accentPip={false}
              style={{ borderBottomColor: theme.colors.status.error + '44' }}
            />
            <View style={styles.sectionContent}>

            <TouchableOpacity
              style={[
                styles.deleteButton,
                { borderColor: theme.colors.status.error + '88' },
              ]}
              onPress={handleDelete}
              activeOpacity={0.75}
            >
              <LinearGradient
                colors={[
                  theme.colors.status.error + '33',
                  theme.colors.status.error + '11',
                ]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={StyleSheet.absoluteFillObject}
              />
              <View style={styles.deleteIconBadge}>
                <Icon
                  name="delete-outline"
                  size={16}
                  color={theme.colors.status.error}
                />
              </View>
              <ThemedText
                size={14}
                weight="medium"
                style={{ color: theme.colors.status.error }}
              >
                Delete Entity
              </ThemedText>
            </TouchableOpacity>
            </View>
          </ThemedCard>
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
              Select Character Profile
            </ThemedText>

            <FlatList
              data={
                [
                  { id: '', name: 'None (unlinked)' } as Pick<
                    CharacterProfile,
                    'id' | 'name'
                  >,
                  ...allProfiles,
                ] as Array<Pick<CharacterProfile, 'id' | 'name'>>
              }
              keyExtractor={item => item.id ?? ''}
              renderItem={({ item }) => {
                const isNone = item.id === '';
                const isSelected = isNone
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
                      if (isNone) {
                        handleClearProfile();
                      } else {
                        handleProfileChange(item.id);
                      }
                    }}
                  >
                    <ThemedText
                      size={14}
                      variant={
                        isSelected ? 'accent' : isNone ? 'muted' : 'primary'
                      }
                      weight={isSelected ? 'medium' : 'normal'}
                      style={{ flex: 1 }}
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

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { elevation: 4 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  savingIndicator: { marginRight: 16 },
  keyboardAvoid: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 48 },

  // ── Sections ──
  section: {
    padding: 0,
    overflow: 'hidden',
  },
  sectionContent: {
    padding: 16,
    gap: 12,
  },
  dangerSection: {
    borderWidth: 1.5,
  },
  sectionTitle: {
    letterSpacing: 0.8,
    marginBottom: 12,
  },

  // ── Fields ──
  fieldLabel: { marginBottom: 6 },
  fieldHint: { marginTop: 4 },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    minHeight: 44,
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

  // ── Profile preview ──
  profilePreview: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
    gap: 12,
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

  // ── Danger zone ──
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 11,
    alignSelf: 'flex-start',
    gap: 10,
    overflow: 'hidden',
  },
  deleteIconBadge: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.06)',
    justifyContent: 'center',
    alignItems: 'center',
  },

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
});
