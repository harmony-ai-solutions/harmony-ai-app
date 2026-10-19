import React, { useState, useEffect } from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet, Modal, FlatList, Switch } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { EXTENDED_PARAMS, ExtendedParamInfo, STANDARD_PARAM_KEYS } from '../../constants/extendedParamMetadata';
import { parseExtraParams, serializeExtraParams } from '../../utils/configHelpers';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';

interface AdvancedSamplingParamsProps {
  extraParamsJson: string;
  onChange: (jsonString: string) => void;
}

export const AdvancedSamplingParams: React.FC<AdvancedSamplingParamsProps> = ({
  extraParamsJson,
  onChange,
}) => {
  const { theme } = useAppTheme();
  const [expanded, setExpanded] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [params, setParams] = useState<Record<string, any>>({});

  useEffect(() => {
    const parsed = parseExtraParams(extraParamsJson);
    const nonStandard = getNonStandardParams(parsed);
    setParams(nonStandard);
  }, [extraParamsJson]);

  if (!theme) return null;

  const getNonStandardParams = (allParams: Record<string, any>): Record<string, any> => {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(allParams)) {
      if (!STANDARD_PARAM_KEYS.has(key)) {
        result[key] = value;
      }
    }
    return result;
  };

  const handleValueChange = (key: string, value: any) => {
    const newParams = { ...params, [key]: value };
    setParams(newParams);
    onChange(serializeExtraParams(newParams));
  };

  const handleRemove = (key: string) => {
    const newParams = { ...params };
    delete newParams[key];
    setParams(newParams);
    onChange(serializeExtraParams(newParams));
  };

  const handleAddParam = (paramInfo: ExtendedParamInfo) => {
    const defaultValue = paramInfo.type === 'boolean' ? false : 0;
    handleValueChange(paramInfo.key, defaultValue);
    setShowAddModal(false);
  };

  const getInputType = (key: string): 'number' | 'boolean' | 'text' => {
    const info = EXTENDED_PARAMS.find(p => p.key === key);
    if (info?.type === 'boolean') return 'boolean';
    if (info) return 'number';
    return 'text';
  };

  const paramCount = Object.keys(params).length;

  const renderParamItem = ({ item: key }: { item: string }) => {
    const info = EXTENDED_PARAMS.find(p => p.key === key);
    const value = params[key];
    const inputType = getInputType(key);
    const label = info?.label || key;

    return (
      <View
        style={[
          styles.paramItem,
          {
            backgroundColor: theme.colors.background.base,
            borderColor: theme.colors.border.default,
          },
        ]}
      >
        <View style={styles.paramInfo}>
          <ThemedText size={14} weight="medium">
            {label}
          </ThemedText>
          {info?.tooltip && (
            <ThemedText variant="muted" size={11}>
              {info.tooltip}
            </ThemedText>
          )}
        </View>
        <View style={styles.paramInput}>
          {inputType === 'boolean' ? (
            <Switch
              value={value === true}
              onValueChange={(val) => handleValueChange(key, val)}
              trackColor={{ false: theme.colors.border.default, true: theme.colors.accent.primary }}
            />
          ) : inputType === 'number' ? (
            <TextInput
              style={[
                styles.numberInput,
                {
                  color: theme.colors.text.primary,
                  borderColor: theme.colors.border.default,
                  backgroundColor: theme.colors.background.surface,
                },
              ]}
              value={value?.toString() || ''}
              onChangeText={(text) => handleValueChange(key, parseFloat(text) || 0)}
              keyboardType="decimal-pad"
            />
          ) : (
            <TextInput
              style={[
                styles.textInput,
                {
                  color: theme.colors.text.primary,
                  borderColor: theme.colors.border.default,
                  backgroundColor: theme.colors.background.surface,
                },
              ]}
              value={value?.toString() || ''}
              onChangeText={(text) => handleValueChange(key, text)}
            />
          )}
        </View>
        <TouchableOpacity onPress={() => handleRemove(key)} style={styles.removeButton}>
          <Icon name="close-circle" size={20} color={theme.colors.status.error} />
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Collapsible dashed drawer row (File 2 `drawer-row`) */}
      <TouchableOpacity
        testID="advanced-sampling-drawer"
        style={styles.drawerRow}
        onPress={() => setExpanded(!expanded)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
      >
        <ThemedText size={11.5} numberOfLines={1} style={styles.drawerLabel}>
          ⚙ Extended YAML Samplers (top_k, min_p, dry, xtc, mirostat…)
        </ThemedText>
        <ThemedText size={11.5} style={styles.drawerCount}>
          {`${paramCount} active ${expanded ? '▴' : '▾'}`}
        </ThemedText>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.content}>
          {paramCount > 0 ? (
            <FlatList
              data={Object.keys(params)}
              renderItem={renderParamItem}
              keyExtractor={(item) => item}
              scrollEnabled={false}
            />
          ) : (
            <ThemedText variant="muted" size={13} style={styles.emptyText}>
              No advanced parameters configured
            </ThemedText>
          )}

          <TouchableOpacity
            style={[
              styles.addButton,
              { borderColor: theme.colors.accent.primary + '66' },
            ]}
            onPress={() => setShowAddModal(true)}
            activeOpacity={0.7}
          >
            <LinearGradient
              colors={[
                theme.colors.accent.primary + '1A',
                theme.colors.background.elevated,
              ]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
            <Icon name="plus" size={18} color={theme.colors.accent.primary} />
            <ThemedText
              size={14}
              weight="medium"
              style={{ color: theme.colors.accent.primary, marginLeft: 6 }}
            >
              Add Parameter
            </ThemedText>
          </TouchableOpacity>
        </View>
      )}

      {/* Add Parameter Modal */}
      <Modal visible={showAddModal} transparent animationType="fade" onRequestClose={() => setShowAddModal(false)}>
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowAddModal(false)}
        >
          <View
            style={[
              styles.modalSheet,
              {
                backgroundColor: theme.colors.background.elevated,
              },
            ]}
          >
            {/* Accent stripe */}
            <LinearGradient
              colors={[
                theme.colors.accent.primary + 'CC',
                theme.colors.accent.secondary + '66',
                'transparent',
              ]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.modalStripe}
            />

            {/* Drag handle */}
            <View style={styles.dragHandleContainer}>
              <View style={[styles.dragHandle, { backgroundColor: theme.colors.border.default }]} />
            </View>

            <ThemedText weight="bold" size={15} style={styles.modalTitle}>
              Add Parameter
            </ThemedText>

            <FlatList
              data={EXTENDED_PARAMS.filter(p => !params[p.key])}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.modalItem, { borderBottomColor: theme.colors.border.default + '66' }]}
                  onPress={() => handleAddParam(item)}
                  activeOpacity={0.65}
                >
                  <ThemedText size={14} weight="medium">
                    {item.label}
                  </ThemedText>
                  {item.tooltip && (
                    <ThemedText variant="muted" size={12} style={{ marginTop: 2 }}>
                      {item.tooltip}
                    </ThemedText>
                  )}
                </TouchableOpacity>
              )}
              keyExtractor={(item) => item.key}
              ListEmptyComponent={
                <ThemedText variant="muted" size={13} style={styles.emptyText}>
                  All available parameters have been added
                </ThemedText>
              }
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: 8,
  },

  // ── Collapsible dashed drawer row ──
  drawerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#334155',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginTop: 4,
  },
  drawerLabel: {
    flex: 1,
    color: '#94a3b8',
  },
  drawerCount: {
    color: '#cbd5e1',
    fontWeight: '600',
  },

  // ── Expanded content ──
  content: {
    marginTop: 8,
    gap: 8,
  },
  paramItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
  },
  paramInfo: {
    flex: 1,
    gap: 2,
  },
  paramInput: {
    marginHorizontal: 4,
  },
  numberInput: {
    width: 80,
    padding: 8,
    borderRadius: 6,
    borderWidth: 1,
    textAlign: 'center',
    fontSize: 14,
  },
  textInput: {
    width: 80,
    padding: 8,
    borderRadius: 6,
    borderWidth: 1,
    fontSize: 14,
  },
  removeButton: {
    padding: 4,
  },
  emptyText: {
    textAlign: 'center',
    padding: 16,
  },

  // ── Add button ──
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
  },

  // ── Modal ──
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.18)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 36,
    maxHeight: '70%',
    overflow: 'hidden',
  },
  modalStripe: {
    height: 2,
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
  modalTitle: {
    textAlign: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    letterSpacing: 0.3,
  },
  modalItem: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
