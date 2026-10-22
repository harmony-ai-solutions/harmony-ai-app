import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Modal,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { hapticLightPress } from '../../utils/haptics';
import { MODULE_TYPES } from '../../constants/moduleConfiguration';

export interface ModuleConfigOption {
  id: string;
  name: string;
  /** Optional provider + model summary, e.g. "Soulbits Cloud · qwen-35-9b". */
  subtitle?: string;
}

/**
 * Provider id → human label, derived from the single module-type table so the
 * selector never hardcodes a second copy of the provider names.
 */
const PROVIDER_LABELS: Record<string, string> = (() => {
  const labels: Record<string, string> = {};
  for (const moduleType of MODULE_TYPES) {
    for (const option of moduleType.providerOptions) {
      if (!labels[option.id]) labels[option.id] = option.name;
    }
  }
  return labels;
})();

/** Read the `model` field out of a capability overlay (JSON string or object). */
function readCapabilityModel(capability: unknown): string | undefined {
  if (!capability) return undefined;
  let parsed: unknown = capability;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return undefined;
    }
  }
  if (parsed && typeof parsed === 'object') {
    const model = (parsed as Record<string, unknown>).model;
    if (typeof model === 'string' && model.trim() !== '') return model.trim();
  }
  return undefined;
}

/**
 * Build the muted "provider · model" summary shown under a config's name.
 *
 * - Standard single-slot configs: `${ProviderLabel}${model ? ` · ${model}` : ''}`
 * - STT dual-slot configs: `${TranscriptionProviderLabel} + VAD: ${VadLabel}`
 *
 * Pure + defensive (config rows arrive from the engine and may carry a JSON
 * string, an object, or nothing at all). Returns `undefined` when the row has
 * no resolvable provider, so callers can skip the subtitle line entirely.
 */
export function formatModuleConfigSubtitle(
  config: Record<string, any>,
): string | undefined {
  if (!config) return undefined;

  const label = (provider: unknown): string | undefined => {
    if (typeof provider !== 'string' || provider === '' || provider === 'disabled') {
      return undefined;
    }
    return PROVIDER_LABELS[provider] ?? provider;
  };

  // STT carries two independent provider slots.
  if (config.transcription_provider || config.vad_provider) {
    const transcription = label(config.transcription_provider);
    const vad = label(config.vad_provider);
    if (!transcription) return vad ? `VAD: ${vad}` : undefined;
    return vad ? `${transcription} + VAD: ${vad}` : transcription;
  }

  const provider = label(config.provider);
  if (!provider) return undefined;

  const model = readCapabilityModel(config.capability_json);
  return model ? `${provider} · ${model}` : provider;
}

interface EntityModuleSelectorProps {
  label: string;
  configs: ModuleConfigOption[];
  selectedId: string; // '' = disabled
  onChange: (id: string) => void;
  isLoading?: boolean;
  /** Hide the inline label — used by EntityModuleSelectorWithActions which renders its own label row */
  hideLabel?: boolean;
  /** When provided, renders a "Create new config…" row at the bottom of the sheet. */
  onCreateNew?: () => void;
}

export const EntityModuleSelector: React.FC<EntityModuleSelectorProps> = ({
  label,
  configs,
  selectedId,
  onChange,
  isLoading = false,
  hideLabel = false,
  onCreateNew,
}) => {
  const { theme } = useAppTheme();
  const [modalVisible, setModalVisible] = useState(false);

  if (!theme) return null;

  // The '' (no-config) state is a legitimate, selectable end state: the sheet
  // always offers a "Disabled" option so the user can clear a module slot.
  // Engine-seeded default configs arrive via normal sync and appear as
  // ordinary options.
  const options = [
    { id: -1, name: 'Disabled', value: '', subtitle: undefined as string | undefined },
    ...configs.map(c => ({
      id: c.id as string | number,
      name: c.name,
      value: String(c.id),
      subtitle: c.subtitle,
    })),
  ];

  const selectedOption = options.find(o => o.value === selectedId);
  const selectedLabel = selectedOption?.name ?? 'Disabled';
  const selectedSubtitle = selectedOption?.subtitle;
  const isDisabled = selectedId === '';

  return (
    <View style={styles.container}>
      {!hideLabel && (
        <ThemedText size={13} variant="secondary" style={styles.label}>
          {label}
        </ThemedText>
      )}

      {/* ── Selector button (`sb-input` from the Edit AI Partner design) ── */}
      <TouchableOpacity
        style={[
          styles.selector,
          {
            backgroundColor: 'rgba(15, 23, 42, 0.9)',
            borderColor: isDisabled
              ? theme.colors.border.default
              : 'rgba(236, 72, 153, 0.5)',
            opacity: isLoading ? 0.5 : 1,
          },
        ]}
        onPress={() => {
          if (isLoading) return;
          hapticLightPress();
          setModalVisible(true);
        }}
        activeOpacity={0.7}
        disabled={isLoading}
      >
        <View style={styles.selectorTextGroup}>
          <ThemedText
            size={13.5}
            weight={isDisabled ? 'normal' : 'medium'}
            variant={isDisabled ? 'muted' : 'primary'}
            numberOfLines={1}
            style={isDisabled ? undefined : styles.selectorName}
          >
            {selectedLabel}
          </ThemedText>
          {selectedSubtitle ? (
            <ThemedText
              size={11}
              variant="muted"
              numberOfLines={1}
              testID="module-selector-subtitle"
            >
              {selectedSubtitle}
            </ThemedText>
          ) : null}
        </View>
        <ThemedText
          size={12}
          style={[
            styles.selectorChevron,
            {
              color: isDisabled
                ? theme.colors.text.muted
                : theme.colors.accent.primary,
            },
          ]}
        >
          ▾
        </ThemedText>
      </TouchableOpacity>

      {/* ── Popup modal ── */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setModalVisible(false)}
        >
          <TouchableOpacity activeOpacity={1} style={styles.sheetWrapper}>
            {/* Sheet background gradient */}
            <LinearGradient
              colors={[
                theme.colors.background.elevated,
                theme.colors.background.surface,
              ]}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={[StyleSheet.absoluteFill, styles.sheetGradientRadius]}
            />

            {/* Drag handle */}
            <View style={styles.dragHandleContainer}>
              <View
                style={[
                  styles.dragHandle,
                  { backgroundColor: theme.colors.border.default },
                ]}
              />
            </View>

            {/* Accent stripe across top */}
            <LinearGradient
              colors={[
                theme.colors.accent.primary + 'CC',
                theme.colors.accent.secondary
                  ? theme.colors.accent.secondary + '66'
                  : theme.colors.accent.primaryHover + '66',
                'transparent',
              ]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.sheetTopStripe}
            />

            {/* Title row */}
            <View style={styles.modalTitleRow}>
              <ThemedText weight="bold" size={15} style={styles.modalTitle}>
                {label}
              </ThemedText>
            </View>

            {/* Hairline separator */}
            <View
              style={[
                styles.separator,
                { backgroundColor: theme.colors.border.default + '66' },
              ]}
            />

            {/* Options list */}
            <FlatList
              data={options}
              keyExtractor={item => item.value}
              renderItem={({ item }) => {
                const isSelected = item.value === selectedId;
                return (
                  <TouchableOpacity
                    style={[
                      styles.modalItem,
                      isSelected && {
                        backgroundColor:
                          theme.colors.accent.primary + '1A',
                      },
                    ]}
                    onPress={() => {
                      onChange(item.value);
                      setModalVisible(false);
                    }}
                    activeOpacity={0.65}
                  >
                    <View style={styles.modalItemText}>
                      <ThemedText
                        size={14}
                        variant={isSelected ? 'accent' : 'primary'}
                        weight={isSelected ? 'medium' : 'normal'}
                      >
                        {item.name}
                      </ThemedText>
                      {item.subtitle ? (
                        <ThemedText
                          size={11}
                          variant="muted"
                          numberOfLines={1}
                        >
                          {item.subtitle}
                        </ThemedText>
                      ) : null}
                    </View>
                    {isSelected && (
                      <Icon
                        name="check"
                        size={16}
                        color={theme.colors.accent.primary}
                      />
                    )}
                  </TouchableOpacity>
                );
              }}
              style={styles.optionsList}
            />

            {/* Create new config row */}
            {onCreateNew && (
              <>
                <View
                  style={[
                    styles.separator,
                    { backgroundColor: theme.colors.border.default + '66' },
                  ]}
                />
                <TouchableOpacity
                  style={styles.createNewRow}
                  onPress={() => {
                    setModalVisible(false);
                    onCreateNew();
                  }}
                  activeOpacity={0.65}
                >
                  <Icon
                    name="plus-circle-outline"
                    size={18}
                    color={theme.colors.accent.primary}
                  />
                  <ThemedText
                    size={14}
                    variant="accent"
                    weight="medium"
                    style={styles.createNewText}
                  >
                    Create new config…
                  </ThemedText>
                </TouchableOpacity>
              </>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { gap: 6, marginBottom: 12 },
  label: { paddingLeft: 2 },

  // ── Selector button ──
  selector: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 11,
    paddingVertical: 8,
    gap: 8,
  },
  selectorTextGroup: {
    flex: 1,
    gap: 1,
  },
  selectorName: {
    fontWeight: '600',
  },
  selectorChevron: {
    flexShrink: 0,
  },

  // ── Modal sheet ──
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.18)',
    justifyContent: 'flex-end',
  },
  sheetWrapper: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 36,
    maxHeight: '70%',
    overflow: 'hidden',
  },
  sheetGradientRadius: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  dragHandleContainer: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 4,
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    opacity: 0.5,
  },
  sheetTopStripe: {
    height: 2,
    marginHorizontal: 0,
  },
  modalTitleRow: {
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  modalTitle: {
    letterSpacing: 0.3,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 0,
  },
  optionsList: {
    flexGrow: 0,
  },

  // ── Option rows ──
  modalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    gap: 12,
  },
  modalItemText: {
    flex: 1,
    gap: 2,
  },
  createNewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    gap: 8,
  },
  createNewText: {
    flex: 1,
  },
});
