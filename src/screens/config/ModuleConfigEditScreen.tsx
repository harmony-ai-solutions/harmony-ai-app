import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
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
import { ProviderSlotSection } from '../../components/config/ProviderSlotSection';
import type { SlotState } from '../../components/config/ProviderSlotSection';
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

  const emptySlotFor = (providerType: string): SlotState => ({
    providerType,
    accountId: null,
    capability: capabilityDefaultsOf(providerType, PROVIDER_DEFAULTS[providerType] ?? {}),
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
        nextSlots[def.slot] = emptySlotFor(storeProvider);
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

  /** Provider type switch: reset the account + reseed the capability defaults. */
  const handleProviderSwitch = (slot: string, providerType: string) => {
    setSlots((prev) => ({ ...prev, [slot]: emptySlotFor(providerType) }));
    setExplicitFields((prev) => ({ ...prev, [slot]: {} }));
  };

  const handleAccountChange = (slot: string, accountId: string | null) => {
    setSlots((prev) => ({
      ...prev,
      [slot]: { ...(prev[slot] ?? EMPTY_SLOT), accountId },
    }));
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

    // Provider required per slot.
    for (const def of slotDefs) {
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

  // ── Text input with theme styling (for module-specific fields) ──
  const renderThemedInput = (
    label: string,
    value: any,
    onChangeText: (text: string) => void,
    placeholder: string,
    keyboardType: 'default' | 'decimal-pad' | 'number-pad' = 'default',
  ) => (
    <View>
      <ThemedText size={13} variant="secondary" style={styles.fieldLabel}>
        {label}
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
        value={value?.toString() ?? ''}
        onChangeText={onChangeText}
        placeholder={placeholder}
        keyboardType={keyboardType}
        placeholderTextColor={theme.colors.text.muted}
      />
    </View>
  );

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

  const renderSlots = () =>
    slotDefs.map((def) => {
      const slotState = slots[def.slot] ?? EMPTY_SLOT;
      const typeAccounts = accounts.filter((a) => a.type === slotState.providerType);
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
          onProviderChange={(type) => handleProviderSwitch(def.slot, type)}
          onAccountChange={(id) => handleAccountChange(def.slot, id)}
          onCapabilityChange={(key, value) => handleCapabilityChange(def.slot, key, value)}
          onAddAccount={() => {
            hapticLightPress();
            setEditorSlot(def.slot);
          }}
        />
      );
    });

  const renderModuleSection = () => {
    if (isSTT) {
      return (
        <ThemedCard elevated accentStripe style={styles.section}>
          <SectionHeader title="STT Settings" />
          <View style={styles.sectionContent}>
            {renderThemedInput(
              t('mainStreamTime'),
              formValues.main_stream_time_millis,
              (text) => handleModuleFieldChange('main_stream_time_millis', text ? parseInt(text, 10) : null),
              '2000',
              'number-pad',
            )}
            {renderThemedInput(
              t('transitionStreamTime'),
              formValues.transition_stream_time_millis,
              (text) => handleModuleFieldChange('transition_stream_time_millis', text ? parseInt(text, 10) : null),
              '1000',
              'number-pad',
            )}
            {renderThemedInput(
              t('maxBufferCount'),
              formValues.max_buffer_count,
              (text) => handleModuleFieldChange('max_buffer_count', text ? parseInt(text, 10) : null),
              '5',
              'number-pad',
            )}
          </View>
        </ThemedCard>
      );
    }

    const fields = moduleConfig?.moduleSpecificFields ?? [];
    if (fields.length === 0) return null;
    return (
      <ThemedCard elevated accentStripe style={styles.section}>
        <SectionHeader title="Module Settings" />
        <View style={styles.sectionContent}>
          {fields.map((field) => (
            <View key={field.key}>
              <ThemedText size={13} variant="secondary" style={styles.fieldLabel}>
                {field.label}
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
                value={formValues[field.key]?.toString() ?? ''}
                onChangeText={(text) => {
                  if (field.type === 'number') {
                    handleModuleFieldChange(
                      field.key,
                      text === '' ? null : field.step && field.step < 1 ? parseFloat(text) : parseInt(text, 10),
                    );
                  } else {
                    handleModuleFieldChange(field.key, text);
                  }
                }}
                placeholder={field.placeholder}
                keyboardType={field.type === 'number' ? 'decimal-pad' : 'default'}
                placeholderTextColor={theme.colors.text.muted}
              />
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
          {/* ── General Section ── */}
          <ThemedCard elevated accentStripe style={styles.section}>
            <SectionHeader title="General" />
            <View style={styles.sectionContent}>
              {renderThemedInput(
                t('configName'),
                formValues.name,
                (text) => handleModuleFieldChange('name', text),
                'Enter config name',
              )}
            </View>
          </ThemedCard>

          {/* ── Simple / Advanced mode toggle ── */}
          <ThemedCard elevated style={styles.section}>
            <View style={styles.modeToggleRow}>
              <View style={styles.modeToggleCopy}>
                <ThemedText size={15} weight="medium">
                  {t('modeLabel')}
                </ThemedText>
                <ThemedText size={12} variant="muted" style={styles.modeToggleHint}>
                  {showAdvanced ? t('modeAdvancedHint') : t('modeSimpleHint')}
                </ThemedText>
              </View>

              <View
                style={[
                  styles.modeSegmented,
                  { backgroundColor: theme.colors.background.surface },
                ]}
              >
                <TouchableOpacity
                  style={[
                    styles.modeSegment,
                    !showAdvanced && [
                      styles.modeSegmentActive,
                      { backgroundColor: theme.colors.accent.primary },
                    ],
                  ]}
                  onPress={() => {
                    hapticLightPress();
                    setShowAdvanced(false);
                  }}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={t('modeSimple')}
                  accessibilityState={{ selected: !showAdvanced }}
                >
                  <ThemedText
                    size={13}
                    weight="medium"
                    variant={showAdvanced ? 'secondary' : 'primary'}
                    style={!showAdvanced ? styles.modeSegmentActiveText : undefined}
                  >
                    {t('modeSimple')}
                  </ThemedText>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.modeSegment,
                    showAdvanced && [
                      styles.modeSegmentActive,
                      { backgroundColor: theme.colors.accent.primary },
                    ],
                  ]}
                  onPress={() => {
                    hapticLightPress();
                    setShowAdvanced(true);
                  }}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={t('modeAdvanced')}
                  accessibilityState={{ selected: showAdvanced }}
                >
                  <ThemedText
                    size={13}
                    weight="medium"
                    variant={showAdvanced ? 'primary' : 'secondary'}
                    style={showAdvanced ? styles.modeSegmentActiveText : undefined}
                  >
                    {t('modeAdvanced')}
                  </ThemedText>
                </TouchableOpacity>
              </View>
            </View>
          </ThemedCard>

          {/* ── Provider → Account → Capability, per slot ── */}
          {renderSlots()}

          {/* ── Section 4 — Module ── */}
          {renderModuleSection()}

          {/* ── STT/VAD recorder test block (2-2) ── */}
          {isSTT && slots.transcription?.providerType && (
            <ThemedCard elevated accentStripe style={styles.section}>
              <SectionHeader title={t('testConfiguration')} />
              <View style={styles.sectionContent}>
                <SttTestPanel enabled={!!slots.transcription?.providerType} entityId={entityId} />
              </View>
            </ThemedCard>
          )}

          {/* ── TTS playback test block (2-3) ── */}
          {moduleType === 'tts' && slots.provider?.providerType && (
            <ThemedCard elevated accentStripe style={styles.section}>
              <SectionHeader title={t('testConfiguration')} />
              <View style={styles.sectionContent}>
                <TtsTestPanel entityId={entityId} />
              </View>
            </ThemedCard>
          )}

          {/* ── Danger Zone ── */}
          {!isCreate && (
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
    marginBottom: 16,
  },
  sectionContent: {
    padding: 16,
    gap: 12,
  },
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
