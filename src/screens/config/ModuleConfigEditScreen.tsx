import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
  RefreshControl,
  Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import { useTranslation } from 'react-i18next';
import { useRoute, useNavigation, RouteProp, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createLogger } from '../../utils/logger';

const log = createLogger('[ModuleConfigEditScreen]');

/** Persisted user preference for the Simple vs Advanced view toggle. */
const MODE_TOGGLE_KEY = 'module_config_show_advanced';

import { ScreenHeader } from '../../components/themed/ScreenHeader';
import { ThemedCard } from '../../components/themed/ThemedCard';
import { SectionHeader } from '../../components/themed/SectionHeader';
import { ThemedView } from '../../components/themed/ThemedView';
import { ThemedText } from '../../components/themed/ThemedText';
import { hapticLightPress } from '../../utils/haptics';
import { useAppAlert } from '../../contexts/AppAlertContext';
import { AccountForm } from '../../components/providers/AccountForm';
import {
  ProviderSlotSection,
  groupFieldsIntoRows,
} from '../../components/config/ProviderSlotSection';
import type { SlotState } from '../../components/config/ProviderSlotSection';
import { FormField } from '../../components/config/FormField';
import { useProviderCapabilityCatalog } from '../../hooks/useProviderCapabilityCatalog';
import {
  catalogModelsForModule,
  findModel,
  getSpeechOptions,
} from '../../constants/modelCapabilities';
import type { FieldDefinition } from '../../constants/providerFieldSchemas';
import {
  MODULE_TYPES,
  ModuleTypeConfig,
  ProviderOption,
  STT_SLOT_PROVIDER_OPTIONS,
} from '../../constants/moduleConfiguration';
import { MODULE_DEFAULTS, PROVIDER_DEFAULTS } from '../../constants/moduleDefaults';
import {
  filterAvailableProviders,
  getAvailableProviders,
  STORE_PROVIDER_ID,
} from '../../services/variant/providerAvailability';
import { invalidateEntityAccessCache } from '../../services/variant/entityAccess';
import { isStoreVariant } from '../../config/appVariant';
import { capabilityDefaultsOf } from '../../constants/accountFieldSchemas';
import { useAppTheme } from '../../contexts/ThemeContext';
import { SttTestPanel } from '../../components/config/SttTestPanel';
import { TtsTestPanel } from '../../components/config/TtsTestPanel';
import {
  createBackendConfig, updateBackendConfig, getBackendConfig, deleteBackendConfig,
  createCognitionConfig, updateCognitionConfig, getCognitionConfig, deleteCognitionConfig,
  createMovementConfig, updateMovementConfig, getMovementConfig, deleteMovementConfig,
  createRAGConfig, updateRAGConfig, getRAGConfig, deleteRAGConfig,
  createSTTConfig, updateSTTConfig, getSTTConfig, deleteSTTConfig,
  createTTSConfig, updateTTSConfig, getTTSConfig, deleteTTSConfig,
  createVisionConfig, updateVisionConfig, getVisionConfig, deleteVisionConfig,
  createImaginationConfig, updateImaginationConfig, getImaginationConfig, deleteImaginationConfig,
  listAccounts, createAccount,
} from '../../database/repositories';
import type { ProviderAccount } from '../../database/models';
import type { ProviderAccountWriteDto } from '../../services/engine/EngineApiClient';

type RootStackParamList = {
  ModuleConfigEdit: {
    moduleType: string;
    configId?: string;
    /** The AI entity this config is wired to (edit-mode CreateAI). Enables
     *  entity-bound test panels (TTS) — absent in create mode. */
    entityId?: string;
  };
};

type ModuleConfigEditRouteProp = RouteProp<RootStackParamList, 'ModuleConfigEdit'>;
type ModuleConfigEditNavigationProp = NativeStackNavigationProp<RootStackParamList, 'ModuleConfigEdit'>;

/**
 * Seed the per-slot "explicit field" set from a loaded capability overlay: a
 * persisted value that differs from the provider's default was set explicitly
 * by the user (used by the preset preview chips to label overrides — plan §11
 * A3 "explicit local values override the preset").
 */
function explicitKeysFromPersisted(
  providerType: string,
  persisted: Record<string, any> | null | undefined,
): Record<string, boolean> {
  if (!persisted) return {};
  const defaults = PROVIDER_DEFAULTS[providerType] || {};
  const out: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(persisted)) {
    if (value === undefined || value === null || value === '') continue;
    if (String(value) !== String(defaults[key])) out[key] = true;
  }
  return out;
}

/** Parse a capability overlay (JSON string or object) into a plain object. */
function parseCapability(value: unknown): Record<string, any> {
  if (value && typeof value === 'object') return { ...(value as Record<string, any>) };
  if (typeof value === 'string' && value.trim() !== '') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

/** Serialize a capability overlay, dropping undefined values (stable '{}'). */
function serializeCapability(values: Record<string, any>): string {
  const cleaned: Record<string, any> = {};
  for (const [key, value] of Object.entries(values ?? {})) {
    if (value === undefined) continue;
    cleaned[key] = value;
  }
  return JSON.stringify(cleaned);
}

/** One provider slot definition (STT has two; every other module one). */
interface SlotDef {
  slot: string;
  label: string;
  providerField: string;
  accountField: string;
  capabilityField: string;
  modelModuleType: string;
}

const MODULE_REPOSITORIES: Record<string, {
  create: (config: any) => Promise<string>;
  update: (config: any) => Promise<void>;
  get: (id: string) => Promise<any | null>;
  delete: (id: string) => Promise<void>;
}> = {
  backend: { create: createBackendConfig, update: updateBackendConfig, get: getBackendConfig, delete: deleteBackendConfig },
  cognition: { create: createCognitionConfig, update: updateCognitionConfig, get: getCognitionConfig, delete: deleteCognitionConfig },
  movement: { create: createMovementConfig, update: updateMovementConfig, get: getMovementConfig, delete: deleteMovementConfig },
  rag: { create: createRAGConfig, update: updateRAGConfig, get: getRAGConfig, delete: deleteRAGConfig },
  stt: { create: createSTTConfig, update: updateSTTConfig, get: getSTTConfig, delete: deleteSTTConfig },
  tts: { create: createTTSConfig, update: updateTTSConfig, get: getTTSConfig, delete: deleteTTSConfig },
  vision: { create: createVisionConfig, update: updateVisionConfig, get: getVisionConfig, delete: deleteVisionConfig },
  imagination: { create: createImaginationConfig, update: updateImaginationConfig, get: getImaginationConfig, delete: deleteImaginationConfig },
};

const EMPTY_SLOT: SlotState = { providerType: '', accountId: null, capability: {} };

export const ModuleConfigEditScreen: React.FC = () => {
  const route = useRoute<ModuleConfigEditRouteProp>();
  const navigation = useNavigation<ModuleConfigEditNavigationProp>();
  const { theme } = useAppTheme();
  const { showAlert } = useAppAlert();
  const { t } = useTranslation('moduleConfig');
  const { bottom: safeBottom } = useSafeAreaInsets();

  const { moduleType, configId, entityId } = route.params;
  const isCreate = !configId;
  const isSTT = moduleType === 'stt';

  // Module config fields (name + module-specific scalars).
  const [formValues, setFormValues] = useState<Record<string, any>>({
    name: '',
  });

  // Per-slot provider state (provider type + account FK + capability overlay).
  const [slots, setSlots] = useState<Record<string, SlotState>>({});

  // Per-slot set of capability keys the user has explicitly set (session edits +
  // persisted values that differ from the provider defaults). Drives the preset
  // preview chips' "your explicit value wins" annotation (plan §11 A3).
  const [explicitFields, setExplicitFields] = useState<
    Record<string, Record<string, boolean>>
  >({});

  // Shared provider accounts (all types; filtered per slot by the chosen type).
  const [accounts, setAccounts] = useState<ProviderAccount[]>([]);
  // The "Add account…" modal target (slot) — null when closed.
  const [editorSlot, setEditorSlot] = useState<string | null>(null);
  const [savingAccount, setSavingAccount] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Simple vs Advanced mode toggle — Simple hides the deep technical fields.
  const [showAdvanced, setShowAdvanced] = useState(false);
  // STT presents one interactive 2-stage pipeline instead of two slot walls.
  const [activeSttStage, setActiveSttStage] = useState<'vad' | 'transcription'>('transcription');
  const { catalog } = useProviderCapabilityCatalog();

  const slotDefs: SlotDef[] = useMemo(
    () =>
      isSTT
        ? [
            {
              slot: 'transcription',
              label: 'Transcription',
              providerField: 'transcription_provider',
              accountField: 'transcription_provider_account_id',
              capabilityField: 'transcription_capability_json',
              modelModuleType: 'stt',
            },
            {
              slot: 'vad',
              label: 'VAD',
              providerField: 'vad_provider',
              accountField: 'vad_provider_account_id',
              capabilityField: 'vad_capability_json',
              modelModuleType: 'vad',
            },
          ]
        : [
            {
              slot: 'provider',
              label: '',
              providerField: 'provider',
              accountField: 'provider_account_id',
              capabilityField: 'capability_json',
              modelModuleType: moduleType,
            },
          ],
    [isSTT, moduleType],
  );

  const providerOptions = useMemo(() => getAvailableProviders(moduleType), [moduleType]);

  // Per-slot provider lists (provider-registry 6-5 step 2): STT's transcription
  // and VAD slots each carry their own option list (scoped to the engine clients
  // that implement the capability); every other module uses the module list.
  const providerOptionsForSlot = useCallback(
    (slot: string): ProviderOption[] => {
      if (isSTT && (slot === 'transcription' || slot === 'vad')) {
        return filterAvailableProviders(STT_SLOT_PROVIDER_OPTIONS[slot]);
      }
      return providerOptions;
    },
    [isSTT, providerOptions],
  );

  // Restore the persisted Simple/Advanced preference.
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(MODE_TOGGLE_KEY)
      .then((val) => {
        if (alive && val === 'true') {
          setShowAdvanced(true);
        }
      })
      .catch(() => {
        // Best-effort — default to Simple view.
      });
    return () => {
      alive = false;
    };
  }, []);

  // Persist the preference whenever it changes.
  useEffect(() => {
    AsyncStorage.setItem(MODE_TOGGLE_KEY, String(showAdvanced)).catch(() => {
      // Best-effort — non-critical persistence failure.
    });
  }, [showAdvanced]);

  useFocusEffect(
    useCallback(() => {
      loadConfig();
    }, [configId, moduleType])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadConfig();
    setRefreshing(false);
  }, [configId, moduleType]);

  if (!theme) return null;

  const emptySlotFor = (providerType: string, modelModuleType: string): SlotState => ({
    providerType,
    accountId: null,
    capability: capabilityDefaultsOf(
      providerType,
      PROVIDER_DEFAULTS[providerType] ?? {},
      modelModuleType,
    ),
  });

  const loadConfig = async () => {
    // Accounts are shared across slots — load once (variant-filtered).
    try {
      const all = await listAccounts();
      setAccounts(all);
    } catch (err) {
      log.error('Failed to load provider accounts:', err);
      setAccounts([]);
    }

    if (!configId) {
      // Create mode — seed module defaults + an empty provider slot per slot.
      const defaults = MODULE_DEFAULTS[moduleType] || {};
      const storeVariant = isStoreVariant();
      const storeProvider = storeVariant ? STORE_PROVIDER_ID : '';
      const nextSlots: Record<string, SlotState> = {};
      const nextExplicit: Record<string, Record<string, boolean>> = {};
      for (const def of slotDefs) {
        nextSlots[def.slot] = emptySlotFor(storeProvider, def.modelModuleType);
        nextExplicit[def.slot] = {};
      }
      setFormValues({ ...defaults, name: '' });
      setSlots(nextSlots);
      setExplicitFields(nextExplicit);
      setLoading(false);
      return;
    }

    try {
      const repo = MODULE_REPOSITORIES[moduleType];
      if (!repo) {
        setLoading(false);
        return;
      }

      const config = await repo.get(configId);
      if (!config) {
        setLoading(false);
        return;
      }

      if (isSTT) {
        setFormValues({
          name: config.name,
          main_stream_time_millis: config.main_stream_time_millis,
          transition_stream_time_millis: config.transition_stream_time_millis,
          max_buffer_count: config.max_buffer_count,
        });
        const nextSlots: Record<string, SlotState> = {};
        const nextExplicit: Record<string, Record<string, boolean>> = {};
        for (const def of slotDefs) {
          const providerType: string = config[def.providerField] ?? '';
          const accountId: string | null = config[def.accountField] ?? null;
          const capability = parseCapability(config[def.capabilityField]);
          nextSlots[def.slot] = { providerType, accountId, capability };
          nextExplicit[def.slot] = explicitKeysFromPersisted(providerType, capability);
        }
        setSlots(nextSlots);
        setExplicitFields(nextExplicit);
      } else {
        const def = slotDefs[0];
        const providerType: string = config.provider ?? '';
        const accountId: string | null = config.provider_account_id ?? null;
        const capability = parseCapability(config.capability_json);

        const moduleFields = Object.fromEntries(
          Object.entries(config).filter(
            ([k]) =>
              ![
                'id',
                'name',
                'provider',
                'provider_account_id',
                'capability_json',
                'deleted_at',
              ].includes(k)
          )
        );
        setFormValues({ name: config.name, ...moduleFields });
        setSlots({ [def.slot]: { providerType, accountId, capability } });
        setExplicitFields({
          [def.slot]: explicitKeysFromPersisted(providerType, capability),
        });
      }
    } catch (error) {
      log.error('Failed to load config:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleModuleFieldChange = (key: string, value: any) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
  };

  /** Provider type switch: reset the account + reseed the module-scoped defaults. */
  const handleProviderSwitch = (slot: string, providerType: string) => {
    const def = slotDefs.find((d) => d.slot === slot);
    setSlots((prev) => ({
      ...prev,
      [slot]: emptySlotFor(providerType, def?.modelModuleType ?? moduleType),
    }));
    setExplicitFields((prev) => ({ ...prev, [slot]: {} }));
  };

  const handleAccountChange = (slot: string, accountId: string | null) => {
    setSlots((prev) => ({
      ...prev,
      [slot]: { ...(prev[slot] ?? EMPTY_SLOT), accountId },
    }));
  };

  /** "Disabled (Manual Push-to-Talk only)" — clears the VAD slot. */
  const handleDisableSlot = (slot: string) => {
    setSlots((prev) => ({
      ...prev,
      [slot]: { ...EMPTY_SLOT },
    }));
    setExplicitFields((prev) => ({ ...prev, [slot]: {} }));
  };

  const handleCapabilityChange = (slot: string, key: string, value: any) => {
    setSlots((prev) => ({
      ...prev,
      [slot]: {
        ...(prev[slot] ?? EMPTY_SLOT),
        capability: { ...(prev[slot]?.capability ?? {}), [key]: value },
      },
    }));
    // A user edit is an explicit local value (overrides a preset — §11 A3).
    setExplicitFields((prev) => ({
      ...prev,
      [slot]: { ...(prev[slot] ?? {}), [key]: true },
    }));
  };

  /** "Add account…" submit: create the shared account, then select it. */
  const handleSubmitAccount = async (dto: ProviderAccountWriteDto) => {
    if (!editorSlot) return;
    const providerType = slots[editorSlot]?.providerType;
    if (!providerType) return;
    setSavingAccount(true);
    try {
      const id = await createAccount(providerType, dto);
      const all = await listAccounts();
      setAccounts(all);
      handleAccountChange(editorSlot, id);
      setEditorSlot(null);
    } catch (error) {
      log.error('Failed to create provider account:', error);
      showAlert(t('common:error'), t('accountSaveFailed'));
    } finally {
      setSavingAccount(false);
    }
  };

  const handleSave = async () => {
    if (!formValues.name) {
      showAlert(t('common:error'), t('configNameRequired'));
      return;
    }

    const repo = MODULE_REPOSITORIES[moduleType];
    if (!repo) {
      showAlert(t('common:error'), t('unknownModuleType'));
      return;
    }

    // Provider required per slot. STT's VAD stage may be disabled entirely
    // (manual push-to-talk) — the engine treats an empty VAD provider as off.
    for (const def of slotDefs) {
      if (isSTT && def.slot === 'vad' && !slots[def.slot]?.providerType) continue;
      if (!slots[def.slot]?.providerType) {
        const key = isSTT
          ? def.slot === 'transcription'
            ? 'transcriptionProviderRequired'
            : 'vadProviderRequired'
          : 'providerRequired';
        showAlert(t('common:error'), t(key));
        return;
      }
    }

    setSaving(true);
    try {
      let moduleConfig: Record<string, any>;
      if (isSTT) {
        const tx = slots.transcription;
        const vad = slots.vad;
        moduleConfig = {
          name: formValues.name,
          transcription_provider: tx.providerType,
          transcription_provider_account_id: tx.accountId,
          transcription_capability_json: serializeCapability(tx.capability),
          vad_provider: vad.providerType,
          vad_provider_account_id: vad.accountId,
          vad_capability_json: serializeCapability(vad.capability),
          main_stream_time_millis: formValues.main_stream_time_millis,
          transition_stream_time_millis: formValues.transition_stream_time_millis,
          max_buffer_count: formValues.max_buffer_count,
        };
      } else {
        const providerSlot = slots.provider;
        const moduleSpecificKeys = (
          MODULE_TYPES.find((m) => m.id === moduleType)?.moduleSpecificFields || []
        ).map((f) => f.key);
        const moduleFields: Record<string, any> = {};
        for (const key of moduleSpecificKeys) {
          if (formValues[key] !== undefined) moduleFields[key] = formValues[key];
        }
        moduleConfig = {
          name: formValues.name,
          provider: providerSlot.providerType,
          provider_account_id: providerSlot.accountId,
          capability_json: serializeCapability(providerSlot.capability),
          ...moduleFields,
        };
      }

      if (isCreate) {
        await repo.create(moduleConfig);
      } else {
        await repo.update({ ...moduleConfig, id: configId });
      }

      // Provider/module wiring changed → the computed lock set is stale (7-14).
      invalidateEntityAccessCache();
      navigation.goBack();
    } catch (error) {
      log.error('Failed to save:', error);
      showAlert(t('common:error'), t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const repo = MODULE_REPOSITORIES[moduleType];
    if (!repo || !configId) return;

    showAlert(
      t('deleteTitle'),
      t('deleteConfirm'),
      [
        { text: t('common:cancel'), style: 'cancel' },
        {
          text: t('common:delete'),
          style: 'destructive',
          onPress: async () => {
            await repo.delete(configId);
            invalidateEntityAccessCache();
            navigation.goBack();
          },
        },
      ]
    );
  };

  const getModuleConfig = (): ModuleTypeConfig | undefined =>
    MODULE_TYPES.find((m) => m.id === moduleType);

  const moduleConfig = getModuleConfig();

  // ── Selected TTS model (for test-panel paralinguistic tags) ──
  const ttsSlot = slots.provider;
  const selectedTtsModel = useMemo(() => {
    if (moduleType !== 'tts' || !ttsSlot?.providerType) return null;
    const entries = catalogModelsForModule(catalog[ttsSlot.providerType], 'tts');
    return findModel(entries, ttsSlot.capability?.model) ?? null;
  }, [moduleType, ttsSlot, catalog]);

  // ── Loading state ──
  if (loading) {
    return (
      <ThemedView style={styles.container}>
        <ScreenHeader
          title={`${moduleConfig?.name || moduleType} Config`}
          onBack={() => navigation.goBack()}
        />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.colors.accent.primary} />
        </View>
      </ThemedView>
    );
  }

  /** RAG's Embedding Concurrency footer (Advanced only, inside Capability). */
  const renderRagFooter = () => {
    const fields = getModuleConfig()?.moduleSpecificFields ?? [];
    if (fields.length === 0) return null;
    return (
      <>
        {groupFieldsIntoRows(fields).map((row) => (
          <View
            key={row.map((f) => f.key).join('-')}
            style={row.length > 1 ? styles.twoColRow : undefined}
          >
            {row.map((field) => (
              <View key={field.key} style={row.length > 1 ? styles.halfCol : undefined}>
                <FormField
                  field={field}
                  value={formValues[field.key]}
                  onChange={handleModuleFieldChange}
                  testID={`module-field-${field.key}`}
                />
              </View>
            ))}
          </View>
        ))}
      </>
    );
  };

  const renderSlots = () => {
    // STT shows exactly ONE stage at a time (Stage 1 VAD / Stage 2
    // Transcription) as a single Provider + Capability card (Phase 3-6).
    const defs = isSTT
      ? slotDefs.filter((def) => def.slot === activeSttStage)
      : slotDefs;

    return defs.map((def) => {
      const slotState = slots[def.slot] ?? EMPTY_SLOT;
      const typeAccounts = accounts.filter((a) => a.type === slotState.providerType);
      const isVadStage = isSTT && def.slot === 'vad';
      return (
        <ProviderSlotSection
          key={def.slot}
          slot={def.slot}
          slotLabel={def.label}
          modelModuleType={def.modelModuleType}
          providerOptions={providerOptionsForSlot(def.slot)}
          state={slotState}
          accounts={typeAccounts}
          showAdvanced={showAdvanced}
          explicitFields={explicitFields[def.slot] ?? {}}
          configName={!isSTT ? formValues.name : undefined}
          onConfigNameChange={
            !isSTT ? (val) => handleModuleFieldChange('name', val) : undefined
          }
          onToggleAdvanced={!isSTT ? setShowAdvanced : undefined}
          onProviderChange={(type) => handleProviderSwitch(def.slot, type)}
          onAccountChange={(id) => handleAccountChange(def.slot, id)}
          onCapabilityChange={(key, value) => handleCapabilityChange(def.slot, key, value)}
          onAddAccount={() => {
            hapticLightPress();
            setEditorSlot(def.slot);
          }}
          footerContent={
            !isSTT && moduleType === 'rag' && showAdvanced ? renderRagFooter() : undefined
          }
          singleCard={isSTT}
          cardTitle={
            isSTT
              ? isVadStage
                ? t('stage1CardTitle')
                : t('stage2CardTitle')
              : undefined
          }
          cardBadge={
            isSTT
              ? isVadStage
                ? t('stage1Badge')
                : t('stage2Badge')
              : undefined
          }
          allowDisable={isVadStage}
          onDisableSlot={isVadStage ? () => handleDisableSlot(def.slot) : undefined}
        />
      );
    });
  };

  /** Compact `Simple | Advanced` switch for the STT pipeline header (2-3). */
  const renderSttModeSwitch = () => (
    <View style={[styles.modeSegmented, { backgroundColor: theme.colors.background.base }]}>
      <TouchableOpacity
        testID="mode-simple-button"
        onPress={() => {
          hapticLightPress();
          setShowAdvanced(false);
        }}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityState={{ selected: !showAdvanced }}
        style={[
          styles.modeSegment,
          !showAdvanced && [
            styles.modeSegmentActive,
            { backgroundColor: theme.colors.accent.primary },
          ],
        ]}
      >
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
          setShowAdvanced(true);
        }}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityState={{ selected: showAdvanced }}
        style={[
          styles.modeSegment,
          showAdvanced && [
            styles.modeSegmentActive,
            { backgroundColor: theme.colors.accent.primary },
          ],
        ]}
      >
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

  /** Realtime Audio Pipeline banner (Stage 1 VAD ➔ Stage 2 Transcription). */
  const renderSttPipeline = () => {
    const vad = slots.vad;
    const tx = slots.transcription;
    const providerLabelFor = (slot: string, id?: string): string => {
      if (!id) return slot === 'vad' ? 'Manual Push-to-Talk' : 'Select provider';
      const found = providerOptionsForSlot(slot).find((p) => p.id === id);
      return found?.name ?? id;
    };
    const vadModelLabel = vad?.capability?.model
      ? String(vad.capability.model) === 'silero-vad'
        ? 'Silero VAD'
        : String(vad.capability.model)
      : vad?.providerType
        ? 'Silero VAD'
        : 'Disabled';
    const txModelLabel = tx?.capability?.model
      ? String(tx.capability.model).includes('whisper')
        ? 'FasterWhisper'
        : String(tx.capability.model)
      : 'FasterWhisper';

    return (
      <ThemedCard elevated style={styles.section}>
        <SectionHeader title={t('sttPipelineTitle')} right={renderSttModeSwitch()} />
        <View style={styles.sectionContent}>
          <FormField
            field={{
              key: 'name',
              label: t('configName'),
              type: 'text',
              required: true,
              placeholder: t('configNamePlaceholder'),
            }}
            value={formValues.name ?? ''}
            onChange={(_key, value) => handleModuleFieldChange('name', value)}
            testID="config-name-stt"
          />

          <View style={styles.pipelineLabelRow}>
            <ThemedText size={12} variant="secondary">
              {t('pipelineStages')}
            </ThemedText>
            {Boolean(vad?.providerType) && (
              <View
                style={[
                  styles.autoVadBadge,
                  {
                    borderColor: theme.colors.status.success + '66',
                    backgroundColor: theme.colors.status.success + '1A',
                  },
                ]}
              >
                <ThemedText
                  size={10}
                  weight="medium"
                  style={{ color: theme.colors.status.success }}
                >
                  {t('autoVadActive')}
                </ThemedText>
              </View>
            )}
          </View>

          <View
            style={[
              styles.pipelineFlow,
              {
                backgroundColor: 'rgba(7, 11, 20, 0.75)',
                borderColor: theme.colors.border.default,
              },
            ]}
          >
            <TouchableOpacity
              testID="stt-stage-vad"
              onPress={() => {
                hapticLightPress();
                setActiveSttStage('vad');
              }}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityState={{ selected: activeSttStage === 'vad' }}
              style={[
                styles.pipelineNode,
                {
                  borderColor:
                    activeSttStage === 'vad'
                      ? theme.colors.accent.primary
                      : theme.colors.border.default,
                  backgroundColor:
                    activeSttStage === 'vad'
                      ? theme.colors.accent.primary + '24'
                      : theme.colors.background.surface,
                },
              ]}
            >
              <ThemedText size={10} weight="bold" numberOfLines={1} style={styles.pipelineStageLabel}>
                {t('stage1Label')}
              </ThemedText>
              <ThemedText size={12} weight="bold" numberOfLines={1} style={styles.pipelineStageValue}>
                {`${vad?.providerType ? '🟢' : '⚪'} ${vadModelLabel}`}
              </ThemedText>
              <ThemedText size={10.5} numberOfLines={1} style={styles.pipelineStageVadCaption}>
                {`${providerLabelFor('vad', vad?.providerType)} · ${
                  vad?.capability?.threshold ?? 0.5
                } thr`}
              </ThemedText>
            </TouchableOpacity>

            <ThemedText size={14} weight="bold" style={styles.pipelineArrow}>
              ➔
            </ThemedText>

            <TouchableOpacity
              testID="stt-stage-transcription"
              onPress={() => {
                hapticLightPress();
                setActiveSttStage('transcription');
              }}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityState={{ selected: activeSttStage === 'transcription' }}
              style={[
                styles.pipelineNode,
                {
                  borderColor:
                    activeSttStage === 'transcription'
                      ? theme.colors.accent.primary
                      : theme.colors.border.default,
                  backgroundColor:
                    activeSttStage === 'transcription'
                      ? theme.colors.accent.primary + '24'
                      : theme.colors.background.surface,
                },
              ]}
            >
              <ThemedText size={10} weight="bold" numberOfLines={1} style={styles.pipelineStageLabel}>
                {t('stage2Label')}
              </ThemedText>
              <ThemedText size={12} weight="bold" numberOfLines={1} style={styles.pipelineStageValue}>
                {`📝 ${txModelLabel}`}
              </ThemedText>
              <ThemedText size={10.5} numberOfLines={1} style={styles.pipelineStageTxCaption}>
                {tx?.providerType
                  ? `${providerLabelFor('transcription', tx.providerType)} · ${
                      tx?.capability?.model || 'v3-turbo'
                    }`
                  : 'Select provider'}
              </ThemedText>
            </TouchableOpacity>
          </View>

          <ThemedText size={11} variant="muted">
            {t('sttPipelineHint')}
          </ThemedText>
        </View>
      </ThemedCard>
    );
  };

  const renderModuleSection = () => {
    if (isSTT) {
      // Realtime Stream Buffer & Overlap is an Advanced-only concern (Phase 3-6).
      if (!showAdvanced) return null;
      const bufferFields: FieldDefinition[] = [
        {
          key: 'main_stream_time_millis',
          label: t('chunkWindow'),
          type: 'number',
          width: 'half',
          placeholder: '2000',
        },
        {
          key: 'transition_stream_time_millis',
          label: t('transitionOverlap'),
          type: 'number',
          width: 'half',
          placeholder: '1000',
        },
        {
          key: 'max_buffer_count',
          label: t('maxSpeechChunks'),
          type: 'number',
          placeholder: '5',
          tooltip: t('sttMaxSpeechChunksHint'),
        },
      ];

      return (
        <ThemedCard elevated style={styles.section}>
          <SectionHeader
            title={t('sttBufferTitle')}
            right={
              <View style={styles.cyanBadge}>
                <ThemedText size={10} weight="medium" style={{ color: '#38BDF8' }}>
                  AutoVAD Window
                </ThemedText>
              </View>
            }
          />
          <View style={styles.sectionContent}>
            {groupFieldsIntoRows(bufferFields).map((row) => (
              <View
                key={row.map((f) => f.key).join('-')}
                style={row.length > 1 ? styles.twoColRow : undefined}
              >
                {row.map((field) => (
                  <View key={field.key} style={row.length > 1 ? styles.halfCol : undefined}>
                    <FormField
                      field={field}
                      value={formValues[field.key]}
                      onChange={handleModuleFieldChange}
                      testID={`module-field-${field.key}`}
                    />
                  </View>
                ))}
              </View>
            ))}
          </View>
        </ThemedCard>
      );
    }

    // RAG's Embedding Concurrency renders inside the capability card footer.
    if (moduleType === 'rag') return null;

    const allFields = moduleConfig?.moduleSpecificFields ?? [];
    // `output_type` is a legacy persisted scalar, intentionally hidden from the
    // TTS behavior card (it still round-trips through save).
    const fields =
      moduleType === 'tts'
        ? allFields.filter((field) => field.key !== 'output_type')
        : allFields;
    if (fields.length === 0) return null;

    const title =
      moduleType === 'movement'
        ? t('movementExecution')
        : moduleType === 'vision'
        ? t('imagePreprocessing')
        : moduleType === 'cognition'
        ? t('cognitionSettings')
        : moduleType === 'tts'
        ? t('moduleBehaviorTts')
        : `${moduleConfig?.name ?? moduleType} Settings`;

    return (
      <ThemedCard elevated style={styles.section}>
        <SectionHeader title={title} />
        <View style={styles.sectionContent}>
          {groupFieldsIntoRows(fields).map((row) => (
            <View
              key={row.map((f) => f.key).join('-')}
              style={row.length > 1 ? styles.twoColRow : undefined}
            >
              {row.map((field) => (
                <View key={field.key} style={row.length > 1 ? styles.halfCol : undefined}>
                  <FormField
                    field={field}
                    value={formValues[field.key]}
                    onChange={handleModuleFieldChange}
                    testID={`module-field-${field.key}`}
                  />
                </View>
              ))}
            </View>
          ))}
        </View>
      </ThemedCard>
    );
  };

  const editorProviderType = editorSlot ? slots[editorSlot]?.providerType ?? '' : '';

  return (
    <ThemedView style={styles.container}>
      {/* ── Header ── */}
      <ScreenHeader
        title={isCreate ? `New ${moduleConfig?.name || moduleType} Config` : `Edit ${moduleConfig?.name || moduleType} Config`}
        onBack={() => navigation.goBack()}
        right={
          saving ? (
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
              accessibilityLabel="Save configuration"
              accessibilityRole="button"
              testID="header-save-button"
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                backgroundColor: 'rgba(236, 72, 153, 0.14)',
                borderWidth: 1,
                borderColor: 'rgba(236, 72, 153, 0.4)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="check" size={18} color={theme.colors.accent.primary} />
            </TouchableOpacity>
          )
        }
      />

      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: 48 + safeBottom }]}
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
          {/* ── STT: Realtime Audio Pipeline (Config Name + stage flow) ── */}
          {isSTT && renderSttPipeline()}

          {/* ── Provider → Account → Capability, per slot ── */}
          {renderSlots()}

          {/* ── Section 4 — Module ── */}
          {renderModuleSection()}

          {/* ── STT/VAD recorder test block (2-2) ── */}
          {isSTT && (
            <ThemedCard elevated style={styles.section}>
              <SectionHeader title={t('realtimeVadSttTestStudio')} />
              <View style={styles.sectionContent}>
                <SttTestPanel enabled={!!slots.transcription?.providerType} entityId={entityId} />
              </View>
            </ThemedCard>
          )}

          {/* ── TTS playback test block (2-3 / 3-5) ── */}
          {moduleType === 'tts' && (
            <ThemedCard elevated style={styles.section}>
              <SectionHeader
                title={t('voiceTestStudio')}
                right={
                  <View
                    style={[
                      styles.greenBadge,
                      {
                        borderColor: theme.colors.status.success + '66',
                        backgroundColor: theme.colors.status.success + '1A',
                      },
                    ]}
                  >
                    <ThemedText
                      size={10}
                      weight="medium"
                      style={{ color: theme.colors.status.success }}
                    >
                      {t('directEngineSynthesis')}
                    </ThemedText>
                  </View>
                }
              />
              <View style={styles.sectionContent}>
                <TtsTestPanel
                  entityId={entityId}
                  providerType={slots.provider?.providerType}
                  accountId={slots.provider?.accountId}
                  capability={slots.provider?.capability}
                  paralinguisticTags={getSpeechOptions(selectedTtsModel)?.paralinguistic_tags}
                />
              </View>
            </ThemedCard>
          )}

          {/* ── Danger Zone ── */}
          {!isCreate && (
            <ThemedCard
              elevated
              style={styles.section}
            >
              <SectionHeader
                title="Danger Zone"
                accentPip={false}
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
                    style={StyleSheet.absoluteFill}
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
                    Delete This Config
                  </ThemedText>
                </TouchableOpacity>
              </View>
            </ThemedCard>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── "Add account…" modal (shared AccountForm, 6-2) ── */}
      <Modal
        visible={editorSlot !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setEditorSlot(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalShell, { backgroundColor: theme.colors.background.surface }]}>
            {editorSlot && (
              <>
                <ThemedText size={16} weight="bold" style={styles.modalTitle}>
                  {t('accountAddTitle')}
                </ThemedText>
                <AccountForm
                  key={editorProviderType}
                  type={editorProviderType}
                  submitting={savingAccount}
                  onSubmit={handleSubmitAccount}
                  onCancel={() => setEditorSlot(null)}
                />
              </>
            )}
          </View>
        </View>
      </Modal>
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  keyboardAvoid: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 48 },

  // ── Sections ──
  section: {
    padding: 0,
    overflow: 'hidden',
    marginBottom: 12,
  },
  sectionContent: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    paddingTop: 2,
    gap: 10,
  },
  twoColRow: { flexDirection: 'row', gap: 10 },
  halfCol: { flex: 1 },
  cyanBadge: {
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.35)',
    backgroundColor: 'rgba(56, 189, 248, 0.14)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  pipelineLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  autoVadBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  greenBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  pipelineFlow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 10,
    padding: 8,
  },
  pipelineNode: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 2,
  },
  pipelineStageLabel: { fontSize: 10, color: '#64748B' },
  pipelineStageValue: { fontSize: 12 },
  pipelineStageVadCaption: { fontSize: 10.5, color: '#E879F9' },
  pipelineStageTxCaption: { fontSize: 10.5, color: '#38BDF8' },
  pipelineArrow: { color: '#E879F9', fontSize: 14 },
  dangerSection: {
    borderWidth: 1.5,
  },

  // ── Fields ──
  fieldLabel: { marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    minHeight: 44,
  },

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

  // ── Simple / Advanced mode toggle ──
  modeToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: 16,
  },
  modeToggleCopy: {
    flex: 1,
    marginRight: 8,
  },
  modeToggleHint: {
    marginTop: 2,
  },
  modeSegmented: {
    flexDirection: 'row',
    borderRadius: 10,
    padding: 3,
    gap: 3,
  },
  modeSegment: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
  },
  modeSegmentActive: {
    elevation: 1,
  },
  modeSegmentActiveText: {
    color: '#FFFFFF',
  },

  // ── Add-account modal ──
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalShell: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    maxHeight: '85%',
  },
  modalTitle: { marginBottom: 12 },
});
