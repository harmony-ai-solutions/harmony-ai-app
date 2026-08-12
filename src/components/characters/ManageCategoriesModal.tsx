/**
 * ManageCategoriesModal — create / rename / delete character categories and
 * manage which characters belong to each one.
 *
 * Opens as an obsidian-glass bottom sheet over the Characters screen. Used by
 * the "Manage categories" chip next to the category filter chips.
 *
 * The modal is intentionally UI-only: every mutation calls straight into the
 * client-only category repository and reports back via `onChange` so the
 * screen can refresh its chip row. Each category row can be expanded to
 * toggle which character profiles are members.
 */

import React, { useState, useCallback, useRef } from 'react';
import {
  Modal,
  View,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  FlatList,
  TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { useAppAlert } from '../../contexts/AppAlertContext';
import { ThemedText } from '../themed/ThemedText';
import { ThemedButton } from '../themed/ThemedButton';
import { hexToRgba } from '../../utils/colorUtils';
import type { CharacterCategory } from '../../database/repositories/characters';
import type { CharacterProfile } from '../../database/models';

interface ManageCategoriesModalProps {
  visible: boolean;
  categories: CharacterCategory[];
  /** All character profiles that can be assigned to categories */
  profiles: CharacterProfile[];
  /** Map of categoryId → Set(profileId) for current memberships */
  categoryMembers: Record<string, Set<string>>;
  onClose: () => void;
  /** Fired after any category create/rename/delete succeeds */
  onChange: () => void;
  onCreate: (name: string) => Promise<void>;
  onRename: (categoryId: string, name: string) => Promise<void>;
  onDelete: (categoryId: string) => Promise<void>;
  /** Toggle a profile's membership in a category */
  onToggleMember: (profileId: string, categoryId: string, assign: boolean) => Promise<void>;
}

export const ManageCategoriesModal: React.FC<ManageCategoriesModalProps> = ({
  visible,
  categories,
  profiles,
  categoryMembers,
  onClose,
  onChange,
  onCreate,
  onRename,
  onDelete,
  onToggleMember,
}) => {
  const { theme } = useAppTheme();
  const { showAlert } = useAppAlert();
  const { bottom: safeBottom } = useSafeAreaInsets();

  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [busy, setBusy] = useState(false);
  // Which category's member list is expanded (null = none)
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Profile ids currently being toggled (prevents double-fire)
  const [busyMemberIds, setBusyMemberIds] = useState<Set<string>>(new Set());

  const inputRef = useRef<TextInput>(null);

  const reset = useCallback(() => {
    setNewName('');
    setEditingId(null);
    setEditingName('');
    setBusy(false);
    setExpandedId(null);
    setBusyMemberIds(new Set());
  }, []);

  const handleClose = () => {
    reset();
    onClose();
  };

  if (!theme) return null;

  const accent = theme.colors.accent.primary;
  const accentSecondary =
    theme.colors.accent.secondary ?? theme.colors.accent.primaryHover;

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      await onCreate(name);
      setNewName('');
      onChange();
    } catch {
      showAlert('Error', 'Failed to create category.');
    } finally {
      setBusy(false);
    }
  };

  const handleRename = async (categoryId: string) => {
    const name = editingName.trim();
    if (!name) return;
    setBusy(true);
    try {
      await onRename(categoryId, name);
      setEditingId(null);
      setEditingName('');
      onChange();
    } catch {
      showAlert('Error', 'Failed to rename category.');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = (category: CharacterCategory) => {
    showAlert(
      'Delete category',
      `Delete "${category.name}"? Characters in it will not be deleted.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await onDelete(category.id);
              onChange();
            } catch {
              showAlert('Error', 'Failed to delete category.');
            }
          },
        },
      ],
      { icon: 'delete' },
    );
  };

  const startEdit = (category: CharacterCategory) => {
    setEditingId(category.id);
    setEditingName(category.name);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const toggleExpanded = (categoryId: string) => {
    setExpandedId(prev => (prev === categoryId ? null : categoryId));
  };

  const handleToggleMember = async (profileId: string, categoryId: string, assign: boolean) => {
    if (busyMemberIds.has(profileId)) return;
    setBusyMemberIds(prev => new Set(prev).add(profileId));
    try {
      await onToggleMember(profileId, categoryId, assign);
    } finally {
      setBusyMemberIds(prev => {
        const next = new Set(prev);
        next.delete(profileId);
        return next;
      });
    }
  };

  const inputBg = hexToRgba(theme.colors.background.base, 0.6);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <TouchableWithoutFeedback onPress={handleClose}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback>
            <View style={[styles.sheet, { paddingBottom: safeBottom + 24 }]}>
              {/* Gradient background */}
              <LinearGradient
                colors={[
                  theme.colors.background.elevated,
                  theme.colors.background.surface,
                ]}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={[StyleSheet.absoluteFill, styles.sheetRadius]}
              />
              {/* Prismatic tint */}
              <LinearGradient
                colors={[accent + '10', 'transparent']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0.6 }}
                style={[StyleSheet.absoluteFill, styles.sheetRadius]}
                pointerEvents="none"
              />
              {/* Top accent stripe */}
              <LinearGradient
                colors={[accent + 'CC', accentSecondary + '66', 'transparent']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.topStripe}
              />

              {/* Header */}
              <View style={styles.header}>
                <ThemedText size={18} weight="bold" style={styles.title}>
                  Manage categories
                </ThemedText>
                <TouchableOpacity
                  onPress={handleClose}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityLabel="Close"
                  accessibilityRole="button"
                >
                  <Icon name="close" size={22} color={theme.colors.text.muted} />
                </TouchableOpacity>
              </View>

              {/* Create new category */}
              <View style={styles.createRow}>
                <View style={[styles.inputShell, { backgroundColor: inputBg, borderColor: theme.colors.border.default }]}>
                  <TextInput
                    ref={inputRef}
                    style={[styles.input, { color: theme.colors.text.primary }]}
                    placeholder="Category name"
                    placeholderTextColor={theme.colors.text.disabled}
                    value={newName}
                    onChangeText={setNewName}
                    returnKeyType="done"
                    onSubmitEditing={handleCreate}
                  />
                </View>
                <ThemedButton
                  variant="primary"
                  label="Add"
                  onPress={handleCreate}
                  disabled={!newName.trim() || busy}
                  style={styles.addButton}
                />
              </View>

              {/* Category list */}
              <FlatList
                data={categories}
                keyExtractor={item => item.id}
                style={styles.list}
                contentContainerStyle={styles.listContent}
                keyboardShouldPersistTaps="handled"
                ListEmptyComponent={
                  <ThemedText variant="muted" size={13} style={styles.emptyText}>
                    No categories yet — create one above.
                  </ThemedText>
                }
                renderItem={({ item }) => {
                  const isEditing = editingId === item.id;
                  return (
                    <View
                      style={[
                        styles.row,
                        { backgroundColor: hexToRgba(theme.colors.background.base, 0.45), borderColor: theme.colors.border.default + '66' },
                      ]}
                    >
                      <Icon
                        name="shape-outline"
                        size={18}
                        color={accent}
                        style={styles.rowIcon}
                      />
                      {isEditing ? (
                        <View style={styles.editRow}>
                          <View style={[styles.editInputShell, { backgroundColor: inputBg, borderColor: theme.colors.border.default }]}>
                            <TextInput
                              autoFocus
                              style={[styles.input, { color: theme.colors.text.primary }]}
                              placeholder="Category name"
                              placeholderTextColor={theme.colors.text.disabled}
                              value={editingName}
                              onChangeText={setEditingName}
                              returnKeyType="done"
                              onSubmitEditing={() => handleRename(item.id)}
                            />
                          </View>
                          <TouchableOpacity
                            onPress={() => handleRename(item.id)}
                            disabled={!editingName.trim() || busy}
                            accessibilityRole="button"
                            accessibilityLabel="Save"
                          >
                            <Icon name="check" size={22} color={accent} />
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <>
                          <ThemedText size={15} variant="primary" weight="medium" style={styles.rowName}>
                            {item.name}
                          </ThemedText>
                          <TouchableOpacity
                            onPress={() => toggleExpanded(item.id)}
                            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                            accessibilityRole="button"
                            accessibilityLabel={
                              expandedId === item.id
                                ? `Hide members of ${item.name}`
                                : `Add characters to ${item.name}`
                            }
                          >
                            <Icon
                              name={
                                expandedId === item.id
                                  ? 'minus-circle-outline'
                                  : 'plus-circle-outline'
                              }
                              size={20}
                              color={accent}
                            />
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => startEdit(item)}
                            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                            accessibilityRole="button"
                            accessibilityLabel={`Rename ${item.name}`}
                          >
                            <Icon name="pencil-outline" size={18} color={theme.colors.text.muted} />
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => handleDelete(item)}
                            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                            accessibilityRole="button"
                            accessibilityLabel={`Delete ${item.name}`}
                          >
                            <Icon name="delete-outline" size={18} color={theme.colors.status.error} />
                          </TouchableOpacity>
                        </>
                      )}

                      {/* Expanded member list — toggle each character's membership */}
                      {expandedId === item.id && (
                        <View style={styles.memberList}>
                          {profiles.length === 0 ? (
                            <ThemedText variant="muted" size={13} style={styles.memberEmpty}>
                              No characters to assign.
                            </ThemedText>
                          ) : (
                            profiles.map(profile => {
                              const isMember = categoryMembers[item.id]?.has(profile.id) ?? false;
                              const isBusy = busyMemberIds.has(profile.id);
                              return (
                                <TouchableOpacity
                                  key={profile.id}
                                  onPress={() => handleToggleMember(profile.id, item.id, !isMember)}
                                  activeOpacity={0.7}
                                  style={styles.memberRow}
                                  accessibilityRole="checkbox"
                                  accessibilityState={{ checked: isMember }}
                                >
                                  <Icon
                                    name="account-outline"
                                    size={16}
                                    color={theme.colors.text.muted}
                                  />
                                  <ThemedText
                                    size={14}
                                    variant={isMember ? 'accent' : 'primary'}
                                    weight={isMember ? 'bold' : 'normal'}
                                    numberOfLines={1}
                                    style={styles.memberName}
                                  >
                                    {profile.name}
                                  </ThemedText>
                                  <Icon
                                    name={isBusy ? 'progress-clock' : isMember ? 'check-circle' : 'circle-outline'}
                                    size={20}
                                    color={isMember ? accent : theme.colors.text.disabled}
                                  />
                                </TouchableOpacity>
                              );
                            })
                          )}
                        </View>
                      )}
                    </View>
                  );
                }}
              />
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
    maxHeight: '80%',
    backgroundColor: '#151d30',
  },
  sheetRadius: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  topStripe: {
    height: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
  },
  title: {
    letterSpacing: 0.3,
  },
  createRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  inputShell: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    minHeight: 42,
    justifyContent: 'center',
  },
  editInputShell: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    minHeight: 40,
    justifyContent: 'center',
  },
  input: {
    fontSize: 15,
    paddingVertical: 0,
  },
  addButton: {
    minWidth: 64,
  },
  list: {
    maxHeight: 420,
  },
  listContent: {
    paddingHorizontal: 20,
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowIcon: {},
  rowName: {
    flex: 1,
  },
  editRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  emptyText: {
    textAlign: 'center',
    paddingVertical: 20,
  },
  // ── Expanded member list ──
  memberList: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.08)',
    gap: 4,
  },
  memberEmpty: {
    textAlign: 'center',
    paddingVertical: 8,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 8,
  },
  memberName: {
    flex: 1,
  },
});
