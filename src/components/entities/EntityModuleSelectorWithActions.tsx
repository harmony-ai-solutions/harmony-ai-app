/**
 * EntityModuleSelectorWithActions
 *
 * A wrapper around EntityModuleSelector that adds an edit action for the
 * currently selected module config. "Create new config…" lives inside the
 * selector's sheet (last row) instead of a separate + button, keeping the
 * row of trailing icon buttons out of the entity configuration screen.
 *
 * Layout: Label on its own row, then the selector (with a pencil edit icon
 * shown only when a config is selected).
 */

import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { EntityModuleSelector, ModuleConfigOption } from './EntityModuleSelector';

type RootStackParamList = {
  ModuleConfigEdit: {
    moduleType: string;
    configId?: string;
  };
};

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

interface EntityModuleSelectorWithActionsProps {
  label: string;
  moduleType: string;
  configs: ModuleConfigOption[];
  selectedId: string;
  onChange: (id: string) => void;
  isLoading?: boolean;
}

export const EntityModuleSelectorWithActions: React.FC<
  EntityModuleSelectorWithActionsProps
> = ({
  label,
  moduleType,
  configs,
  selectedId,
  onChange,
  isLoading = false,
}) => {
  const { theme } = useAppTheme();
  const navigation = useNavigation<NavigationProp>();

  const handleEdit = () => {
    if (selectedId && selectedId !== '') {
      navigation.navigate('ModuleConfigEdit', {
        moduleType,
        configId: selectedId,
      });
    }
  };

  const handleCreate = () => {
    navigation.navigate('ModuleConfigEdit', {
      moduleType,
    });
  };

  if (!theme) return null;

  return (
    <View style={styles.outer}>
      {/* Label row */}
      <ThemedText size={13} variant="secondary" style={styles.label}>
        {label}
      </ThemedText>

      {/* Selector + edit action on the same baseline */}
      <View style={styles.row}>
        <View style={styles.selectorWrapper}>
          <EntityModuleSelector
            label={label}
            hideLabel
            configs={configs}
            selectedId={selectedId}
            onChange={onChange}
            isLoading={isLoading}
            onCreateNew={handleCreate}
          />
        </View>

        {selectedId && selectedId !== '' ? (
          <TouchableOpacity
            onPress={handleEdit}
            style={styles.actionButton}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel={`Edit ${label} configuration`}
          >
            <Icon name="pencil" size={16} color={theme.colors.accent.primary} />
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  outer: {
    gap: 6,
    marginBottom: 12,
  },
  label: {
    paddingLeft: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  selectorWrapper: {
    flex: 1,
  },
  actionButton: {
    width: 36,
    height: 36,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 6,
  },
});
