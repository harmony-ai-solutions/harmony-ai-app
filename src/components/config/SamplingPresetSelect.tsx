/**
 * SamplingPresetSelect — engine-backed sampling-preset selector + YAML
 * Save-as modal (Phase 2-2).
 *
 * The preset list is fed by the engine's `GET /api/presets` (via `usePresets`)
 * and is ALWAYS rendered as a `<SelectPicker>` — never as a raw text input —
 * even when the engine exposes zero presets. Selecting a preset fetches its
 * `params` (`GET /api/presets/:name`) and renders preview chips describing the
 * values it supplies.
 *
 * Preset semantics (plan §11 A3, engine truth `providers/openai.go:129-193`):
 * **a preset supplies DEFAULTS; explicit local values override it.** The local
 * sampling inputs are never disabled or rewritten by this control — the chips
 * merely show `temperature: 0.7` and, when the user has explicitly set a value
 * for a param the preset also sets, annotate it with
 * `temperature: 0.7 → 0.9 (local wins)`.
 *
 * The action row beside the picker exposes:
 *  - **Save as…** — opens the Save / Import YAML Preset modal, pre-filled from
 *    the slot's current capability via `buildPresetYamlFromCapability`, so the
 *    exact values the user tuned are ready to save under a new preset name.
 *  - **Delete** (shown only while a preset is selected) — confirms, calls
 *    `deletePreset(value)` and resets the module config to Manual.
 */

import React, { useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  Platform,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { SelectPicker } from './SelectPicker';
import { usePresets } from '../../hooks/usePresets';
import { engineApiClient } from '../../services/engine/EngineApiClient';
import type { PresetDetailResponseDto } from '../../services/engine/EngineApiClient';
import {
  buildPresetYamlFromCapability,
  validatePresetName,
} from '../../utils/presetYaml';
import { hapticLightPress } from '../../utils/haptics';

/** Option id for the "None (Manual)" choice — matches the empty value. */
export const MANUAL_PRESET_OPTION_ID = '';

/**
 * Built-in starter TextGen WebUI YAML presets from File 2 so the picker is
 * immediately populated with working presets even before the user imports or
 * saves custom ones.
 */
const BUILTIN_YAML_PRESETS: Record<string, Record<string, number>> = {
  'Midnight-Enigma': {
    temperature: 0.85,
    top_p: 0.95,
    min_p: 0.05,
    repetition_penalty: 1.12,
    dry_multiplier: 0.8,
    top_k: 40,
  },
  'Divine-Intellect': {
    temperature: 0.7,
    top_p: 0.9,
    top_k: 50,
    typical_p: 0.95,
    repetition_penalty: 1.08,
  },
  'Deterministic-Logic': {
    temperature: 0.2,
    top_p: 0.85,
    top_k: 20,
    seed: 42,
  },
};

/** Test id for a preset preview chip. */
export function presetChipTestId(key: string): string {
  return `preset-chip-${key}`;
}

/** Test id for the "your explicit value wins" marker inside a chip. */
export function presetOverrideTestId(key: string): string {
  return `preset-chip-override-${key}`;
}

/** Test id for the action-row "Save as…" button. */
export const PRESET_SAVE_MODAL_TESTID = 'preset-open-save-modal';

/** Test id for the action-row "Delete" button. */
export const PRESET_DELETE_BUTTON_TESTID = 'preset-delete-button';

/** Test id for the YAML editor inside the save modal. */
export const PRESET_YAML_INPUT_TESTID = 'preset-yaml-input';

/** Test id for the preset-name input inside the save modal. */
export const PRESET_NAME_INPUT_TESTID = 'preset-name-input';

interface SamplingPresetSelectProps {
  /** Selected preset name; `''` = Manual (no preset). */
  value: string;
  onChange: (name: string) => void;
  /** The slot's current local form values (to annotate overrides). */
  localValues: Record<string, any>;
  /** Field keys the user has explicitly set for this slot. */
  explicitKeys: Record<string, boolean>;
  /** Field label — used as the picker's accessibility label + modal title. */
  label: string;
}

export const SamplingPresetSelect: React.FC<SamplingPresetSelectProps> = ({
  value,
  onChange,
  localValues,
  explicitKeys,
  label,
}) => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('moduleConfig');
  const { presets, loading, error, savePreset, deletePreset } = usePresets();

  const [detail, setDetail] = useState<PresetDetailResponseDto | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Save / Import YAML Preset modal.
  const [modalOpen, setModalOpen] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [yamlContent, setYamlContent] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Fetch the selected preset's params for the preview chips.
  useEffect(() => {
    let alive = true;
    if (!value) {
      setDetail(null);
      setDetailError(null);
      return () => {
        alive = false;
      };
    }
    const builtinParams = BUILTIN_YAML_PRESETS[value];
    if (builtinParams) {
      setDetail({
        name: value,
        source: 'bundled',
        params: builtinParams,
      } as PresetDetailResponseDto);
    }
    setDetailError(null);
    engineApiClient
      .getPreset(value)
      .then((d) => {
        if (alive && d) setDetail(d);
      })
      .catch((e) => {
        if (alive && !builtinParams) {
          setDetail(null);
          setDetailError((e as Error)?.message ?? 'Failed to load preset');
        }
      });
    return () => {
      alive = false;
    };
  }, [value]);

  if (!theme) return null;

  const openSaveModal = () => {
    hapticLightPress();
    setPresetName(value || '');
    // Pre-fill with the current module capability so the user's tuned sampling
    // values are ready to save under a new preset name.
    setYamlContent(buildPresetYamlFromCapability(localValues ?? {}));
    setNameError(null);
    setModalOpen(true);
  };

  const closeSaveModal = () => {
    if (saving) return;
    setModalOpen(false);
    setNameError(null);
  };

  const handleSave = async () => {
    const trimmed = presetName.trim();
    const validation = validatePresetName(trimmed);
    if (validation) {
      setNameError(validation);
      return;
    }
    setSaving(true);
    setNameError(null);
    try {
      await savePreset(trimmed, yamlContent);
      setModalOpen(false);
      // The newly created preset becomes active immediately.
      onChange(trimmed);
    } catch (e) {
      setNameError((e as Error)?.message ?? 'Failed to save preset');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!value) return;
    hapticLightPress();
    Alert.alert(
      'Delete preset',
      `Delete preset “${value}”?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await deletePreset(value);
                onChange('');
              } catch (e) {
                setDetailError((e as Error)?.message ?? 'Failed to delete preset');
              }
            })();
          },
        },
      ],
      { cancelable: true },
    );
  };

  const renderChips = () => {
    if (!value) {
      return (
        <ThemedText size={10.5} style={styles.emptyCaption}>
          Using provider/model default hyperparameters. Select a TextGen YAML
          preset or save your current settings as one.
        </ThemedText>
      );
    }
    if (!detail?.params) return null;
    const entries = Object.entries(detail.params);
    if (entries.length === 0) return null;
    return (
      <View style={styles.chips}>
        {entries.map(([key, presetValue]) => {
          const localValue = localValues[key];
          const hasLocal =
            localValue !== undefined && localValue !== null && localValue !== '';
          const overridden = hasLocal && explicitKeys[key] === true;
          return (
            <View
              key={key}
              testID={presetChipTestId(key)}
              style={[styles.chip, overridden ? styles.chipOverride : styles.chipDefault]}
            >
              <ThemedText size={10.5} style={overridden ? styles.chipOverrideText : styles.chipText}>
                {`${key}: ${String(presetValue)}`}
              </ThemedText>
              {overridden && (
                <ThemedText
                  size={10.5}
                  testID={presetOverrideTestId(key)}
                  style={styles.chipOverrideText}
                >
                  {` → ${String(localValue)} (local wins)`}
                </ThemedText>
              )}
            </View>
          );
        })}
      </View>
    );
  };

  const engineNames = new Set(presets.map((p) => p.name));
  const builtinOptions = Object.entries(BUILTIN_YAML_PRESETS)
    .filter(([name]) => !engineNames.has(name))
    .map(([name, params]) => ({
      id: name,
      name: `${name} (${Object.keys(params).length} params)`,
    }));

  const options = [
    { id: MANUAL_PRESET_OPTION_ID, name: 'None (Manual)' },
    ...presets.map((p) => ({ id: p.name, name: `${p.name} (${p.param_count} params)` })),
    ...builtinOptions,
  ];
  // Keep a saved-but-unlisted preset selectable (deleted preset round-trips).
  if (value && !options.find((o) => o.id === value)) {
    options.push({ id: value, name: value });
  }

  return (
    <View style={styles.presetBox}>
      {/* ── Label row (File 2 `sb-label`) ── */}
      <View style={styles.labelRow}>
        <ThemedText size={11.5} numberOfLines={1} style={styles.boxLabel}>
          Sampling Preset (TextGen YAML)
        </ThemedText>
        <ThemedText size={10} variant="muted" numberOfLines={1} style={styles.boxRightHint}>
          Presets supply defaults · local wins
        </ThemedText>
      </View>

      {/* ── Action row: persistent picker + Save as… + Delete ── */}
      <View style={styles.actionRow}>
        <View style={styles.pickerWrap}>
          <SelectPicker
            label={label}
            value={value}
            options={options}
            onChange={onChange}
            placeholder={t('presetSelectPlaceholder')}
          />
        </View>
        <TouchableOpacity
          testID={PRESET_SAVE_MODAL_TESTID}
          onPress={openSaveModal}
          accessibilityRole="button"
          accessibilityLabel="Save as preset"
          style={styles.presetButton}
        >
          <ThemedText size={11.5} style={styles.presetButtonText}>
            💾 Save as…
          </ThemedText>
        </TouchableOpacity>
        {value !== '' && (
          <TouchableOpacity
            testID={PRESET_DELETE_BUTTON_TESTID}
            onPress={handleDelete}
            accessibilityRole="button"
            accessibilityLabel="Delete preset"
            style={[styles.presetButton, styles.deleteButton]}
          >
            <ThemedText size={11.5} style={styles.deleteButtonText}>
              Delete
            </ThemedText>
          </TouchableOpacity>
        )}
      </View>

      {loading && (
        <ThemedText variant="muted" size={11} style={styles.hint}>
          {t('presetLoading')}
        </ThemedText>
      )}
      {!loading && error && (
        <ThemedText variant="muted" size={11} style={styles.hint}>
          {t('presetError', { message: error })}
        </ThemedText>
      )}
      {detailError && (
        <ThemedText variant="muted" size={11} style={styles.hint}>
          {t('presetError', { message: detailError })}
        </ThemedText>
      )}
      {renderChips()}

      {/* ── Save / Import YAML Preset modal ── */}
      <Modal
        visible={modalOpen}
        transparent
        animationType="fade"
        onRequestClose={closeSaveModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalShell}>
            <View style={styles.modalHeader}>
              <ThemedText size={13.5} style={styles.modalTitle}>
                💾 Save / Import YAML Preset
              </ThemedText>
              <ThemedText size={11} style={styles.modalEndpoint}>
                POST /api/presets
              </ThemedText>
            </View>

            <ThemedText size={10.5} style={styles.modalLabel}>
              Preset Name *
            </ThemedText>
            <View style={styles.nameInputRow}>
              <TextInput
                testID={PRESET_NAME_INPUT_TESTID}
                value={presetName}
                onChangeText={(text) => {
                  setPresetName(text);
                  if (nameError) setNameError(null);
                }}
                placeholder="Preset name"
                placeholderTextColor={theme.colors.text.muted}
                style={styles.nameInput}
              />
              <ThemedText size={10} style={styles.yamlSuffix}>
                .yaml
              </ThemedText>
            </View>
            {nameError && (
              <ThemedText
                size={12}
                testID="preset-name-error"
                style={styles.nameError}
              >
                {nameError}
              </ThemedText>
            )}

            <View style={styles.yamlLabelRow}>
              <ThemedText size={10.5} style={styles.modalLabel}>
                TextGen WebUI YAML (pre-filled from current config)
              </ThemedText>
              {value !== '' && detail?.params ? (
                <TouchableOpacity
                  testID="preset-seed-from-preset"
                  onPress={() => {
                    hapticLightPress();
                    setYamlContent(buildPresetYamlFromCapability(detail.params));
                  }}
                  accessibilityRole="button"
                >
                  <ThemedText size={10.5} style={styles.pinkLink}>
                    {`Seed from “${value}”`}
                  </ThemedText>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  testID="preset-reset-from-config"
                  onPress={() => {
                    hapticLightPress();
                    setYamlContent(buildPresetYamlFromCapability(localValues ?? {}));
                  }}
                  accessibilityRole="button"
                >
                  <ThemedText size={10.5} style={styles.pinkLink}>
                    📂 Reset from config
                  </ThemedText>
                </TouchableOpacity>
              )}
            </View>

            <TextInput
              testID={PRESET_YAML_INPUT_TESTID}
              value={yamlContent}
              onChangeText={setYamlContent}
              multiline
              numberOfLines={8}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="temperature: 0.7"
              placeholderTextColor={theme.colors.text.muted}
              style={styles.yamlInput}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                testID="preset-save-cancel"
                onPress={closeSaveModal}
                accessibilityRole="button"
                style={styles.secondaryButton}
              >
                <ThemedText size={11.5} style={styles.secondaryButtonText}>
                  Cancel
                </ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                testID="preset-save-confirm"
                onPress={handleSave}
                disabled={saving}
                accessibilityRole="button"
                style={[styles.presetButton, { opacity: saving ? 0.6 : 1 }]}
              >
                <ThemedText size={11.5} style={styles.presetButtonText}>
                  {saving ? 'Saving…' : 'Save & Select Preset'}
                </ThemedText>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  presetBox: {
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    borderWidth: 1,
    borderColor: 'rgba(167, 139, 250, 0.32)',
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 6,
  },
  boxLabel: {
    color: '#cbd5e1',
    fontWeight: '600',
    flexShrink: 0,
  },
  boxRightHint: {
    flexShrink: 1,
    textAlign: 'right',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pickerWrap: {
    flex: 1,
  },
  presetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(236, 72, 153, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(236, 72, 153, 0.45)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 38,
  },
  presetButtonText: {
    color: '#f472b6',
    fontWeight: '600',
  },
  deleteButton: {
    backgroundColor: 'rgba(148, 163, 184, 0.12)',
    borderColor: '#334155',
    paddingHorizontal: 8,
  },
  deleteButtonText: {
    color: '#94a3b8',
    fontWeight: '600',
  },
  hint: {
    marginTop: 4,
  },
  emptyCaption: {
    marginTop: 8,
    color: '#64748b',
    lineHeight: 15,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    marginTop: 8,
  },
  chip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  chipDefault: {
    backgroundColor: 'rgba(167, 139, 250, 0.14)',
    borderColor: 'rgba(167, 139, 250, 0.3)',
  },
  chipOverride: {
    backgroundColor: 'rgba(236, 72, 153, 0.16)',
    borderColor: 'rgba(236, 72, 153, 0.45)',
  },
  chipText: {
    color: '#ddd6fe',
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },
  chipOverrideText: {
    color: '#fbcfe8',
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    padding: 20,
  },
  modalShell: {
    backgroundColor: '#131c2e',
    borderWidth: 1,
    borderColor: '#ec4899',
    borderRadius: 12,
    padding: 14,
    gap: 8,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 2,
  },
  modalTitle: {
    color: '#fff',
    fontWeight: '700',
  },
  modalEndpoint: {
    color: '#a78bfa',
  },
  modalLabel: {
    color: '#94a3b8',
  },
  nameInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  nameInput: {
    flex: 1,
    color: '#e2e8f0',
    fontSize: 13,
    padding: 0,
  },
  yamlSuffix: {
    color: '#64748b',
  },
  nameError: {
    color: '#ef4444',
  },
  yamlLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  pinkLink: {
    color: '#f472b6',
    fontWeight: '600',
  },
  yamlInput: {
    backgroundColor: '#090d16',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 7,
    padding: 9,
    color: '#a7f3d0',
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 11.5,
    lineHeight: 16,
    minHeight: 160,
    textAlignVertical: 'top',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  secondaryButton: {
    backgroundColor: 'rgba(148, 163, 184, 0.12)',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  secondaryButtonText: {
    color: '#cbd5e1',
    fontWeight: '600',
  },
});
