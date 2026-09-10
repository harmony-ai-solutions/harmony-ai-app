/**
 * PersonaEditScreen — the FULL persona editor (create / edit / built-in).
 *
 * A persona is the identity the USER chats AS. Since persona-card alignment
 * (decision 11) the 3-field form is fully replaced by the same editor
 * machinery `CreateAIScreen` uses in edit mode — the reusable
 * `src/components/character-card/editor-sections/*` suite (Greeting /
 * Alternate Greetings / Lorebook / Images / Tags / Attribution / Export) plus
 * the shared state mapping (`profileToEditorState` / `editorStateToProfileFields`),
 * the diff-based image reconcile (`computeImageDeltas`) and the shared export
 * helpers (`exportProfileToCardV3` / `exportToJSON` / `exportToPNG`).
 *
 * personaMode differences from the AI editor:
 *   - lifecycle + advanced (module configs) sections are HIDDEN (decision 2);
 *     the loaded lifecycle_config is never written back on save.
 *   - greeting TEST is disabled (decision 13) — personas never generate
 *     greetings as chat partners; greeting content round-trips untouched.
 *   - the name field renames the persona via `updateUserPersona` (profile name
 *     + entity alias synced; entity id FROZEN — RN semantics, no RenameEntity).
 *   - the built-in `user` persona gets the same editor with rename + delete
 *     LOCKED; until the engine seeder syncs its profile it shows the pre-seed
 *     empty state (decision 8).
 *   - creating a persona named `user` is blocked client-side, trim +
 *     case-insensitive (decision 14).
 *
 * After saving, the backing entity is pushed to the engine (best-effort
 * syncAndWait) so chat INIT_ENTITY succeeds when chatting as this persona.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  Image,
  Share,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { launchImageLibrary } from 'react-native-image-picker';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import RNFS from 'react-native-fs';
import { v4 as uuidv4 } from 'uuid';
import { useAppTheme } from '../contexts/ThemeContext';
import { useAppAlert } from '../contexts/AppAlertContext';
import { useBiometricLock } from '../contexts/BiometricLockContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedText } from '../components/themed/ThemedText';
import { ThemedButton } from '../components/themed/ThemedButton';
import { ThemedCard } from '../components/themed/ThemedCard';
import { ScreenHeader } from '../components/themed/ScreenHeader';
import { SectionHeader } from '../components/themed/SectionHeader';
import { ProfileAvatar } from '../components/profile/ProfileAvatar';
import { ProfileImagePicker } from '../components/characters/ProfileImagePicker';
import { parseJsonColumn } from '../components/character-card/lorebook';
import type { LifecycleConfig } from '../components/character-card/LifecycleConfigEditor';
import {
  AlternateGreetingsSection,
  AttributionSection,
  ExportSection,
  GreetingEditorSection,
  LorebookSection,
  TagsSection,
  computeImageDeltas,
  editorStateToProfileFields,
  profileToEditorState,
} from '../components/character-card/editor-sections';
import type {
  DesiredEditorImage,
  EditorState,
} from '../components/character-card/editor-sections';
import { exportProfileToCardV3, exportToJSON, exportToPNG } from '../utils/charactercard/exporter';
import { utf8Encode } from '../utils/charactercard/pngWriter';
import { uint8ArrayToBase64, createDataURL } from '../database/base64';
import { hexToRgba } from '../utils/colorUtils';
import {
  getCharacterProfile,
  getCharacterImages,
  createCharacterImage,
  updateCharacterImage,
  deleteCharacterImage,
  getAllCharacterProfiles,
} from '../database/repositories/characters';
import { getAllEntities, getEntity, ReservedEntityNameError } from '../database/repositories/entities';
import {
  createUserPersona,
  getUserPersona,
  updateUserPersona,
  deleteUserPersona,
  PersonaAliasConflictError,
  resolvePersonaId,
} from '../database/repositories/userEntities';
import type { UserPersonaAvatar, UserPersonaProfileFields } from '../database/repositories/userEntities';
import syncService from '../services/SyncService';
import ChatPreferencesService from '../services/ChatPreferencesService';
import { RootStackParamList } from '../navigation/AppNavigator';
import { createLogger } from '../utils/logger';

const log = createLogger('[PersonaEditScreen]');

type PersonaEditRouteProp = RouteProp<RootStackParamList, 'PersonaEdit'>;

/**
 * personaMode section allow-list (decision 2): only lifecycle + advanced
 * (module configs) are hidden for personas — greeting / lorebook / images /
 * tags / attribution / export all stay. Rendering iterates this list so the
 * hidden-sections mechanism is explicit and testable.
 */
type PersonaEditorSection =
  | 'greeting'
  | 'lorebook'
  | 'images'
  | 'tags'
  | 'attribution'
  | 'export';
const PERSONA_EDITOR_SECTIONS: PersonaEditorSection[] = [
  'greeting',
  'lorebook',
  'images',
  'tags',
  'attribution',
  'export',
];

/**
 * Reserved-name validation (decision 14 + D33): `user` is the built-in
 * identity and `deleted` is system-reserved — a persona must never be created
 * or renamed to one (trim + case-insensitive; the mint seam's typed
 * `ReservedEntityNameError` stays as the backstop).
 */
function isReservedPersonaName(raw: string): boolean {
  const lower = raw.trim().toLowerCase();
  return lower === 'user' || lower === 'deleted';
}

/** Filesystem-safe export base name (CreateAI parity). */
function sanitizeExportFilename(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/[^a-zA-Z0-9 _-]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/_+/g, '_');
  return cleaned || 'character';
}

export const PersonaEditScreen: React.FC = () => {
  const { theme } = useAppTheme();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<PersonaEditRouteProp>();
  const { t } = useTranslation(['profile', 'characters', 'createAI']);
  const { showAlert } = useAppAlert();
  const { withExternalFlow } = useBiometricLock();

  const personaId = route.params?.entityId;
  const isEdit = !!personaId;
  // Built-in identity (A1 / decision 8): the `user` entity is load-bearing —
  // id FROZEN, rename + delete LOCKED, but it gets the same full editor.
  const isBuiltIn = personaId === 'user';

  // ── Core fields ─────────────────────────────────────────────────────────
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [personality, setPersonality] = useState('');
  const [voiceCharacteristics, setVoiceCharacteristics] = useState('');
  const [typingSpeedWpm, setTypingSpeedWpm] = useState('60');
  const [audioResponseChance, setAudioResponseChance] = useState('50');
  const [basePrompt, setBasePrompt] = useState('');
  const [scenario, setScenario] = useState('');
  const [exampleDialogues, setExampleDialogues] = useState('');

  // ── V3/RP editor state (single source shared with the editor sections) ───
  const [nickname, setNickname] = useState('');
  const [firstMes, setFirstMes] = useState('');
  const [alternateGreetings, setAlternateGreetings] = useState<string[]>([]);
  const [postHistoryInstructions, setPostHistoryInstructions] = useState('');
  const [creatorName, setCreatorName] = useState('');
  const [creatorNotes, setCreatorNotes] = useState('');
  const [characterVersion, setCharacterVersion] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [groupOnlyGreetings, setGroupOnlyGreetings] = useState<string[]>([]);
  const [extensions, setExtensions] = useState<Record<string, unknown>>({});
  const [assets, setAssets] = useState<unknown[] | null>(null);
  const [cardProvenance, setCardProvenance] = useState<Record<string, unknown> | null>(null);
  const [characterBook, setCharacterBook] = useState<string | null>(null);
  // Held for the full-state round-trip but NEVER rendered or written back in
  // personaMode (decision 2 — lifecycle hidden).
  const [lifecycleConfig, setLifecycleConfig] = useState<LifecycleConfig>({});
  const [libraryTags, setLibraryTags] = useState<string[]>([]);

  // ── Avatar + gallery images ─────────────────────────────────────────────
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [avatarBase64, setAvatarBase64] = useState<string | null>(null);
  const [avatarMimeType, setAvatarMimeType] = useState<string>('image/jpeg');
  // Gallery tiles (create-flow rendering + edit-mode desired-image source).
  const [galleryImages, setGalleryImages] = useState<
    Array<{ base64: string; mimeType: string; description: string }>
  >([]);
  // Edit-mode image rows (real ids) for the picker + reconcile.
  const [editImages, setEditImages] = useState<
    import('../database/models').CharacterImage[]
  >([]);
  const [primaryImageId, setPrimaryImageId] = useState<string | null>(null);

  // ── Roleplay entity resolution ({{user}}) for the greeting preview ───────
  const [impersonatedEntityName, setImpersonatedEntityName] = useState('{{user}}');

  // ── UI state ────────────────────────────────────────────────────────────
  const [isSaving, setIsSaving] = useState(false);
  // D86: set by the alias-collision pre-check or the typed
  // `PersonaAliasConflictError` save guard; cleared on the next name edit.
  const [aliasConflictFlag, setAliasConflictFlag] = useState(false);

  // ── Name-field inline errors ──────────────────────────────────────────────
  // D33: reserved names (`user` / `deleted`) flag LIVE as they are typed —
  // submit is additionally blocked in `handleSave`.
  const reservedNameError = isReservedPersonaName(name)
    ? t('personaNameReserved')
    : null;
  // D86: alias conflict (pre-check + typed residual race) — friendly inline
  // error mirroring the engine's update-400 semantics, never raw SQLite text.
  const aliasConflictError = aliasConflictFlag ? t('personaAliasConflict') : null;
  const nameFieldError = reservedNameError ?? aliasConflictError;

  const handleNameChange = (v: string) => {
    setName(v);
    if (aliasConflictFlag) setAliasConflictFlag(false);
  };
  const [loaded, setLoaded] = useState(false);
  const [hasLinkedProfile, setHasLinkedProfile] = useState(false);
  const [showDetails, setShowDetails] = useState(true);
  const [showGreeting, setShowGreeting] = useState(false);
  const [showLorebook, setShowLorebook] = useState(false);
  const [showImages, setShowImages] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const [showAttribution, setShowAttribution] = useState(false);
  // The resolved global "Chatting as" identity id (delete gate — review 2a).
  const [activePersonaId, setActivePersonaId] = useState<string | null>(null);

  const nameRef = useRef(name);
  useEffect(() => {
    nameRef.current = name;
  }, [name]);

  // Pre-seed empty state (decision 8): the built-in `user` has no linked
  // profile until the engine seeder syncs "You" — the editor is shown locked.
  const isPreSeed = isEdit && isBuiltIn && !hasLinkedProfile;

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

  // ── Edit-mode helpers: roleplay entity ({{user}}) + library tags ────────
  // Only needed by the greeting preview / tag suggestions.
  useEffect(() => {
    (async () => {
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
    (async () => {
      try {
        const persona = personaId ? await getUserPersona(personaId) : null;
        setImpersonatedEntityName(persona?.name ?? '{{user}}');
      } catch {
        setImpersonatedEntityName('{{user}}');
      }
    })();
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
        if (!cancelled && !persona) {
          showAlert(t('common:error'), t('persona:personaNotFound'));
          navigation.goBack();
          return;
        }
        if (cancelled || !persona) return;

        // Linked profile? (built-in `user` may be pre-seed — no profile until
        // the engine seeder syncs "You" down.)
        const entity = await getEntity(personaId!);
        if (cancelled) return;
        const profileId = entity?.character_profile_id ?? null;
        setHasLinkedProfile(!!profileId);

        if (profileId) {
          const profile = await getCharacterProfile(profileId);
          if (cancelled) return;
          if (!profile) {
            showAlert(t('common:error'), t('persona:personaNotFound'));
            navigation.goBack();
            return;
          }

          // V3/RP fields via the shared editor-state mapping (single source of
          // truth — the same mapping the round-trip test pins down).
          const editorState = profileToEditorState(profile);
          setName(editorState.name);
          setDescription(editorState.description);
          setPersonality(editorState.personality);
          setVoiceCharacteristics(editorState.voiceCharacteristics);
          setTypingSpeedWpm(editorState.typingSpeedWpm);
          setAudioResponseChance(editorState.audioResponseChance);
          setBasePrompt(editorState.basePrompt);
          setScenario(editorState.scenario);
          setExampleDialogues(editorState.mesExample);
          setNickname(editorState.nickname);
          setFirstMes(editorState.firstMes);
          setAlternateGreetings(editorState.alternateGreetings);
          setPostHistoryInstructions(editorState.postHistoryInstructions);
          setCreatorName(editorState.creator);
          setCreatorNotes(editorState.creatorNotes);
          setCharacterVersion(editorState.characterVersion);
          setTags(editorState.tags);
          setGroupOnlyGreetings(editorState.groupOnlyGreetings);
          setExtensions(editorState.extensions);
          setAssets(editorState.assets);
          setCardProvenance(editorState.cardProvenance);
          setCharacterBook(editorState.characterBook);
          setLifecycleConfig(editorState.lifecycleConfig);

          // Images: full rows (real ids) for the picker + reconcile; the
          // primary also feeds the avatar UI and the rest the gallery tiles.
          try {
            const images = await getCharacterImages(profileId);
            if (cancelled) return;
            setEditImages(images);
            const primary = images.find(img => img.is_primary === true);
            setPrimaryImageId(primary?.id ?? null);
            if (primary && primary.image_data && primary.mime_type) {
              setAvatarBase64(primary.image_data);
              setAvatarMimeType(primary.mime_type);
              setAvatarUri(createDataURL(primary.image_data, primary.mime_type));
            }
            setGalleryImages(
              images
                .filter(img => img.image_data && img.mime_type && !img.is_primary)
                .map(img => ({
                  base64: img.image_data,
                  mimeType: img.mime_type,
                  description: img.description ?? '',
                })),
            );
          } catch (imgErr) {
            log.warn('Failed to load persona images:', imgErr);
          }
        } else {
          // Pre-seed built-in user: show the raw persona row (name falls back
          // to the alias/id) so the locked editor still displays something.
          setName(persona.name);
          setDescription(persona.description ?? '');
          setPersonality(persona.personality ?? '');
          setAvatarUri(persona.avatarUri);
        }
        if (!cancelled) setLoaded(true);
      } catch (err) {
        log.error('Failed to load persona for edit:', err);
        if (!cancelled) {
          showAlert(t('common:error'), t('personaSaveFailed'));
          navigation.goBack();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isEdit, personaId, navigation, showAlert, t]);

  // ── V3/RP editor state builder (single mapping for save + export) ────────
  const currentEditorState = useCallback(
    (): EditorState => ({
      name,
      description,
      personality,
      voiceCharacteristics,
      typingSpeedWpm,
      audioResponseChance,
      basePrompt,
      scenario,
      firstMes,
      alternateGreetings,
      mesExample: exampleDialogues,
      postHistoryInstructions,
      creatorNotes,
      creator: creatorName,
      characterVersion,
      nickname,
      tags,
      groupOnlyGreetings,
      extensions,
      assets,
      cardProvenance,
      characterBook,
      lifecycleConfig,
    }),
    [
      name, description, personality, voiceCharacteristics,
      typingSpeedWpm, audioResponseChance, basePrompt, scenario,
      firstMes, alternateGreetings, exampleDialogues, postHistoryInstructions,
      creatorNotes, creatorName, characterVersion, nickname, tags,
      groupOnlyGreetings, extensions, assets, cardProvenance, characterBook,
      lifecycleConfig,
    ],
  );

  /**
   * Profile fields for the persona save. Built from the shared editor mapping
   * then stripped of `lifecycle_config` — personaMode NEVER writes lifecycle
   * (decision 2: hidden section; omitted fields round-trip untouched).
   */
  const personaProfileFields = useCallback((): UserPersonaProfileFields => {
    const fields = editorStateToProfileFields(currentEditorState());
    const { lifecycle_config, ...rest } = fields;
    void lifecycle_config;
    return rest;
  }, [currentEditorState]);

  // ── Alternate greeting operations ────────────────────────────────────────
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

  // ── Avatar picker ────────────────────────────────────────────────────────
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
        const base64 = asset.base64 ?? null;
        const mimeType = asset.type ?? 'image/jpeg';

        // Edit mode: changing the avatar demotes the current primary row into
        // the gallery (the save-time reconcile persists the is_primary/order
        // flags; the old row's id stays stable).
        if (isEdit && base64) {
          const curPrimary = editImages.find(img => img.is_primary);
          if (
            curPrimary &&
            !(curPrimary.image_data === base64 && curPrimary.mime_type === mimeType)
          ) {
            setGalleryImages(prev => [
              {
                base64: curPrimary.image_data,
                mimeType: curPrimary.mime_type,
                description: curPrimary.description ?? '',
              },
              ...prev.filter(
                g =>
                  !(g.base64 === curPrimary.image_data && g.mimeType === curPrimary.mime_type),
              ),
            ]);
          }
        }

        setAvatarUri(asset.uri ?? null);
        setAvatarBase64(base64);
        setAvatarMimeType(mimeType);
      }
    } catch (err) {
      log.error('Failed to pick persona picture:', err);
    }
  };

  /** Create mode only — clears the (unpersisted) avatar. */
  const handleRemoveAvatar = () => {
    setAvatarUri(null);
    setAvatarBase64(null);
    setAvatarMimeType('image/jpeg');
  };

  // ── Gallery image picker (create flow — added to the Images tab) ─────────
  const handleAddGalleryImage = async () => {
    try {
      const result = await withExternalFlow(() =>
        launchImageLibrary({
          mediaType: 'photo',
          includeBase64: true,
          quality: 0.8,
        }),
      );
      if (result.assets?.[0]) {
        const asset = result.assets[0];
        if (!asset.base64) return;
        setGalleryImages(prev => [
          ...prev,
          {
            base64: asset.base64!,
            mimeType: asset.type ?? 'image/jpeg',
            description: '',
          },
        ]);
      }
    } catch (err) {
      log.error('Failed to add gallery image:', err);
    }
  };

  const handleRemoveGalleryImage = (index: number) => {
    setGalleryImages(prev => prev.filter((_, i) => i !== index));
  };

  // ── Edit-mode image operations (local-only; the save path reconciles) ────
  // Deferred writes: the picker mutates local state and the diff-based
  // reconcile on save computes the create/update/remove deltas, so untouched
  // image rows keep their ids (Phase 8 Step 4 pattern).
  const handleAddImage = async () => {
    try {
      const result = await withExternalFlow(() =>
        launchImageLibrary({
          mediaType: 'photo',
          includeBase64: true,
          quality: 0.8,
        }),
      );
      if (!result.assets || !result.assets[0]) return;
      const asset = result.assets[0];
      if (!asset.base64) {
        showAlert(t('common:error'), t('characters:imageError'));
        return;
      }
      const mimeType = asset.type ?? 'image/jpeg';
      const isFirst = editImages.length === 0;
      const tempId = `tmp-${uuidv4()}`;
      const row: import('../database/models').CharacterImage = {
        id: tempId,
        character_profile_id: personaId ?? '',
        image_data: asset.base64,
        mime_type: mimeType,
        description: '',
        is_primary: isFirst,
        display_order: editImages.length,
        vl_model_interpretation: '',
        vl_model: '',
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: null,
      };
      setEditImages(prev => [...prev, row]);
      setGalleryImages(prev => [
        ...prev,
        { base64: asset.base64!, mimeType, description: '' },
      ]);
      if (isFirst) {
        setPrimaryImageId(tempId);
        setAvatarBase64(asset.base64);
        setAvatarMimeType(mimeType);
        setAvatarUri(createDataURL(asset.base64, mimeType));
      }
    } catch (err) {
      log.error('Failed to add image:', err);
      showAlert(t('common:error'), t('characters:addImageFailed'));
    }
  };

  const handleSetPrimary = (imageId: string) => {
    setPrimaryImageId(imageId);
    setEditImages(prev =>
      prev.map(img => ({ ...img, is_primary: img.id === imageId })),
    );
    const target = editImages.find(img => img.id === imageId);
    if (target) {
      setAvatarBase64(target.image_data || null);
      setAvatarMimeType(target.mime_type || 'image/jpeg');
      setAvatarUri(createDataURL(target.image_data, target.mime_type));
      setGalleryImages(prev =>
        prev.filter(
          g =>
            !(g.base64 === target.image_data && g.mimeType === target.mime_type),
        ),
      );
    }
  };

  const handleDeleteImage = (imageId: string) => {
    const target = editImages.find(img => img.id === imageId);
    const remaining = editImages.filter(img => img.id !== imageId);
    setEditImages(remaining);
    if (target) {
      setGalleryImages(prev =>
        prev.filter(
          g =>
            !(g.base64 === target.image_data && g.mimeType === target.mime_type),
        ),
      );
    }
    if (primaryImageId === imageId) {
      const replacement = remaining[0] ?? null;
      setPrimaryImageId(replacement?.id ?? null);
      if (replacement) {
        setAvatarBase64(replacement.image_data || null);
        setAvatarMimeType(replacement.mime_type || 'image/jpeg');
        setAvatarUri(createDataURL(replacement.image_data, replacement.mime_type));
        setGalleryImages(prev =>
          prev.filter(
            g =>
              !(g.base64 === replacement.image_data && g.mimeType === replacement.mime_type),
          ),
        );
      } else {
        setAvatarBase64(null);
        setAvatarMimeType('image/jpeg');
        setAvatarUri(null);
      }
    }
  };

  // ── Save ───────────────────────────────────────────────────────────────
  const handleSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      showAlert(t('personaNameRequired'));
      return;
    }
    // Decision 14 / D33: reserved-name validation (trim + case-insensitive).
    // The inline field error renders live under the name field; just block
    // the submit here.
    if (isReservedPersonaName(name)) {
      return;
    }
    if (isPreSeed) {
      showAlert(t('personaPreSeedLocked'));
      return;
    }

    // Numeric validation (CreateAI parity — alert instead of silent clamp).
    const typingWpm = parseInt(typingSpeedWpm, 10);
    if (isNaN(typingWpm) || typingWpm < 1 || typingWpm > 200) {
      showAlert(t('common:validation'), t('characters:validationTypingSpeed'));
      return;
    }
    const audioChance = parseInt(audioResponseChance, 10);
    if (isNaN(audioChance) || audioChance < 0 || audioChance > 100) {
      showAlert(t('common:validation'), t('characters:validationAudioChance'));
      return;
    }

    // D86 (review 7): case-insensitive alias-equality pre-check over LIVE
    // rows, excluding the edited entity — the edit-path mirror of the engine's
    // update-400 semantics (creates auto-suffix per D56, edits reject).
    // Best-effort probe: if it fails, the typed save guard below still maps
    // the residual constraint race.
    if (isEdit) {
      try {
        const liveEntities = await getAllEntities();
        const aliasTaken = liveEntities.some(
          e =>
            e.id !== personaId &&
            (e.alias ?? '').trim().toLowerCase() === trimmedName.toLowerCase(),
        );
        if (aliasTaken) {
          setAliasConflictFlag(true);
          return;
        }
      } catch (preCheckErr) {
        log.warn('Persona alias pre-check failed; falling back to the save guard:', preCheckErr);
      }
    }

    setIsSaving(true);
    try {
      const profileFields = personaProfileFields();

      if (isEdit) {
        // Rename = profile name + entity alias via updateUserPersona; the
        // entity id is FROZEN (RN semantics — no RenameEntity call).
        await updateUserPersona(personaId!, {
          name: trimmedName,
          description: description.trim() || '',
          personality: personality.trim() || '',
          ...profileFields,
        });

        // Diff-based image reconcile (Phase 8 Step 4): compute create/update/
        // remove deltas from the editor state vs the persisted rows and apply
        // ONLY the deltas — ids of untouched images stay stable.
        try {
          const entity = await getEntity(personaId!);
          const profileId = entity?.character_profile_id;
          if (profileId) {
            const existingImages = await getCharacterImages(profileId);
            const hasAvatar = !!(avatarBase64 && avatarMimeType);
            const desiredImages: DesiredEditorImage[] = [];
            if (hasAvatar) {
              desiredImages.push({
                id: null,
                base64: avatarBase64!,
                mimeType: avatarMimeType!,
                description: '',
                isPrimary: true,
              });
            }
            galleryImages.forEach((galleryImg, index) => {
              desiredImages.push({
                id: null,
                base64: galleryImg.base64,
                mimeType: galleryImg.mimeType,
                description: galleryImg.description,
                isPrimary: !hasAvatar && index === 0,
              });
            });
            const deltas = computeImageDeltas(existingImages, desiredImages);
            for (const removeId of deltas.remove) {
              try {
                await deleteCharacterImage(removeId);
              } catch (delErr) {
                log.warn('Failed to delete stale persona image:', delErr);
              }
            }
            for (const update of deltas.update) {
              try {
                await updateCharacterImage({
                  id: update.id,
                  description: update.description,
                  display_order: update.displayOrder,
                  is_primary: update.isPrimary,
                });
              } catch (updErr) {
                log.warn('Failed to update persona image:', updErr);
              }
            }
            for (const create of deltas.create) {
              await createCharacterImage({
                character_profile_id: profileId,
                image_data: create.base64,
                mime_type: create.mimeType,
                description: create.description,
                is_primary: create.isPrimary,
                display_order: create.displayOrder,
                vl_model_interpretation: '',
                vl_model: '',
                updated_at: new Date(),
              });
            }
          }
        } catch (imgErr) {
          log.warn('Failed to reconcile persona images:', imgErr);
        }
      } else {
        // Create: the primary avatar rides createUserPersona (it creates the
        // user entity + profile + primary image); gallery rows land after so
        // they can reference the fresh profile id.
        const avatar: UserPersonaAvatar | null =
          avatarBase64 && avatarMimeType
            ? { image_data: avatarBase64, mime_type: avatarMimeType }
            : null;
        const persona = await createUserPersona({
          name: trimmedName,
          description: description.trim() || '',
          personality: personality.trim() || '',
          avatar,
          ...profileFields,
        });

        try {
          const entity = await getEntity(persona.id);
          const profileId = entity?.character_profile_id;
          if (profileId) {
            const hasAvatar = !!avatar;
            for (const [index, galleryImg] of galleryImages.entries()) {
              await createCharacterImage({
                character_profile_id: profileId,
                image_data: galleryImg.base64,
                mime_type: galleryImg.mimeType,
                description: galleryImg.description,
                is_primary: !hasAvatar && index === 0,
                display_order: hasAvatar ? index + 1 : index,
                vl_model_interpretation: '',
                vl_model: '',
                updated_at: new Date(),
              });
            }
          }
        } catch (galErr) {
          log.warn('Failed to persist persona gallery images:', galErr);
        }
      }

      // ── Push the backing entity to the engine (CRITICAL — 4-2/D34) so chat
      //    INIT_ENTITY succeeds when chatting as this persona. A failed push
      //    surfaces the failure alert instead of the success alert; the persona
      //    is saved locally either way and a retry re-runs the save. ──
      try {
        await syncService.syncAndWait({ timeoutMs: 45_000, critical: true });
      } catch (syncErr) {
        log.error('Auto-sync after persona save failed (critical):', syncErr);
        const syncCode = (syncErr as { code?: string })?.code;
        showAlert(
          t('common:error'),
          syncCode === 'sync_conflict' ? t('personaSaveSyncConflict') : t('personaSaveSyncFailed'),
        );
        return;
      }

      showAlert(t('personaSaved'), undefined, [{ text: t('common:ok') }]);
      navigation.goBack();
    } catch (err) {
      log.error('Failed to save persona:', err);
      // D33 belt-and-braces: the persona create seam mints via mintEntityId,
      // which throws the typed reserved-name error — the live inline error
      // above already covers it; never the generic alert.
      if (err instanceof ReservedEntityNameError) {
        return;
      }
      // D86: typed residual-race mapping (updateUserPersona's unique-index
      // catch) — the same friendly inline error as the pre-check, never raw
      // SQLite text and never the generic alert.
      if (err instanceof PersonaAliasConflictError) {
        setAliasConflictFlag(true);
        return;
      }
      // Alias-unique failures (rename or create) are user-presentable: another
      // live entity already owns that name. SQLite surfaces them as UNIQUE
      // violations on idx_entities_alias_unique. Everything else — persona
      // not found, storage, sync — keeps the generic message.
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('UNIQUE')) {
        showAlert(t('common:error'), t('personaAliasConflict'));
      } else {
        showAlert(t('common:error'), t('personaSaveFailed'));
      }
    } finally {
      setIsSaving(false);
    }
  };

  // ── Export (JSON / PNG ccv3) — lifts the CURRENT form state ──────────────
  const handleExport = async (kind: 'json' | 'png') => {
    if (!name.trim()) {
      showAlert(t('common:validation'), t('characters:validationName'));
      return;
    }
    try {
      const fields = editorStateToProfileFields(currentEditorState());
      const card = exportProfileToCardV3(
        {
          id: personaId ?? 'export',
          ...fields,
          vision_config_id: null,
        },
        editImages,
      );
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
        { dialogTitle: t('characters:exportCard') },
      );
    } catch (err) {
      log.error('Failed to export persona card:', err);
      showAlert(t('common:error'), t('characters:exportFailed'));
    }
  };

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
      // A1 / decision 8: the built-in `user` identity is load-bearing and
      // never deletable.
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
            showAlert(t('personaDeleted'), undefined, [{ text: t('common:ok') }]);
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

  // ── Styles derived from theme ────────────────────────────────────────────
  const accent = theme.colors.accent.primary;
  const surfaceColor = theme.colors.background.surface;
  const inputTextStyle = { color: theme.colors.text.primary };
  // Built-in `user`: rename locked (decision 8). Pre-seed: everything locked.
  const nameEditable = !isBuiltIn && !isPreSeed;
  const fieldsEditable = !isPreSeed && !isSaving;
  const saveDisabled = isSaving || isPreSeed;

  const renderField = (
    labelKey: string,
    placeholderKey: string,
    value: string,
    onChange: (v: string) => void,
    multiline = false,
    editable = fieldsEditable,
    autoCapitalize: 'words' | 'sentences' | 'none' = 'sentences',
    testID?: string,
  ) => (
    <View style={styles.fieldGroup}>
      <ThemedText size={13} variant="secondary" style={styles.fieldLabel}>
        {t(labelKey)}
      </ThemedText>
      <TextInput
        style={[
          styles.input,
          multiline && styles.multilineInput,
          inputTextStyle,
          { backgroundColor: hexToRgba(surfaceColor, 0.55), borderColor: theme.colors.border.default },
        ]}
        value={value}
        onChangeText={onChange}
        placeholder={t(placeholderKey)}
        placeholderTextColor={theme.colors.text.muted}
        multiline={multiline}
        numberOfLines={multiline ? 3 : 1}
        textAlignVertical={multiline ? 'top' : undefined}
        autoCorrect={false}
        autoCapitalize={autoCapitalize}
        editable={editable && !isSaving}
        testID={testID}
      />
    </View>
  );

  const renderCollapsibleCard = (
    title: string,
    open: boolean,
    setOpen: React.Dispatch<React.SetStateAction<boolean>>,
    children: React.ReactNode,
    testID?: string,
  ) => (
    <ThemedCard elevated accentStripe style={styles.section}>
      <TouchableOpacity
        onPress={() => setOpen(prev => !prev)}
        activeOpacity={0.7}
        testID={testID}
      >
        <SectionHeader
          title={title}
          right={
            <Icon
              name={open ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={theme.colors.text.muted}
            />
          }
        />
      </TouchableOpacity>
      {open && <View style={styles.sectionContent}>{children}</View>}
    </ThemedCard>
  );

  const charName = nickname.trim() || name.trim() || '{{char}}';

  return (
    <ThemedView style={styles.container}>
      {/* ── Header ── */}
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
          {/* ── Pre-seed empty state (decision 8) ── */}
          {isPreSeed ? (
            <ThemedCard style={styles.section}>
              <View style={styles.preSeedRow}>
                <Icon name="information-outline" size={18} color={theme.colors.accent.primary} />
                <ThemedText size={13} variant="secondary" style={styles.preSeedCopy}>
                  {t('personaPreSeedHint')}
                </ThemedText>
              </View>
            </ThemedCard>
          ) : null}

          {/* ══════════════════ GENERAL ══════════════════ */}
          <ThemedCard elevated accentStripe style={styles.section}>
            <SectionHeader title={t('createAI:sectionGeneral')} />

            {/* Avatar */}
            <View style={styles.avatarRow}>
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
                {!isEdit && avatarUri ? (
                  <ThemedButton
                    label={t('personaPictureRemove')}
                    onPress={handleRemoveAvatar}
                    variant="ghost"
                    icon="close"
                    style={styles.pictureBtn}
                  />
                ) : null}
              </View>
            </View>

            <View style={styles.sectionContent}>
              {/* Name (rename via profile + alias; id FROZEN) */}
              {renderField(
                'personaName',
                'personaNamePlaceholder',
                name,
                handleNameChange,
                false,
                nameEditable,
                'words',
                'persona-name-input',
              )}
              {/* D33/D86: reserved-name + alias-conflict inline errors */}
              {nameFieldError ? (
                <ThemedText
                  size={12}
                  style={{ color: theme.colors.status.error, marginLeft: 2, marginTop: -2 }}
                  testID="persona-name-error"
                >
                  {nameFieldError}
                </ThemedText>
              ) : null}
              {isBuiltIn ? (
                <ThemedText size={11} variant="muted" style={styles.fieldHint} testID="persona-builtin-lock-hint">
                  {t('personaLockedNameHint')}
                </ThemedText>
              ) : null}

              {/* Description */}
              {renderField('personaDescription', 'personaDescriptionPlaceholder', description, setDescription, true, fieldsEditable, 'sentences', 'persona-description-input')}

              {/* Personality */}
              {renderField('personaPersonality', 'personaPersonalityPlaceholder', personality, setPersonality, true, fieldsEditable, 'sentences', 'persona-personality-input')}
            </View>
          </ThemedCard>

          {/* ══════════════════ DETAILS ══════════════════ */}
          <ThemedCard elevated accentStripe style={styles.section}>
            <TouchableOpacity
              onPress={() => setShowDetails(prev => !prev)}
              activeOpacity={0.7}
              testID="persona-details-toggle"
            >
              <SectionHeader
                title={t('createAI:sectionDetails')}
                right={
                  <Icon
                    name={showDetails ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={theme.colors.text.muted}
                  />
                }
              />
            </TouchableOpacity>

            {showDetails && (
              <View style={styles.sectionContent}>
                <ThemedText size={12} variant="accent" weight="bold" style={styles.groupLabel}>
                  {t('createAI:voiceBehaviorLabel')}
                </ThemedText>
                {renderField('createAI:voiceLabel', 'createAI:voicePlaceholder', voiceCharacteristics, setVoiceCharacteristics, true)}

                {/* Typing speed + Audio chance (side-by-side numeric row) */}
                <View style={styles.numericRow}>
                  <View style={styles.numericField}>
                    <ThemedText size={13} variant="secondary" numberOfLines={1} style={styles.fieldLabel}>
                      {t('createAI:typingSpeedLabel')}
                    </ThemedText>
                    <TextInput
                      style={[styles.input, inputTextStyle, { backgroundColor: hexToRgba(surfaceColor, 0.55), borderColor: theme.colors.border.default }]}
                      value={typingSpeedWpm}
                      onChangeText={setTypingSpeedWpm}
                      placeholder="60"
                      placeholderTextColor={theme.colors.text.muted}
                      keyboardType="numeric"
                      returnKeyType="done"
                      editable={fieldsEditable}
                    />
                  </View>
                  <View style={styles.numericField}>
                    <ThemedText size={13} variant="secondary" numberOfLines={1} style={styles.fieldLabel}>
                      {t('createAI:audioChanceLabel')}
                    </ThemedText>
                    <TextInput
                      style={[styles.input, inputTextStyle, { backgroundColor: hexToRgba(surfaceColor, 0.55), borderColor: theme.colors.border.default }]}
                      value={audioResponseChance}
                      onChangeText={setAudioResponseChance}
                      placeholder="50"
                      placeholderTextColor={theme.colors.text.muted}
                      keyboardType="numeric"
                      returnKeyType="done"
                      editable={fieldsEditable}
                    />
                  </View>
                </View>

                <ThemedText size={12} variant="accent" weight="bold" style={styles.groupLabel}>
                  {t('createAI:promptsScenarioLabel')}
                </ThemedText>
                {renderField('createAI:basePromptLabel', 'createAI:basePromptPlaceholder', basePrompt, setBasePrompt, true)}
                {renderField('createAI:scenarioLabel', 'createAI:scenarioPlaceholder', scenario, setScenario, true)}
                {renderField('createAI:exampleDialoguesLabel', 'createAI:exampleDialoguesPlaceholder', exampleDialogues, setExampleDialogues, true)}

                {/* Post-history instructions (UJB) — edit mode, V3 column */}
                {isEdit && renderField('characters:postHistoryInstructions', 'characters:postHistoryHint', postHistoryInstructions, setPostHistoryInstructions, true, fieldsEditable, 'sentences', 'post-history-input')}

                {/* Nickname — edit mode, V3 identity surface */}
                {isEdit && renderField('characters:nickname', 'characters:nicknamePlaceholder', nickname, setNickname, false, fieldsEditable, 'sentences', 'nickname-input')}
              </View>
            )}
          </ThemedCard>

          {/* ══════════════════ personaMode V3 EDITOR SECTIONS ══════════════════
              Rendered from the allow-list above — lifecycle + advanced (module
              configs) are NOT in the list (decision 2). */}
          {PERSONA_EDITOR_SECTIONS.includes('greeting') && (
            renderCollapsibleCard(
              t('characters:greetingSection'),
              showGreeting,
              setShowGreeting,
              <>
                {/* greeting TEST disabled in personaMode (decision 13) */}
                <GreetingEditorSection
                  firstMes={firstMes}
                  onChangeFirstMes={setFirstMes}
                  charName={charName}
                  userName={impersonatedEntityName}
                  testState="idle"
                  testGreeting=""
                  onTestScenario={() => undefined}
                  onUseTestGreeting={() => undefined}
                  onDiscardTestGreeting={() => undefined}
                  testDisabled
                />
                <AlternateGreetingsSection
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
              'persona-greeting-section-toggle',
            )
          )}

          {PERSONA_EDITOR_SECTIONS.includes('lorebook') && (
            renderCollapsibleCard(
              t('characters:lorebookSection'),
              showLorebook,
              setShowLorebook,
              <LorebookSection
                characterBook={characterBook}
                onChange={setCharacterBook}
              />,
              'persona-lorebook-section-toggle',
            )
          )}

          {PERSONA_EDITOR_SECTIONS.includes('images') && (
            renderCollapsibleCard(
              t('createAI:imagesLabel'),
              showImages,
              setShowImages,
              isEdit ? (
                <>
                  <ProfileImagePicker
                    images={editImages}
                    primaryImageId={primaryImageId}
                    onAddImage={handleAddImage}
                    onSetPrimary={handleSetPrimary}
                    onDeleteImage={handleDeleteImage}
                  />
                  <ThemedText variant="muted" size={12} style={styles.imageHint}>
                    {editImages.length > 0
                      ? `${editImages.length} image${editImages.length !== 1 ? 's' : ''} · Tap to view · Hold for options`
                      : t('characters:saveFirstMessage')}
                  </ThemedText>
                </>
              ) : (
                <>
                  <View style={styles.galleryWrap}>
                    {galleryImages.map((img, index) => (
                      <View key={`${index}-${img.base64.length}`} style={styles.galleryTile}>
                        <Image
                          source={{ uri: `data:${img.mimeType};base64,${img.base64}` }}
                          style={styles.galleryTileImage}
                          resizeMode="cover"
                        />
                        <TouchableOpacity
                          onPress={() => handleRemoveGalleryImage(index)}
                          activeOpacity={0.7}
                          style={styles.galleryTileRemove}
                          testID="persona-remove-gallery-image"
                          accessibilityRole="button"
                          accessibilityLabel={t('createAI:removeImage')}
                        >
                          <Icon name="close" size={14} color="#fff" />
                        </TouchableOpacity>
                      </View>
                    ))}
                    <TouchableOpacity
                      onPress={handleAddGalleryImage}
                      activeOpacity={0.7}
                      style={styles.galleryAddTile}
                      testID="persona-add-gallery-image"
                      accessibilityRole="button"
                      accessibilityLabel={t('createAI:addImage')}
                    >
                      <Icon name="plus" size={26} color={accent} />
                      <ThemedText size={11} variant="muted">
                        {t('createAI:addImage')}
                      </ThemedText>
                    </TouchableOpacity>
                  </View>
                  <ThemedText size={11} variant="muted" style={styles.galleryHint}>
                    {t('createAI:imagesHint')}
                  </ThemedText>
                </>
              ),
              'persona-images-section-toggle',
            )
          )}

          {PERSONA_EDITOR_SECTIONS.includes('tags') && (
            renderCollapsibleCard(
              t('characters:tags'),
              showTags,
              setShowTags,
              <TagsSection
                tags={tags}
                onChange={setTags}
                suggestions={libraryTags}
              />,
              'persona-tags-section-toggle',
            )
          )}

          {PERSONA_EDITOR_SECTIONS.includes('attribution') && (
            renderCollapsibleCard(
              t('characters:attributionSection'),
              showAttribution,
              setShowAttribution,
              <AttributionSection
                creator={creatorName}
                onChangeCreator={setCreatorName}
                creatorNotes={creatorNotes}
                onChangeCreatorNotes={setCreatorNotes}
                characterVersion={characterVersion}
                onChangeCharacterVersion={setCharacterVersion}
                cardProvenance={cardProvenance}
              />,
              'persona-attribution-section-toggle',
            )
          )}

          {/* Export — edit mode only (parity with CreateAIScreen; a fresh
              create has nothing meaningful to serialize yet). */}
          {isEdit && PERSONA_EDITOR_SECTIONS.includes('export') && (
            <ThemedCard elevated accentStripe style={styles.section}>
              <SectionHeader title={t('characters:exportCard')} />
              <View style={styles.sectionContent}>
                <ExportSection
                  onExport={handleExport}
                  disabled={!name.trim()}
                />
              </View>
            </ThemedCard>
          )}

          {/* ── Voice input (shared across all personas) — read-only info row.
                 Explicitly NOT per-persona editing (persona-modules 2-1). ── */}
          <ThemedCard style={styles.section}>
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
            disabled={saveDisabled}
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
  section: {
    marginBottom: 16,
  },
  sectionContent: {
    paddingTop: 4,
    gap: 12,
  },
  groupLabel: {
    marginTop: 4,
    letterSpacing: 0.4,
  },
  // ── Avatar ──
  avatarRow: {
    alignItems: 'center',
    gap: 14,
    paddingBottom: 8,
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
  // ── Fields ──
  fieldGroup: {
    gap: 6,
  },
  fieldLabel: {
    marginBottom: 0,
  },
  fieldHint: {
    marginTop: -4,
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
  },
  numericRow: {
    flexDirection: 'row',
    gap: 10,
  },
  numericField: {
    flex: 1,
    gap: 6,
  },
  // ── Gallery (create mode) ──
  galleryWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  galleryTile: {
    width: 92,
    height: 92,
    borderRadius: 8,
    overflow: 'hidden',
  },
  galleryTileImage: {
    width: '100%',
    height: '100%',
  },
  galleryTileRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 10,
    padding: 3,
  },
  galleryAddTile: {
    width: 92,
    height: 92,
    borderRadius: 8,
    borderWidth: 2,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 2,
  },
  galleryHint: {
    marginTop: 2,
  },
  imageHint: {
    marginTop: 4,
  },
  // ── Pre-seed state ──
  preSeedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
  },
  preSeedCopy: {
    flex: 1,
  },
  // ── Voice input row ──
  voiceInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
  },
  voiceInputCopy: {
    flex: 1,
  },
  saveButton: {
    marginTop: 4,
  },
  deleteHint: {
    marginTop: 8,
    textAlign: 'center',
  },
});

export default PersonaEditScreen;