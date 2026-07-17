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

export interface ModuleConfigOption {
  id: string;
  name: string;
}

interface EntityModuleSelectorProps {
  label: string;
  configs: ModuleConfigOption[];
  selectedId: string; // '' = disabled
  onChange: (id: string) => void;
  isLoading?: boolean;
  /** Hide the inline label — used by EntityModuleSelectorWithActions which renders its own label row */
  hideLabel?: boolean;
}

export const EntityModuleSelector: React.FC<EntityModuleSelectorProps> = ({
  label,
  configs,
  selectedId,
  onChange,
  isLoading = false,
  hideLabel = false,
}) => {
  const { theme } = useAppTheme();
  const [modalVisible, setModalVisible] = useState(false);

  if (!theme) return null;

  const options = [
    { id: -1, name: 'Disabled', value: '' },
    ...configs.map(c => ({ id: c.id, name: c.name, value: String(c.id) })),
  ];

  const selectedLabel =
    options.find(o => o.value === selectedId)?.name ?? 'Disabled';
  const isDisabled = selectedId === '';

  return (
    <View style={styles.container}>
      {!hideLabel && (
        <ThemedText size={13} variant="secondary" style={styles.label}>
          {label}
        </ThemedText>
      )}

      {/* ── Selector button ── */}
      <TouchableOpacity
        style={[
          styles.selector,
          {
            borderColor: isDisabled
              ? theme.colors.border.default
              : theme.colors.accent.primary + '66',
            opacity: isLoading ? 0.5 : 1,
          },
        ]}
        onPress={() => !isLoading && setModalVisible(true)}
        activeOpacity={0.7}
        disabled={isLoading}
      >
        <LinearGradient
          colors={
            isDisabled
              ? [
                  theme.colors.background.elevated,
                  theme.colors.background.surface,
                ]
              : [
                  theme.colors.accent.primary + '1A',
                  theme.colors.background.elevated,
                ]
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFillObject}
        />
        {/* Left accent pip for active selection */}
        {!isDisabled && (
          <LinearGradient
            colors={[theme.colors.accent.primary, theme.colors.accent.secondary ?? theme.colors.accent.primaryHover]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={styles.selectorPip}
          />
        )}
        <View style={styles.selectorInner}>
          <ThemedText
            size={14}
            variant={isDisabled ? 'muted' : 'primary'}
            style={{ flex: 1 }}
          >
            {selectedLabel}
          </ThemedText>
          <Icon
            name="chevron-down"
            size={18}
            color={
              isDisabled
                ? theme.colors.text.muted
                : theme.colors.accent.primary
            }
          />
        </View>
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
              style={[StyleSheet.absoluteFillObject, styles.sheetGradientRadius]}
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
                    {isSelected && (
                      <LinearGradient
                        colors={[
                          theme.colors.accent.primary,
                          theme.colors.accent.secondary ??
                            theme.colors.accent.primaryHover,
                        ]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 0, y: 1 }}
                        style={styles.itemAccentPip}
                      />
                    )}
                    <ThemedText
                      size={14}
                      variant={isSelected ? 'accent' : 'primary'}
                      weight={isSelected ? 'medium' : 'normal'}
                      style={{ flex: 1, paddingLeft: isSelected ? 10 : 0 }}
                    >
                      {item.name}
                    </ThemedText>
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
    minHeight: 44,
    overflow: 'hidden',
  },
  selectorPip: {
    width: 3,
    alignSelf: 'stretch',
  },
  selectorInner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },

  // ── Modal sheet ──
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
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
    paddingVertical: 14,
    paddingHorizontal: 20,
    gap: 0,
  },
  itemAccentPip: {
    width: 3,
    height: 20,
    borderRadius: 2,
    marginRight: 0,
  },
});
