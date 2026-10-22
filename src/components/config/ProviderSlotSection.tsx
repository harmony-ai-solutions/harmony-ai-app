/**
 * ProviderSlotSection — one provider slot of the module-config form
 * (provider-registry 6-3, plan §7; reworked config-and-partner-ux 1-3 / 2-2 /
 * 2-3 / 3-1..3-8).
 *
 * Renders the final flow for a single slot:
 *
 *   General & Provider (optional Config Name + provider type chips + inline
 *   account picker) → Capability (engine-registry-backed model picker,
 *   module-scoped capability fields, sampling preset, model-gated TTS
 *   controls, supported-params 2-column grid + collapsed unsupported drawer).
 *
 * The parent (ModuleConfigEditScreen) owns the slot STATE (provider type,
 * `provider_account_id`, capability overlay) and the module-level sections; this
 * component owns the transient live-discovery state and the account-switch
 * revalidation (plan §3.2): when the account changes it debounces a live fetch
 * and marks an overlay model/voice ref stale when the new account's list lacks
 * it — never dropping the value.
 *
 * `singleCard` collapses General & Provider + Capability into ONE card (used by
 * the STT stage editor), while `footerContent` appends a module-owned section
 * (RAG's Embedding Concurrency) to the bottom of the capability card.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { ThemedCard } from '../themed/ThemedCard';
import { SectionHeader } from '../themed/SectionHeader';
import { ThemedText } from '../themed/ThemedText';
import { FormField } from './FormField';
import { AccountPicker } from './AccountPicker';
import { CatalogModelSelect } from './CatalogModelSelect';
import { VoicePicker } from './VoicePicker';
import { SelectPicker } from './SelectPicker';
import { SoulbitsModelSelect } from './SoulbitsModelSelect';
import { SamplingPresetSelect } from './SamplingPresetSelect';
import { AdvancedSamplingParams } from './AdvancedSamplingParams';
import { VoiceProfileBar } from './VoiceProfileBar';
import { VoiceCloneAndDesignSection } from './VoiceCloneAndDesignSection';
import { useAppTheme } from '../../contexts/ThemeContext';
import { useProviderModels } from '../../hooks/useProviderModels';
import { useProviderCapabilityCatalog } from '../../hooks/useProviderCapabilityCatalog';
import {
  catalogModelsForModule,
  findModel,
  getSpeechOptions,
  resolveEffectiveSpeechOptions,
  isSamplingParamKey,
  isParamSupported,
  partitionFieldsBySupport,
  type SpeechOptionsMeta,
} from '../../constants/modelCapabilities';
import {
  getProviderFieldsForModule,
  LLM_CHAT_MODULES,
} from '../../constants/providerFieldSchemas';
import type { FieldDefinition } from '../../constants/providerFieldSchemas';
import { isSimpleFieldKey } from '../../constants/moduleConfigVisibility';
import { hapticLightPress } from '../../utils/haptics';
import type { ProviderOption } from '../../constants/moduleConfiguration';
import type { ProviderAccount } from '../../database/models';

/** The OpenAI-family providers whose extra sampling params render in Advanced. */
const OPENAI_FAMILY = ['openai', 'openaicompatible', 'openrouter', 'google', 'xai', 'anthropic'];

/** TTS providers whose named voice profiles live under `/api/voices`. */
const VOICE_PROFILE_PROVIDERS = ['soulvoice', 'soulbitscloud'];

/** TTS providers with a voice cloning / voice design workflow. */
const VOICE_CLONE_PROVIDERS = ['soulbitscloud', 'soulvoice', 'elevenlabs'];

/** TTS providers that get the side-by-side Language + Base Voice dropdowns. */
const SOUL_TTS_PROVIDERS = ['soulbitscloud', 'soulvoice'];

/** Fallback picker lists when the model metadata declares none. */
const FALLBACK_TTS_LANGUAGES = ['Auto', 'EN', 'DE', 'FR', 'ES', 'IT', 'PT', 'JA', 'KO', 'ZH'];
const FALLBACK_TTS_VOICES = ['Claire', 'Bella', 'Nova', 'Alloy', 'Echo', 'Shimmer'];

/** Engine sentinel written when a slot is deliberately turned off. */
const DISABLED_PROVIDER = 'disabled';

/** Module → capability-card title key (matches the HTML design previews). */
const CAPABILITY_TITLE_KEYS: Record<string, string> = {
  backend: 'capabilityChat',
  cognition: 'capabilityCognitionLlm',
  movement: 'capabilityMovementLlm',
  rag: 'capabilityEmbeddings',
  tts: 'voiceDesignCapability',
  vision: 'capabilityMultimodalVision',
  imagination: 'capabilityImageGeneration',
};

/**
 * TTS fields that stay visible in Simple mode even though they are not in the
 * global SIMPLE_FIELD_KEYS list (the ElevenLabs 2×2 slider grid + boost row).
 */
const TTS_SIMPLE_EXTRA_KEYS: ReadonlySet<string> = new Set([
  'stability',
  'similarity_boost',
  'style',
  'speaker_boost',
]);

/**
 * Acoustic / prosody (and extended generation) keys that are gated by a TTS
 * model's `meta.speech_options.supported_generation_params` (Phase 3-5).
 */
const TTS_MODEL_GATED_KEYS: ReadonlySet<string> = new Set([
  'pitch',
  'energy',
  'style',
  'seed',
  'speed',
  'exaggeration',
  'cfg_weight',
  'norm_loudness',
  'temperature',
  'repetition_penalty',
  'top_p',
  'top_k',
  'min_p',
]);

export interface SlotState {
  providerType: string;
  accountId: string | null;
  capability: Record<string, any>;
}

export interface ProviderSlotSectionProps {
  slot: string;
  slotLabel: string;
  /** The module whose models are offered ('stt' / 'vad' / the module id). */
  modelModuleType: string;
  providerOptions: ProviderOption[];
  state: SlotState;
  /** Accounts of `state.providerType`. */
  accounts: ProviderAccount[];
  showAdvanced: boolean;
  explicitFields: Record<string, boolean>;
  /** Unified `General & Provider` card: current module config name. */
  configName?: string;
  onConfigNameChange?: (name: string) => void;
  /** Renders the compact `Simple | Advanced` switch in the Capability header. */
  onToggleAdvanced?: (next: boolean) => void;
  onProviderChange: (type: string) => void;
  onAccountChange: (accountId: string | null) => void;
  onCapabilityChange: (key: string, value: any) => void;
  onAddAccount: () => void;
  /** Module-owned content appended to the bottom of the capability card. */
  footerContent?: React.ReactNode;
  /** Collapse General & Provider + Capability into one card (STT stages). */
  singleCard?: boolean;
  /** Single-card mode: SectionHeader title (e.g. "STAGE 1: VAD…"). */
  cardTitle?: string;
  /** Single-card mode: right-hand badge text. */
  cardBadge?: string;
  /** Adds a `Disabled` provider chip. */
  allowDisable?: boolean;
  /** Chip label override (default: `disabledPushToTalk`). */
  disableLabel?: string;
  /** Clears (or disables) the slot's provider (used by the Disabled chip). */
  onDisableSlot?: () => void;
}

/**
 * Pair adjacent `width: 'half'` fields into a single 2-column row while
 * full-width fields occupy their own 1-element row (Phase 2-2 / 3-1).
 *
 * Pure and exported so the module-settings renderers (Cognition, Movement,
 * RAG, Vision, STT buffer) share the exact same layout pass.
 */
export function groupFieldsIntoRows(fields: FieldDefinition[]): FieldDefinition[][] {
  const rows: FieldDefinition[][] = [];
  let pendingHalf: FieldDefinition | null = null;

  for (const field of fields) {
    if (field.width === 'half') {
      if (pendingHalf) {
        rows.push([pendingHalf, field]);
        pendingHalf = null;
      } else {
        pendingHalf = field;
      }
    } else {
      if (pendingHalf) {
        rows.push([pendingHalf]);
        pendingHalf = null;
      }
      rows.push([field]);
    }
  }

  if (pendingHalf) rows.push([pendingHalf]);
  return rows;
}

/**
 * One gateway-style language descriptor (`soulbitscloud` speech_options):
 * `{code, name, voices}` — voices scoped to that language. Soulvoice's plain
 * language-name strings never become these.
 */
interface TtsLanguageScope {
  code?: string;
  name?: string;
  language?: string;
  id?: string;
  voices?: unknown;
}

/** One voice entry after normalization. */
interface TtsVoiceOption {
  id: string;
  name: string;
}

/** Normalize one voice list: strings or objects keyed id/name/voice. */
function collectVoiceOptions(list: unknown): TtsVoiceOption[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((raw): TtsVoiceOption => {
      if (typeof raw === 'string') {
        return { id: raw, name: raw };
      }
      const entry = (raw ?? {}) as { id?: unknown; name?: unknown; voice?: unknown };
      const id = String(entry.id ?? entry.name ?? entry.voice ?? '');
      return { id, name: String(entry.name ?? id) };
    })
    .filter((voice) => voice.id !== '');
}

/** The descriptor id of a language entry (gateway `code`, soulvoice name, …). */
function languageScopeId(entry: TtsLanguageScope): string {
  return String(entry.code ?? entry.language ?? entry.id ?? entry.name ?? '').trim();
}

/**
 * Normalize a model's `speech_options.languages` into `{id, name}` picker
 * options. Declared shapes (research soulvoice §3.2, gateway `SpeechOptions`):
 *  - soulvoice live: plain names — `["default", "en", …]`
 *  - soulbitscloud gateway: descriptors — `[{code, name, voices}, …]`
 * `String(code)` over the gateway's objects produced the "[object Object]"
 * rows (owner report, 2026-10-22) — the id is now read from the fields.
 */
export function normalizeTtsLanguageOptions(
  languages: SpeechOptionsMeta['languages'],
): Array<{ id: string; name: string }> {
  const list =
    languages && languages.length > 0 ? languages : FALLBACK_TTS_LANGUAGES;
  return list
    .map((entry) => {
      if (typeof entry === 'string') {
        return { id: entry, name: entry };
      }
      const id = languageScopeId(entry as TtsLanguageScope);
      const name = String((entry as TtsLanguageScope).name ?? id);
      return { id, name };
    })
    .filter((option) => option.id !== '');
}

/**
 * Normalize a model's selectable voices into `{id, name}` picker options,
 * tolerant of every declared shape:
 *  - flat strings (`soulbitscloud` gateway — present only when the model
 *    accepts `voice` WITHOUT a language scope, e.g. KittenTTS)
 *  - descriptor objects keyed `voice` (`{voice, language?, styles?}` —
 *    soulvoice live; the old normalizer only read `id`/`name`, so every
 *    soulvoice entry came out empty, got filtered, and the picker fell back
 *    to the generic list — the "voices never change with the model" report,
 *    owner 2026-10-22)
 *  - per-language voice scopes: when the model declares NO flat voices, the
 *    languages' own `voices` arrays are the source. A language that declares
 *    its own set SCOPES the picker to that set (Chatterbox Multilingual);
 *    with no language selected the union of every language's voices is shown.
 * Falls back to the generic list only when the model declares neither.
 */
export function normalizeTtsVoiceOptions(
  speechOptions: SpeechOptionsMeta | null | undefined,
  languageValue?: string | null,
): TtsVoiceOption[] {
  const selected = String(languageValue ?? '').trim().toLowerCase();
  const languageEntries = (speechOptions?.languages ?? []).flatMap((entry) =>
    typeof entry === 'object' && entry !== null ? [entry as TtsLanguageScope] : [],
  );

  // A selected language that declares its own voice set scopes the picker.
  const scoped = languageEntries.find((entry) => {
    const id = languageScopeId(entry);
    return id !== '' && id.toLowerCase() === selected;
  });
  if (scoped && Array.isArray(scoped.voices) && (scoped.voices as unknown[]).length > 0) {
    return collectVoiceOptions(scoped.voices);
  }

  // Union: the flat list plus every language's scoped voices.
  let flat = collectVoiceOptions(speechOptions?.voices);
  for (const entry of languageEntries) {
    flat = flat.concat(collectVoiceOptions(entry.voices));
  }
  const seen = new Set<string>();
  const union = flat.filter((voice) => {
    if (seen.has(voice.id)) return false;
    seen.add(voice.id);
    return true;
  });
  return union.length > 0
    ? union
    : FALLBACK_TTS_VOICES.map((voice) => ({ id: voice, name: voice }));
}

// ── Sibling components (Wave 2, same interfaces) ─────────────────────────────

export const ProviderSlotSection: React.FC<ProviderSlotSectionProps> = ({
  slot,
  slotLabel,
  modelModuleType,
  providerOptions,
  state,
  accounts,
  showAdvanced,
  explicitFields,
  configName,
  onConfigNameChange,
  onToggleAdvanced,
  onProviderChange,
  onAccountChange,
  onCapabilityChange,
  onAddAccount,
  footerContent,
  singleCard = false,
  cardTitle,
  cardBadge,
  allowDisable = false,
  disableLabel,
  onDisableSlot,
}) => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('moduleConfig');
  const { catalog } = useProviderCapabilityCatalog();
  const [unsupportedOpen, setUnsupportedOpen] = useState(false);

  const account = useMemo(
    () => accounts.find((a) => a.id === state.accountId) ?? null,
    [accounts, state.accountId],
  );

  const { models: liveModels, voices, fetching, error: fetchError, fetchNow, scheduleFetch } =
    useProviderModels({ type: state.providerType, account, module: modelModuleType });

  // Auto-select the sole account of the type (plan §7 auto-collapse).
  const singleId = accounts.length === 1 ? accounts[0].id : null;
  useEffect(() => {
    if (singleId && state.accountId !== singleId) {
      onAccountChange(singleId);
    }
  }, [singleId, state.accountId, onAccountChange]);

  // Account-switch revalidation (§3.2): debounced live fetch on every change
  // (incl. the initial load, so a persisted ref is revalidated).
  const prevAccountId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (state.accountId && prevAccountId.current !== state.accountId) {
      scheduleFetch();
    }
    prevAccountId.current = state.accountId;
  }, [state.accountId, scheduleFetch]);

  if (!theme) return null;

  const entries = liveModels ?? catalogModelsForModule(catalog[state.providerType], modelModuleType);
  // Imagination's xAI provider stores its image model under `image_model`
  // (never `model`), so both keys feed the model metadata lookup.
  const currentModelId = state.capability.model ?? state.capability.image_model ?? '';
  const selectedModel = findModel(entries, currentModelId);
  const modelStale =
    liveModels != null && !!currentModelId && !liveModels.some((m) => m.id === currentModelId);
  const voiceStale =
    voices != null &&
    !!state.capability.voice_id &&
    !voices.some((v) => v.voice_id === state.capability.voice_id);

  const speechOptions =
    modelModuleType === 'tts'
      ? resolveEffectiveSpeechOptions(selectedModel, currentModelId, state.providerType)
      : null;

  const isTts = modelModuleType === 'tts';
  const isSoulTts = isTts && SOUL_TTS_PROVIDERS.includes(state.providerType);
  const isElevenLabsTts = isTts && state.providerType === 'elevenlabs';
  const isOpenAiTts = isTts && state.providerType === 'openai';

  const sectionTitle = (section: string) => (slotLabel ? `${slotLabel} ${section}` : section);

  const capabilityTitleKey = CAPABILITY_TITLE_KEYS[modelModuleType];
  const capabilityTitle = capabilityTitleKey
    ? t(capabilityTitleKey)
    : sectionTitle(t('capability'));

  // ── Provider type chips (Phase 1-3: no redundant gradient pip) ──
  const isDisabledSelection =
    !state.providerType || state.providerType === DISABLED_PROVIDER;

  const renderProviderChips = () => (
    <View style={styles.providerChips}>
      {providerOptions.map((option) => {
        const isSelected = state.providerType === option.id;
        return (
          <TouchableOpacity
            key={`${slot}-${option.id}`}
            style={[
              styles.providerChip,
              {
                borderColor: isSelected
                  ? theme.colors.accent.primary
                  : theme.colors.border.default,
                backgroundColor: isSelected
                  ? theme.colors.accent.primary + '1A'
                  : theme.colors.background.base,
              },
            ]}
            onPress={() => onProviderChange(option.id)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
          >
            <ThemedText
              size={13}
              variant={isSelected ? 'accent' : 'primary'}
              weight={isSelected ? 'medium' : 'normal'}
            >
              {option.name}
            </ThemedText>
            {isSelected && (
              <Icon name="check" size={14} color={theme.colors.accent.primary} style={{ marginLeft: 4 }} />
            )}
          </TouchableOpacity>
        );
      })}

      {allowDisable && (
        <TouchableOpacity
          testID={`provider-disabled-${slot}`}
          style={[
            styles.providerChip,
            {
              borderColor: isDisabledSelection
                ? theme.colors.accent.primary
                : theme.colors.border.default,
              backgroundColor: isDisabledSelection
                ? theme.colors.accent.primary + '1A'
                : theme.colors.background.base,
            },
          ]}
          onPress={() => {
            hapticLightPress();
            onDisableSlot?.();
          }}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityState={{ selected: isDisabledSelection }}
        >
          <ThemedText
            size={13}
            variant={isDisabledSelection ? 'accent' : 'primary'}
            weight={isDisabledSelection ? 'medium' : 'normal'}
          >
            {disableLabel ?? t('disabledPushToTalk')}
          </ThemedText>
          {isDisabledSelection && (
            <Icon name="check" size={14} color={theme.colors.accent.primary} style={{ marginLeft: 4 }} />
          )}
        </TouchableOpacity>
      )}
    </View>
  );

  const renderProviderBlock = () => (
    <>
      <ThemedText size={13} variant="secondary" style={styles.fieldLabel}>
        {t('providerType')}
      </ThemedText>
      {renderProviderChips()}

      {state.providerType ? (
        <View style={styles.accountInline}>
          <AccountPicker
            slot={slot}
            providerType={state.providerType}
            accounts={accounts}
            selectedId={state.accountId}
            onSelect={onAccountChange}
            onAddAccount={onAddAccount}
          />
        </View>
      ) : null}
    </>
  );

  // ── Model metadata badge text (design parity across every module) ──
  const modelMetaBadge = (() => {
    if (modelModuleType === 'rag') {
      const dims = (selectedModel?.meta as Record<string, any> | undefined)?.embedding_dimensions;
      return dims !== undefined && dims !== null ? t('embeddingDimensions', { dims }) : null;
    }
    if (modelModuleType === 'tts') {
      return speechOptions?.supports_voice_cloning
        ? t('badgeTtsCloning')
        : t('badgeTtsMultiVoice');
    }
    if (modelModuleType === 'vision') return t('badgeVision');
    if (modelModuleType === 'imagination') {
      return state.providerType === 'comfyui' ? t('badgeComfyFetched') : t('badgeImage');
    }
    if (modelModuleType === 'stt') return t('badgeStt');
    if (modelModuleType === 'vad') return t('badgeVad');
    if (LLM_CHAT_MODULES.includes(modelModuleType as (typeof LLM_CHAT_MODULES)[number])) {
      return selectedModel?.capabilities?.includes('vision')
        ? t('badgeChatVision')
        : t('badgeChat');
    }
    return null;
  })();

  const modelLabelFor = (field: FieldDefinition): string => {
    if (modelModuleType === 'rag') return t('embeddingModel');
    if (modelModuleType === 'tts') return t('ttsModel');
    if (modelModuleType === 'imagination' && state.providerType === 'comfyui') {
      return t('checkpointModel');
    }
    return field.label;
  };

  // ── Model picker (catalog-backed; Soulbits Cloud keeps its own catalog) ──
  const renderModelField = (field: FieldDefinition) => {
    const label = modelLabelFor(field);

    return (
      <View key={field.key} style={styles.fieldWrap}>
        <View style={styles.modelLabelRow}>
          <ThemedText size={13} variant="secondary" style={styles.fieldLabelInline}>
            {label}
          </ThemedText>
          {modelMetaBadge ? (
            <View
              testID={
                modelModuleType === 'rag'
                  ? `embedding-dims-${slot}`
                  : `model-meta-${slot}`
              }
              style={[
                styles.metaBadge,
                {
                  borderColor: theme.colors.accent.secondary + '55',
                  backgroundColor: theme.colors.accent.secondary + '1A',
                },
              ]}
            >
              <ThemedText
                size={10}
                weight="medium"
                style={{ color: theme.colors.accent.secondary }}
              >
                {modelMetaBadge}
              </ThemedText>
            </View>
          ) : null}
        </View>

        {state.providerType === 'soulbitscloud' ? (
          <SoulbitsModelSelect
            moduleType={modelModuleType}
            value={state.capability[field.key] ?? ''}
            onChange={(m) => onCapabilityChange(field.key, m)}
          />
        ) : (
          <CatalogModelSelect
            providerType={state.providerType}
            moduleType={modelModuleType}
            value={state.capability[field.key] ?? ''}
            onChange={(m) => onCapabilityChange(field.key, m)}
            label={label}
            liveModels={liveModels}
            canFetch={account != null}
            fetching={fetching}
            fetchError={fetchError}
            onFetch={fetchNow}
            stale={modelStale}
          />
        )}

        {modelModuleType === 'rag' && (
          <ThemedText variant="muted" size={11} style={styles.hint}>
            {t('embeddingModelHint')}
          </ThemedText>
        )}
      </View>
    );
  };

  // ── One capability field ──
  const renderCapabilityField = (field: FieldDefinition, inUnsupportedDrawer = false) => {
    const isCatalogField =
      field.catalog === true ||
      (state.providerType === 'soulbitscloud' &&
        (field.key === 'model' || field.key === 'image_model'));

    if (isCatalogField) {
      return renderModelField(field);
    }

    if (field.key === 'voice_id' && state.providerType === 'elevenlabs') {
      return (
        <View key={field.key} style={styles.fieldWrap}>
          <ThemedText size={13} variant="secondary" style={styles.fieldLabel}>
            {t('voiceLiveCatalog')}
          </ThemedText>
          <VoicePicker
            label={t('voiceLiveCatalog')}
            value={state.capability.voice_id ?? ''}
            onChange={(id) => onCapabilityChange('voice_id', id)}
            voices={voices}
            stale={voiceStale}
          />
        </View>
      );
    }

    if (field.key === 'sampling_preset_name') {
      // SamplingPresetSelect renders its own header row inside `preset-box`,
      // so no extra label is emitted here (design parity, File 2).
      return (
        <View key={field.key} style={styles.fieldWrap}>
          <SamplingPresetSelect
            value={state.capability.sampling_preset_name ?? ''}
            onChange={(name) => onCapabilityChange('sampling_preset_name', name)}
            localValues={state.capability}
            explicitKeys={explicitFields}
            label={field.label}
          />
        </View>
      );
    }

    // R12 param warning (never a hard block). Fields in the collapsed drawer
    // get a single subtle subtitle instead of one orange pill each (Phase 2-2).
    const unsupported =
      !inUnsupportedDrawer &&
      isSamplingParamKey(field.key) &&
      isParamSupported(selectedModel, field.key) === false;

    return (
      <View key={field.key}>
        <FormField
          field={field}
          value={state.capability[field.key]}
          onChange={onCapabilityChange}
        />
        {unsupported && (
          <View
            testID={`param-warning-${slot}-${field.key}`}
            style={[styles.warnChip, { borderColor: theme.colors.status.warning }]}
          >
            <Icon name="alert-outline" size={12} color={theme.colors.status.warning} />
            <ThemedText size={11} style={{ color: theme.colors.status.warning }}>
              {t('paramUnsupported', { model: currentModelId })}
            </ThemedText>
          </View>
        )}
      </View>
    );
  };

  // ── Module-scoped capability fields (Phase 1-2 / 3-1..3-8) ──
  const gatedParams = speechOptions?.supported_generation_params;
  const declaredGatedParams =
    Array.isArray(gatedParams) && gatedParams.length > 0 ? new Set(gatedParams) : null;

  const moduleFields = getProviderFieldsForModule(state.providerType, modelModuleType).filter((f) => {
    if (f.key === 'name') return false;
    // TTS model-family gating: only show the acoustic/prosody params the
    // selected model declares (pitch/energy/style vs exaggeration/cfg_weight).
    if (
      modelModuleType === 'tts' &&
      declaredGatedParams &&
      TTS_MODEL_GATED_KEYS.has(f.key) &&
      !declaredGatedParams.has(f.key)
    ) {
      return false;
    }
    // Soulbits / Soulvoice TTS keeps Audio Format + Sample Rate in Advanced
    // mode (File 3 Tab 1), while OpenAI TTS shows Speed | Response Format in Simple.
    if (!showAdvanced && isSoulTts && (f.key === 'format' || f.key === 'sample_rate')) {
      return false;
    }
    if (
      !showAdvanced &&
      !isSimpleFieldKey(f.key) &&
      !(isTts && TTS_SIMPLE_EXTRA_KEYS.has(f.key))
    ) {
      return false;
    }
    // Unsupported sampling params are hidden in Simple mode (plan 6-3 step 3).
    if (
      !showAdvanced &&
      isSamplingParamKey(f.key) &&
      isParamSupported(selectedModel, f.key) === false
    ) {
      return false;
    }
    return true;
  });

  // Advanced: split model-supported fields from the truly unsupported ones.
  // Structural fields (model/voice/chips) are never "unsupported" — only
  // sampling params are partitioned.
  const structuralFields = moduleFields.filter((f) => !isSamplingParamKey(f.key));
  const samplingFields = moduleFields.filter((f) => isSamplingParamKey(f.key));
  const { supportedFields, unsupportedFields } = showAdvanced
    ? (() => {
        const { supportedFields: supportedSampling, unsupportedFields: unsupported } =
          partitionFieldsBySupport(samplingFields, selectedModel);
        return {
          supportedFields: [...structuralFields, ...supportedSampling],
          unsupportedFields: unsupported,
        };
      })()
    : { supportedFields: [...structuralFields, ...samplingFields], unsupportedFields: [] };

  const isLLMChatModule = LLM_CHAT_MODULES.includes(
    modelModuleType as (typeof LLM_CHAT_MODULES)[number],
  );
  const showAdvancedSampling =
    showAdvanced &&
    isLLMChatModule &&
    (OPENAI_FAMILY.includes(state.providerType) || state.providerType === 'soulbitscloud');

  const renderFieldRows = (fields: FieldDefinition[], prefix: string, inDrawer = false) =>
    groupFieldsIntoRows(fields).map((row) => (
      <View
        key={`${prefix}-${row.map((f) => f.key).join('-')}`}
        style={row.length > 1 ? styles.twoColRow : undefined}
      >
        {row.map((field) => (
          <View key={field.key} style={row.length > 1 ? styles.halfCol : undefined}>
            {renderCapabilityField(field, inDrawer)}
          </View>
        ))}
      </View>
    ));

  const renderUnsupportedDrawer = () => {
    if (!showAdvanced || unsupportedFields.length === 0) return null;
    const modelName = selectedModel?.label || selectedModel?.id || currentModelId;
    return (
      <View style={styles.unsupportedDrawerWrap}>
        <TouchableOpacity
          testID={`unsupported-params-drawer-${slot}`}
          onPress={() => {
            hapticLightPress();
            setUnsupportedOpen((open) => !open);
          }}
          accessibilityRole="button"
          accessibilityState={{ expanded: unsupportedOpen }}
          style={[styles.unsupportedDrawer, { borderColor: theme.colors.status.warning }]}
        >
          <Icon name="alert-outline" size={13} color={theme.colors.status.warning} />
          <ThemedText size={12} style={{ color: theme.colors.status.warning, flex: 1 }}>
            {unsupportedOpen
              ? t('unsupportedParamsHide', { count: unsupportedFields.length })
              : t('unsupportedParams', {
                  count: unsupportedFields.length,
                  model: modelName,
                })}
          </ThemedText>
          <Icon
            name={unsupportedOpen ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={theme.colors.status.warning}
          />
        </TouchableOpacity>
        {unsupportedOpen && (
          <View style={styles.unsupportedBody}>
            <ThemedText variant="muted" size={11} style={styles.hint}>
              {t('unsupportedParamsHint')}
            </ThemedText>
            {renderFieldRows(unsupportedFields, `${slot}-unsupported`, true)}
          </View>
        )}
      </View>
    );
  };

  const renderModeSwitch = () => {
    if (!onToggleAdvanced) return null;
    return (
      <View style={[styles.modeSegmented, { backgroundColor: theme.colors.background.base }]}>
        <TouchableOpacity
          testID="mode-simple-button"
          onPress={() => {
            hapticLightPress();
            onToggleAdvanced(false);
          }}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityState={{ selected: !showAdvanced }}
          style={[styles.modeSegment, !showAdvanced && styles.modeSegmentActive]}
        >
          {!showAdvanced && (
            <LinearGradient
              colors={[theme.colors.accent.primary, theme.colors.accent.secondary]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
          )}
          <ThemedText
            size={11}
            weight="medium"
            variant={showAdvanced ? 'secondary' : 'primary'}
            style={!showAdvanced ? styles.modeSegmentActiveText : undefined}
          >
            {t('modeSimple')}
          </ThemedText>
        </TouchableOpacity>
        <TouchableOpacity
          testID="mode-advanced-button"
          onPress={() => {
            hapticLightPress();
            onToggleAdvanced(true);
          }}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityState={{ selected: showAdvanced }}
          style={[styles.modeSegment, showAdvanced && styles.modeSegmentActive]}
        >
          {showAdvanced && (
            <LinearGradient
              colors={[theme.colors.accent.primary, theme.colors.accent.secondary]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
          )}
          <ThemedText
            size={11}
            weight="medium"
            variant={showAdvanced ? 'primary' : 'secondary'}
            style={showAdvanced ? styles.modeSegmentActiveText : undefined}
          >
            {t('modeAdvanced')}
          </ThemedText>
        </TouchableOpacity>
      </View>
    );
  };

  const renderCardBadge = () => {
    if (!cardBadge) return null;
    const color = allowDisable ? theme.colors.status.success : theme.colors.accent.primary;
    return (
      <View
        style={[
          styles.cardBadge,
          { borderColor: color + '66', backgroundColor: color + '1A' },
        ]}
      >
        <ThemedText size={10} weight="medium" style={{ color }}>
          {cardBadge}
        </ThemedText>
      </View>
    );
  };

  const showVoiceProfileBar =
    modelModuleType === 'tts' && VOICE_PROFILE_PROVIDERS.includes(state.providerType);
  const showVoiceClone =
    modelModuleType === 'tts' && VOICE_CLONE_PROVIDERS.includes(state.providerType);
  const selectedVoiceName =
    state.capability.voice_name ??
    state.capability.voice ??
    state.capability.voice_id ??
    '';

  // ── TTS: Language + Base Voice dropdowns (soulbitscloud / soulvoice) ──
  const renderTtsVoiceAndLanguage = () => {
    // A value saved while the descriptor bug was live can be the literal
    // "[object Object]" string (the old picker's option ids were
    // `String(languageObject)`); render that as unset instead of keeping it
    // as a phantom option row.
    const cleanPickerValue = (raw: string): string =>
      raw.includes('[object Object]') ? '' : raw;
    const languageValue = cleanPickerValue(String(state.capability.language ?? ''));
    const voiceValue = cleanPickerValue(String(state.capability.voice ?? ''));

    const languageOptions = normalizeTtsLanguageOptions(speechOptions?.languages);
    if (languageValue && !languageOptions.some((o) => o.id === languageValue)) {
      languageOptions.push({ id: languageValue, name: languageValue });
    }

    // Voice list follows the model (and, on the gateway's per-language models,
    // the selected language) — never the generic fallback while the model
    // declares its own voices.
    const voiceOptions = normalizeTtsVoiceOptions(speechOptions, languageValue);
    if (voiceValue && !voiceOptions.some((o) => o.id === voiceValue)) {
      voiceOptions.push({ id: voiceValue, name: voiceValue });
    }

    return (
      <View style={styles.twoColRow}>
        <View style={styles.halfCol}>
          <ThemedText size={13} variant="secondary" style={styles.fieldLabel}>
            {t('language')}
          </ThemedText>
          <SelectPicker
            label={t('language')}
            value={languageValue}
            options={languageOptions}
            onChange={(value) => onCapabilityChange('language', value)}
            placeholder={t('language')}
          />
        </View>
        <View style={styles.halfCol}>
          <ThemedText size={13} variant="secondary" style={styles.fieldLabel}>
            {t('baseVoice')}
          </ThemedText>
          <SelectPicker
            label={t('baseVoice')}
            value={voiceValue}
            options={voiceOptions}
            onChange={(value) => onCapabilityChange('voice', value)}
            placeholder={t('baseVoice')}
          />
        </View>
      </View>
    );
  };

  // ── Capability body: TTS gets the design's exact top-to-bottom order ──
  const renderCapabilityContent = () => {
    if (modelModuleType === 'tts') {
      const modelField = supportedFields.find(
        (f) => f.catalog === true || f.key === 'model' || f.key === 'image_model',
      );
      const handled = new Set<string>();
      if (modelField) handled.add(modelField.key);
      if (isSoulTts) {
        handled.add('voice');
        handled.add('language');
        handled.add('voice_config_file');
      }
      if (isElevenLabsTts) {
        handled.add('voice_id');
        // `model_id` is a legacy secondary id already covered by `model`.
        handled.add('model_id');
      }
      if (isOpenAiTts) {
        handled.add('voice');
        handled.add('instructions');
      }

      const remaining = supportedFields.filter((f) => !handled.has(f.key));

      const voiceField = isOpenAiTts
        ? supportedFields.find((f) => f.key === 'voice')
        : undefined;
      const instructionsField = isOpenAiTts
        ? supportedFields.find((f) => f.key === 'instructions')
        : undefined;

      // Detect 3-column OpenVoice / HarmonySpeech trio (speed, pitch, energy)
      // vs Chatterbox duo (exaggeration, cfg_weight) vs ElevenLabs voice settings.
      const openVoiceTrioKeys = ['speed', 'pitch', 'energy'];
      const hasOpenVoiceTrio =
        isSoulTts &&
        openVoiceTrioKeys.every((k) => remaining.some((f) => f.key === k)) &&
        !remaining.some((f) => f.key === 'exaggeration');
      const openVoiceTrioFields = hasOpenVoiceTrio
        ? openVoiceTrioKeys
            .map((k) => remaining.find((f) => f.key === k)!)
            .filter(Boolean)
        : [];
      const hasChatterbox =
        isSoulTts && remaining.some((f) => f.key === 'exaggeration' || f.key === 'cfg_weight');
      const chatterboxPairFields = hasChatterbox
        ? remaining.filter((f) => f.key === 'exaggeration' || f.key === 'cfg_weight')
        : [];
      const paralinguisticTags =
        speechOptions?.paralinguistic_tags && speechOptions.paralinguistic_tags.length > 0
          ? speechOptions.paralinguistic_tags
          : hasChatterbox
            ? ['[laughter]', '[sigh]', '[gasp]', '[chuckle]', '[clears throat]']
            : [];

      const afterProsodyRemaining = remaining.filter((f) => {
        if (hasOpenVoiceTrio && openVoiceTrioKeys.includes(f.key)) return false;
        if (hasChatterbox && (f.key === 'exaggeration' || f.key === 'cfg_weight')) return false;
        return true;
      });

      return (
        <>
          {showVoiceProfileBar && (
            <VoiceProfileBar
              selectedVoiceName={selectedVoiceName}
              capability={state.capability}
              onSelectProfile={(voiceName, loadedConfig) => {
                onCapabilityChange('voice_config_file', voiceName);
                if (loadedConfig) {
                  for (const [key, value] of Object.entries(loadedConfig)) {
                    onCapabilityChange(key, value);
                  }
                }
              }}
            />
          )}

          {/* 1 — Model, always first */}
          {modelField ? renderModelField(modelField) : null}

          {/* 2 — Voice cloning / design workflows, immediately below the model */}
          {showVoiceClone && (
            <VoiceCloneAndDesignSection
              providerType={state.providerType}
              accountId={state.accountId}
              selectedModel={selectedModel ?? null}
              capability={state.capability}
              onCapabilityChange={onCapabilityChange}
              onVoiceCloned={(voiceId) => onCapabilityChange('voice_id', voiceId)}
            />
          )}

          {/* 3 — Voice + language pickers */}
          {isSoulTts && renderTtsVoiceAndLanguage()}
          {isElevenLabsTts &&
            supportedFields
              .filter((f) => f.key === 'voice_id')
              .map((field) => renderCapabilityField(field))}
          {isOpenAiTts && voiceField && renderCapabilityField(voiceField)}
          {isOpenAiTts && instructionsField && renderCapabilityField(instructionsField)}

          {/* 4a — OpenVoice V2 3-column Voice Modulation & Prosody */}
          {hasOpenVoiceTrio && (
            <View style={styles.prosodyBlock}>
              <View style={styles.modelLabelRow}>
                <ThemedText size={12} variant="secondary" weight="medium">
                  Voice Modulation &amp; Prosody (generation_options)
                </ThemedText>
                <View
                  style={[
                    styles.metaBadge,
                    {
                      borderColor: 'rgba(56, 189, 248, 0.35)',
                      backgroundColor: 'rgba(56, 189, 248, 0.14)',
                    },
                  ]}
                >
                  <ThemedText size={10} weight="medium" style={{ color: '#38BDF8' }}>
                    {selectedModel?.label || currentModelId || 'OpenVoice V2'}
                  </ThemedText>
                </View>
              </View>
              <View style={styles.threeColRow}>
                {openVoiceTrioFields.map((field) => (
                  <View key={field.key} style={styles.thirdCol}>
                    {renderCapabilityField(field)}
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* 4b — Chatterbox Expressivity & Prosody + Paralinguistic Tag Pills */}
          {hasChatterbox && (
            <View style={styles.prosodyBlock}>
              <View style={styles.modelLabelRow}>
                <ThemedText size={12} variant="secondary" weight="medium">
                  Chatterbox Expressivity &amp; Prosody
                </ThemedText>
                <View
                  style={[
                    styles.metaBadge,
                    {
                      borderColor: theme.colors.accent.primary + '55',
                      backgroundColor: theme.colors.accent.primary + '1A',
                    },
                  ]}
                >
                  <ThemedText
                    size={10}
                    weight="medium"
                    style={{ color: theme.colors.accent.primary }}
                  >
                    Chatterbox
                  </ThemedText>
                </View>
              </View>
              {renderFieldRows(chatterboxPairFields, `${slot}-cb`)}
              {paralinguisticTags.length > 0 && (
                <View style={styles.fieldWrap}>
                  <ThemedText size={12} variant="secondary" style={styles.fieldLabel}>
                    Paralinguistic Tags (supported inline in utterances)
                  </ThemedText>
                  <View style={styles.tagPillRow}>
                    {paralinguisticTags.map((tag) => (
                      <View key={tag} style={styles.tagPill}>
                        <ThemedText size={10.5} style={styles.tagPillText}>
                          {tag}
                        </ThemedText>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </View>
          )}

          {/* 4c — ElevenLabs Voice Settings header */}
          {isElevenLabsTts && afterProsodyRemaining.length > 0 && (
            <View style={styles.modelLabelRow}>
              <ThemedText size={12} variant="secondary" weight="medium">
                Voice Settings (Gated by /v1/models flags)
              </ThemedText>
              <View
                style={[
                  styles.metaBadge,
                  {
                    borderColor: 'rgba(56, 189, 248, 0.35)',
                    backgroundColor: 'rgba(56, 189, 248, 0.14)',
                  },
                ]}
              >
                <ThemedText size={10} weight="medium" style={{ color: '#38BDF8' }}>
                  can_use_style ✓
                </ThemedText>
              </View>
            </View>
          )}

          {/* 4d — Remaining acoustic / prosody grid + structural fields */}
          {renderFieldRows(afterProsodyRemaining, slot)}

          {showAdvancedSampling && (
            <AdvancedSamplingParams
              extraParamsJson={state.capability.extra_params || '{}'}
              onChange={(json) => onCapabilityChange('extra_params', json)}
            />
          )}

          {renderUnsupportedDrawer()}

          {footerContent ? (
            <View
              style={[styles.footerDivider, { borderTopColor: theme.colors.border.default }]}
            >
              {footerContent}
            </View>
          ) : null}
        </>
      );
    }

    return (
      <>
        {showVoiceProfileBar && (
          <VoiceProfileBar
            selectedVoiceName={selectedVoiceName}
            capability={state.capability}
            onSelectProfile={(voiceName, loadedConfig) => {
              onCapabilityChange('voice_config_file', voiceName);
              if (loadedConfig) {
                for (const [key, value] of Object.entries(loadedConfig)) {
                  onCapabilityChange(key, value);
                }
              }
            }}
          />
        )}

        {modelModuleType === 'vad' && showAdvanced && supportedFields.length > 1 ? (
          <>
            {renderFieldRows(
              supportedFields.filter((f) => f.key === 'model'),
              `${slot}-model`,
            )}
            <View style={styles.modelLabelRow}>
              <ThemedText size={12} variant="secondary" weight="medium">
                Silero VAD Sensitivity &amp; Timing
              </ThemedText>
              <View
                style={[
                  styles.metaBadge,
                  {
                    borderColor: theme.colors.accent.primary + '55',
                    backgroundColor: theme.colors.accent.primary + '1A',
                  },
                ]}
              >
                <ThemedText
                  size={10}
                  weight="medium"
                  style={{ color: theme.colors.accent.primary }}
                >
                  POST /v1/audio/vad
                </ThemedText>
              </View>
            </View>
            {renderFieldRows(
              supportedFields.filter((f) => f.key !== 'model'),
              slot,
            )}
          </>
        ) : (
          renderFieldRows(supportedFields, slot)
        )}

        {showAdvancedSampling && (
          <AdvancedSamplingParams
            extraParamsJson={state.capability.extra_params || '{}'}
            onChange={(json) => onCapabilityChange('extra_params', json)}
          />
        )}

        {renderUnsupportedDrawer()}

        {footerContent ? (
          <View
            style={[styles.footerDivider, { borderTopColor: theme.colors.border.default }]}
          >
            {footerContent}
          </View>
        ) : null}
      </>
    );
  };

  // ── Single-card mode (STT stage editor): Provider + Capability together ──
  if (singleCard) {
    return (
      <ThemedCard elevated style={styles.section}>
        <SectionHeader title={cardTitle ?? capabilityTitle} right={renderCardBadge()} />
        <View style={styles.sectionContent}>
          {renderProviderBlock()}
          {state.providerType ? renderCapabilityContent() : null}
        </View>
      </ThemedCard>
    );
  }

  return (
    <>
      {/* 1 — General & Provider (Config Name + Provider Type + inline Account) */}
      <ThemedCard elevated style={styles.section}>
        <SectionHeader
          title={onConfigNameChange ? t('generalAndProvider') : sectionTitle('Provider')}
        />
        <View style={styles.sectionContent}>
          {onConfigNameChange && (
            <FormField
              field={{
                key: 'name',
                label: t('configName'),
                type: 'text',
                required: true,
                placeholder: t('configNamePlaceholder'),
              }}
              value={configName ?? ''}
              onChange={(_key, value) => onConfigNameChange(value)}
              testID={`config-name-${slot}`}
            />
          )}

          {renderProviderBlock()}
        </View>
      </ThemedCard>

      {/* 2 — Capability */}
      {state.providerType ? (
        <ThemedCard elevated style={styles.section}>
          <SectionHeader title={capabilityTitle} right={renderModeSwitch()} />
          <View style={styles.sectionContent}>{renderCapabilityContent()}</View>
        </ThemedCard>
      ) : null}
    </>
  );
};

const styles = StyleSheet.create({
  section: { padding: 0, overflow: 'hidden', marginBottom: 12 },
  sectionContent: { paddingHorizontal: 14, paddingBottom: 14, paddingTop: 2, gap: 10 },
  fieldWrap: { marginBottom: 2 },
  fieldLabel: { marginBottom: 4 },
  fieldLabelInline: { marginBottom: 0, flexShrink: 1 },
  modelLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 4,
  },
  metaBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  cardBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  hint: { marginTop: 4 },
  accountInline: { marginTop: 4 },
  providerChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: -2 },
  providerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  twoColRow: { flexDirection: 'row', gap: 10 },
  halfCol: { flex: 1 },
  threeColRow: { flexDirection: 'row', gap: 8 },
  thirdCol: { flex: 1 },
  prosodyBlock: { gap: 8, marginTop: 2 },
  tagPillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tagPill: {
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.35)',
    backgroundColor: 'rgba(168, 85, 247, 0.16)',
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tagPillText: {
    color: '#E9D5FF',
    fontFamily: 'monospace',
  },
  footerDivider: {
    borderTopWidth: 1,
    marginTop: 10,
    paddingTop: 12,
  },
  warnChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: -12,
    marginBottom: 16,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  unsupportedDrawerWrap: { marginTop: 4 },
  unsupportedDrawer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  unsupportedBody: {
    marginTop: 8,
    paddingLeft: 4,
    paddingRight: 4,
  },
  modeSegmented: {
    flexDirection: 'row',
    borderRadius: 8,
    padding: 2,
    gap: 2,
  },
  modeSegment: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    overflow: 'hidden',
  },
  modeSegmentActive: {
    elevation: 1,
  },
  modeSegmentActiveText: {
    color: '#FFFFFF',
  },
});
