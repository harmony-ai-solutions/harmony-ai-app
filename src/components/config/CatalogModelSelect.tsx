/**
 * CatalogModelSelect — engine-registry-backed model picker with live refresh.
 *
 * Provider-registry 6-3 (supersedes the 2-1 interim app-side catalog). The
 * picker is fed by the engine's tier-2 capability registry
 * (`GET /api/providers/capabilities`, via {@link useProviderCapabilityCatalog})
 * and, once the user runs **"Fetch from provider"**, by the live discovery
 * result the parent slot passes in as `liveModels` (merge order: live > catalog,
 * plan §6.3). Behaviour:
 *
 *  - Entries exist → a `SelectPicker` of the entries + a trailing "Custom…"
 *    option (free text escape hatch). A saved value not in the list stays
 *    selectable so a manual choice round-trips on reload.
 *  - No entries (live-authoritative provider not yet fetched, unknown module, or
 *    the STT VAD slot) → a plain free-text input.
 *  - A provenance chip (`detected` / `known` / `assumed`) on the selected model
 *    and a context-window chip when known.
 *  - A stale marker when the parent reports the saved model is absent from the
 *    new account's live list (revalidation, plan §3.2) — the value is NEVER
 *    dropped, the user is offered a re-fetch / replacement.
 */

import React, { useState } from 'react';
import { View, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { SelectPicker } from './SelectPicker';
import { useProviderCapabilityCatalog } from '../../hooks/useProviderCapabilityCatalog';
import { catalogModelsForModule, findModel } from '../../constants/modelCapabilities';
import type { ModelInfoDto } from '../../services/engine/EngineApiClient';

/** Sentinel option id for the "Custom…" row (never a real model id). */
export const CUSTOM_MODEL_OPTION_ID = '__custom__';

/** Test id for the free-text fallback input. */
export const CUSTOM_MODEL_INPUT_TESTID = 'catalog-model-custom-input';

/** Test id for the "Fetch from provider" button. */
export const MODEL_FETCH_TESTID = 'catalog-model-fetch';

/** Test id for the stale-ref marker (revalidation). */
export const MODEL_STALE_TESTID = 'catalog-model-stale';

/** Test id for a model's provenance chip. */
export function modelProvenanceChipTestId(modelId: string): string {
  return `model-provenance-${modelId}`;
}

/**
 * Format a context-window token count for the note chip, e.g. 128000 → "128K",
 * 1050000 → "1.05M", 8192 → "8.2K".
 */
export function formatContextWindow(context: number): string {
  if (context >= 1_000_000) {
    return `${(context / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`;
  }
  if (context >= 1_000) {
    return `${(context / 1_000).toFixed(1).replace(/\.?0+$/, '')}K`;
  }
  return String(context);
}

interface CatalogModelSelectProps {
  providerType: string;
  /** The module whose models should be offered (STT uses 'stt' / 'vad'). */
  moduleType: string;
  value: string;
  onChange: (model: string) => void;
  /** Field label (falls back to the generic "Model" translation). */
  label?: string;
  /** Live-discovered models for the selected account (null = not fetched). */
  liveModels?: ModelInfoDto[] | null;
  /** Whether a live fetch can run (an account with credentials is selected). */
  canFetch?: boolean;
  fetching?: boolean;
  fetchError?: string | null;
  /** Trigger the on-demand live refresh (`POST /api/providers/models`). */
  onFetch?: () => void;
  /** True when the saved value is absent from the new account's live list. */
  stale?: boolean;
}

export const CatalogModelSelect: React.FC<CatalogModelSelectProps> = ({
  providerType,
  moduleType,
  value,
  onChange,
  label,
  liveModels,
  canFetch = false,
  fetching = false,
  fetchError = null,
  onFetch,
  stale = false,
}) => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('moduleConfig');
  const { catalog } = useProviderCapabilityCatalog();

  // Merge order (plan §6.3): a live result wins; otherwise the offline catalog
  // slice filtered to the module.
  const entries: ModelInfoDto[] =
    liveModels ?? catalogModelsForModule(catalog[providerType], moduleType);
  const usingLive = liveModels != null;
  const selectedEntry = findModel(entries, value);

  // "Custom…" tapped this session (value may still hold a catalog id).
  const [customRequested, setCustomRequested] = useState(false);

  if (!theme) return null;

  const showFreeText = entries.length === 0 || customRequested;

  const renderFetchRow = () => {
    if (!onFetch) return null;
    return (
      <View style={styles.fetchRow}>
        <TouchableOpacity
          onPress={onFetch}
          disabled={!canFetch || fetching}
          accessibilityRole="button"
          accessibilityLabel={t('modelFetch')}
          testID={MODEL_FETCH_TESTID}
          style={[
            styles.fetchButton,
            {
              borderColor: theme.colors.accent.primary,
              opacity: !canFetch || fetching ? 0.5 : 1,
            },
          ]}
        >
          {fetching ? (
            <ActivityIndicator size="small" color={theme.colors.accent.primary} />
          ) : (
            <ThemedText size={13} variant="accent" weight="medium">
              {t('modelFetch')}
            </ThemedText>
          )}
        </TouchableOpacity>
        {fetching && (
          <ThemedText variant="muted" size={11} style={styles.hint}>
            {t('modelFetching')}
          </ThemedText>
        )}
        {!fetching && fetchError && (
          <ThemedText variant="muted" size={11} style={styles.hint}>
            {t('modelFetchError', { message: fetchError })}
          </ThemedText>
        )}
      </View>
    );
  };

  const renderChips = () => {
    if (!selectedEntry) return null;
    return (
      <View style={styles.chips}>
        {selectedEntry.provenance ? (
          <View
            testID={modelProvenanceChipTestId(selectedEntry.id)}
            style={[
              styles.chip,
              {
                borderColor: theme.colors.border.default,
                backgroundColor: theme.colors.background.surface,
              },
            ]}
          >
            <ThemedText variant="muted" size={11}>
              {t('modelProvenance', { provenance: selectedEntry.provenance })}
            </ThemedText>
          </View>
        ) : null}
        {selectedEntry.context !== undefined ? (
          <View
            style={[
              styles.chip,
              {
                borderColor: theme.colors.border.default,
                backgroundColor: theme.colors.background.surface,
              },
            ]}
          >
            <ThemedText variant="muted" size={11}>
              {t(usingLive ? 'modelContextChipLive' : 'modelContextChip', {
                context: formatContextWindow(selectedEntry.context),
              })}
            </ThemedText>
          </View>
        ) : null}
      </View>
    );
  };

  const renderStale = () => {
    if (!stale) return null;
    return (
      <View
        testID={MODEL_STALE_TESTID}
        style={[styles.stale, { borderColor: theme.colors.status.warning }]}
      >
        <ThemedText size={11} style={{ color: theme.colors.status.warning }}>
          {t('modelStale')}
        </ThemedText>
      </View>
    );
  };

  // ── Free-text (no entries, or "Custom…" chosen) ──
  if (showFreeText) {
    return (
      <View>
        <TextInput
          style={[
            styles.input,
            {
              color: theme.colors.text.primary,
              borderColor: theme.colors.border.default,
              backgroundColor: theme.colors.background.base,
            },
          ]}
          value={value}
          onChangeText={(text) => {
            // Clearing the field while entries exist returns to the picker.
            if (text === '' && entries.length > 0) setCustomRequested(false);
            onChange(text);
          }}
          placeholder={t('modelCustom')}
          placeholderTextColor={theme.colors.text.muted}
          testID={CUSTOM_MODEL_INPUT_TESTID}
        />
        {entries.length === 0 && (
          <ThemedText variant="muted" size={11} style={styles.hint}>
            {t('modelNoModels')}
          </ThemedText>
        )}
        {renderFetchRow()}
        {renderStale()}
        {renderChips()}
      </View>
    );
  }

  // ── Entries available → SelectPicker ──
  const options = entries.map((e) => ({ id: e.id, name: e.label ?? e.id }));
  // Keep a saved-but-unlisted value selectable (manual choice round-trips).
  if (value && !options.find((o) => o.id === value)) {
    options.push({ id: value, name: value });
  }
  options.push({ id: CUSTOM_MODEL_OPTION_ID, name: t('modelCustom') });

  const handleChange = (id: string) => {
    if (id === CUSTOM_MODEL_OPTION_ID) {
      setCustomRequested(true);
      return;
    }
    onChange(id);
  };

  return (
    <View>
      <SelectPicker
        label={label ?? t('model')}
        value={value}
        options={options}
        onChange={handleChange}
        placeholder={t('modelSelectPlaceholder')}
      />
      {renderFetchRow()}
      {renderStale()}
      {renderChips()}
    </View>
  );
};

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    minHeight: 44,
  },
  hint: {
    marginTop: 4,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  chip: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  fetchRow: {
    marginTop: 8,
  },
  fetchButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  stale: {
    marginTop: 6,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
});
