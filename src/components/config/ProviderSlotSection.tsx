/**
 * ProviderSlotSection — one provider slot of the module-config form
 * (provider-registry 6-3, plan §7).
 *
 * Renders the final flow for a single slot:
 *
 *   Provider (type) → Account (picker, auto-collapsed when single)
 *   → Capability (engine-registry-backed model picker + "Fetch from provider",
 *     ElevenLabs voice picker, sampling-preset dropdown, R12 param warnings).
 *
 * The parent (ModuleConfigEditScreen) owns the slot STATE (provider type,
 * `provider_account_id`, capability overlay) and the module-level sections; this
 * component owns the transient live-discovery state and the account-switch
 * revalidation (plan §3.2): when the account changes it debounces a live fetch
 * and marks an overlay model/voice ref stale when the new account's list lacks
 * it — never dropping the value.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useTranslation } from 'react-i18next';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { ThemedCard } from '../themed/ThemedCard';
import { SectionHeader } from '../themed/SectionHeader';
import { ThemedText } from '../themed/ThemedText';
import { FormField } from './FormField';
import { AccountPicker } from './AccountPicker';
import { CatalogModelSelect } from './CatalogModelSelect';
import { VoicePicker } from './VoicePicker';
import { SoulbitsModelSelect } from './SoulbitsModelSelect';
import { SamplingPresetSelect } from './SamplingPresetSelect';
import { AdvancedSamplingParams } from './AdvancedSamplingParams';
import { useAppTheme } from '../../contexts/ThemeContext';
import { useProviderModels } from '../../hooks/useProviderModels';
import { useProviderCapabilityCatalog } from '../../hooks/useProviderCapabilityCatalog';
import {
  catalogModelsForModule,
  findModel,
  isSamplingParamKey,
  isParamSupported,
} from '../../constants/modelCapabilities';
import { PROVIDER_SCHEMAS } from '../../constants/providerFieldSchemas';
import type { FieldDefinition } from '../../constants/providerFieldSchemas';
import { isSimpleFieldKey } from '../../constants/moduleConfigVisibility';
import type { ProviderOption } from '../../constants/moduleConfiguration';
import type { ProviderAccount } from '../../database/models';

/** The OpenAI-family providers whose extra sampling params render in Advanced. */
const OPENAI_FAMILY = ['openai', 'openaicompatible', 'openrouter', 'google', 'xai', 'anthropic'];

export interface SlotState {
  providerType: string;
  accountId: string | null;
  capability: Record<string, any>;
}

interface ProviderSlotSectionProps {
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
  onProviderChange: (type: string) => void;
  onAccountChange: (accountId: string | null) => void;
  onCapabilityChange: (key: string, value: any) => void;
  onAddAccount: () => void;
}

export const ProviderSlotSection: React.FC<ProviderSlotSectionProps> = ({
  slot,
  slotLabel,
  modelModuleType,
  providerOptions,
  state,
  accounts,
  showAdvanced,
  explicitFields,
  onProviderChange,
  onAccountChange,
  onCapabilityChange,
  onAddAccount,
}) => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('moduleConfig');
  const { catalog } = useProviderCapabilityCatalog();

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
  const selectedModel = findModel(entries, state.capability.model);
  const modelStale =
    liveModels != null &&
    !!state.capability.model &&
    !liveModels.some((m) => m.id === state.capability.model);
  const voiceStale =
    voices != null &&
    !!state.capability.voice_id &&
    !voices.some((v) => v.voice_id === state.capability.voice_id);

  const sectionTitle = (section: string) =>
    slotLabel ? `${slotLabel} ${section}` : section;

  // ── Provider type chips ──
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
            {isSelected && (
              <LinearGradient
                colors={[theme.colors.accent.primary, theme.colors.accent.secondary]}
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
              <Icon name="check" size={14} color={theme.colors.accent.primary} style={{ marginLeft: 4 }} />
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );

  // ── One capability field ──
  const renderCapabilityField = (field: FieldDefinition) => {
    if (field.key === 'model') {
      if (state.providerType === 'soulbitscloud') {
        return (
          <View key={field.key} style={styles.fieldWrap}>
            <ThemedText size={13} variant="secondary" style={styles.fieldLabel}>
              {field.label}
            </ThemedText>
            <SoulbitsModelSelect
              moduleType={modelModuleType}
              value={state.capability.model ?? ''}
              onChange={(m) => onCapabilityChange('model', m)}
            />
          </View>
        );
      }
      return (
        <View key={field.key} style={styles.fieldWrap}>
          <ThemedText size={13} variant="secondary" style={styles.fieldLabel}>
            {field.label}
          </ThemedText>
          <CatalogModelSelect
            providerType={state.providerType}
            moduleType={modelModuleType}
            value={state.capability.model ?? ''}
            onChange={(m) => onCapabilityChange('model', m)}
            label={field.label}
            liveModels={liveModels}
            canFetch={account != null}
            fetching={fetching}
            fetchError={fetchError}
            onFetch={fetchNow}
            stale={modelStale}
          />
        </View>
      );
    }

    if (field.key === 'voice_id' && state.providerType === 'elevenlabs') {
      return (
        <View key={field.key} style={styles.fieldWrap}>
          <ThemedText size={13} variant="secondary" style={styles.fieldLabel}>
            {field.label}
          </ThemedText>
          <VoicePicker
            label={field.label}
            value={state.capability.voice_id ?? ''}
            onChange={(id) => onCapabilityChange('voice_id', id)}
            voices={voices}
            stale={voiceStale}
          />
        </View>
      );
    }

    if (field.key === 'sampling_preset_name') {
      return (
        <View key={field.key} style={styles.fieldWrap}>
          <ThemedText size={13} variant="secondary" style={styles.fieldLabel}>
            {field.label}
          </ThemedText>
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

    // R12 param warning (expert mode only; never a hard block). A model that
    // declares no parameter set (sparse coverage pre-5-2) never warns.
    const unsupported =
      isSamplingParamKey(field.key) && isParamSupported(selectedModel, field.key) === false;

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
              {t('paramUnsupported', { model: state.capability.model ?? '' })}
            </ThemedText>
          </View>
        )}
      </View>
    );
  };

  const capabilityFields = (PROVIDER_SCHEMAS[state.providerType]?.fields ?? []).filter((f) => {
    if (f.key === 'name') return false;
    if (!showAdvanced && !isSimpleFieldKey(f.key)) return false;
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

  const isOpenAIFamily = OPENAI_FAMILY.includes(state.providerType);
  const showAdvancedSampling = showAdvanced && isOpenAIFamily;

  return (
    <>
      {/* 1 — Provider */}
      <ThemedCard elevated accentStripe style={styles.section}>
        <SectionHeader title={sectionTitle('Provider')} />
        <View style={styles.sectionContent}>
          <ThemedText size={13} variant="secondary" style={styles.fieldLabel}>
            {t('providerType')}
          </ThemedText>
          {renderProviderChips()}
        </View>
      </ThemedCard>

      {/* 2 — Account (only once a type is chosen) */}
      {state.providerType ? (
        <ThemedCard elevated accentStripe style={styles.section}>
          <SectionHeader title={sectionTitle('Account')} />
          <View style={styles.sectionContent}>
            <AccountPicker
              slot={slot}
              accounts={accounts}
              selectedId={state.accountId}
              onSelect={onAccountChange}
              onAddAccount={onAddAccount}
            />
          </View>
        </ThemedCard>
      ) : null}

      {/* 3 — Capability */}
      {state.providerType ? (
        <ThemedCard elevated accentStripe style={styles.section}>
          <SectionHeader title={sectionTitle('Capability')} />
          <View style={styles.sectionContent}>
            {capabilityFields.map(renderCapabilityField)}
            {showAdvancedSampling && (
              <AdvancedSamplingParams
                extraParamsJson={state.capability.extra_params || '{}'}
                onChange={(json) => onCapabilityChange('extra_params', json)}
              />
            )}
          </View>
        </ThemedCard>
      ) : null}
    </>
  );
};

const styles = StyleSheet.create({
  section: { marginBottom: 16 },
  sectionContent: { padding: 16 },
  fieldWrap: { marginBottom: 16 },
  fieldLabel: { marginBottom: 6 },
  providerChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  providerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipPip: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
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
});
