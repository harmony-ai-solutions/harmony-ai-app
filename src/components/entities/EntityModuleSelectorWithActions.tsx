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
 *
 * `confirmGate` (the partner STT slot, 4-4): that slot does NOT drive the
 * user's chat voice input (the global user config in Settings › Voice input
 * does), so it renders LOCKED — muted, no edit link, tapping opens the
 * explainer modal — until the user explicitly confirms once per screen visit.
 * The unlock is in-memory only: nothing is persisted and the next visit starts
 * locked again.
 */

import React, { useState } from 'react';
import { View, TouchableOpacity, StyleSheet, Modal } from 'react-native';
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

/**
 * Explainer shown before a gated module row becomes editable.
 * `lockedHint` is rendered under the selector while the row is still locked.
 */
export interface ModuleConfirmGate {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  lockedHint?: string;
}

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
  /** When present the row starts LOCKED and only becomes editable after the
   *  user confirms the explainer modal (once per screen visit). */
  confirmGate?: ModuleConfirmGate;
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
  confirmGate,
}) => {
  const { theme } = useAppTheme();
  const navigation = useNavigation<NavigationProp>();
  const [unlocked, setUnlocked] = useState(false);
  const [gateVisible, setGateVisible] = useState(false);

  const locked = Boolean(confirmGate) && !unlocked;

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
          selector is exactly the same full width. Hidden while locked — the
          whole row is read-only until the gate is confirmed. */}
      <View style={styles.labelRow}>
        <ThemedText size={12} style={styles.label} numberOfLines={1}>
          {label}
        </ThemedText>
        {!locked && selectedId && selectedId !== '' ? (
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
        locked={locked}
        onLockedPress={() => {
          hapticLightPress();
          setGateVisible(true);
        }}
      />

      {/* Hint under a locked row — why the slot is gated. */}
      {locked && confirmGate?.lockedHint ? (
        <ThemedText size={10.5} variant="muted" style={styles.lockedHint}>
          {confirmGate.lockedHint}
        </ThemedText>
      ) : null}

      {/* ── Gate explainer modal (centered card) ── */}
      <Modal
        visible={gateVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setGateVisible(false)}
      >
        <TouchableOpacity
          style={styles.gateOverlay}
          activeOpacity={1}
          onPress={() => setGateVisible(false)}
        >
          <TouchableOpacity
            activeOpacity={1}
            style={[styles.gateCard, { backgroundColor: theme.colors.background.elevated }]}
          >
            <ThemedText weight="bold" size={14.5} style={styles.gateTitle}>
              {confirmGate?.title}
            </ThemedText>
            <ThemedText size={12} variant="secondary" style={styles.gateMessage}>
              {confirmGate?.message}
            </ThemedText>
            <View style={styles.gateButtons}>
              <TouchableOpacity
                style={styles.gateButtonGhost}
                onPress={() => setGateVisible(false)}
                activeOpacity={0.7}
                accessibilityRole="button"
                testID={`gate-cancel-${moduleType}`}
              >
                <ThemedText size={12.5} variant="secondary" weight="medium">
                  {confirmGate?.cancelLabel}
                </ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.gateButtonPrimary,
                  { backgroundColor: theme.colors.accent.primary },
                ]}
                onPress={() => {
                  hapticLightPress();
                  setGateVisible(false);
                  setUnlocked(true);
                }}
                activeOpacity={0.85}
                accessibilityRole="button"
                testID={`gate-confirm-${moduleType}`}
              >
                <ThemedText size={12.5} weight="medium" style={styles.gateConfirmText}>
                  {confirmGate?.confirmLabel}
                </ThemedText>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
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
  lockedHint: {
    paddingLeft: 2,
    marginTop: 2,
    lineHeight: 15,
  },

  // ── Gate modal ──
  gateOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 28,
  },
  gateCard: {
    width: '100%',
    maxWidth: 300,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  gateTitle: {
    letterSpacing: 0.2,
  },
  gateMessage: {
    marginTop: 8,
    lineHeight: 18,
  },
  gateButtons: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  gateButtonGhost: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.35)',
  },
  gateButtonPrimary: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
  },
  gateConfirmText: {
    color: '#FFFFFF',
  },
});
