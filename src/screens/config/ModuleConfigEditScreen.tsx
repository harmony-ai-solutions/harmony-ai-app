import React, { useState, useCallback, useEffect } from 'react';
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
import { FormField } from '../../components/config/FormField';
import { AdvancedSamplingParams } from '../../components/config/AdvancedSamplingParams';
import { SoulbitsModelSelect } from '../../components/config/SoulbitsModelSelect';
import { MODULE_TYPES, ModuleTypeConfig } from '../../constants/moduleConfiguration';
import { MODULE_DEFAULTS, PROVIDER_DEFAULTS } from '../../constants/moduleDefaults';
import { PROVIDER_SCHEMAS } from '../../constants/providerFieldSchemas';
import { isSimpleFieldKey, isManagedCloudField } from '../../constants/moduleConfigVisibility';
import { useAppTheme } from '../../contexts/ThemeContext';
import { useSyncConnection } from '../../contexts/SyncConnectionContext';
import { SttTestPanel } from '../../components/config/SttTestPanel';
import type { ModuleTestDraftConfig } from '../../services/voiceInput/moduleTestClient';
import { CLOUD_HOSTS } from '../../config/cloud';
import { injectSoulbitsToken } from '../../services/cloud/soulbitsTokenSync';
import AuthService from '../../services/auth/AuthService';
import {
  createBackendConfig, updateBackendConfig, getBackendConfig, deleteBackendConfig,
  createCognitionConfig, updateCognitionConfig, getCognitionConfig, deleteCognitionConfig,
  createMovementConfig, updateMovementConfig, getMovementConfig, deleteMovementConfig,
  createRAGConfig, updateRAGConfig, getRAGConfig, deleteRAGConfig,
  createSTTConfig, updateSTTConfig, getSTTConfig, deleteSTTConfig,
  createTTSConfig, updateTTSConfig, getTTSConfig, deleteTTSConfig,
  createVisionConfig, updateVisionConfig, getVisionConfig, deleteVisionConfig,
  createImaginationConfig, updateImaginationConfig, getImaginationConfig, deleteImaginationConfig,
} from '../../database/repositories/modules';
import {
  createOpenAIProviderConfig, updateOpenAIProviderConfig, getOpenAIProviderConfig, deleteOpenAIProviderConfig,
} from '../../database/repositories/providers/OpenAIProviderConfigRepository';
import {
  createOpenAICompatibleProviderConfig, updateOpenAICompatibleProviderConfig, getOpenAICompatibleProviderConfig, deleteOpenAICompatibleProviderConfig,
} from '../../database/repositories/providers/OpenAICompatibleProviderConfigRepository';
import {
  createOpenRouterProviderConfig, updateOpenRouterProviderConfig, getOpenRouterProviderConfig, deleteOpenRouterProviderConfig,
} from '../../database/repositories/providers/OpenRouterProviderConfigRepository';
import {
  createElevenLabsProviderConfig, updateElevenLabsProviderConfig, getElevenLabsProviderConfig, deleteElevenLabsProviderConfig,
} from '../../database/repositories/providers/ElevenLabsProviderConfigRepository';
import {
  createHarmonySpeechProviderConfig, updateHarmonySpeechProviderConfig, getHarmonySpeechProviderConfig, deleteHarmonySpeechProviderConfig,
} from '../../database/repositories/providers/HarmonySpeechProviderConfigRepository';
import {
  createKindroidProviderConfig, updateKindroidProviderConfig, getKindroidProviderConfig, deleteKindroidProviderConfig,
} from '../../database/repositories/providers/KindroidProviderConfigRepository';
import {
  createKajiwotoProviderConfig, updateKajiwotoProviderConfig, getKajiwotoProviderConfig, deleteKajiwotoProviderConfig,
} from '../../database/repositories/providers/KajiwotoProviderConfigRepository';
import {
  createCharacterAIProviderConfig, updateCharacterAIProviderConfig, getCharacterAIProviderConfig, deleteCharacterAIProviderConfig,
} from '../../database/repositories/providers/CharacterAIProviderConfigRepository';
import {
  createLocalAIProviderConfig, updateLocalAIProviderConfig, getLocalAIProviderConfig, deleteLocalAIProviderConfig,
} from '../../database/repositories/providers/LocalAIProviderConfigRepository';
import {
  createMistralProviderConfig, updateMistralProviderConfig, getMistralProviderConfig, deleteMistralProviderConfig,
} from '../../database/repositories/providers/MistralProviderConfigRepository';
import {
  createOllamaProviderConfig, updateOllamaProviderConfig, getOllamaProviderConfig, deleteOllamaProviderConfig,
} from '../../database/repositories/providers/OllamaProviderConfigRepository';
import {
  createComfyUIProviderConfig, updateComfyUIProviderConfig, getComfyUIProviderConfig, deleteComfyUIProviderConfig,
} from '../../database/repositories/providers/ComfyUIProviderConfigRepository';
import {
  createGoogleProviderConfig, updateGoogleProviderConfig, getGoogleProviderConfig, deleteGoogleProviderConfig,
} from '../../database/repositories/providers/GoogleProviderConfigRepository';
import {
  createXAIProviderConfig, updateXAIProviderConfig, getXAIProviderConfig, deleteXAIProviderConfig,
} from '../../database/repositories/providers/XAIProviderConfigRepository';
import {
  createAnthropicProviderConfig, updateAnthropicProviderConfig, getAnthropicProviderConfig, deleteAnthropicProviderConfig,
} from '../../database/repositories/providers/AnthropicProviderConfigRepository';
import {
  createSoulbitsCloudProviderConfig, updateSoulbitsCloudProviderConfig, getSoulbitsCloudProviderConfig, deleteSoulbitsCloudProviderConfig,
} from '../../database/repositories/providers/SoulbitsCloudProviderConfigRepository';

type RootStackParamList = {
  ModuleConfigEdit: {
    moduleType: string;
    configId?: string;
  };
};

type ModuleConfigEditRouteProp = RouteProp<RootStackParamList, 'ModuleConfigEdit'>;
type ModuleConfigEditNavigationProp = NativeStackNavigationProp<RootStackParamList, 'ModuleConfigEdit'>;

const OPENAI_FAMILY = ['openai', 'openaicompatible', 'openrouter', 'google', 'xai', 'anthropic'];

/** Beta-aware inference host, used to prefill the Soulbits Cloud base_url when connected. */
function soulbitsCloudBaseUrl(cloudConnected: boolean): string | undefined {
  return cloudConnected ? CLOUD_HOSTS.inference : undefined;
}

/**
 * Build the STT test block's draft config from the editable form state (2-2).
 * Passes the current draft (possibly unsaved) STT config so the engine runs the
 * *configured* provider end-to-end. provider_config_id is resolved server-side.
 * Returns null until a transcription provider is selected.
 */
function buildSttTestDraft(
  formValues: Record<string, any>,
  txConfigId: string | null | undefined,
  vadConfigId: string | null | undefined,
): ModuleTestDraftConfig | null {
  if (!formValues.transcription_provider) return null;
  return {
    provider_type: formValues.transcription_provider,
    provider_config_id: txConfigId ?? null,
    module_config: {
      transcription_provider: formValues.transcription_provider,
      transcription_provider_config_id: txConfigId ?? null,
      vad_provider: formValues.vad_provider ?? '',
      vad_provider_config_id: vadConfigId ?? null,
      main_stream_time_millis: formValues.main_stream_time_millis,
      transition_stream_time_millis: formValues.transition_stream_time_millis,
      max_buffer_count: formValues.max_buffer_count,
    },
  };
}

/**
 * True when the api_key field holds an injected cloud PASETO (v4.local.*) that
 * must be shown read-only — same prefix heuristic the engine uses to switch
 * between PASETO mode and plain API-key mode (`strings.HasPrefix(apiKey,
 * "v4.local.")`). Prevents the user from copying/editing the managed credential.
 */
function isManagedSoulbitsApiKey(
  providerType: string,
  fieldKey: string,
  apiKey: string | undefined,
): boolean {
  return providerType === 'soulbitscloud'
    && fieldKey === 'api_key'
    && typeof apiKey === 'string'
    && apiKey.startsWith('v4.local.');
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

const PROVIDER_REPOSITORIES: Record<string, {
  create: (config: any) => Promise<string>;
  update: (config: any) => Promise<void>;
  get: (id: string) => Promise<any | null>;
  delete: (id: string) => Promise<void>;
}> = {
  openai: { create: createOpenAIProviderConfig, update: updateOpenAIProviderConfig, get: getOpenAIProviderConfig, delete: deleteOpenAIProviderConfig },
  openaicompatible: { create: createOpenAICompatibleProviderConfig, update: updateOpenAICompatibleProviderConfig, get: getOpenAICompatibleProviderConfig, delete: deleteOpenAICompatibleProviderConfig },
  openrouter: { create: createOpenRouterProviderConfig, update: updateOpenRouterProviderConfig, get: getOpenRouterProviderConfig, delete: deleteOpenRouterProviderConfig },
  elevenlabs: { create: createElevenLabsProviderConfig, update: updateElevenLabsProviderConfig, get: getElevenLabsProviderConfig, delete: deleteElevenLabsProviderConfig },
  harmonyspeech: { create: createHarmonySpeechProviderConfig, update: updateHarmonySpeechProviderConfig, get: getHarmonySpeechProviderConfig, delete: deleteHarmonySpeechProviderConfig },
  kindroid: { create: createKindroidProviderConfig, update: updateKindroidProviderConfig, get: getKindroidProviderConfig, delete: deleteKindroidProviderConfig },
  kajiwoto: { create: createKajiwotoProviderConfig, update: updateKajiwotoProviderConfig, get: getKajiwotoProviderConfig, delete: deleteKajiwotoProviderConfig },
  characterai: { create: createCharacterAIProviderConfig, update: updateCharacterAIProviderConfig, get: getCharacterAIProviderConfig, delete: deleteCharacterAIProviderConfig },
  localai: { create: createLocalAIProviderConfig, update: updateLocalAIProviderConfig, get: getLocalAIProviderConfig, delete: deleteLocalAIProviderConfig },
  mistral: { create: createMistralProviderConfig, update: updateMistralProviderConfig, get: getMistralProviderConfig, delete: deleteMistralProviderConfig },
  ollama: { create: createOllamaProviderConfig, update: updateOllamaProviderConfig, get: getOllamaProviderConfig, delete: deleteOllamaProviderConfig },
  comfyui: { create: createComfyUIProviderConfig, update: updateComfyUIProviderConfig, get: getComfyUIProviderConfig, delete: deleteComfyUIProviderConfig },
  google: { create: createGoogleProviderConfig, update: updateGoogleProviderConfig, get: getGoogleProviderConfig, delete: deleteGoogleProviderConfig },
  xai: { create: createXAIProviderConfig, update: updateXAIProviderConfig, get: getXAIProviderConfig, delete: deleteXAIProviderConfig },
  anthropic: { create: createAnthropicProviderConfig, update: updateAnthropicProviderConfig, get: getAnthropicProviderConfig, delete: deleteAnthropicProviderConfig },
  soulbitscloud: { create: createSoulbitsCloudProviderConfig, update: updateSoulbitsCloudProviderConfig, get: getSoulbitsCloudProviderConfig, delete: deleteSoulbitsCloudProviderConfig },
};

export const ModuleConfigEditScreen: React.FC = () => {
  const route = useRoute<ModuleConfigEditRouteProp>();
  const navigation = useNavigation<ModuleConfigEditNavigationProp>();
  const { theme } = useAppTheme();
  const { showAlert } = useAppAlert();
  const { t } = useTranslation('moduleConfig');
  const { bottom: safeBottom } = useSafeAreaInsets();
  const { isConnected, connectionStatus } = useSyncConnection();
  const cloudConnected = connectionStatus?.mode === 'cloud' && isConnected === true;
  // Managed Soulbits Cloud mode — endpoint + tokens are auto-synced from the
  // backend, so the credential/endpoint fields should be hidden regardless of
  // the momentary WS connection state.
  const isCloudMode = connectionStatus?.mode === 'cloud';
  
  const { moduleType, configId } = route.params;
  const isCreate = !configId;
  const isSTT = moduleType === 'stt';
  
  // Module config fields (name, module-specific fields, provider references)
  const [formValues, setFormValues] = useState<Record<string, any>>({
    name: '',
    provider: '',
  });
  
  // Inline provider config fields — keyed by provider slot
  // For standard modules: 'provider' (single slot)
  // For STT: 'transcription' and 'vad' (two slots)
  const [providerForms, setProviderForms] = useState<Record<string, {
    providerConfigId: string | null;
    values: Record<string, any>;
  }>>({});
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Simple vs Advanced mode toggle — Simple hides the deep technical fields.
  const [showAdvanced, setShowAdvanced] = useState(false);

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

  const loadConfig = async () => {
    if (!configId) {
      // Create mode — prefill with module defaults
      const defaults = MODULE_DEFAULTS[moduleType] || {};
      setFormValues(prev => ({
        ...prev,
        ...defaults,
      }));
      
      if (isSTT) {
        setProviderForms({
          transcription: { providerConfigId: null, values: {} },
          vad: { providerConfigId: null, values: {} },
        });
      } else {
        setProviderForms({
          provider: { providerConfigId: null, values: {} },
        });
      }
      
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
      if (config) {
        if (isSTT) {
          setFormValues({
            name: config.name,
            transcription_provider: config.transcription_provider ?? '',
            vad_provider: config.vad_provider ?? '',
            main_stream_time_millis: config.main_stream_time_millis,
            transition_stream_time_millis: config.transition_stream_time_millis,
            max_buffer_count: config.max_buffer_count,
          });

          // Load transcription provider config inline
          const txProviderType = config.transcription_provider;
          const txProviderConfigId = config.transcription_provider_config_id;
          let txProviderValues: Record<string, any> = {};
          if (txProviderType && txProviderConfigId) {
            const pRepo = PROVIDER_REPOSITORIES[txProviderType];
            if (pRepo) {
              const pConfig = await pRepo.get(txProviderConfigId);
              if (pConfig) {
                const defaults = PROVIDER_DEFAULTS[txProviderType] || {};
                txProviderValues = { ...defaults, ...pConfig };
              }
            }
          }

          // Load VAD provider config inline
          const vadProviderType = config.vad_provider;
          const vadProviderConfigId = config.vad_provider_config_id;
          let vadProviderValues: Record<string, any> = {};
          if (vadProviderType && vadProviderConfigId) {
            const pRepo = PROVIDER_REPOSITORIES[vadProviderType];
            if (pRepo) {
              const pConfig = await pRepo.get(vadProviderConfigId);
              if (pConfig) {
                const defaults = PROVIDER_DEFAULTS[vadProviderType] || {};
                vadProviderValues = { ...defaults, ...pConfig };
              }
            }
          }

          setProviderForms({
            transcription: { providerConfigId: txProviderConfigId ?? null, values: txProviderValues },
            vad: { providerConfigId: vadProviderConfigId ?? null, values: vadProviderValues },
          });
        } else {
          // Standard module
          const providerType = config.provider;
          const providerConfigId = config.provider_config_id;
          
          const moduleFields = Object.fromEntries(
            Object.entries(config).filter(([k]) =>
              !['id', 'name', 'provider', 'provider_config_id', 'deleted_at'].includes(k)
            )
          );

          setFormValues({
            name: config.name,
            provider: providerType ?? '',
            ...moduleFields,
          });

          // Load provider config values inline
          let providerValues: Record<string, any> = {};
          if (providerType && providerConfigId) {
            const pRepo = PROVIDER_REPOSITORIES[providerType];
            if (pRepo) {
              const pConfig = await pRepo.get(providerConfigId);
              if (pConfig) {
                const defaults = PROVIDER_DEFAULTS[providerType] || {};
                providerValues = { ...defaults, ...pConfig };
              }
            }
          }

          setProviderForms({
            provider: { providerConfigId: providerConfigId ?? null, values: providerValues },
          });
        }
      }
    } catch (error) {
      log.error('Failed to load config:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleModuleFieldChange = (key: string, value: any) => {
    setFormValues(prev => ({ ...prev, [key]: value }));
  };

  const handleProviderFieldChange = (slot: string, key: string, value: any) => {
    setProviderForms(prev => ({
      ...prev,
      [slot]: {
        ...prev[slot],
        values: {
          ...prev[slot].values,
          [key]: value,
        },
      },
    }));
  };

  const handleProviderSwitch = async (slot: string, providerType: string) => {
    if (slot === 'provider') {
      handleModuleFieldChange('provider', providerType);
    } else if (slot === 'transcription') {
      handleModuleFieldChange('transcription_provider', providerType);
    } else if (slot === 'vad') {
      handleModuleFieldChange('vad_provider', providerType);
    }

    // Reset provider form values to defaults for the new type
    const defaults = PROVIDER_DEFAULTS[providerType] || {};

    // Feature 1: when switching TO Soulbits Cloud while connected, prefill the
    // beta-aware inference endpoint (overrides the prod default baked into PROVIDER_DEFAULTS).
    if (providerType === 'soulbitscloud') {
      const prefillUrl = soulbitsCloudBaseUrl(cloudConnected);
      if (prefillUrl) {
        defaults.base_url = prefillUrl;
      }
      // Pre-seed the cloud PASETO as api_key (read-only in the form) so new
      // configs ship with a working credential without manual entry.
      try {
        const paseto = await AuthService.getToken();
        if (paseto) {
          defaults.api_key = paseto;
        }
      } catch {
        // No cloud token — standalone mode. Leave api_key empty for the user.
      }
    }

    setProviderForms(prev => ({
      ...prev,
      [slot]: {
        providerConfigId: null, // new provider type = no existing config
        values: { ...defaults },
      },
    }));
  };

  const handleExtraParamsChange = (slot: string, jsonString: string) => {
    handleProviderFieldChange(slot, 'extra_params', jsonString);
  };

  /**
   * Save provider config (create or update), return the config ID.
   */
  const saveProviderConfig = async (
    providerType: string,
    slot: string,
  ): Promise<string | null> => {
    const pRepo = PROVIDER_REPOSITORIES[providerType];
    if (!pRepo) return null;

    const form = providerForms[slot];
    if (!form) return null;

    // Build the provider config object from form values
    const providerConfig = { ...form.values };

    // Ensure the name field is set (derive from module config name + provider type)
    if (!providerConfig.name) {
      providerConfig.name = `${formValues.name || 'Config'} - ${providerType}`;
    }

    // Inject the current cloud PASETO as api_key for NEW soulbitscloud configs
    // (belt-and-braces on top of the form prefill — catches token refreshes that
    // happened while the form was open). No-op for updates / standalone mode.
    const seededConfig = await injectSoulbitsToken({
      providerType,
      isCreate: !form.providerConfigId,
      providerConfig,
    });

    try {
      if (form.providerConfigId) {
        // Update existing
        await pRepo.update({ ...seededConfig, id: form.providerConfigId });
        return form.providerConfigId;
      } else {
        // Create new
        const newId = await pRepo.create(seededConfig);
        return newId;
      }
    } catch (error) {
      log.error(`Failed to save ${providerType} provider config:`, error);
      throw error;
    }
  };

  const handleSave = async () => {
    if (!formValues.name) {
      showAlert(t('common:error'), t('configNameRequired'));
      return;
    }

    setSaving(true);
    try {
      const repo = MODULE_REPOSITORIES[moduleType];
      if (!repo) {
        showAlert(t('common:error'), t('unknownModuleType'));
        return;
      }

      if (isSTT) {
        // STT: validate both provider slots
        const txProvider = formValues.transcription_provider;
        const vadProvider = formValues.vad_provider;
        if (!txProvider) {
          showAlert(t('common:error'), t('transcriptionProviderRequired'));
          return;
        }
        if (!vadProvider) {
          showAlert(t('common:error'), t('vadProviderRequired'));
          return;
        }

        // Save transcription provider config
        const txConfigId = await saveProviderConfig(txProvider, 'transcription');
        // Save VAD provider config
        const vadConfigId = await saveProviderConfig(vadProvider, 'vad');

        const moduleConfig = {
          name: formValues.name,
          transcription_provider: txProvider,
          transcription_provider_config_id: txConfigId,
          vad_provider: vadProvider,
          vad_provider_config_id: vadConfigId,
          main_stream_time_millis: formValues.main_stream_time_millis,
          transition_stream_time_millis: formValues.transition_stream_time_millis,
          max_buffer_count: formValues.max_buffer_count,
        };

        if (isCreate) {
          await repo.create(moduleConfig);
        } else {
          await repo.update({ ...moduleConfig, id: configId });
        }
      } else {
        // Standard module
        const providerType = formValues.provider;
        if (!providerType) {
          showAlert(t('common:error'), t('providerRequired'));
          return;
        }

        // Save provider config inline
        const providerConfigId = await saveProviderConfig(providerType, 'provider');

        // Build module config, filtering out provider config fields
        const moduleSpecificKeys = (MODULE_TYPES.find(m => m.id === moduleType)?.moduleSpecificFields || []).map(f => f.key);
        const moduleSpecificDefaults = MODULE_DEFAULTS[moduleType] || {};
        const moduleFields: Record<string, any> = {};
        for (const key of moduleSpecificKeys) {
          if (formValues[key] !== undefined) {
            moduleFields[key] = formValues[key];
          }
        }

        const moduleConfig = {
          name: formValues.name,
          provider: providerType,
          provider_config_id: providerConfigId,
          ...moduleFields,
        };

        if (isCreate) {
          await repo.create(moduleConfig);
        } else {
          await repo.update({ ...moduleConfig, id: configId });
        }
      }
      
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
            navigation.goBack();
          },
        },
      ]
    );
  };

  const getModuleConfig = (): ModuleTypeConfig | undefined => {
    return MODULE_TYPES.find(m => m.id === moduleType);
  };

  const moduleConfig = getModuleConfig();

  // ── Provider option chip ──
  const renderProviderOption = (
    option: { id: string; name: string },
    currentValue: string,
    onSelect: (id: string) => void,
    keyPrefix: string = '',
  ) => {
    const isSelected = currentValue === option.id;
    return (
      <TouchableOpacity
        key={`${keyPrefix}${option.id}`}
        style={[
          styles.providerChip,
          {
            borderColor: isSelected
              ? theme!.colors.accent.primary
              : theme!.colors.border.default,
            backgroundColor: isSelected
              ? theme!.colors.accent.primary + '1A'
              : theme!.colors.background.base,
          },
        ]}
        onPress={() => onSelect(option.id)}
        activeOpacity={0.7}
      >
        {isSelected && (
          <LinearGradient
            colors={[theme!.colors.accent.primary, theme!.colors.accent.secondary]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={styles.chipPip}
          />
        )}
        <ThemedText
          size={13}
          variant={isSelected ? 'accent' : 'primary'}
          weight={isSelected ? 'medium' : 'normal'}
          style={{ paddingLeft: isSelected ? 8 : 0 }}
        >
          {option.name}
        </ThemedText>
        {isSelected && (
          <Icon name="check" size={14} color={theme!.colors.accent.primary} style={{ marginLeft: 4 }} />
        )}
      </TouchableOpacity>
    );
  };

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
            color: theme!.colors.text.primary,
            borderColor: theme!.colors.border.default,
            backgroundColor: theme!.colors.background.base,
          },
        ]}
        value={value?.toString() ?? ''}
        onChangeText={onChangeText}
        placeholder={placeholder}
        keyboardType={keyboardType}
        placeholderTextColor={theme!.colors.text.muted}
      />
    </View>
  );

  // ── Render inline provider config fields for a slot ──
  const renderInlineProviderFields = (
    slot: string,
    providerType: string,
  ) => {
    const schema = PROVIDER_SCHEMAS[providerType];
    if (!schema) return null;

    const form = providerForms[slot];
    if (!form) return null;

    const isOpenAIFamily = OPENAI_FAMILY.includes(providerType);

    // Fields used to look up the module model catalog. The STT VAD slot uses a
    // dedicated 'vad' mapping (voice-activity models, e.g. silero-vad) instead
    // of the STT transcription models.
    const modelModuleType = slot === 'vad' ? 'vad' : moduleType;

    // Filter out 'name' field (auto-generated from module config name) and, in
    // Simple mode, any field not in the essential set.
    const fields = schema.fields.filter(f => {
      if (f.key === 'name') return false;
      if (showAdvanced) return true;
      return isSimpleFieldKey(f.key);
    });

    // Managed Soulbits Cloud provider (cloud mode): the endpoint and the
    // API key/token are auto-synced from the backend — hide both fields in
    // Simple AND Advanced mode so the screen never suggests they are
    // user-configurable. The credential is still injected server-side
    // (injectSoulbitsToken) and synced via soulbitsTokenSync.
    const isManagedCloudProvider =
      providerType === 'soulbitscloud' && isCloudMode;

    return (
      <View style={styles.providerFieldsContainer}>
        {fields.map((field) => {
          // Hide endpoint/credential fields for managed Soulbits Cloud providers.
          if (isManagedCloudProvider && isManagedCloudField(field.key)) {
            return null;
          }

          if (providerType === 'soulbitscloud' && field.key === 'model') {
            return (
              <View key={field.key} style={{ marginBottom: 16 }}>
                <ThemedText size={13} variant="secondary" style={styles.fieldLabel}>{field.label}</ThemedText>
                <SoulbitsModelSelect
                  moduleType={modelModuleType}
                  value={form.values.model ?? ''}
                  onChange={(m) => handleProviderFieldChange(slot, 'model', m)}
                />
              </View>
            );
          }
          return (
            <FormField
              key={field.key}
              field={field}
              value={form.values[field.key]}
              onChange={(key, value) => handleProviderFieldChange(slot, key, value)}
              readOnly={isManagedSoulbitsApiKey(providerType, field.key, form.values.api_key)}
            />
          );
        })}

        {/* Advanced Sampling Params for OpenAI family (Advanced mode only) */}
        {showAdvanced && isOpenAIFamily && (
          <AdvancedSamplingParams
            extraParamsJson={form.values.extra_params || '{}'}
            onChange={(json) => handleExtraParamsChange(slot, json)}
          />
        )}
      </View>
    );
  };

  // ── Render provider section for a single slot ──
  const renderProviderSection = (
    slot: string,
    label: string,
    providerType: string,
  ) => {
    const providerOptions = moduleConfig?.providerOptions || [];

    return (
      <ThemedCard elevated accentStripe style={styles.section}>
        <SectionHeader title={label} />
        <View style={styles.sectionContent}>
          {/* Provider type selector */}
          <View>
            <ThemedText size={13} variant="secondary" style={styles.fieldLabel}>
              Provider Type *
            </ThemedText>
            <View style={styles.providerChips}>
              {providerOptions.map((option) =>
                renderProviderOption(
                  option,
                  providerType,
                  (id) => handleProviderSwitch(slot, id),
                )
              )}
            </View>
          </View>

          {/* Inline provider config fields */}
          {providerType && renderInlineProviderFields(slot, providerType)}
        </View>
      </ThemedCard>
    );
  };

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

  const renderModuleSpecificFields = () => {
    if (isSTT) {
      // STT special case: dual provider slots
      return (
        <>
          {/* Transcription Provider Section */}
          {renderProviderSection(
            'transcription',
            'Transcription Provider',
            formValues.transcription_provider,
          )}

          {/* VAD Provider Section */}
          {renderProviderSection(
            'vad',
            'VAD Provider',
            formValues.vad_provider,
          )}

          {/* STT Settings Section */}
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

          {/* ── STT/VAD recorder test block (2-2) — tests the configured / draft provider ── */}
          {(() => {
            const sttDraft = buildSttTestDraft(
              formValues,
              providerForms['transcription']?.providerConfigId,
              providerForms['vad']?.providerConfigId,
            );
            if (!sttDraft) return null;
            return (
              <ThemedCard elevated accentStripe style={styles.section}>
                <SectionHeader title={t('testConfiguration')} />
                <View style={styles.sectionContent}>
                  <SttTestPanel draftConfig={sttDraft} enabled={!!formValues.transcription_provider} />
                </View>
              </ThemedCard>
            );
          })()}
        </>
      );
    }

    // Standard modules: Module Settings above Provider Settings
    const fields = moduleConfig?.moduleSpecificFields ?? [];
    
    return (
      <>
        {/* Module-specific fields */}
        {fields.length > 0 && (
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
                        handleModuleFieldChange(field.key, text === '' ? null : (field.step && field.step < 1 ? parseFloat(text) : parseInt(text, 10)));
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
        )}

        {/* Provider config section (inline) */}
        {renderProviderSection(
          'provider',
          'Provider Settings',
          formValues.provider,
        )}
      </>
    );
  };

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
              colors={[theme!.colors.accent.primary]}
              tintColor={theme!.colors.accent.primary}
              progressBackgroundColor={theme!.colors.background.surface}
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

          {/* Module-specific fields (including STT dual-provider) */}
          {renderModuleSpecificFields()}

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

  // ── Provider chips ──
  providerChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  providerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
  },
  chipPip: {
    width: 3,
    height: 16,
    borderRadius: 2,
    marginRight: 0,
  },

  // ── Inline provider fields ──
  providerFieldsContainer: {
    marginTop: 4,
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
});
