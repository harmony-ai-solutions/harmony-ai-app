/**
 * VoiceProfileBar — named `.voice.json` profile selector + CRUD (Phase 3-5).
 *
 * Soulvoice and Soulbits Cloud keep named voice configurations engine-side
 * (`GET/POST/PUT/DELETE /api/voices`). This bar lets users on those providers:
 *
 *  - load a named profile into the current TTS capability,
 *  - overwrite the selected profile with the current capability (Save),
 *  - create a new profile from the current capability (Save as…), and
 *  - delete a profile.
 *
 * The engine's `config.VoiceConfig` payload is provider-specific and round-trips
 * opaquely — this component never interprets it beyond finding a voice name to
 * hand back to the parent (`voice_name` / `voice_id` / `voice`).
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { SelectPicker } from './SelectPicker';
import { engineApiClient } from '../../services/engine/EngineApiClient';
import type { VoiceConfigDto } from '../../services/engine/EngineApiClient';
import { hapticLightPress } from '../../utils/haptics';
import { createLogger } from '../../utils/logger';

const log = createLogger('[VoiceProfileBar]');

export interface VoiceProfileBarProps {
  /** Voice name currently held by the capability (display only). */
  selectedVoiceName: string;
  /** The live TTS capability to persist when saving a profile. */
  capability: Record<string, any>;
  /** Called with the profile's voice name (and full config) when one loads. */
  onSelectProfile: (voiceName: string, loadedConfig?: Record<string, any>) => void;
}

const MANUAL = '';

export const VoiceProfileBar: React.FC<VoiceProfileBarProps> = ({
  selectedVoiceName,
  capability,
  onSelectProfile,
}) => {
  const { theme } = useAppTheme();

  const [profiles, setProfiles] = useState<VoiceConfigDto[]>([]);
  const [selected, setSelected] = useState<string>(() =>
    String(capability?.voice_config_file ?? MANUAL),
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    const incoming = String(capability?.voice_config_file ?? MANUAL);
    setSelected(incoming);
  }, [capability?.voice_config_file]);

  const loadProfiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await engineApiClient.listVoiceConfigs();
      setProfiles(res?.voices ?? []);
    } catch (e) {
      setError((e as Error)?.message ?? 'Failed to load voice profiles');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  if (!theme) return null;

  const handleSelect = async (name: string) => {
    hapticLightPress();
    setSelected(name);
    setError(null);
    if (name === MANUAL) {
      onSelectProfile('');
      return;
    }
    setBusy(true);
    try {
      const dto = await engineApiClient.getVoiceConfig(name);
      const config =
        (dto?.config as Record<string, any> | undefined) ??
        ((dto as unknown as Record<string, any>) ?? {});
      onSelectProfile(name, config);
    } catch (e) {
      setError((e as Error)?.message ?? 'Failed to load voice profile');
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    if (!selected) {
      openSaveAs();
      return;
    }
    hapticLightPress();
    setBusy(true);
    setError(null);
    try {
      await engineApiClient.updateVoiceConfig(selected, capability);
      await loadProfiles();
    } catch (e) {
      setError((e as Error)?.message ?? 'Failed to save voice profile');
    } finally {
      setBusy(false);
    }
  };

  const openSaveAs = () => {
    hapticLightPress();
    setNewName(selected || selectedVoiceName || '');
    setNameError(null);
    setModalOpen(true);
  };

  const handleCreate = async () => {
    const trimmed = newName.trim();
    if (trimmed === '') {
      setNameError('Profile name is required');
      return;
    }
    if (/[\\/]/.test(trimmed) || trimmed.includes('..')) {
      setNameError('Profile name cannot contain path separators or ".."');
      return;
    }
    setBusy(true);
    setNameError(null);
    try {
      await engineApiClient.createVoiceConfig(trimmed, capability);
      setSelected(trimmed);
      onSelectProfile(trimmed, capability);
      setModalOpen(false);
      await loadProfiles();
    } catch (e) {
      setNameError((e as Error)?.message ?? 'Failed to create voice profile');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = () => {
    if (!selected) return;
    hapticLightPress();
    Alert.alert(
      'Delete voice profile',
      `Delete “${selected}”? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusy(true);
              try {
                await engineApiClient.deleteVoiceConfig(selected);
                setSelected(MANUAL);
                onSelectProfile('');
                await loadProfiles();
              } catch (e) {
                log.error('Failed to delete voice profile:', e);
                setError((e as Error)?.message ?? 'Failed to delete voice profile');
              } finally {
                setBusy(false);
              }
            })();
          },
        },
      ],
      { cancelable: true },
    );
  };

  const options = [
    { id: MANUAL, name: '🎙️ Manual (inline settings)' },
    ...profiles.map((p) => ({ id: p.name, name: `🎙️ ${p.name}` })),
  ];
  if (selected && !options.find((o) => o.id === selected)) {
    options.push({ id: selected, name: `🎙️ ${selected}` });
  }

  return (
    <View style={styles.wrapper} testID="voice-profile-bar">
      <View style={styles.headerRow}>
        <ThemedText size={11.5} style={styles.profileLabel}>
          Voice Configuration Profile (/api/voices)
        </ThemedText>
        <ThemedText size={10.5} style={styles.syncedText}>
          Synced with Engine
        </ThemedText>
      </View>

      <View style={styles.actionRow}>
        <View style={styles.pickerWrap}>
          <SelectPicker
            label="Voice Profile"
            value={selected}
            options={options}
            onChange={(name) => {
              void handleSelect(name);
            }}
            placeholder={selectedVoiceName ? `🎙️ ${selectedVoiceName}` : '🎙️ Manual (inline settings)'}
          />
        </View>
        <TouchableOpacity
          testID="voice-profile-save-button"
          onPress={() => {
            void handleSave();
          }}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Save voice profile"
          style={styles.btnOutlineDark}
        >
          <ThemedText size={11.5} style={styles.btnOutlineDarkText}>
            💾 Save
          </ThemedText>
        </TouchableOpacity>
        <TouchableOpacity
          testID="voice-profile-save-as-button"
          onPress={openSaveAs}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Save voice profile as"
          style={styles.btnOutlineDark}
        >
          <ThemedText size={11.5} style={styles.btnOutlineDarkText}>
            + New
          </ThemedText>
        </TouchableOpacity>
        {selected !== MANUAL && (
          <TouchableOpacity
            testID="voice-profile-delete-button"
            onPress={handleDelete}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Delete voice profile"
            style={styles.deleteButton}
          >
            <Icon name="trash-can-outline" size={14} color="#f472b6" />
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <ThemedText size={11} variant="muted">
          Loading voice profiles…
        </ThemedText>
      ) : null}
      {error ? (
        <ThemedText size={11} style={{ color: theme.colors.status.error }} testID="voice-profile-error">
          {error}
        </ThemedText>
      ) : null}

      <Modal
        visible={modalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalShell,
              {
                backgroundColor: theme.colors.background.surface,
                borderColor: theme.colors.border.default,
              },
            ]}
          >
            <ThemedText size={16} weight="bold">
              Save Voice Profile As
            </ThemedText>
            <TextInput
              testID="voice-profile-name-input"
              value={newName}
              onChangeText={(text) => {
                setNewName(text);
                if (nameError) setNameError(null);
              }}
              placeholder="Profile name"
              placeholderTextColor={theme.colors.text.muted}
              style={[
                styles.nameInput,
                {
                  color: theme.colors.text.primary,
                  borderColor: theme.colors.border.default,
                  backgroundColor: theme.colors.background.base,
                },
              ]}
            />
            {nameError ? (
              <ThemedText size={12} style={{ color: theme.colors.status.error }}>
                {nameError}
              </ThemedText>
            ) : null}
            <View style={styles.modalActions}>
              <TouchableOpacity
                testID="voice-profile-cancel"
                onPress={() => setModalOpen(false)}
                accessibilityRole="button"
                style={styles.modalButton}
              >
                <ThemedText size={13} variant="secondary">
                  Cancel
                </ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                testID="voice-profile-create"
                onPress={() => {
                  void handleCreate();
                }}
                disabled={busy}
                accessibilityRole="button"
                style={[
                  styles.modalButton,
                  { backgroundColor: theme.colors.accent.primary, opacity: busy ? 0.6 : 1 },
                ]}
              >
                <ThemedText size={13} weight="medium" style={styles.primaryText}>
                  Save profile
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
  wrapper: { gap: 8 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  profileLabel: {
    color: '#CBD5E1',
    fontWeight: '600',
  },
  syncedText: {
    color: '#E879F9',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pickerWrap: { flex: 1 },
  btnOutlineDark: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 22, 38, 0.9)',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  btnOutlineDarkText: {
    color: '#E879F9',
    fontWeight: '600',
  },
  deleteButton: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(236, 72, 153, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(236, 72, 153, 0.45)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 20,
  },
  modalShell: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 18,
    gap: 10,
  },
  nameInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    minHeight: 44,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  modalButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  primaryText: { color: '#FFFFFF' },
});
