import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Modal,
} from 'react-native';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';

export interface ModuleConfigOption {
  id: number;
  name: string;
}

interface EntityModuleSelectorProps {
  label: string;
  configs: ModuleConfigOption[];
  selectedId: string; // '' = disabled
  onChange: (id: string) => void;
  isLoading?: boolean;
}

export const EntityModuleSelector: React.FC<EntityModuleSelectorProps> = ({
  label,
  configs,
  selectedId,
  onChange,
  isLoading = false,
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

  return (
    <View style={styles.container}>
      <ThemedText size={13} variant="secondary" style={styles.label}>
        {label}
      </ThemedText>

      <TouchableOpacity
        style={[
          styles.selector,
          {
            borderColor: theme.colors.border.default,
            backgroundColor: theme.colors.background.elevated,
            opacity: isLoading ? 0.5 : 1,
          },
        ]}
        onPress={() => !isLoading && setModalVisible(true)}
        activeOpacity={0.7}
        disabled={isLoading}
      >
        <ThemedText size={14} variant="primary" style={{ flex: 1 }}>
          {selectedLabel}
        </ThemedText>
        <ThemedText size={14} variant="muted">
          ▾
        </ThemedText>
      </TouchableOpacity>

      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setModalVisible(false)}
        >
          <View
            style={[
              styles.modalSheet,
              { backgroundColor: theme.colors.background.elevated },
            ]}
          >
            <ThemedText weight="bold" size={15} style={styles.modalTitle}>
              {label}
            </ThemedText>
            <FlatList
              data={options}
              keyExtractor={item => item.value}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.modalItem,
                    item.value === selectedId && {
                      backgroundColor: theme.colors.accent.primary + '22',
                    },
                  ]}
                  onPress={() => {
                    onChange(item.value);
                    setModalVisible(false);
                  }}
                >
                  <ThemedText
                    size={14}
                    variant={item.value === selectedId ? 'accent' : 'primary'}
                    weight={item.value === selectedId ? 'medium' : 'normal'}
                    style={{ flex: 1 }}
                  >
                    {item.name}
                  </ThemedText>
                  {item.value === selectedId && (
                    <ThemedText size={14} variant="accent">
                      ✓
                    </ThemedText>
                  )}
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { gap: 6, marginBottom: 12 },
  label: { paddingLeft: 2 },
  selector: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 12,
    paddingBottom: 32,
    maxHeight: '70%',
  },
  modalTitle: {
    textAlign: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    marginBottom: 4,
  },
  modalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
});
