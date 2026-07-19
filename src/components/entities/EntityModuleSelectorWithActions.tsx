/**
 * EntityModuleSelectorWithActions
 *
 * A wrapper around EntityModuleSelector that adds edit/create action buttons.
 * Allows users to quickly edit an existing module config or create a new one
 * directly from the entity configuration screen.
 *
 * Layout: Label on its own row, then selector + action buttons side-by-side
 * on the same vertical center — no fragile marginTop offsets.
 *
 * Phase 4-5: Integration wrapper for module config editing
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

      {/* Selector + actions on the same baseline */}
      <View style={styles.row}>
        <View style={styles.selectorWrapper}>
          <EntityModuleSelector
            label={label}
            hideLabel
            configs={configs}
            selectedId={selectedId}
            onChange={onChange}
            isLoading={isLoading}
          />
        </View>

        <View style={styles.actions}>
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
          <TouchableOpacity
            onPress={handleCreate}
            style={styles.actionButton}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel={`Create new ${label} configuration`}
          >
            <Icon name="plus" size={16} color={theme.colors.accent.secondary} />
          </TouchableOpacity>
        </View>
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
  actions: {
    flexDirection: 'row',
    marginLeft: 6,
    gap: 2,
  },
  actionButton: {
    width: 36,
    height: 36,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
