/**
 * CreateAIScreen
 *
 * Create AI Partner wizard. Creates a CharacterProfile + Entity (with alias)
 * + EntityModuleMapping in one flow, then saves and returns to the previous
 * screen (Characters list).
 *
 * The screen is split into three sections:
 *   1. General  — name (required), description, avatar
 *   2. Details  — personality, voice/behavior, prompts & scenario
 *   3. Advanced — module configs (AI model / config / voice settings)
 *
 * The user can create a partner with just a name: module slots left unset stay
 * unset (saved as NULL in the entity module mapping). Engine-seeded default
 * configs ("Default SoulbitsCloud") arrive via normal sync — the engine is the
 * single source for default configuration.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  TextInput,
  ActivityIndicator,
  TouchableOpacity,
  Image,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  Share,
  ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemedCard } from '../components/themed/ThemedCard';
import { ScreenHeader } from '../components/themed/ScreenHeader';
import { SectionHeader } from '../components/themed/SectionHeader';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { launchImageLibrary } from 'react-native-image-picker';
import { v4 as uuidv4 } from 'uuid';
import { useTranslation } from 'react-i18next';
import RNFS from 'react-native-fs';
import { createLogger } from '../utils/logger';

const log = createLogger('[CreateAIScreen]');

/**
 * Reserved-name guard (D33): `user` and `deleted` are system-reserved names —
 * an AI partner must never be created from one. Trim + case-insensitive; the
 * same predicate the `mintEntityId` seam enforces (the typed
 * `ReservedEntityNameError` catch in `createPartner` is the backstop).
 */
function isReservedPartnerName(raw: string): boolean {
  const lower = raw.trim().toLowerCase();
  return lower === 'user' || lower === 'deleted';
}

// ─────────────────────────────────────────────────────────────────────────────
// Character-card section summary helpers (4-2)
//
// Pure, exported for unit testing (CONVENTIONS: pure helpers live beside the
// screen and are exercised directly). The accordion rows render these strings
// in their right-aligned summary pills so the user can see what is populated
// without expanding every section.
// ─────────────────────────────────────────────────────────────────────────────

/** Number of entries in a `character_book` JSON column (defensive parse). */
export function countLorebookEntries(characterBookJson: string | null): number {
  const book = parseLorebook(characterBookJson);
  return Array.isArray(book?.entries) ? book!.entries.length : 0;
}

export interface CardSectionBadgeState {
  personality: string;
  voiceCharacteristics: string;
  basePrompt: string;
  scenario: string;
  exampleDialogues: string;
  postHistoryInstructions: string;
  firstMes: string;
  alternateGreetings: string[];
  characterBook: string | null;
  imageCount: number;
  tags: string[];
  lifecycleConfig: LifecycleConfig;
  creatorName: string;
}

export interface CardSectionBadges {
  /** Persona & Prompts row: `Configured` / `Default`. */
  persona: string;
  /** Greetings row: `1 opening · 2 alt`. */
  greetings: string;
  /** Lorebook row: `3 entries`. */
  lorebook: string;
  /** Combined Gallery & Tags summary: `2 img · 4 tags`. */
  galleryTags: string;
  /** Combined Lifecycle & Attribution summary: `Custom` / `Default`. */
  lifecycleAttribution: string;
  /** Granular per-row variants used by the consolidated accordion. */
  images: string;
  tagsRow: string;
  lifecycle: string;
  attribution: string;
}

const CONFIGURED = 'Configured';
const DEFAULT_VALUE = 'Default';
const CUSTOM = 'Custom';

const hasText = (value: string | null | undefined): boolean =>
  typeof value === 'string' && value.trim() !== '';

const hasLifecycleValues = (config: LifecycleConfig): boolean =>
  Object.values(config ?? {}).some(value => {
    if (value === null || value === undefined || value === '') return false;
    if (typeof value === 'object') return Object.keys(value as object).length > 0;
    return true;
  });

/**
 * Build the live summary pills for every character-card accordion row.
 * Pure — no i18n, no state, no theme.
 */
export function buildCardSectionBadges(
  state: CardSectionBadgeState,
): CardSectionBadges {
  const personaConfigured =
    hasText(state.personality) ||
    hasText(state.voiceCharacteristics) ||
    hasText(state.basePrompt) ||
    hasText(state.scenario) ||
    hasText(state.exampleDialogues) ||
    hasText(state.postHistoryInstructions);

  const openingCount = hasText(state.firstMes) ? 1 : 0;
  const altCount = state.alternateGreetings?.length ?? 0;
  const lorebookCount = countLorebookEntries(state.characterBook);
  const imageCount = state.imageCount ?? 0;
  const tagCount = state.tags?.length ?? 0;

  const lifecycleCustom = hasLifecycleValues(state.lifecycleConfig);
  const attributionCustom = hasText(state.creatorName);

  return {
    persona: personaConfigured ? CONFIGURED : DEFAULT_VALUE,
    greetings: `${openingCount} opening${
      altCount > 0 ? ` · ${altCount} alt` : ''
    }`,
    lorebook: `${lorebookCount} ${lorebookCount === 1 ? 'entry' : 'entries'}`,
    galleryTags: `${imageCount} ${
      imageCount === 1 ? 'image' : 'images'
    } · ${tagCount} ${tagCount === 1 ? 'tag' : 'tags'}`,
    lifecycleAttribution:
      lifecycleCustom || attributionCustom ? CUSTOM : DEFAULT_VALUE,
    images: `${imageCount} img`,
    tagsRow: `${tagCount} tags`,
    lifecycle: lifecycleCustom ? CUSTOM : DEFAULT_VALUE,
    attribution: attributionCustom ? CUSTOM : DEFAULT_VALUE,
  };
}

import { RootStackParamList } from '../navigation/AppNavigator';
import { useAppTheme } from '../contexts/ThemeContext';
import { useAppAlert } from '../contexts/AppAlertContext';
import { useAuth } from '../contexts/AuthContext';
import { useBiometricLock } from '../contexts/BiometricLockContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedText } from '../components/themed/ThemedText';
import { ThemedButton } from '../components/themed/ThemedButton';
import { ThemedGradient } from '../components/themed/ThemedGradient';
import { EntityModuleSelectorWithActions } from '../components/entities/EntityModuleSelectorWithActions';
import { formatModuleConfigSubtitle } from '../components/entities/EntityModuleSelector';
import { filterModuleConfigsForVariant } from '../services/variant/providerAvailability';
import { invalidateEntityAccessCache } from '../services/variant/entityAccess';
import { hexToRgba } from '../utils/colorUtils';
import { hapticLightPress } from '../utils/haptics';
import { ModuleConfigOption } from '../components/entities/EntityModuleSelector';
import type { CharacterImage } from '../database/models';
import { ProfileImagePicker } from '../components/characters/ProfileImagePicker';
import { MacroHighlighter } from '../components/character-card/MacroHighlighter';
import { parseJsonColumn, parseLorebook } from '../components/character-card/lorebook';
import type { LifecycleConfig } from '../components/character-card/LifecycleConfigEditor';
import {
  AlternateGreetingsSection,
  AttributionSection,
  ExportSection,
  GreetingEditorSection,
  LifecycleSection,
  LorebookSection,
  TagsSection,
  computeImageDeltas,
  editorStateToProfileFields,
  profileToEditorState,
  validateLifecycleConfig,
} from '../components/character-card/editor-sections';
import type {
  DesiredEditorImage,
  EditorState,
} from '../components/character-card/editor-sections';
import { exportProfileToCardV3, exportToJSON, exportToPNG } from '../utils/charactercard/exporter';
import { utf8Encode } from '../utils/charactercard/pngWriter';
import { uint8ArrayToBase64 } from '../database/base64';

import {
  createCharacterProfile,
  createCharacterImage,
  deleteCharacterImage,
  deleteCharacterProfileCascade,
  getCharacterProfile,
  getCharacterImages,
  getAllCharacterProfiles,
  updateCharacterImage,
  updateCharacterProfile,
} from '../database/repositories';
import { setCharacterCreator } from '../services/social/SocialService';
import {
  createEntity,
  createEntityModuleMapping,
  createOrUpdateEntityModuleMapping,
  getAllEntities,
  getEntityByCharacterProfileId,
  getEntityModuleMapping,
  isProfilePersonaOwned,
  ReservedEntityNameError,
  updateEntityFields,
} from '../database/repositories';
import { getUserPersona } from '../database/repositories';
import { getActiveInteractionsByEntity } from '../database/repositories';
import { createDataURL } from '../database/base64';
import {
  getAllCognitionConfigs,
  getAllTTSConfigs,
  getAllSTTConfigs,
  getAllVisionConfigs,
  getAllRAGConfigs,
  getAllImaginationConfigs,
  getAllMovementConfigs,
  getAllBackendConfigs,
} from '../database/repositories';
import ChatPreferencesService from '../services/ChatPreferencesService';
import EntitySessionService from '../services/EntitySessionService';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type Props = NativeStackScreenProps<RootStackParamList, 'CreateAI'>;

// ─────────────────────────────────────────────────────────────────────────────
// CreateAIScreen
// ─────────────────────────────────────────────────────────────────────────────

export const CreateAIScreen: React.FC<Props> = ({ route, navigation }) => {
  const { theme } = useAppTheme();
  const { showAlert } = useAppAlert();
  const { withExternalFlow } = useBiometricLock();
  const { user } = useAuth();
  const { bottom: safeBottom } = useSafeAreaInsets();
  // 'characters' namespace supplies the V3/RP editor labels + validation strings
  // (createAI has none of them). `nsMode: 'fallback'` makes an unprefixed miss
  // in `createAI` fall through to `characters` — without it i18next stops at the
  // first namespace and raw keys (GREETINGSECTION, nicknamePlaceholder) render.
  // V3-only keys are also prefixed explicitly as belt-and-suspenders so they
  // resolve deterministically in production AND in Jest mocks.
  const { t } = useTranslation(['createAI', 'characters'], {
    nsMode: 'fallback',
  });

  // ── Core fields ──────────────────────────────────────────────────────────────
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [personality, setPersonality] = useState('');
  const [voiceCharacteristics, setVoiceCharacteristics] = useState('');
  const [typingSpeedWpm, setTypingSpeedWpm] = useState('60');
  const [audioResponseChance, setAudioResponseChance] = useState('50');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [avatarBase64, setAvatarBase64] = useState<string | null>(null);
  const [avatarMimeType, setAvatarMimeType] = useState<string>('image/jpeg');

  // Visibility / sharing:
  // The client-only visibility sidecar was REMOVED with the stub layer (A3 —
  // source/visibility persistence is gone). Discover is stub-fixture driven, so
  // a local private/public toggle would be dead UI; the 'marketplace'
  // visibility + SOUL price option was already removed in Phase 2 (A4
  // upload-copy ruling): publishing is upload-copy via the Market's Publish
  // wizard — the local character never carries a marketplace visibility state
  // or listing row.

  // ── Prompts & Scenario (AI settings) ────────────────────────────────────────
  const [basePrompt, setBasePrompt] = useState('');
  const [scenario, setScenario] = useState('');
  const [exampleDialogues, setExampleDialogues] = useState('');

  // ── Gallery images (persisted after profile creation) ───────────────────────
  const [galleryImages, setGalleryImages] = useState<
    Array<{ base64: string; mimeType: string; description: string }>
  >([]);

  // ── Collapsible section toggles ─────────────────────────────────────────────
  const [showDetails, setShowDetails] = useState(false);
  // Module wiring is a first-class card in the Edit AI Partner design, so it
  // starts expanded (the old "Advanced" disclosure hid it by default).
  const [showAdvanced, setShowAdvanced] = useState(true);
  // UI-only: tracks the currently focused field for accent highlighting
  const [focusedField, setFocusedField] = useState<
    | 'name'
    | 'nickname'
    | 'description'
    | 'personality'
    | 'basePrompt'
    | 'scenario'
    | 'exampleDialogues'
    | 'voice'
    | 'typing'
    | 'audio'
    | null
  >(null);

  // ── Module config selections (string IDs for picker; '' = disabled) ──────────
  const [cognitionConfigId, setCognitionConfigId] = useState('');
  const [ttsConfigId, setTtsConfigId] = useState('');
  const [sttConfigId, setSttConfigId] = useState('');
  const [visionConfigId, setVisionConfigId] = useState('');
  const [ragConfigId, setRagConfigId] = useState('');
  const [imaginationConfigId, setImaginationConfigId] = useState('');
  const [movementConfigId, setMovementConfigId] = useState('');
  const [backendConfigId, setBackendConfigId] = useState('');

  // ── Available module config lists (loaded on mount) ──────────────────────────
  const [cognitionConfigs, setCognitionConfigs] = useState<ModuleConfigOption[]>([]);
  const [ttsConfigs, setTtsConfigs] = useState<ModuleConfigOption[]>([]);
  const [sttConfigs, setSttConfigs] = useState<ModuleConfigOption[]>([]);
  const [visionConfigs, setVisionConfigs] = useState<ModuleConfigOption[]>([]);
  const [ragConfigs, setRagConfigs] = useState<ModuleConfigOption[]>([]);
  const [imaginationConfigs, setImaginationConfigs] = useState<ModuleConfigOption[]>([]);
  const [movementConfigs, setMovementConfigs] = useState<ModuleConfigOption[]>([]);
  const [backendConfigs, setBackendConfigs] = useState<ModuleConfigOption[]>([]);
  // null = loading, false = loaded but empty, true = has at least one
  const [hasAnyConfigs, setHasAnyConfigs] = useState<boolean | null>(null);

  // ── UI state ─────────────────────────────────────────────────────────────────
  const [isSaving, setIsSaving] = useState(false);
  // D33: set when a save attempt is rejected for a reserved name (the typed
  // `ReservedEntityNameError` backstop in `createPartner`); cleared on the
  // next name edit. The live inline error below covers the common case.
  const [reservedNameBlocked, setReservedNameBlocked] = useState(false);

  // ── V3/RP editor state (edit mode only; `{...current}` spread preserves
  //    unknown columns on save, so absent columns are never wiped) ────────────
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
  const [lifecycleConfig, setLifecycleConfig] = useState<LifecycleConfig>({});
  const [libraryTags, setLibraryTags] = useState<string[]>([]);

  // ── Roleplay entity resolution ({{user}}) for greeting preview / test ───────
  const [impersonatedEntityId, setImpersonatedEntityId] = useState('user');
  const [impersonatedEntityName, setImpersonatedEntityName] = useState('{{user}}');

  // ── Edit-mode image rows (real ids) for the image picker + reconcile ────────
  const [editImages, setEditImages] = useState<CharacterImage[]>([]);
  const [primaryImageId, setPrimaryImageId] = useState<string | null>(null);

  // ── Edit-mode UI state ──────────────────────────────────────────────────────
  const [refreshing, setRefreshing] = useState(false);
  const [testState, setTestState] = useState<'idle' | 'generating' | 'ready'>('idle');
  const [testGreeting, setTestGreeting] = useState('');
  const [showGreeting, setShowGreeting] = useState(false);
  const [showLorebook, setShowLorebook] = useState(false);
  const [showImages, setShowImages] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const [showLifecycle, setShowLifecycle] = useState(false);
  const [showAttribution, setShowAttribution] = useState(false);

  // ── Edit mode — editProfileId edits an existing AI partner ──────────────────
  // The single edit surface: profile (name/bio/prompts/images) + entity module
  // mapping (AI model / voice / config) all edited right here.
  const editProfileId = route.params?.editProfileId ?? null;
  const [editLoaded, setEditLoaded] = useState(false);
  const [editEntityId, setEditEntityId] = useState<string | null>(null);
  const [editOriginalName, setEditOriginalName] = useState('');
  // Batch D.2 (engine-FE parity nicety): the loaded edit card is owned by a
  // user persona. Local write-guards make this state near-impossible to
  // create on-device — it can only appear from data synced before the guards
  // existed — so it only earns a muted hint, not a lock.
  const [editPersonaOwned, setEditPersonaOwned] = useState(false);

  // ── D33: reserved-name inline error on the partner-name field ────────────────
  // Live in CREATE mode only (the name→id mint seam lives there; edit mode
  // renames the alias, no id is derived), so the field flags `user`/`deleted`
  // as soon as they are typed; submit is additionally blocked in
  // `createPartner`.
  const reservedNameError =
    !editProfileId && (reservedNameBlocked || isReservedPartnerName(name))
      ? t('nameReserved')
      : null;

  const handleNameChange = (v: string) => {
    setName(v);
    if (reservedNameBlocked) setReservedNameBlocked(false);
  };

  // ── "From an existing one" — prefillProfileId links an existing profile ──────
  // LIVE LINK (engine parity): the new AI entity references the SAME character
  // profile — the card is shared, never forked. The screen prefills the
  // editable fields from the shared card as a starting preview.
  const prefillProfileId = route.params?.prefillProfileId ?? null;
  const [prefilled, setPrefilled] = useState(false);
  // Copied entity module mapping (link + edit modes): the source entity's
  // 8 config slots, held separately from the module-config selection below so
  // the pickers work once the configs load.
  const [prefillModuleIds, setPrefillModuleIds] = useState<{
    backend: string | null;
    cognition: string | null;
    tts: string | null;
    stt: string | null;
    vision: string | null;
    rag: string | null;
    imagination: string | null;
    movement: string | null;
  } | null>(null);

  /**
   * Load all module configs up front so the Advanced section pickers are
   * populated when the user expands them.
   */
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
      // Variant-aware picker options (plan 7-14 V3): a store build only offers
      // configs wired exclusively to the available provider (soulbitscloud), so
      // the entity editor can never wire a locked provider. Full = unchanged.
      // The subtitle carries the provider + model summary (4-3) so users can
      // tell "Soulbits" / "Test" / "Default SoulbitsCloud" apart in the picker.
      const toOptions = (
        moduleType: string,
        configs: Array<{ id: string; name: string }>,
      ): ModuleConfigOption[] =>
        filterModuleConfigsForVariant(
          moduleType,
          configs as unknown as Array<Record<string, unknown>>,
        ).map(c => ({
          id: String(c.id),
          name: c.name as string,
          subtitle: formatModuleConfigSubtitle(c as Record<string, any>),
        }));
      const cognitionOptions = toOptions('cognition', cognition);
      const ttsOptions = toOptions('tts', tts);
      const sttOptions = toOptions('stt', stt);
      const visionOptions = toOptions('vision', vision);
      const ragOptions = toOptions('rag', rag);
      const imaginationOptions = toOptions('imagination', imagination);
      const movementOptions = toOptions('movement', movement);
      const backendOptions = toOptions('backend', backend);
      setCognitionConfigs(cognitionOptions);
      setTtsConfigs(ttsOptions);
      setSttConfigs(sttOptions);
      setVisionConfigs(visionOptions);
      setRagConfigs(ragOptions);
      setImaginationConfigs(imaginationOptions);
      setMovementConfigs(movementOptions);
      setBackendConfigs(backendOptions);
      setHasAnyConfigs(
        cognitionOptions.length > 0 ||
          ttsOptions.length > 0 ||
          sttOptions.length > 0 ||
          visionOptions.length > 0 ||
          ragOptions.length > 0 ||
          imaginationOptions.length > 0 ||
          movementOptions.length > 0 ||
          backendOptions.length > 0,
      );
    } catch (err) {
      log.error('Failed to load module configs:', err);
      setHasAnyConfigs(false);
    }
  }, []);

  useEffect(() => {
    loadModuleConfigs();
  }, [loadModuleConfigs]);

  // ── Prefill from an existing profile (route param prefillProfileId) ─────────
  useEffect(() => {
    if (!prefillProfileId || prefilled) return;
    let cancelled = false;

    (async () => {
      try {
        const profile = await getCharacterProfile(prefillProfileId);
        if (!profile || cancelled) return;
        setName(profile.name);
        setDescription(profile.description ?? '');
        setPersonality(profile.personality ?? '');
        setVoiceCharacteristics(profile.voice_characteristics ?? '');
        setTypingSpeedWpm(String(profile.typing_speed_wpm ?? 60));
        setAudioResponseChance(String(profile.audio_response_chance_percent ?? 50));
        setBasePrompt(profile.base_prompt ?? '');
        setScenario(profile.scenario ?? '');
        setExampleDialogues(profile.mes_example ?? '');
      } catch (err) {
        log.error('Failed to prefill profile:', err);
      } finally {
        if (!cancelled) setPrefilled(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [prefillProfileId, prefilled]);

  // ── Apply copied module configs (from the source partner) ────────────────────
  // Once both the copied mapping is available AND the module-config lists have
  // loaded, pre-select the copied configs so the Advanced pickers reflect the
  // source partner's exact settings (editable afterwards).
  const prefillAppliedRef = useRef(false);
  useEffect(() => {
    if (!prefillModuleIds || hasAnyConfigs === null || prefillAppliedRef.current) {
      return;
    }
    prefillAppliedRef.current = true;
    setBackendConfigId(prefillModuleIds.backend ?? '');
    setCognitionConfigId(prefillModuleIds.cognition ?? '');
    setTtsConfigId(prefillModuleIds.tts ?? '');
    setSttConfigId(prefillModuleIds.stt ?? '');
    setVisionConfigId(prefillModuleIds.vision ?? '');
    setRagConfigId(prefillModuleIds.rag ?? '');
    setImaginationConfigId(prefillModuleIds.imagination ?? '');
    setMovementConfigId(prefillModuleIds.movement ?? '');
  }, [prefillModuleIds, hasAnyConfigs]);

  // ── Edit mode load (route param editProfileId) ───────────────────────────────
  // Loads the existing AI partner (profile + entity + module mapping + avatar +
  // gallery images) so the whole create wizard becomes the single edit surface.
  // Extracted so pull-to-refresh can re-run the same load.
  const loadEditProfile = useCallback(async () => {
    if (!editProfileId) return;
    try {
      const profile = await getCharacterProfile(editProfileId);
      if (!profile) return;

      setEditPersonaOwned(false);
      try {
        setEditPersonaOwned(await isProfilePersonaOwned(profile.id));
      } catch (ownErr) {
        log.warn('Failed to check persona ownership:', ownErr);
      }

      setName(profile.name);
      setDescription(profile.description ?? '');
      setPersonality(profile.personality ?? '');
      setVoiceCharacteristics(profile.voice_characteristics ?? '');
      setTypingSpeedWpm(String(profile.typing_speed_wpm ?? 60));
      setAudioResponseChance(String(profile.audio_response_chance_percent ?? 50));
      setBasePrompt(profile.base_prompt ?? '');
      setScenario(profile.scenario ?? '');
      setExampleDialogues(profile.mes_example ?? '');
      setEditOriginalName(profile.name);

      // V3/RP fields via the shared editor-state mapping (single source of
      // truth — same mapping the round-trip test pins down).
      const editorState = profileToEditorState(profile);
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

      // Images: full rows (real ids) for the picker + reconcile; the primary
      // also feeds the avatar UI and the rest the gallery tiles.
      try {
        const images = await getCharacterImages(profile.id);
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
        log.warn('Failed to load edit images:', imgErr);
      }

      // Entity + module mapping
      try {
        const entity = await getEntityByCharacterProfileId(profile.id);
        if (entity) {
          setEditEntityId(entity.id);
          const mapping = await getEntityModuleMapping(entity.id);
          if (mapping) {
            setPrefillModuleIds({
              backend: mapping.backend_config_id ?? null,
              cognition: mapping.cognition_config_id ?? null,
              tts: mapping.tts_config_id ?? null,
              stt: mapping.stt_config_id ?? null,
              vision: mapping.vision_config_id ?? null,
              rag: mapping.rag_config_id ?? null,
              imagination: mapping.imagination_config_id ?? null,
              movement: mapping.movement_config_id ?? null,
            });
          }
        }
      } catch (entErr) {
        log.warn('Failed to load edit entity:', entErr);
      }
    } catch (err) {
      log.error('Failed to load profile for edit:', err);
    }
  }, [editProfileId]);

  useEffect(() => {
    if (!editProfileId || editLoaded) return;
    let cancelled = false;
    (async () => {
      await loadEditProfile();
      if (!cancelled) setEditLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [editProfileId, editLoaded, loadEditProfile]);

  // Reset the load latch when the edit target changes (stack reuse — same
  // pattern as the duplicate-flow latch reset below).
  useEffect(() => {
    if (!editProfileId) return;
    setEditLoaded(false);
  }, [editProfileId]);

  // ── Edit-mode helpers: roleplay entity ({{user}}) + library tags ────────────
  // Only needed by the greeting preview / test-scenario / tag suggestions, which
  // render exclusively in edit mode.
  useEffect(() => {
    if (!editProfileId) return;
    (async () => {
      try {
        const allEntities = await getAllEntities();
        const stored = await ChatPreferencesService.getGlobalImpersonatedEntity();
        // $9-A3/A7: only `entity_type='user'` entities are valid impersonation
        // identities — AI characters are partners, never the persona.
        const id =
          stored && allEntities.some(e => e.id === stored && e.entity_type === 'user')
            ? stored
            : (allEntities.find(e => e.id === 'user' && e.entity_type === 'user')?.id ??
              allEntities.find(e => e.entity_type === 'user')?.id ??
              'user');
        // Resolve the {{user}} macro to the user entity's PROFILE name (the
        // engine-seeded "You" profile now syncs down); fall back to the raw id.
        const persona = await getUserPersona(id);
        setImpersonatedEntityId(id);
        setImpersonatedEntityName(persona?.name ?? id);
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
  }, [editProfileId]);

  /** Pull-to-refresh: reload the profile (edit mode only). */
  const onRefresh = useCallback(async () => {
    if (!editProfileId) return;
    setRefreshing(true);
    try {
      await loadEditProfile();
    } finally {
      setRefreshing(false);
    }
  }, [editProfileId, loadEditProfile]);

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
        const base64 = asset.base64 ?? null;
        const mimeType = asset.type ?? 'image/jpeg';

        // Edit mode: changing the avatar demotes the current primary row into
        // the gallery (it stays a non-primary image — the save-time reconcile
        // persists the is_primary/order flags; the old row's id stays stable).
        if (editProfileId && base64) {
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
      log.error('Failed to pick avatar:', err);
    }
  };

// ── Gallery image picker (adds to the Images tab) ───────────────────────────
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

  // ── V3/RP editor state builder (single mapping for save + export) ────────────
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

  // ── Alternate greeting operations ────────────────────────────────────────────
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

  // ── [Test scenario generation] (edit mode — needs a saved profile + entity) ──
  const handleTestScenario = useCallback(async () => {
    if (testState === 'generating') return;
    if (!editProfileId) {
      showAlert(t('characters:saveFirst'), t('characters:testScenarioNeedsSavedProfile'));
      return;
    }
    try {
      const entity = await getEntityByCharacterProfileId(editProfileId);
      if (!entity) {
        showAlert(t('common:error'), t('characters:testScenarioNoEntity'));
        return;
      }
      const interactions = await getActiveInteractionsByEntity(entity.id);
      const interactionId = interactions[0]?.id;
      if (!interactionId) {
        showAlert(t('common:error'), t('characters:testScenarioUnavailable'));
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
      showAlert(t('common:error'), t('characters:testScenarioUnavailable'));
      setTestState('idle');
    }
  }, [editProfileId, testState, impersonatedEntityId, showAlert, t]);

  const handleUseTestGreeting = () => {
    setFirstMes(testGreeting);
    setTestGreeting('');
    setTestState('idle');
  };

  const handleDiscardTestGreeting = () => {
    setTestGreeting('');
    setTestState('idle');
  };

  // ── Export (JSON / PNG ccv3) — lifts the CURRENT form state ──────────────────
  const handleExport = async (kind: 'json' | 'png') => {
    if (!name.trim()) {
      showAlert('Validation', t('characters:validationName'));
      return;
    }
    try {
      const fields = editorStateToProfileFields(currentEditorState());
      const card = exportProfileToCardV3(
        {
          id: editProfileId ?? 'export',
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
      log.error('Failed to export card:', err);
      showAlert(t('common:error'), t('characters:exportFailed'));
    }
  };

  const sanitizeExportFilename = (raw: string): string => {
    const cleaned = raw
      .trim()
      .replace(/[^a-zA-Z0-9 _-]/g, '_')
      .replace(/\s+/g, ' ')
      .replace(/_+/g, '_');
    return cleaned || 'character';
  };

  // ── Edit-mode image operations (local-only; the save path reconciles) ───────
  // Deferred writes: the picker mutates local state and the diff-based
  // reconcile on save computes the create/update/remove deltas, so untouched
  // image rows keep their ids (Phase 8 Step 4 — no more hard-delete+recreate).
  const handleAddImage = async () => {
    if (!editProfileId) {
      showAlert(t('characters:saveFirst'), t('characters:saveFirstMessage'));
      return;
    }
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
      const row: CharacterImage = {
        id: tempId,
        character_profile_id: editProfileId,
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

  // ── Save ─────────────────────────────────────────────────────────────────────
  /**
   * Persist the character profile + entity + module mapping, then go back to
   * the screen we came from (Characters list). Chat is started from the
   * Characters list after the partner has been saved.
   */
  const createPartner = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      showAlert(t('nameRequired'), t('nameRequiredMessage'));
      return;
    }

    // D33: reserved names (`user` / `deleted`) never reach the mint seam —
    // block the submit; the inline field error is already visible.
    if (!editProfileId && isReservedPartnerName(trimmedName)) {
      setReservedNameBlocked(true);
      return;
    }

    setIsSaving(true);
    try {
      // ── EDIT MODE: update the existing AI partner in place ─────────────
      if (editProfileId) {
        // Validation alerts instead of silent clamping (Phase 8 Step 2).
        const typingWpm = parseInt(typingSpeedWpm, 10);
        if (isNaN(typingWpm) || typingWpm < 1 || typingWpm > 200) {
          showAlert('Validation', t('characters:validationTypingSpeed'));
          setIsSaving(false);
          return;
        }
        const audioChance = parseInt(audioResponseChance, 10);
        if (isNaN(audioChance) || audioChance < 0 || audioChance > 100) {
          showAlert('Validation', t('characters:validationAudioChance'));
          setIsSaving(false);
          return;
        }
        if (!validateLifecycleConfig(lifecycleConfig)) {
          showAlert('Validation', t('characters:lifecycleInvalidNumber'));
          setIsSaving(false);
          return;
        }

        const current = await getCharacterProfile(editProfileId);
        if (!current) throw new Error('Profile not found');

        // V3 columns flow through the existing save path — `{...current}` keeps
        // every column the editors don't touch; the shared mapping encodes the
        // V3/RP columns explicitly (mapper JSON conventions, §A12).
        const fields = editorStateToProfileFields(currentEditorState());
        await updateCharacterProfile({
          ...current,
          ...fields,
        });

        // Diff-based image reconcile (Phase 8 Step 4): compute create/update/
        // remove deltas from the editor state vs the persisted rows and apply
        // ONLY the deltas — ids of untouched images stay stable (the old path
        // hard-deleted + recreated every row, churning engine-synced ids).
        try {
          const existingImages = await getCharacterImages(editProfileId);
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
              log.warn('Failed to delete stale edit image:', delErr);
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
              log.warn('Failed to update edit image:', updErr);
            }
          }
          for (const create of deltas.create) {
            await createCharacterImage({
              character_profile_id: editProfileId,
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
        } catch (imgErr) {
          log.warn('Failed to reconcile edit images:', imgErr);
        }

        // Update the entity (alias rename if the name changed) + module mapping
        if (editEntityId) {
          if (trimmedName !== editOriginalName) {
            try {
              await updateEntityFields(editEntityId, { alias: trimmedName });
            } catch (err: any) {
              if (
                err?.message?.includes('UNIQUE') ||
                err?.message?.includes('alias')
              ) {
                showAlert(t('aliasConflictTitle'), t('aliasConflictMessage'));
                setIsSaving(false);
                return;
              }
              throw err;
            }
          }
          await createOrUpdateEntityModuleMapping({
            entity_id: editEntityId,
            backend_config_id: backendConfigId || null,
            cognition_config_id: cognitionConfigId || null,
            tts_config_id: ttsConfigId || null,
            stt_config_id: sttConfigId || null,
            vision_config_id: visionConfigId || null,
            rag_config_id: ragConfigId || null,
            imagination_config_id: imaginationConfigId || null,
            movement_config_id: movementConfigId || null,
          });
          // Entity wiring changed → the computed lock set is stale (7-14).
          invalidateEntityAccessCache();
        }

        navigation.goBack();
        return;
      }

      // 1. Either link an existing character profile (from the "From an
      //    Existing One" flow) or create a brand-new one. The ENGINE mints the
      //    profile id (`POST /api/character-profiles` ignores a client id), so
      //    the returned id drives entity linkage + image uploads below
      //    (create-then-use-response — owner ruling 1).
      let profileId: string;
      if (prefillProfileId) {
        // Reuse the pre-existing profile — do NOT create a new persona.
        profileId = prefillProfileId;
      } else {
        // The NOT NULL text fields use empty string fallbacks, never null.
        const typingWpm = parseInt(typingSpeedWpm, 10);
        const audioChance = parseInt(audioResponseChance, 10);

        const createdProfile = await createCharacterProfile({
          id: '', // ignored by the engine (server-assigned)
          name: trimmedName,
          description: description.trim() || '',
          personality: personality.trim() || '',
          voice_characteristics: voiceCharacteristics.trim() || '',
          typing_speed_wpm: Number.isFinite(typingWpm) ? Math.min(200, Math.max(1, typingWpm)) : 60,
          audio_response_chance_percent: Number.isFinite(audioChance)
            ? Math.min(100, Math.max(0, audioChance))
            : 50,
          vision_config_id: null,
          lifecycle_config: '{}',
          base_prompt: basePrompt.trim() || '',
          scenario: scenario.trim() || '',
          mes_example: exampleDialogues.trim() || '',
        });
        // Engine-minted profile id — reuse it for entity linkage + images.
        profileId = createdProfile.id;

        // Record the cloud user who created this AI (creator badge + the
        // creator-only Edit Profile / Edit AI Settings buttons depend on it).
        if (user?.id) {
          try {
            await setCharacterCreator({
              profileId,
              userId: user.id,
            });
          } catch (err) {
            log.warn('Failed to record character creator:', err);
          }
        }

        // 2. Add avatar image if selected (only for newly created profiles)
        const hasAvatar = !!(avatarBase64 && avatarMimeType);
        if (hasAvatar) {
          const now = new Date();
          await createCharacterImage({
            character_profile_id: profileId,
            image_data: avatarBase64!,
            mime_type: avatarMimeType!,
            description: '',
            is_primary: true,
            display_order: 0,
            vl_model_interpretation: '',
            vl_model: '',
            updated_at: now,
          });
        }

        // 2b. Persist gallery images. When no avatar was picked, the first
        // gallery image becomes the primary. display_order continues after the
        // avatar (0 → 1, 2, …).
        for (const [index, galleryImg] of galleryImages.entries()) {
          const now = new Date();
          await createCharacterImage({
            character_profile_id: profileId,
            image_data: galleryImg.base64,
            mime_type: galleryImg.mimeType,
            description: galleryImg.description,
            is_primary: !hasAvatar && index === 0,
            display_order: index + 1,
            vl_model_interpretation: '',
            vl_model: '',
            updated_at: now,
          });
        }
      }

      // 3. Create the entity. The ENGINE mints the id from the name
      //    (`POST /api/entities` rejects a client id) — create-then-use-response:
      //    the returned id drives the module mapping below.
      let entityId: string;
      try {
        const entity = await createEntity({
          name: trimmedName,
          character_profile_id: profileId,
          lifecycle_config: '{}',
        });
        entityId = entity.id;
      } catch (err: any) {
        if (err instanceof ReservedEntityNameError) {
          // Belt-and-braces (the pre-check catches the common case): the profile
          // was created before the entity rejection — roll it back so no orphan
          // lingers, then keep the rejection on the inline field error.
          if (!prefillProfileId) {
            try {
              await deleteCharacterProfileCascade(profileId);
            } catch (rollbackErr) {
              log.warn('Failed to roll back orphaned profile after reserved-name rejection:', rollbackErr);
            }
          }
          setReservedNameBlocked(true);
          setIsSaving(false);
          return;
        }
        // A live-alias collision is a 400 from the engine
        // (`{error:"entity alias is already in use"}`) — surface the same
        // alias-conflict alert. Ghost-id collisions auto-resolve engine-side
        // (dedupe_id_if_taken), so no id-collision branch is needed.
        if (err?.message?.includes('alias')) {
          // Roll back ONLY the brand-new profile created in step 1 so a failed
          // attempt cannot leave an orphaned "Name 2" duplicate in the
          // Characters list — the reported bug showed a "name already in use"
          // alert AND the fork still appearing. The prefill-link flow
          // (prefillProfileId) reuses an EXISTING profile, so nothing needs
          // rolling back there — the entity insert simply fails. For a fresh
          // create the entity insert failed, so the cascade soft-deletes just
          // the profile (+ any created images/sidecars).
          if (!prefillProfileId) {
            try {
              await deleteCharacterProfileCascade(profileId);
            } catch (rollbackErr) {
              log.warn('Failed to roll back orphaned profile after alias conflict:', rollbackErr);
            }
          }
          showAlert(
            t('aliasConflictTitle'),
            t('aliasConflictMessage'),
          );
          setIsSaving(false);
          return;
        }
        throw err;
      }

      // 4. Resolve module config ids. Unset slots stay unset ('' → null) —
      //    nothing is auto-created here. The engine/user fills them later;
      //    engine-seeded defaults arrive via normal sync.
      const resolvedBackend = backendConfigId || null;
      const resolvedCognition = cognitionConfigId || null;
      const resolvedTts = ttsConfigId || null;
      const resolvedStt = sttConfigId || null;
      const resolvedVision = visionConfigId || null;
      const resolvedRag = ragConfigId || null;
      const resolvedImagination = imaginationConfigId || null;
      const resolvedMovement = movementConfigId || null;

      // 5. Create entity module mapping
      await createEntityModuleMapping({
        entity_id: entityId,
        backend_config_id: resolvedBackend,
        cognition_config_id: resolvedCognition,
        tts_config_id: resolvedTts,
        stt_config_id: resolvedStt,
        vision_config_id: resolvedVision,
        rag_config_id: resolvedRag,
        imagination_config_id: resolvedImagination,
        movement_config_id: resolvedMovement,
        deleted_at: null,
      });
      // New entity wiring → the computed lock set is stale (7-14).
      invalidateEntityAccessCache();

      // 6. The entity (and its profile/mapping) is authored directly on the
      //    engine at create time (task 3-4) — no separate sync push is needed.

      // 7. Go back to the screen we came from (Characters list).
      navigation.goBack();
    } catch (err: any) {
      showAlert(
        t('common:error'),
        t('createFailed', { message: err?.message ?? 'Unknown error' }),
      );
    } finally {
      setIsSaving(false);
    }
  };

  /** "Save" — persist the partner and return to the Characters list. */
  const handleSave = () => {
    createPartner();
  };

  // ── Render guard ─────────────────────────────────────────────────────────────
  if (!theme) return null;

  // ── Styles derived from theme ────────────────────────────────────────────────
  const accent = theme.colors.accent.primary;
  const surfaceColor = theme.colors.background.surface;
  const inputTextStyle = { color: theme.colors.text.primary };

  /**
   * A clean `sb-input` field from the design: label above, crisp dark box with
   * NO leading icon inside. The `icon` argument is retained for call-site
   * compatibility but intentionally unused — the proposed clean UX dropped the
   * decorative in-box icons.
   */
  const renderField = (
    labelKey: string,
    placeholderKey: string,
    value: string,
    onChange: (v: string) => void,
    field: typeof focusedField,
    multiline = false,
    _icon?: string,
    containerStyle?: ViewStyle,
    hideLabel = false,
  ) => {
    const focused = focusedField === field;
    return (
      <View style={[styles.fieldGroup, containerStyle]}>
        {!hideLabel && (
          <ThemedText size={12} variant="secondary" style={styles.fieldLabel}>
            {t(labelKey)}
          </ThemedText>
        )}
        <View
          style={[
            styles.inputShell,
            multiline && styles.multilineShell,
            {
              backgroundColor: 'rgba(15, 23, 42, 0.9)',
              borderColor: focused ? accent : theme.colors.border.default,
            },
          ]}
        >
          <TextInput
            style={[
              styles.input,
              multiline && styles.multilineInput,
              inputTextStyle,
            ]}
            value={value}
            onChangeText={onChange}
            onFocus={() => setFocusedField(field)}
            onBlur={() => setFocusedField(null)}
            placeholder={t(placeholderKey)}
            placeholderTextColor={theme.colors.text.muted}
            multiline={multiline}
            scrollEnabled={multiline ? false : undefined}
            textAlignVertical={multiline ? 'top' : undefined}
            autoCorrect={false}
          />
        </View>
      </View>
    );
  };

  /**
   * One row of the consolidated "Character Card Sections" accordion: a clean
   * divided row (title left, summary pill + chevron right) with the expanded
   * body directly below it inside the same card.
   */
  const renderAccordionRow = (
    title: string,
    badgeText: string,
    open: boolean,
    onToggle: () => void,
    children: React.ReactNode,
    testID: string,
    aliasTestIDs: string[] = [],
    isLast = false,
  ) => (
    <View style={[styles.accordionRow, isLast && !open && styles.accordionRowLast]}>
      <TouchableOpacity
        onPress={onToggle}
        activeOpacity={0.7}
        testID={testID}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={styles.accordionRowHeader}
      >
        <ThemedText
          size={14}
          weight="medium"
          numberOfLines={1}
          style={styles.accordionRowTitle}
        >
          {title}
        </ThemedText>
        <View style={styles.countPill} testID={`${testID}-badge`}>
          <ThemedText size={11} numberOfLines={1} style={styles.countPillText}>
            {badgeText} {open ? '▴' : '▾'}
          </ThemedText>
        </View>
      </TouchableOpacity>
      {/* Backwards-compatible toggle aliases (zero-size, accessible) so the
          consolidated rows still answer the legacy per-section testIDs. */}
      {aliasTestIDs.map(alias => (
        <TouchableOpacity
          key={alias}
          onPress={onToggle}
          testID={alias}
          accessibilityRole="button"
          accessibilityLabel={title}
          style={styles.accordionAlias}
        />
      ))}
      {open && <View style={styles.accordionRowBody}>{children}</View>}
    </View>
  );

  // ── Live summary pills for the character-card accordion (4-2) ──────────────
  const cardBadges = buildCardSectionBadges({
    personality,
    voiceCharacteristics,
    basePrompt,
    scenario,
    exampleDialogues,
    postHistoryInstructions,
    firstMes,
    alternateGreetings,
    characterBook,
    imageCount: editProfileId ? editImages.length : galleryImages.length,
    tags,
    lifecycleConfig,
    creatorName,
  });

  // Combined accordion rows: either legacy sub-toggle keeps the consolidated
  // row open (and toggling the row moves both flags together).
  const galleryOpen = showImages || showTags;
  const toggleGallery = () => {
    const next = !galleryOpen;
    setShowImages(next);
    setShowTags(next);
  };
  const lifecycleOpen = showLifecycle || showAttribution;
  const toggleLifecycle = () => {
    const next = !lifecycleOpen;
    setShowLifecycle(next);
    setShowAttribution(next);
  };

  return (
    <ThemedView style={styles.container}>
      {/* ── Header ── */}
      <ScreenHeader
        title={
          editProfileId
            ? t('editTitle', { name: editOriginalName || name })
            : t('title')
        }
        onBack={() => navigation.goBack()}
        right={
          editProfileId ? (
            <ExportSection
              compact
              onExport={handleExport}
              disabled={!name.trim()}
            />
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
          refreshControl={
            editProfileId ? (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                colors={[accent]}
                tintColor={accent}
                progressBackgroundColor={theme.colors.background.surface}
              />
            ) : undefined
          }
        >
          {/* ══════════════════ 1. IDENTITY ══════════════════ */}
          <ThemedCard elevated style={styles.section}>
            <SectionHeader title={t('characters:identity', 'Identity')} />

            {/* Live-link mode: the card is SHARED with the source AI — keep
                the UX honest about what saving will and won't do. */}
            {prefillProfileId && (
              <View style={styles.sharedCardHint} testID="shared-card-hint">
                <Icon name="link-variant" size={14} color={theme.colors.text.muted} />
                <ThemedText size={12} variant="muted" style={styles.sharedCardHintText}>
                  {t('sharedCardHint')}
                </ThemedText>
              </View>
            )}

            {/* Edit mode, stale-synced data only: the card is owned by a user
                persona (D.2). Local writes can't produce this state — muted
                hint, no lock. */}
            {editProfileId && editPersonaOwned && (
              <View style={styles.sharedCardHint} testID="persona-owned-hint">
                <Icon name="account-off-outline" size={14} color={theme.colors.text.muted} />
                <ThemedText size={12} variant="muted" style={styles.sharedCardHintText}>
                  {t('personaOwnedHint')}
                </ThemedText>
              </View>
            )}

            {/* Avatar */}
            <View style={styles.avatarRow}>
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
                          size={34}
                          color={hexToRgba(accent, 0.9)}
                        />
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
                      borderColor: theme.colors.background.base,
                    },
                  ]}
                >
                  <Icon name="camera" size={14} color={accent} />
                </View>
              </TouchableOpacity>
              <View style={styles.avatarTextGroup}>
                <ThemedText size={16} weight="bold" variant="primary">
                  {t('avatarLabel')}
                </ThemedText>
                <ThemedText size={12} variant="muted">
                  {avatarUri ? t('changePhoto') : t('addPhotoHint')}
                </ThemedText>
              </View>
            </View>

            <View style={styles.sectionContent}>
              {/* Name (required) + Nickname — side-by-side in EDIT mode under a
                  single combined label so the identity surface stays compact;
                  Name spans full width on create (where the name mints the
                  entity id). */}
              <ThemedText size={12} variant="secondary" style={styles.fieldLabel}>
                {editProfileId
                  ? t('nameAndNicknameLabel', 'Name * · Nickname')
                  : t('nameLabel')}
              </ThemedText>
              <View style={editProfileId ? styles.identityNameRow : undefined}>
                <View style={editProfileId ? styles.identityNameField : undefined}>
                  {renderField(
                    'nameLabel',
                    'namePlaceholder',
                    name,
                    handleNameChange,
                    'name',
                    false,
                    'account-edit',
                    undefined,
                    true,
                  )}
                </View>

                {editProfileId && (
                  <View style={styles.identityNicknameField} testID="nickname-field">
                    <View
                      style={[
                        styles.inputShell,
                        {
                          backgroundColor: 'rgba(15, 23, 42, 0.9)',
                          borderColor:
                            focusedField === 'nickname'
                              ? accent
                              : theme.colors.border.default,
                        },
                      ]}
                    >
                      <TextInput
                        style={[styles.input, inputTextStyle]}
                        value={nickname}
                        onChangeText={setNickname}
                        onFocus={() => setFocusedField('nickname')}
                        onBlur={() => setFocusedField(null)}
                        placeholder={t('characters:nicknamePlaceholder', 'Alias (optional)')}
                        placeholderTextColor={theme.colors.text.muted}
                        testID="nickname-input"
                      />
                    </View>
                  </View>
                )}
              </View>

              {/* D33: reserved-name inline error (create mode — `user`/`deleted`) */}
              {reservedNameError ? (
                <ThemedText
                  size={12}
                  style={{
                    color: theme.colors.status.error,
                    marginLeft: 4,
                    marginTop: -10,
                    marginBottom: 12,
                  }}
                  testID="create-ai-name-error"
                >
                  {reservedNameError}
                </ThemedText>
              ) : null}

              {/* Description */}
              {renderField(
                'descriptionLabel',
                'descriptionPlaceholder',
                description,
                setDescription,
                'description',
                true,
                'text-box-outline',
              )}

            </View>
          </ThemedCard>

          {/* ══════════════════ 2. CHARACTER CARD SECTIONS ══════════════════
              One glass card with exactly five accordion rows. Each row carries
              a right-aligned count pill with the chevron INSIDE it (Configured
              / 1 opening · 2 alt / 3 entries / 2 images · 4 tags / Default) so
              the card's state is readable without expanding every section. */}
          <ThemedCard elevated style={styles.section}>
            <SectionHeader title={t('characterCardSections', 'Character Card Sections')} />

            {/* ── 1. Persona & Prompts ── */}
            {renderAccordionRow(
              t('personaPrompts', 'Persona & Prompts'),
              cardBadges.persona,
              showDetails,
              () => setShowDetails(prev => !prev),
              <View style={styles.accordionRowBodyInner}>
                {/* Personality */}
                {renderField(
                  'personalityLabel',
                  'personalityPlaceholder',
                  personality,
                  setPersonality,
                  'personality',
                  true,
                  'message-text-outline',
                )}

                {/* ── Voice & Behavior ── */}
                <ThemedText size={12} variant="accent" weight="bold" style={styles.groupLabel}>
                  {t('voiceBehaviorLabel')}
                </ThemedText>

                {/* Voice characteristics */}
                {renderField(
                  'voiceLabel',
                  'voicePlaceholder',
                  voiceCharacteristics,
                  setVoiceCharacteristics,
                  'voice',
                  true,
                  'account-voice',
                )}

                {/* Typing speed + Audio chance (side-by-side numeric row) */}
                <View style={styles.numericRow}>
                  <View style={styles.numericField}>
                    <ThemedText size={13} variant="secondary" numberOfLines={1} style={styles.numericFieldLabel}>
                      {t('typingSpeedLabel')}
                    </ThemedText>
                    <View
                      style={[
                        styles.inputShell,
                        {
                          backgroundColor: 'rgba(15, 23, 42, 0.9)',
                          borderColor:
                            focusedField === 'typing'
                              ? accent
                              : theme.colors.border.default,
                        },
                      ]}
                    >
                      <TextInput
                        style={[styles.input, styles.numericInput, inputTextStyle]}
                        value={typingSpeedWpm}
                        onChangeText={setTypingSpeedWpm}
                        onFocus={() => setFocusedField('typing')}
                        onBlur={() => setFocusedField(null)}
                        placeholder="60"
                        placeholderTextColor={theme.colors.text.muted}
                        keyboardType="numeric"
                        returnKeyType="done"
                      />
                    </View>
                  </View>

                  <View style={styles.numericField}>
                    <ThemedText size={13} variant="secondary" numberOfLines={1} style={styles.numericFieldLabel}>
                      {t('audioChanceLabel')}
                    </ThemedText>
                    <View
                      style={[
                        styles.inputShell,
                        {
                          backgroundColor: 'rgba(15, 23, 42, 0.9)',
                          borderColor:
                            focusedField === 'audio'
                              ? accent
                              : theme.colors.border.default,
                        },
                      ]}
                    >
                      <TextInput
                        style={[styles.input, styles.numericInput, inputTextStyle]}
                        value={audioResponseChance}
                        onChangeText={setAudioResponseChance}
                        onFocus={() => setFocusedField('audio')}
                        onBlur={() => setFocusedField(null)}
                        placeholder="50"
                        placeholderTextColor={theme.colors.text.muted}
                        keyboardType="numeric"
                        returnKeyType="done"
                      />
                    </View>
                  </View>
                </View>

                {/* ── Prompts & Scenario (AI settings) ── */}
                <ThemedText size={12} variant="accent" weight="bold" style={styles.groupLabel}>
                  {t('promptsScenarioLabel')}
                </ThemedText>

                {/* Base Prompt (system prompt) */}
                {renderField(
                  'basePromptLabel',
                  'basePromptPlaceholder',
                  basePrompt,
                  setBasePrompt,
                  'basePrompt',
                  true,
                  'creation',
                )}
                {/* Scenario */}
                {renderField(
                  'scenarioLabel',
                  'scenarioPlaceholder',
                  scenario,
                  setScenario,
                  'scenario',
                  true,
                  'movie-open-outline',
                )}
                {/* Example Dialogues */}
                {renderField(
                  'exampleDialoguesLabel',
                  'exampleDialoguesPlaceholder',
                  exampleDialogues,
                  setExampleDialogues,
                  'exampleDialogues',
                  true,
                  'chat-processing-outline',
                )}

                {/* Post-history instructions (UJB) — edit mode, V3 column */}
                {editProfileId && (
                  <View style={styles.fieldGroup} testID="post-history-field">
                    <ThemedText size={12} variant="secondary" weight="medium" style={styles.fieldLabel}>
                      {t('characters:postHistoryInstructions', 'Post-history instructions (UJB)')}
                    </ThemedText>
                    <View style={[styles.inputShell, styles.multilineShell, { backgroundColor: 'rgba(15, 23, 42, 0.9)', borderColor: theme.colors.border.default }]}>
                      <TextInput
                        style={[styles.input, styles.multilineInput, inputTextStyle]}
                        value={postHistoryInstructions}
                        onChangeText={setPostHistoryInstructions}
                        placeholder={t('characters:postHistoryHint', 'Injected after the conversation history')}
                        placeholderTextColor={theme.colors.text.muted}
                        multiline
                        numberOfLines={3}
                        textAlignVertical="top"
                        testID="post-history-input"
                      />
                    </View>
                    <MacroHighlighter
                      text={postHistoryInstructions}
                      numberOfLines={2}
                      testID="post-history-macro-highlight"
                    />
                  </View>
                )}
              </View>,
              'details-section-toggle',
              ['persona-prompts-toggle'],
            )}

            {/* ── 2. Greetings ── */}
            {renderAccordionRow(
              t('greetingsRow', 'Greetings'),
              cardBadges.greetings,
              showGreeting,
              () => setShowGreeting(prev => !prev),
              <View style={styles.accordionRowBodyInner}>
                <GreetingEditorSection
                  firstMes={firstMes}
                  onChangeFirstMes={setFirstMes}
                  charName={nickname.trim() || name.trim() || '{{char}}'}
                  userName={impersonatedEntityName}
                  testState={testState}
                  testGreeting={testGreeting}
                  onTestScenario={handleTestScenario}
                  onUseTestGreeting={handleUseTestGreeting}
                  onDiscardTestGreeting={handleDiscardTestGreeting}
                />
                <AlternateGreetingsSection
                  alternateGreetings={alternateGreetings}
                  firstMes={firstMes}
                  charName={nickname.trim() || name.trim() || '{{char}}'}
                  userName={impersonatedEntityName}
                  onAdd={handleAddAlternate}
                  onRemove={handleRemoveAlternate}
                  onMove={handleMoveAlternate}
                  onEdit={handleEditAlternate}
                  onPromoteToDefault={handlePromoteToDefault}
                />
              </View>,
              'greeting-section-toggle',
            )}

            {/* ── 3. Lorebook ── */}
            {renderAccordionRow(
              t('characters:lorebookSection', 'Lorebook'),
              cardBadges.lorebook,
              showLorebook,
              () => setShowLorebook(prev => !prev),
              <View style={styles.accordionRowBodyInner}>
                <LorebookSection
                  characterBook={characterBook}
                  onChange={setCharacterBook}
                />
              </View>,
              'lorebook-section-toggle',
            )}

            {/* ── 4. Gallery & Tags (one combined row) ── */}
            {renderAccordionRow(
              t('galleryTagsRow', 'Gallery & Tags'),
              cardBadges.galleryTags,
              galleryOpen,
              toggleGallery,
              <>
                {editProfileId ? (
                  <View style={styles.accordionRowBodyInner}>
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
                  </View>
                ) : (
                  <View style={styles.accordionRowBodyInner}>
                    <View style={styles.galleryWrap}>
                      {galleryImages.map((img, index) => (
                        <View key={`${index}-${img.base64.length}`} style={styles.galleryTile}>
                          <Image
                            source={{ uri: `data:${img.mimeType};base64,${img.base64}` }}
                            style={styles.galleryTileImage}
                            resizeMode="cover"
                          />
                          <TouchableOpacity
                            onPress={() => {
                              hapticLightPress();
                              handleRemoveGalleryImage(index);
                            }}
                            activeOpacity={0.7}
                            style={styles.galleryTileRemove}
                            testID="create-ai-remove-gallery-image"
                            accessibilityRole="button"
                            accessibilityLabel={t('removeImage')}
                          >
                            <Icon name="close" size={14} color="#fff" />
                          </TouchableOpacity>
                        </View>
                      ))}

                      {/* Add image tile */}
                      <TouchableOpacity
                        onPress={() => {
                          hapticLightPress();
                          handleAddGalleryImage();
                        }}
                        activeOpacity={0.7}
                        style={styles.galleryAddTile}
                        testID="create-ai-add-gallery-image"
                        accessibilityRole="button"
                        accessibilityLabel={t('addImage')}
                      >
                        <Icon name="plus" size={26} color={accent} />
                        <ThemedText size={11} variant="muted">
                          {t('addImage')}
                        </ThemedText>
                      </TouchableOpacity>
                    </View>
                    <ThemedText size={11} variant="muted" style={styles.galleryHint}>
                      {t('imagesHint')}
                    </ThemedText>
                  </View>
                )}

                <View style={styles.combinedDivider} />
                <TagsSection
                  tags={tags}
                  onChange={setTags}
                  suggestions={libraryTags}
                />
              </>,
              'images-section-toggle',
              ['tags-section-toggle'],
            )}

            {/* ── 5. AI Lifecycle & Attribution (one combined row) ── */}
            {renderAccordionRow(
              t('lifecycleAttributionRow', 'AI Lifecycle & Attribution'),
              cardBadges.lifecycle,
              lifecycleOpen,
              toggleLifecycle,
              <View style={styles.accordionRowBodyInner}>
                <LifecycleSection
                  config={lifecycleConfig}
                  onChange={setLifecycleConfig}
                />
                <View style={styles.combinedDivider} />
                <AttributionSection
                  creator={creatorName}
                  onChangeCreator={setCreatorName}
                  creatorNotes={creatorNotes}
                  onChangeCreatorNotes={setCreatorNotes}
                  characterVersion={characterVersion}
                  onChangeCharacterVersion={setCharacterVersion}
                  cardProvenance={cardProvenance}
                />
              </View>,
              'lifecycle-section-toggle',
              ['attribution-section-toggle'],
              true,
            )}
          </ThemedCard>

          {/* ══════════════════ 3. MODULE WIRING ══════════════════ */}
          <ThemedCard elevated accentTint style={styles.section}>
            {/* Standard section header — the card is expanded by default and
                the rows sit in one clean stack (no noisy sub-group headers). */}
            <TouchableOpacity
              onPress={() => setShowAdvanced(prev => !prev)}
              activeOpacity={0.7}
              testID="advanced-toggle"
            >
              <SectionHeader title={t('moduleWiring', 'MODULE WIRING')} />
            </TouchableOpacity>

            {showAdvanced && (
              <View style={styles.sectionContent}>
                {/* Loading indicator (only while first load is in flight) */}
                {hasAnyConfigs === null && (
                  <View style={styles.loadingRow}>
                    <ActivityIndicator size="small" color={accent} />
                    <ThemedText size={13} variant="muted" style={styles.loadingLabel}>
                      {t('loadingConfigs')}
                    </ThemedText>
                  </View>
                )}

                {/* Module pickers — always visible so configs can be selected,
                    created, or edited right here. A slot with no selection
                    stays unset ("Disabled") — engine-seeded defaults arrive
                    via normal sync; the sheet's "Create new config…" row
                    opens ModuleConfigEdit. Each picker carries its provider +
                    model subtitle so configs are distinguishable at a glance. */}
                <EntityModuleSelectorWithActions
                  label={t('moduleBackend')}
                  moduleType="backend"
                  configs={backendConfigs}
                  selectedId={backendConfigId}
                  onChange={setBackendConfigId}
                  isLoading={hasAnyConfigs === null}
                  entityId={editEntityId ?? undefined}
                />
                <EntityModuleSelectorWithActions
                  label={t('moduleCognition')}
                  moduleType="cognition"
                  configs={cognitionConfigs}
                  selectedId={cognitionConfigId}
                  onChange={setCognitionConfigId}
                  isLoading={hasAnyConfigs === null}
                  entityId={editEntityId ?? undefined}
                />

                <EntityModuleSelectorWithActions
                  label={t('moduleTTS')}
                  moduleType="tts"
                  configs={ttsConfigs}
                  selectedId={ttsConfigId}
                  onChange={setTtsConfigId}
                  isLoading={hasAnyConfigs === null}
                  entityId={editEntityId ?? undefined}
                />
                <EntityModuleSelectorWithActions
                  label={t('moduleSTT')}
                  moduleType="stt"
                  configs={sttConfigs}
                  selectedId={sttConfigId}
                  onChange={setSttConfigId}
                  isLoading={hasAnyConfigs === null}
                  entityId={editEntityId ?? undefined}
                />

                <EntityModuleSelectorWithActions
                  label={t('moduleRAG')}
                  moduleType="rag"
                  configs={ragConfigs}
                  selectedId={ragConfigId}
                  onChange={setRagConfigId}
                  isLoading={hasAnyConfigs === null}
                  entityId={editEntityId ?? undefined}
                />
                <EntityModuleSelectorWithActions
                  label={t('moduleMovement')}
                  moduleType="movement"
                  configs={movementConfigs}
                  selectedId={movementConfigId}
                  onChange={setMovementConfigId}
                  isLoading={hasAnyConfigs === null}
                  entityId={editEntityId ?? undefined}
                />
                <EntityModuleSelectorWithActions
                  label={t('moduleVision')}
                  moduleType="vision"
                  configs={visionConfigs}
                  selectedId={visionConfigId}
                  onChange={setVisionConfigId}
                  isLoading={hasAnyConfigs === null}
                  entityId={editEntityId ?? undefined}
                />
                <EntityModuleSelectorWithActions
                  label={t('moduleImagination')}
                  moduleType="imagination"
                  configs={imaginationConfigs}
                  selectedId={imaginationConfigId}
                  onChange={setImaginationConfigId}
                  isLoading={hasAnyConfigs === null}
                  entityId={editEntityId ?? undefined}
                />

              </View>
            )}
          </ThemedCard>

          {/* ── Action: Save only — partners are created and saved here, then
              chatted with from the Characters list (create and edit). */}
          <View style={styles.ctaSection}>
            {isSaving ? (
              <ActivityIndicator size="large" color={accent} />
            ) : (
              <ThemedButton
                label={t('save')}
                onPress={handleSave}
                variant="primary"
                icon="content-save-outline"
                disabled={isSaving}
                style={styles.ctaButton}
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
  keyboardAvoid: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
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
  // ── Live-link shared-card hint (muted, subtle) ──
  sharedCardHint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  sharedCardHintText: {
    flex: 1,
  },

  // ── Avatar row ──
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 4,
  },
  avatarPressable: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarRing: {
    width: 76,
    height: 76,
    borderRadius: 38,
    padding: 3,
  },
  avatarInner: {
    flex: 1,
    borderRadius: 35,
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
  cameraBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  avatarTextGroup: {
    flex: 1,
    gap: 2,
  },

  // ── Fields ──
  fieldGroup: {
    marginBottom: 18,
  },
  fieldLabel: {
    marginBottom: 8,
    marginLeft: 4,
  },
  inputShell: {
    // Clean `sb-input`: crisp dark box, no leading icons.
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 11,
    paddingVertical: 8,
    minHeight: 38,
  },
  multilineShell: {
    // Prose textareas: full width, symmetric vertical padding.
    alignItems: 'stretch',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  input: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 0,
  },
  multilineInput: {
    minHeight: 54,
    paddingVertical: 0,
    textAlignVertical: 'top',
    lineHeight: 20,
  },

  // ── Identity card: Name + Nickname side-by-side in edit mode ──
  identityNameRow: {
    flexDirection: 'row',
    gap: 10,
  },
  identityNameField: {
    flex: 1.2,
  },
  identityNicknameField: {
    flex: 1,
  },

  // ── Character Card Sections accordion (`accordion-row` / `count-pill`) ──
  accordionRow: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(51, 65, 85, 0.65)',
  },
  accordionRowLast: {
    borderBottomWidth: 0,
  },
  accordionRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  accordionRowTitle: {
    flexShrink: 1,
  },
  countPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(148, 163, 184, 0.15)',
    flexShrink: 0,
  },
  countPillText: {
    color: '#cbd5e1',
  },
  accordionAlias: {
    width: 0,
    height: 0,
  },
  accordionRowBody: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  accordionRowBodyInner: {
    gap: 0,
  },
  combinedDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(51, 65, 85, 0.65)',
    marginVertical: 12,
  },

  // ── Advanced ──
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  loadingLabel: {
    marginLeft: 8,
  },
  groupLabel: {
    marginTop: 8,
    marginBottom: 10,
    letterSpacing: 0.4,
  },

  // ── Numeric row (typing speed / audio chance) ──
  numericRow: {
    flexDirection: 'row',
    gap: 12,
  },
  numericField: {
    flex: 1,
    marginBottom: 8,
  },
  numericFieldLabel: {
    marginBottom: 8,
    marginLeft: 4,
  },
  numericInput: {
    textAlign: 'center',
    fontSize: 15,
    paddingVertical: 0,
  },

  // ── SOUL price (marketplace only) ──
  priceRow: {
    marginTop: 4,
    marginBottom: 8,
  },
  priceInputWrap: {
    marginBottom: 4,
  },
  priceHint: {
    marginLeft: 4,
    lineHeight: 15,
  },

  // ── Gallery ──
  galleryWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 4,
  },
  galleryTile: {
    width: 92,
    height: 92,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  galleryTileImage: {
    width: '100%',
    height: '100%',
  },
  galleryTileRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  galleryAddTile: {
    width: 92,
    height: 92,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.22)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  galleryHint: {
    marginTop: 8,
    marginLeft: 2,
  },

  // ── Edit-mode images section ──
  imageHint: {
    marginTop: 4,
  },

  // ── CTA ──
  ctaSection: {
    marginTop: 8,
    minHeight: 56,
    justifyContent: 'center',
  },
  ctaButton: {
    flex: 1,
  },
});
