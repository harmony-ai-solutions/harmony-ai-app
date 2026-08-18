/**
 * CreateAIScreen
 *
 * Create AI Partner wizard. Creates a CharacterProfile + Entity (with alias)
 * + EntityModuleMapping in one flow, then saves and returns to the previous
 * screen (Characters list).
 *
 * The screen is split into three sections:
 *   1. General  — name (required), description, avatar
 *   2. Details  — personality, appearance, backstory
 *   3. Advanced — module configs (AI model / config / voice settings)
 *
 * The user can create a partner with just a name: when no module configs are
 * selected, Soulbits Cloud default configs are created automatically in the
 * background (see SoulbitsDefaultConfigService) so the partner is fully
 * wired up out of the box and chat-ready from the Characters list.
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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemedCard } from '../components/themed/ThemedCard';
import { ScreenHeader } from '../components/themed/ScreenHeader';
import { SectionHeader } from '../components/themed/SectionHeader';
import { SoulIcon } from '../components/market/SoulIcon';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { launchImageLibrary } from 'react-native-image-picker';
import { v4 as uuidv4 } from 'uuid';
import { useTranslation } from 'react-i18next';
import { createLogger } from '../utils/logger';

const log = createLogger('[CreateAIScreen]');

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
import { hexToRgba } from '../utils/colorUtils';
import { hapticLightPress } from '../utils/haptics';
import { ModuleConfigOption } from '../components/entities/EntityModuleSelector';
import type { CharacterProfile } from '../database/models';

import {
  createCharacterProfile,
  createCharacterImage,
  deleteCharacterImage,
  deleteCharacterProfileCascade,
  getCharacterProfile,
  getCharacterImages,
  getCharacterProfileVisibility,
  setCharacterProfileSource,
  setCharacterProfileVisibility,
  updateCharacterProfile,
  type CharacterProfileVisibility,
} from '../database/repositories/characters';
import { setCharacterCreator } from '../database/repositories/characterSocial';
import {
  getMarketplaceListing,
  upsertMarketplaceListing,
  removeMarketplaceListing,
} from '../database/repositories/marketplace';
import {
  createEntity,
  createEntityModuleMapping,
  createOrUpdateEntityModuleMapping,
  getEntityByCharacterProfileId,
  getEntityModuleMapping,
  getNextEntityAliasCopy,
  updateEntityFields,
} from '../database/repositories/entities';
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
} from '../database/repositories/modules';
import syncService from '../services/SyncService';
import {
  ensureSoulbitsDefaultConfigs,
  DEFAULT_CONFIG_NAME,
} from '../services/SoulbitsDefaultConfigService';

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
  const { t } = useTranslation('createAI');

  // ── Core fields ──────────────────────────────────────────────────────────────
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [personality, setPersonality] = useState('');
  const [appearance, setAppearance] = useState('');
  const [backstory, setBackstory] = useState('');
  const [voiceCharacteristics, setVoiceCharacteristics] = useState('');
  const [typingSpeedWpm, setTypingSpeedWpm] = useState('60');
  const [audioResponseChance, setAudioResponseChance] = useState('50');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [avatarBase64, setAvatarBase64] = useState<string | null>(null);
  const [avatarMimeType, setAvatarMimeType] = useState<string>('image/jpeg');

  // Visibility / sharing:
  //   - private      → only the creator can see/chat (DEFAULT)
  //   - public       → visible + searchable on Discover, anyone can chat
  //   - marketplace  → listed on the Market screen with a SOUL price; viewing
  //                    the profile is free but chatting requires purchasing it
  // Stored in the client-only character_profile_sources sidecar (never synced)
  // + the client-only marketplace listings table (never synced).
  const [visibility, setVisibility] = useState<'private' | 'public' | 'marketplace'>(
    'private',
  );
  const [priceSouls, setPriceSouls] = useState('100');
  const [visibilityLoaded, setVisibilityLoaded] = useState(false);

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
  const [showAdvanced, setShowAdvanced] = useState(false);
  // UI-only: tracks the currently focused field for accent highlighting
  const [focusedField, setFocusedField] = useState<
    | 'name'
    | 'description'
    | 'personality'
    | 'appearance'
    | 'backstory'
    | 'basePrompt'
    | 'scenario'
    | 'exampleDialogues'
    | 'voice'
    | 'typing'
    | 'audio'
    | 'price'
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

  // ── Edit mode — editProfileId edits an existing AI partner ──────────────────
  // The single edit surface: profile (name/bio/prompts/images) + entity module
  // mapping (AI model / voice / config) all edited right here.
  const editProfileId = route.params?.editProfileId ?? null;
  const [editLoaded, setEditLoaded] = useState(false);
  const [editEntityId, setEditEntityId] = useState<string | null>(null);
  const [editOriginalName, setEditOriginalName] = useState('');

  // ── "From an existing one" — prefillProfileId links an existing profile ──────
  const prefillProfileId = route.params?.prefillProfileId ?? null;
  const [prefilled, setPrefilled] = useState(false);

  // ── Duplicate flow — duplicateProfileId copies a profile into a NEW one ──────
  // The source profile is fully copied: name gets an auto-numbered suffix
  // (02, 03, …), all detail fields + voice settings carry over, the primary
  // avatar image is copied, and any existing entity module mapping is re-used
  // so the copy is chat-ready with the exact same settings.
  const duplicateProfileId = route.params?.duplicateProfileId ?? null;
  const [duplicateProfile, setDuplicateProfile] =
    useState<CharacterProfile | null>(null);
  const [duplicateLoaded, setDuplicateLoaded] = useState(false);
  // Tracks the last auto-assigned copy name so the focus-time name re-derivation
  // can distinguish "the auto name is still in the field" (safe to advance to
  // the next free number) from "the user manually edited the field" (leave it).
  const lastAutoNameRef = useRef<string | null>(null);
  // Live mirror of `name` so focus callbacks never read a stale closure.
  const nameRef = useRef(name);
  useEffect(() => {
    nameRef.current = name;
  }, [name]);
  // Prefills from the copied profile — separate from the module-config
  // selection below so pickers work after the copy lands.
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
    } catch (err) {
      log.error('Failed to load module configs:', err);
      setHasAnyConfigs(false);
    }
  }, []);

  useEffect(() => {
    loadModuleConfigs();
  }, [loadModuleConfigs]);

  // Live mirror of the module-config selections so the async default-fill
  // below can always read the CURRENT selections (not stale closure values) —
  // closing over the state variables would let a pending fill overwrite the
  // edit/duplicate mapping that the prefill effect applies mid-flight.
  const configSelectionsRef = useRef({
    backend: backendConfigId,
    cognition: cognitionConfigId,
    tts: ttsConfigId,
    stt: sttConfigId,
    vision: visionConfigId,
    rag: ragConfigId,
    imagination: imaginationConfigId,
    movement: movementConfigId,
  });
  useEffect(() => {
    configSelectionsRef.current = {
      backend: backendConfigId,
      cognition: cognitionConfigId,
      tts: ttsConfigId,
      stt: sttConfigId,
      vision: visionConfigId,
      rag: ragConfigId,
      imagination: imaginationConfigId,
      movement: movementConfigId,
    };
  }, [
    backendConfigId,
    cognitionConfigId,
    ttsConfigId,
    sttConfigId,
    visionConfigId,
    ragConfigId,
    imaginationConfigId,
    movementConfigId,
  ]);

  // ── Auto-select Soulbits Cloud defaults for empty module slots ──────────────
  // The module selectors must ALWAYS show a config — never "Disabled". As soon
  // as the config lists have loaded, every slot the user has not explicitly
  // set is pre-selected with the idempotent Soulbits Cloud default config
  // ("Soulbits Cloud (default)"). The user can still switch any slot to a
  // different config later. In edit/duplicate mode the copied mapping is
  // applied by the prefill effect below and any of ITS unset slots get filled
  // back in here: the effect re-runs whenever a selection changes, so a slot
  // only stays empty while its default is still being created.
  const mergeDefaultOption = (
    list: ModuleConfigOption[],
    id: string,
  ): ModuleConfigOption[] =>
    list.some(o => o.id === id)
      ? list
      : [...list, { id, name: DEFAULT_CONFIG_NAME }];

  useEffect(() => {
    if (hasAnyConfigs === null) return;

    let cancelled = false;
    (async () => {
      try {
        // Idempotent — reuses existing rows, only creates missing ones.
        const defaults = await ensureSoulbitsDefaultConfigs();
        if (cancelled) return;

        const sel = configSelectionsRef.current;
        const backendId = defaults.backendConfigId;
        if (backendId && sel.backend === '') {
          setBackendConfigId(backendId);
          setBackendConfigs(prev => mergeDefaultOption(prev, backendId));
        }
        const cognitionId = defaults.cognitionConfigId;
        if (cognitionId && sel.cognition === '') {
          setCognitionConfigId(cognitionId);
          setCognitionConfigs(prev => mergeDefaultOption(prev, cognitionId));
        }
        const ttsId = defaults.ttsConfigId;
        if (ttsId && sel.tts === '') {
          setTtsConfigId(ttsId);
          setTtsConfigs(prev => mergeDefaultOption(prev, ttsId));
        }
        const sttId = defaults.sttConfigId;
        if (sttId && sel.stt === '') {
          setSttConfigId(sttId);
          setSttConfigs(prev => mergeDefaultOption(prev, sttId));
        }
        const visionId = defaults.visionConfigId;
        if (visionId && sel.vision === '') {
          setVisionConfigId(visionId);
          setVisionConfigs(prev => mergeDefaultOption(prev, visionId));
        }
        const ragId = defaults.ragConfigId;
        if (ragId && sel.rag === '') {
          setRagConfigId(ragId);
          setRagConfigs(prev => mergeDefaultOption(prev, ragId));
        }
        const imaginationId = defaults.imaginationConfigId;
        if (imaginationId && sel.imagination === '') {
          setImaginationConfigId(imaginationId);
          setImaginationConfigs(prev => mergeDefaultOption(prev, imaginationId));
        }
        const movementId = defaults.movementConfigId;
        if (movementId && sel.movement === '') {
          setMovementConfigId(movementId);
          setMovementConfigs(prev => mergeDefaultOption(prev, movementId));
        }
      } catch (err) {
        log.warn('Failed to pre-select Soulbits Cloud defaults:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    hasAnyConfigs,
    // Re-run after the edit/duplicate prefill applies (it can leave unset
    // slots as ''), after the user clears a slot, and after the merge backfills
    // the config lists — the ref keeps this closure from double-filling.
    backendConfigId,
    cognitionConfigId,
    ttsConfigId,
    sttConfigId,
    visionConfigId,
    ragConfigId,
    imaginationConfigId,
    movementConfigId,
  ]);

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
        setAppearance(profile.appearance ?? '');
        setBackstory(profile.backstory ?? '');
        setVoiceCharacteristics(profile.voice_characteristics ?? '');
        setTypingSpeedWpm(String(profile.typing_speed_wpm ?? 60));
        setAudioResponseChance(String(profile.audio_response_chance_percent ?? 50));
        setBasePrompt(profile.base_prompt ?? '');
        setScenario(profile.scenario ?? '');
        setExampleDialogues(profile.example_dialogues ?? '');
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

  // ── Duplicate prefill (route param duplicateProfileId) ───────────────────────
  // Loads the source profile, copies its primary avatar + entity module mapping,
  // computes an auto-numbered name (02, 03, …) and prefills every editable field
  // so the user gets a full copy they can tweak, save, or chat with.
  //
  // NOTE on screen reuse: CreateAI is a single Stack.Screen that the user can
  // return to repeatedly ("Max" → "Max 2" → save → "Max" again → "Max 3").
  // Because stack navigation reuses the mounted component, React state survives
  // the round-trip and the `duplicateLoaded` latch below would otherwise stay
  // `true`, so re-entering the duplicate flow would KEEP the stale "Max 2" name
  // instead of recomputing "Max 3". This was the reported bug: creating a 3rd
  // copy of the same AI stayed named "Name 2", collided with the existing
  // "Name 2", and the save spilled an orphaned duplicate profile.
  //
  // Two guards fix it:
  //   1. `duplicateLoaded` is reset whenever the duplication TARGET changes, and
  //   2. a focus-time re-derivation (below) advances the auto-name even when the
  //      same target is duplicated twice in a row — after saving "Max 2" and
  //      returning to duplicate "Max" again, the field still holds "Max 2"
  //      (from the previous visit); we recompute the next free number and bump
  //      it to "Max 3" so the user never saves a duplicate name.
  useEffect(() => {
    if (!duplicateProfileId) return;
    setDuplicateLoaded(false);
  }, [duplicateProfileId]);

  useEffect(() => {
    if (!duplicateProfileId || duplicateLoaded) return;
    let cancelled = false;

    (async () => {
      try {
        const profile = await getCharacterProfile(duplicateProfileId);
        if (!profile || cancelled) return;

        // Compute the next free copy name — "Aria" → "Aria 02" → "Aria 03"…
        const nextName = await getNextEntityAliasCopy(profile.name || 'Character');
        if (cancelled) return;
        setDuplicateProfile(profile);
        setName(nextName);
        lastAutoNameRef.current = nextName;
        setDescription(profile.description ?? '');
        setPersonality(profile.personality ?? '');
        setAppearance(profile.appearance ?? '');
        setBackstory(profile.backstory ?? '');
        setVoiceCharacteristics(profile.voice_characteristics ?? '');
        setTypingSpeedWpm(String(profile.typing_speed_wpm ?? 60));
        setAudioResponseChance(String(profile.audio_response_chance_percent ?? 50));
        setBasePrompt(profile.base_prompt ?? '');
        setScenario(profile.scenario ?? '');
        setExampleDialogues(profile.example_dialogues ?? '');

        // Carry over the source profile's visibility + price so the copy
        // matches it.
        try {
          const visibility = await getCharacterProfileVisibility(profile.id);
          if (!cancelled) {
            setVisibility(visibility);
            setVisibilityLoaded(true);
          }
          try {
            const listing = await getMarketplaceListing(profile.id);
            if (listing && !cancelled) {
              setPriceSouls(String(listing.priceSouls));
            }
          } catch (priceErr) {
            log.warn('Failed to copy profile price:', priceErr);
          }
        } catch (visErr) {
          log.warn('Failed to copy profile visibility:', visErr);
          if (!cancelled) setVisibilityLoaded(true);
        }

        // Copy the source profile's gallery images (the primary avatar is
        // already copied separately above — skip it to avoid a duplicate).
        try {
          const images = await getCharacterImages(profile.id);
          if (!cancelled) {
            setGalleryImages(
              images
                .filter(img => img.image_data && img.mime_type && !img.is_primary)
                .map(img => ({
                  base64: img.image_data,
                  mimeType: img.mime_type,
                  description: img.description ?? '',
                })),
            );
          }
        } catch (galleryErr) {
          log.warn('Failed to copy gallery images:', galleryErr);
        }

        // Copy the primary avatar image (base64 + mime) so the copy looks identical.
        try {
          const images = await getCharacterImages(profile.id);
          const primary = images.find(img => img.is_primary === true);
          if (primary && !cancelled) {
            setAvatarBase64(primary.image_data || null);
            setAvatarMimeType(primary.mime_type || 'image/jpeg');
            setAvatarUri(createDataURL(primary.image_data, primary.mime_type));
          }
        } catch (imgErr) {
          log.warn('Failed to copy primary avatar:', imgErr);
        }

        // Copy the source entity's module mapping (settings) so the copy is
        // chat-ready with the exact same AI model / voice / config stack.
        try {
          const entity = await getEntityByCharacterProfileId(profile.id);
          if (entity) {
            const mapping = await getEntityModuleMapping(entity.id);
            if (mapping && !cancelled) {
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
        } catch (mapErr) {
          log.warn('Failed to copy module mapping:', mapErr);
        }
      } catch (err) {
        log.error('Failed to duplicate profile:', err);
      } finally {
        if (!cancelled) setDuplicateLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [duplicateProfileId, duplicateLoaded]);

  // ── Focus-time auto-name re-derivation (duplicate flow) ─────────────────────
  // Guards against the reported bug: duplicating the SAME source AI twice in a
  // row. Stack navigation reuses this component, so after saving "Max 2" and
  // re-entering the duplicate flow for "Max", the name field still holds the
  // previous visit's "Max 2". If the field still contains the auto-assigned
  // name (not manually edited), recompute the next free copy number and bump it
  // ("Max 2" → "Max 3") so the user can never save a duplicate name.
  useFocusEffect(
    useCallback(() => {
      if (!duplicateProfileId || !duplicateProfile || !lastAutoNameRef.current) {
        return;
      }
      // Respect manual edits: only advance when the field still shows the name
      // we auto-assigned (compared via the live ref, avoiding stale closures).
      const current = nameRef.current?.trim() ?? '';
      const lastAuto = lastAutoNameRef.current.trim();
      if (current === '' || current !== lastAuto) {
        return;
      }
      let cancelled = false;
      (async () => {
        try {
          const nextName = await getNextEntityAliasCopy(duplicateProfile.name || 'Character');
          if (cancelled || nextName === lastAuto) return;
          lastAutoNameRef.current = nextName;
          setName(nextName);
        } catch (err) {
          log.warn('Failed to re-derive duplicate copy name on focus:', err);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [duplicateProfileId, duplicateProfile]),
  );

  // ── Apply copied module configs (from the duplicated partner) ────────────────
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
  useEffect(() => {
    if (!editProfileId || editLoaded) return;
    let cancelled = false;

    (async () => {
      try {
        const profile = await getCharacterProfile(editProfileId);
        if (!profile || cancelled) return;

        setName(profile.name);
        setDescription(profile.description ?? '');
        setPersonality(profile.personality ?? '');
        setAppearance(profile.appearance ?? '');
        setBackstory(profile.backstory ?? '');
        setVoiceCharacteristics(profile.voice_characteristics ?? '');
        setTypingSpeedWpm(String(profile.typing_speed_wpm ?? 60));
        setAudioResponseChance(String(profile.audio_response_chance_percent ?? 50));
        setBasePrompt(profile.base_prompt ?? '');
        setScenario(profile.scenario ?? '');
        setExampleDialogues(profile.example_dialogues ?? '');
        setEditOriginalName(profile.name);

        // Visibility (private/public/marketplace) — loaded from the client-only
        // sidecar + marketplace listing price.
        try {
          const visibility = await getCharacterProfileVisibility(profile.id);
          if (!cancelled) {
            setVisibility(visibility);
            setVisibilityLoaded(true);
          }
          try {
            const listing = await getMarketplaceListing(profile.id);
            if (listing && !cancelled) {
              setPriceSouls(String(listing.priceSouls));
            }
          } catch (priceErr) {
            log.warn('Failed to load profile price:', priceErr);
          }
        } catch (visErr) {
          log.warn('Failed to load profile visibility:', visErr);
          if (!cancelled) setVisibilityLoaded(true);
        }

        // Avatar (primary image)
        try {
          const images = await getCharacterImages(profile.id);
          if (cancelled) return;
          const primary = images.find(img => img.is_primary === true);
          if (primary && primary.image_data && primary.mime_type) {
            setAvatarBase64(primary.image_data);
            setAvatarMimeType(primary.mime_type);
            setAvatarUri(createDataURL(primary.image_data, primary.mime_type));
          }
          // Gallery images (all non-primary images)
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
          if (entity && !cancelled) {
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
      } finally {
        if (!cancelled) setEditLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [editProfileId, editLoaded]);

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

    setIsSaving(true);
    try {
      // ── EDIT MODE: update the existing AI partner in place ─────────────
      if (editProfileId) {
        const typingWpm = parseInt(typingSpeedWpm, 10);
        const audioChance = parseInt(audioResponseChance, 10);

        const current = await getCharacterProfile(editProfileId);
        if (!current) throw new Error('Profile not found');

        await updateCharacterProfile({
          ...current,
          name: trimmedName,
          description: description.trim() || '',
          personality: personality.trim() || '',
          appearance: appearance.trim() || '',
          backstory: backstory.trim() || '',
          voice_characteristics: voiceCharacteristics.trim() || '',
          typing_speed_wpm: Number.isFinite(typingWpm)
            ? Math.min(200, Math.max(1, typingWpm))
            : current.typing_speed_wpm,
          audio_response_chance_percent: Number.isFinite(audioChance)
            ? Math.min(100, Math.max(0, audioChance))
            : current.audio_response_chance_percent,
          base_prompt: basePrompt.trim() || '',
          scenario: scenario.trim() || '',
          example_dialogues: exampleDialogues.trim() || '',
        });

        // Persist the chosen visibility (private/public/marketplace) in the
        // sidecar + upsert/remove the marketplace listing + price.
        await setCharacterProfileVisibility(
          editProfileId,
          visibility as CharacterProfileVisibility,
        );
        if (visibility === 'marketplace') {
          const price = parseFloat(priceSouls);
          await upsertMarketplaceListing(
            editProfileId,
            Number.isFinite(price) ? Math.max(0, price) : 0,
          );
        } else {
          await removeMarketplaceListing(editProfileId);
        }

        // Reconcile images: delete the existing ones, then re-create from the
        // current UI state (avatar + gallery). This keeps the DB in exact sync
        // with what the user sees, whether they swapped the avatar, removed a
        // gallery tile, or added new ones.
        try {
          const existingImages = await getCharacterImages(editProfileId);
          for (const img of existingImages) {
            try {
              await deleteCharacterImage(img.id, true);
            } catch (delErr) {
              log.warn('Failed to delete edit image:', delErr);
            }
          }
        } catch (imgErr) {
          log.warn('Failed to load images for edit reconcile:', imgErr);
        }

        const hasAvatar = !!(avatarBase64 && avatarMimeType);
        if (hasAvatar) {
          await createCharacterImage({
            character_profile_id: editProfileId,
            image_data: avatarBase64!,
            mime_type: avatarMimeType!,
            description: '',
            is_primary: true,
            display_order: 0,
            vl_model_interpretation: '',
            vl_model: '',
            updated_at: new Date(),
          });
        }
        for (const [index, galleryImg] of galleryImages.entries()) {
          await createCharacterImage({
            character_profile_id: editProfileId,
            image_data: galleryImg.base64,
            mime_type: galleryImg.mimeType,
            description: galleryImg.description,
            is_primary: !hasAvatar && index === 0,
            display_order: index + 1,
            vl_model_interpretation: '',
            vl_model: '',
            updated_at: new Date(),
          });
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
        }

        // Fire-and-forget sync so the engine picks up the edits.
        syncService.initiateSync().catch(syncErr => {
          log.warn('Auto-sync after edit failed (non-critical):', syncErr);
        });

        navigation.goBack();
        return;
      }

      // ── Duplicate-flow save-time name guard ─────────────────────────────
      // The screen-level focus re-derivation normally keeps the auto-name in
      // sync, but a stale name can still reach the save (e.g. the CreateAI
      // component was remounted or the user opened the copy flow straight from
      // a context menu). Rather than fail with the "name already in use" alert
      // AND leave an orphaned profile, the DUPLICATE flow transparently
      // advances the auto-name to the next free copy number ("Max 2" → "Max 3")
      // so the 3rd copy of an AI is always named correctly — the reported bug.
      // Manual names (the user typed something) are NEVER rewritten; only the
      // auto-assigned copy name is bumped.
      let effectiveName = trimmedName;
      if (
        duplicateProfile &&
        lastAutoNameRef.current &&
        trimmedName === lastAutoNameRef.current.trim()
      ) {
        const autoName = await getNextEntityAliasCopy(duplicateProfile.name || 'Character');
        if (autoName && autoName !== trimmedName) {
          effectiveName = autoName;
          lastAutoNameRef.current = autoName;
          setName(autoName);
        }
      }
      const entityId = effectiveName;

      // 1. Either link an existing character profile (from the "From an
      //    Existing One" flow) or create a brand-new one.
      let profileId: string;
      if (prefillProfileId) {
        // Reuse the pre-existing profile — do NOT create a new persona.
        profileId = prefillProfileId;
      } else {
        profileId = uuidv4();

        // The NOT NULL text fields use empty string fallbacks, never null.
        const typingWpm = parseInt(typingSpeedWpm, 10);
        const audioChance = parseInt(audioResponseChance, 10);

        await createCharacterProfile({
          id: profileId,
          name: effectiveName,
          description: description.trim() || '',
          personality: personality.trim() || '',
          appearance: appearance.trim() || '',
          backstory: backstory.trim() || '',
          voice_characteristics: voiceCharacteristics.trim() || '',
          typing_speed_wpm: Number.isFinite(typingWpm) ? Math.min(200, Math.max(1, typingWpm)) : 60,
          audio_response_chance_percent: Number.isFinite(audioChance)
            ? Math.min(100, Math.max(0, audioChance))
            : 50,
          // When duplicating, the prompt fields are prefilled from the source
          // profile — the editable state values carry over faithfully. Vision
          // config + lifecycle config are carried over only from the source.
          vision_config_id: duplicateProfile?.vision_config_id ?? null,
          lifecycle_config: duplicateProfile?.lifecycle_config ?? '{}',
          base_prompt: basePrompt.trim() || '',
          scenario: scenario.trim() || '',
          example_dialogues: exampleDialogues.trim() || '',
        });
        // Tag as user-created so it is hidden from the Discover community grid
        await setCharacterProfileSource(profileId, 'user');

        // Persist the chosen visibility (private/public/marketplace). Public
        // partners appear on Discover; private ones stay hidden; marketplace
        // partners get listed on the Market screen with their SOUL price.
        await setCharacterProfileVisibility(
          profileId,
          visibility as CharacterProfileVisibility,
        );
        if (visibility === 'marketplace') {
          const price = parseFloat(priceSouls);
          await upsertMarketplaceListing(
            profileId,
            Number.isFinite(price) ? Math.max(0, price) : 0,
          );
        }

        // Record the cloud user who created this AI (creator badge + the
        // creator-only Edit Profile / Edit AI Settings buttons depend on it).
        if (user?.id) {
          try {
            await setCharacterCreator({
              profileId,
              creatorUserId: user.id,
              creatorDisplayName: user.display_name || user.email?.split('@')[0] || 'Creator',
              creatorAvatarUrl: user.avatar_url ?? null,
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

      // 3. Create entity with alias = name (unique among non-deleted entities)
      try {
        await createEntity({
          id: entityId,
          alias: effectiveName,
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
          // Roll back ONLY the brand-new profile created in step 1 so a failed
          // attempt cannot leave an orphaned "Name 2" duplicate in the
          // Characters list — the reported bug showed a "name already in use"
          // alert AND the copy still appearing. The prefill-link flow
          // (prefillProfileId, no duplicate) reuses an EXISTING profile, so
          // nothing needs rolling back there — the entity insert simply fails.
          // For a fresh duplicate the entity insert failed, so the cascade
          // soft-deletes just the profile (+ any created images/sidecars).
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

      // 4. Resolve module config ids. When the user picked none, auto-create
      //    the Soulbits Cloud default configs in the background so the
      //    partner is chat-ready immediately.
      let resolvedBackend = backendConfigId || null;
      let resolvedCognition = cognitionConfigId || null;
      let resolvedTts = ttsConfigId || null;
      let resolvedStt = sttConfigId || null;
      let resolvedVision = visionConfigId || null;
      let resolvedRag = ragConfigId || null;
      let resolvedImagination = imaginationConfigId || null;
      let resolvedMovement = movementConfigId || null;

      const anySelected =
        resolvedBackend ||
        resolvedCognition ||
        resolvedTts ||
        resolvedStt ||
        resolvedVision ||
        resolvedRag ||
        resolvedImagination ||
        resolvedMovement;

      if (!anySelected) {
        log.info('No module configs selected — applying Soulbits Cloud defaults.');
        const defaults = await ensureSoulbitsDefaultConfigs();
        resolvedBackend = defaults.backendConfigId;
        resolvedCognition = defaults.cognitionConfigId;
        resolvedTts = defaults.ttsConfigId;
        resolvedStt = defaults.sttConfigId;
        resolvedVision = defaults.visionConfigId;
        resolvedRag = defaults.ragConfigId;
        resolvedImagination = defaults.imaginationConfigId;
        resolvedMovement = defaults.movementConfigId;
      }

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

      // 6. Push the new entity (and its profile/mapping) to the engine.
      //    Fire-and-forget — a full syncAndWait here can block the save for
      //    up to 45s (e.g. the engine waiting on a size-estimate confirmation),
      //    which made saving feel like it "takes forever". The entity is
      //    persisted locally either way; any leftover engine state is picked
      //    up by the next opportunistic sync.
      try {
        syncService.initiateSync().catch(syncErr => {
          log.warn('Auto-sync after entity creation failed (non-critical):', syncErr);
        });
      } catch (syncErr) {
        log.warn('Auto-sync after entity creation failed (non-critical):', syncErr);
      }

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

  const anyConfigSelected = () =>
    !!(
      backendConfigId ||
      cognitionConfigId ||
      ttsConfigId ||
      sttConfigId ||
      visionConfigId ||
      ragConfigId ||
      imaginationConfigId ||
      movementConfigId
    );

  const renderField = (
    labelKey: string,
    placeholderKey: string,
    value: string,
    onChange: (v: string) => void,
    field: typeof focusedField,
    multiline = false,
    icon: string,
  ) => {
    const focused = focusedField === field;
    return (
      <View style={styles.fieldGroup}>
        <ThemedText size={12} variant="secondary" weight="medium" style={styles.fieldLabel}>
          {t(labelKey)}
        </ThemedText>
        <View
          style={[
            styles.inputShell,
            multiline && styles.multilineShell,
            {
              backgroundColor: hexToRgba(surfaceColor, 0.55),
              borderColor: focused ? accent : theme.colors.border.default,
            },
          ]}
        >
          <Icon
            name={icon}
            size={20}
            color={focused ? accent : theme.colors.text.muted}
            style={multiline ? styles.multilineIcon : undefined}
          />
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
            numberOfLines={multiline ? 3 : 1}
            textAlignVertical={multiline ? 'top' : undefined}
            autoCorrect={false}
          />
        </View>
      </View>
    );
  };

  return (
    <ThemedView style={styles.container}>
      {/* ── Header ── */}
      <ScreenHeader
        title={
          editProfileId
            ? t('editTitle', { name: editOriginalName || name })
            : duplicateProfile
            ? t('duplicateTitle', { name: duplicateProfile.name })
            : t('title')
        }
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
        >
          {/* ══════════════════ 1. GENERAL ══════════════════ */}
          <ThemedCard elevated accentStripe style={styles.section}>
            <SectionHeader title={t('sectionGeneral')} />

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
              {/* Name (required) */}
              {renderField(
                'nameLabel',
                'namePlaceholder',
                name,
                setName,
                'name',
                false,
                'account-edit',
              )}

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

          {/* ══════════════════ 2. DETAILS ══════════════════ */}
          <ThemedCard elevated accentStripe style={styles.section}>
            <TouchableOpacity
              onPress={() => setShowDetails(prev => !prev)}
              activeOpacity={0.7}
            >
              <SectionHeader
                title={t('sectionDetails')}
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
                {/* ── Visibility & Sharing ── */}
                <ThemedText size={12} variant="accent" weight="bold" style={styles.groupLabel}>
                  {t('visibilityLabel')}
                </ThemedText>

                {/* 3-way selector: Private / Public / Marketplace */}
                <View
                  style={[
                    styles.visibilityRow,
                    {
                      backgroundColor: hexToRgba(surfaceColor, 0.55),
                      borderColor: hexToRgba(accent, 0.25),
                    },
                  ]}
                >
                  <View style={styles.visibilityIconWrap}>
                    <Icon
                      name={
                        visibility === 'private'
                          ? 'lock-outline'
                          : visibility === 'public'
                          ? 'earth'
                          : 'storefront-outline'
                      }
                      size={22}
                      color={accent}
                    />
                  </View>
                  <View style={styles.visibilityLabelGroup}>
                    <ThemedText size={15} weight="bold" variant="primary">
                      {visibility === 'private'
                        ? t('visibilityPrivate')
                        : visibility === 'public'
                        ? t('visibilityPublic')
                        : t('visibilityMarketplace')}
                    </ThemedText>
                    <ThemedText size={12} variant="muted">
                      {visibility === 'private'
                        ? t('visibilityPrivateHint')
                        : visibility === 'public'
                        ? t('visibilityPublicHint')
                        : t('visibilityMarketplaceHint')}
                    </ThemedText>
                  </View>
                </View>

                {/* Segment picker: Private | Public | Marketplace */}
                <View style={styles.visibilitySegments}>
                  {(
                    [
                      { key: 'private', icon: 'lock-outline', label: t('visibilityPrivate') },
                      { key: 'public', icon: 'earth', label: t('visibilityPublic') },
                      { key: 'marketplace', icon: 'storefront-outline', label: t('visibilityMarketplace') },
                    ] as const
                  ).map(seg => {
                    const active = visibility === seg.key;
                    return (
                      <TouchableOpacity
                        key={seg.key}
                        onPress={() => {
                          hapticLightPress();
                          setVisibility(seg.key);
                        }}
                        activeOpacity={0.8}
                        disabled={!visibilityLoaded && !!editProfileId}
                        testID={`create-ai-visibility-${seg.key}`}
                        accessibilityRole="button"
                        accessibilityLabel={seg.label}
                        style={[
                          styles.visibilitySegment,
                          {
                            backgroundColor: active
                              ? hexToRgba(accent, 0.18)
                              : hexToRgba(surfaceColor, 0.45),
                            borderColor: active
                              ? accent
                              : theme.colors.border.default,
                          },
                        ]}
                      >
                        <Icon
                          name={seg.icon}
                          size={16}
                          color={active ? accent : theme.colors.text.muted}
                        />
                        <ThemedText
                          size={12}
                          weight={active ? 'bold' : 'medium'}
                          variant={active ? 'primary' : 'muted'}
                          numberOfLines={1}
                          style={styles.visibilitySegmentLabel}
                        >
                          {seg.label}
                        </ThemedText>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* SOUL price (marketplace only) */}
                {visibility === 'marketplace' && (
                  <View style={styles.priceRow}>
                    <View style={styles.priceInputWrap}>
                      <ThemedText size={13} variant="secondary" numberOfLines={1} style={styles.numericFieldLabel}>
                        {t('priceSoulsLabel')}
                      </ThemedText>
                      <View
                        style={[
                          styles.inputShell,
                          {
                            backgroundColor: hexToRgba(surfaceColor, 0.55),
                            borderColor:
                              focusedField === 'price'
                                ? accent
                                : theme.colors.border.default,
                          },
                        ]}
                      >
                        <SoulIcon size={18} />
                        <TextInput
                          style={[styles.input, styles.numericInput, inputTextStyle]}
                          value={priceSouls}
                          onChangeText={setPriceSouls}
                          onFocus={() => setFocusedField('price')}
                          onBlur={() => setFocusedField(null)}
                          placeholder="100"
                          placeholderTextColor={theme.colors.text.muted}
                          keyboardType="numeric"
                          returnKeyType="done"
                          testID="create-ai-marketplace-price"
                        />
                      </View>
                    </View>
                    <ThemedText size={11} variant="muted" style={styles.priceHint}>
                      {t('priceSoulsHint')}
                    </ThemedText>
                  </View>
                )}

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
                {/* Appearance */}
                {renderField(
                  'appearanceLabel',
                  'appearancePlaceholder',
                  appearance,
                  setAppearance,
                  'appearance',
                  true,
                  'human-handsup',
                )}
                {/* Backstory */}
                {renderField(
                  'backstoryLabel',
                  'backstoryPlaceholder',
                  backstory,
                  setBackstory,
                  'backstory',
                  true,
                  'book-open-page-variant-outline',
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
                          backgroundColor: hexToRgba(surfaceColor, 0.55),
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
                          backgroundColor: hexToRgba(surfaceColor, 0.55),
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

                {/* ── Images gallery ── */}
                <ThemedText size={12} variant="accent" weight="bold" style={styles.groupLabel}>
                  {t('imagesLabel')}
                </ThemedText>

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
          </ThemedCard>

          {/* ══════════════════ 3. ADVANCED ══════════════════ */}
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
                {/* "No config selected — Soulbits Cloud defaults" — shown at the
                    TOP of the Advanced section (before any module pickers) so the
                    user sees it before choosing configs, not buried at the bottom. */}
                {!anyConfigSelected() && hasAnyConfigs !== null && (
                  <View style={styles.defaultHint}>
                    <Icon name="creation" size={16} color="#e2e8f0" />
                    <ThemedText size={13} weight="medium" style={styles.defaultHintText}>
                      {t('defaultConfigNote')}
                    </ThemedText>
                  </View>
                )}

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
                    created, or edited right here. Every slot is pre-selected
                    with the Soulbits Cloud default config (never "Disabled");
                    the sheet's "Create new config…" row opens ModuleConfigEdit. */}
                <ThemedText size={12} variant="accent" weight="bold" style={styles.groupLabel}>
                  {t('aiModelSection')}
                </ThemedText>
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

                <ThemedText size={12} variant="accent" weight="bold" style={styles.groupLabel}>
                  {t('voiceSection')}
                </ThemedText>
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

                <ThemedText size={12} variant="accent" weight="bold" style={styles.groupLabel}>
                  {t('configSection')}
                </ThemedText>
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
  defaultHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  defaultHintText: {
    flex: 1,
    color: '#e2e8f0',
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

  // ── Visibility & sharing (3-way selector) ──
  visibilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  visibilityIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  visibilityLabelGroup: {
    flex: 1,
    gap: 2,
  },
  visibilitySegments: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
  },
  visibilitySegment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 6,
  },
  visibilitySegmentLabel: {
    flexShrink: 1,
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
