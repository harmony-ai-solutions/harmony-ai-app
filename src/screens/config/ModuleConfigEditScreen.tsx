import React, { useState, useCallback } from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import { useRoute, useNavigation, RouteProp, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { createLogger } from '../../utils/logger';

const log = createLogger('[ModuleConfigEditScreen]');

import { ScreenHeader } from '../../components/themed/ScreenHeader';
import { ThemedCard } from '../../components/themed/ThemedCard';
import { SectionHeader } from '../../components/themed/SectionHeader';
import { ThemedView } from '../../components/themed/ThemedView';
import { ThemedText } from '../../components/themed/ThemedText';
import { useAppAlert } from '../../contexts/AppAlertContext';
import { FormField } from '../../components/config/FormField';
import { AdvancedSamplingParams } from '../../components/config/AdvancedSamplingParams';
import { MODULE_TYPES, ModuleTypeConfig } from '../../constants/moduleConfiguration';
import { MODULE_DEFAULTS, PROVIDER_DEFAULTS } from '../../constants/moduleDefaults';
import { PROVIDER_SCHEMAS } from '../../constants/providerFieldSchemas';
import { useAppTheme } from '../../contexts/ThemeContext';
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
  const { bottom: safeBottom } = useSafeAreaInsets();
  
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

  useFocusEffect(
    useCallback(() => {
      loadConfig();
    }, [configId, moduleType])
  );

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

  const handleProviderSwitch = (slot: string, providerType: string) => {
    if (slot === 'provider') {
      handleModuleFieldChange('provider', providerType);
    } else if (slot === 'transcription') {
      handleModuleFieldChange('transcription_provider', providerType);
    } else if (slot === 'vad') {
      handleModuleFieldChange('vad_provider', providerType);
    }

    // Reset provider form values to defaults for the new type
    const defaults = PROVIDER_DEFAULTS[providerType] || {};
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

    try {
      if (form.providerConfigId) {
        // Update existing
        await pRepo.update({ ...providerConfig, id: form.providerConfigId });
        return form.providerConfigId;
      } else {
        // Create new
        const newId = await pRepo.create(providerConfig);
        return newId;
      }
    } catch (error) {
      log.error(`Failed to save ${providerType} provider config:`, error);
      throw error;
    }
  };

  const handleSave = async () => {
    if (!formValues.name) {
      showAlert('Error', 'Config name is required');
      return;
    }

    setSaving(true);
    try {
      const repo = MODULE_REPOSITORIES[moduleType];
      if (!repo) {
        showAlert('Error', 'Unknown module type');
        return;
      }

      if (isSTT) {
        // STT: validate both provider slots
        const txProvider = formValues.transcription_provider;
        const vadProvider = formValues.vad_provider;
        if (!txProvider) {
          showAlert('Error', 'Transcription provider is required');
          return;
        }
        if (!vadProvider) {
          showAlert('Error', 'VAD provider is required');
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
          showAlert('Error', 'Provider is required');
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
      showAlert('Error', 'Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const repo = MODULE_REPOSITORIES[moduleType];
    if (!repo || !configId) return;

    showAlert(
      'Delete Configuration',
      'Are you sure you want to delete this configuration?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
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

    // Filter out 'name' field — it's auto-generated from module config name
    const fields = schema.fields.filter(f => f.key !== 'name');

    return (
      <View style={styles.providerFieldsContainer}>
        {fields.map((field) => (
          <FormField
            key={field.key}
            field={field}
            value={form.values[field.key]}
            onChange={(key, value) => handleProviderFieldChange(slot, key, value)}
          />
        ))}

        {/* Advanced Sampling Params for OpenAI family */}
        {isOpenAIFamily && (
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
                'Main Stream Time (ms)',
                formValues.main_stream_time_millis,
                (text) => handleModuleFieldChange('main_stream_time_millis', text ? parseInt(text, 10) : null),
                '2000',
                'number-pad',
              )}
              {renderThemedInput(
                'Transition Stream Time (ms)',
                formValues.transition_stream_time_millis,
                (text) => handleModuleFieldChange('transition_stream_time_millis', text ? parseInt(text, 10) : null),
                '1000',
                'number-pad',
              )}
              {renderThemedInput(
                'Max Buffer Count',
                formValues.max_buffer_count,
                (text) => handleModuleFieldChange('max_buffer_count', text ? parseInt(text, 10) : null),
                '5',
                'number-pad',
              )}
            </View>
          </ThemedCard>
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
              onPress={handleSave}
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
        >
          {/* ── General Section ── */}
          <ThemedCard elevated accentStripe style={styles.section}>
            <SectionHeader title="General" />
            <View style={styles.sectionContent}>
              {renderThemedInput(
                'Config Name *',
                formValues.name,
                (text) => handleModuleFieldChange('name', text),
                'Enter config name',
              )}
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
});
