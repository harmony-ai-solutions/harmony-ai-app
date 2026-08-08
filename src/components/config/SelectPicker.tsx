import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Modal,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';

interface SelectPickerProps {
  label: string;
  value: string;
  options: Array<{ id: string; name: string }>;
  onChange: (value: string) => void;
  placeholder?: string;
}

export const SelectPicker: React.FC<SelectPickerProps> = ({
  label,
  value,
  options,
  onChange,
  placeholder,
}) => {
  const { theme } = useAppTheme();
  const [open, setOpen] = useState(false);

  if (!theme) return null;

  const selectedOption = options.find(o => o.id === value);
  const displayText = selectedOption?.name ?? placeholder ?? 'Select…';
  const isPlaceholder = !selectedOption;

  const accentPrimary = theme.colors.accent.primary;
  const accentSecondary =
    theme.colors.accent.secondary ?? theme.colors.accent.primary;

  const handleSelect = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <>
      <TouchableOpacity
        style={[
          styles.row,
          {
            borderColor: theme.colors.border.default,
            backgroundColor: theme.colors.background.base,
          },
        ]}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={label}
        activeOpacity={0.65}
      >
        <ThemedText
          size={15}
          variant={isPlaceholder ? 'muted' : 'primary'}
          style={styles.rowText}
        >
          {displayText}
        </ThemedText>
        <Icon name="chevron-down" size={18} color={theme.colors.text.muted} />
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <TouchableWithoutFeedback onPress={() => setOpen(false)}>
          <View style={styles.overlay}>
            <TouchableWithoutFeedback>
              <View style={styles.modalShell}>
                {/* Gradient background */}
                <LinearGradient
                  colors={[
                    theme.colors.background.elevated,
                    theme.colors.background.surface,
                  ]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 0, y: 1 }}
                  style={[StyleSheet.absoluteFill, styles.modalRadius]}
                />

                {/* Prismatic tint */}
                <LinearGradient
                  colors={[accentPrimary + '10', 'transparent']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0.6 }}
                  style={[StyleSheet.absoluteFill, styles.modalRadius]}
                  pointerEvents="none"
                />

                {/* Top accent stripe */}
                <LinearGradient
                  colors={[
                    accentPrimary + 'CC',
                    accentSecondary + '66',
                    'transparent',
                  ]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.topStripe}
                />

                {/* Header */}
                <View style={styles.header}>
                  <ThemedText size={18} weight="bold" style={styles.title}>
                    {label}
                  </ThemedText>
                </View>

                {/* Hairline separator */}
                <View
                  style={[
                    styles.headerSeparator,
                    { backgroundColor: theme.colors.border.default + '55' },
                  ]}
                />

                {/* Options list */}
                <FlatList
                  data={options}
                  renderItem={({ item }) => {
                    const isSelected = item.id === value;
                    return (
                      <TouchableOpacity
                        onPress={() => handleSelect(item.id)}
                        activeOpacity={0.65}
                        style={[
                          styles.optionRow,
                          isSelected && { backgroundColor: accentPrimary + '18' },
                        ]}
                      >
                        {/* Left accent pip for selected */}
                        {isSelected && (
                          <LinearGradient
                            colors={[accentPrimary, accentSecondary]}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 0, y: 1 }}
                            style={styles.rowPip}
                          />
                        )}

                        {/* Option name */}
                        <ThemedText
                          size={15}
                          weight={isSelected ? 'bold' : 'medium'}
                          variant={isSelected ? 'accent' : 'primary'}
                          style={styles.optionText}
                        >
                          {item.name}
                        </ThemedText>

                        {/* Check icon for selected */}
                        {isSelected && (
                          <Icon
                            name="check-circle"
                            size={20}
                            color={accentPrimary}
                          />
                        )}

                        {/* Row separator */}
                        <View
                          style={[
                            styles.rowSeparator,
                            { backgroundColor: theme.colors.border.default + '44' },
                          ]}
                        />
                      </TouchableOpacity>
                    );
                  }}
                  keyExtractor={item => item.id}
                  style={styles.list}
                />
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
  },
  rowText: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.18)',
    justifyContent: 'flex-end',
  },
  modalShell: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
    maxHeight: '80%',
    paddingBottom: 24,
    backgroundColor: '#151d30',
  },
  modalRadius: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  topStripe: {
    height: 2,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
    alignItems: 'center',
  },
  title: {
    marginBottom: 4,
    letterSpacing: 0.3,
  },
  headerSeparator: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 0,
  },
  list: {
    maxHeight: 300,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 12,
  },
  rowPip: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: 3,
  },
  optionText: {
    flex: 1,
  },
  rowSeparator: {
    position: 'absolute',
    left: 20,
    right: 0,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
  },
});
