/**
 * EntityModuleSelectorWithActions
 *
 * A wrapper around EntityModuleSelector that adds an edit action for the
 * currently selected module config. "Create new config…" lives inside the
 * selector's sheet (last row) instead of a separate + button, keeping the
 * row of trailing icon buttons out of the entity configuration screen.
 *
 * Layout (4-3): module label on the left + `✎ Edit config` link on the right,
 * then the selector at FULL width. The edit action used to sit beside the
 * dropdown, which shrank every selected dropdown by 42dp relative to the
 * `Disabled` ones right below it.
 */

import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { hapticLightPress } from '../../utils/haptics';
import { EntityModuleSelector, ModuleConfigOption } from './EntityModuleSelector';

type RootStackParamList = {
  ModuleConfigEdit: {
    moduleType: string;
    configId?: string;
    entityId?: string;
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
  /** The AI entity this config is being wired to (edit mode). When present it is
   *  threaded into ModuleConfigEdit so entity-bound test panels (TTS) can run. */
  entityId?: string;
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
  entityId,
}) => {
  const { theme } = useAppTheme();
  const navigation = useNavigation<NavigationProp>();

  const handleEdit = () => {
    if (selectedId && selectedId !== '') {
      navigation.navigate('ModuleConfigEdit', {
        moduleType,
        configId: selectedId,
        ...(entityId ? { entityId } : {}),
      });
    }
  };

  const handleCreate = () => {
    navigation.navigate('ModuleConfigEdit', {
      moduleType,
      ...(entityId ? { entityId } : {}),
    });
  };

  if (!theme) return null;

  return (
    <View style={styles.outer}>
      {/* Label row: module label on the left, "✎ Edit config" on the right.
          Keeping the action here (not beside the dropdown) means every module
          selector is exactly the same full width. */}
      <View style={styles.labelRow}>
        <ThemedText size={12} style={styles.label} numberOfLines={1}>
          {label}
        </ThemedText>
        {selectedId && selectedId !== '' ? (
          <TouchableOpacity
            onPress={() => {
              hapticLightPress();
              handleEdit();
            }}
            style={styles.editLink}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel={`Edit ${label} configuration`}
            accessibilityRole="button"
            testID={`edit-module-config-${moduleType}`}
          >
            <ThemedText size={11.5} style={styles.editLinkText}>
              ✎ Edit config
            </ThemedText>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Full-width selector */}
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
  );
};

const styles = StyleSheet.create({
  outer: {
    gap: 6,
    marginBottom: 12,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingLeft: 2,
  },
  label: {
    flexShrink: 1,
    color: '#cbd5e1',
  },
  editLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
  },
  editLinkText: {
    color: '#ec4899',
    fontWeight: '600',
  },
  newLinkText: {
    color: 'rgba(236, 72, 153, 0.75)',
  },
});
