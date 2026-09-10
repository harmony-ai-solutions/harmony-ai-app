/**
 * AddToCategoryModal — pick the categories a single character belongs to.
 *
 * Opens from the long-press character-card context menu ("Add to category").
 * Shows every category as a toggleable row (checked = the character belongs
 * to it). Toggling a row immediately persists via the client-only category
 * repository.
 */

import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { hexToRgba } from '../../utils/colorUtils';
import { hapticLightPress } from '../../utils/haptics';
import type { CharacterCategory } from '../../services/CategoryPreferencesService';

interface AddToCategoryModalProps {
  visible: boolean;
  characterName: string;
  categories: CharacterCategory[];
  /** Map of categoryId → whether this character is a member */
  assigned: Record<string, boolean>;
  onToggle: (categoryId: string, assign: boolean) => Promise<void> | void;
  onClose: () => void;
}

export const AddToCategoryModal: React.FC<AddToCategoryModalProps> = ({
  visible,
  characterName,
  categories,
  assigned,
  onToggle,
  onClose,
}) => {
  const { theme } = useAppTheme();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const { t } = useTranslation('characters');
  // In-flight category ids so rapid toggles can't double-fire
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!visible) setBusyIds(new Set());
  }, [visible]);

  if (!theme) return null;

  const accent = theme.colors.accent.primary;
  const accentSecondary =
    theme.colors.accent.secondary ?? theme.colors.accent.primaryHover;

  const handleToggle = async (categoryId: string) => {
    if (busyIds.has(categoryId)) return;
    const willAssign = !assigned[categoryId];
    setBusyIds(prev => new Set(prev).add(categoryId));
    try {
      await onToggle(categoryId, willAssign);
    } finally {
      setBusyIds(prev => {
        const next = new Set(prev);
        next.delete(categoryId);
        return next;
      });
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
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
                <View style={styles.headerText}>
                  <ThemedText size={18} weight="bold">
                    {t('addToCategoryTitle')}
                  </ThemedText>
                  <ThemedText variant="muted" size={13} numberOfLines={1}>
                    {characterName}
                  </ThemedText>
                </View>
                <TouchableOpacity
                  onPress={onClose}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityLabel="Close"
                  accessibilityRole="button"
                >
                  <Icon name="close" size={22} color={theme.colors.text.muted} />
                </TouchableOpacity>
              </View>

              {/* Category toggle list */}
              <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
                {categories.length === 0 ? (
                  <ThemedText variant="muted" size={13} style={styles.emptyText}>
                    {t('addToCategoryNoCategories')}
                  </ThemedText>
                ) : (
                  categories.map(category => {
                    const isOn = !!assigned[category.id];
                    const isBusy = busyIds.has(category.id);
                    return (
                      <TouchableOpacity
                        key={category.id}
                        onPress={() => {
                          hapticLightPress();
                          handleToggle(category.id);
                        }}
                        activeOpacity={0.7}
                        style={[
                          styles.row,
                          {
                            backgroundColor: hexToRgba(theme.colors.background.base, 0.45),
                            borderColor: isOn ? accent + '66' : theme.colors.border.default + '66',
                          },
                        ]}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: isOn }}
                        accessibilityLabel={`${category.name}${isOn ? ', selected' : ''}`}
                      >
                        <View style={styles.rowTextGroup}>
                          <Icon name="shape-outline" size={18} color={accent} style={styles.rowIcon} />
                          <ThemedText
                            size={15}
                            variant={isOn ? 'accent' : 'primary'}
                            weight={isOn ? 'bold' : 'medium'}
                            style={styles.rowName}
                          >
                            {category.name}
                          </ThemedText>
                        </View>

                        {isBusy ? (
                          <ActivityIndicator size="small" color={accent} />
                        ) : (
                          <LinearGradient
                            colors={
                              isOn
                                ? [accent, accentSecondary]
                                : [theme.colors.border.default, theme.colors.border.default]
                            }
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                            style={styles.checkShell}
                          >
                            <Icon
                              name={isOn ? 'check' : 'plus'}
                              size={16}
                              color={isOn ? '#fff' : theme.colors.text.muted}
                            />
                          </LinearGradient>
                        )}
                      </TouchableOpacity>
                    );
                  })
                )}
              </ScrollView>
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
  headerText: {
    flex: 1,
    gap: 2,
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
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowTextGroup: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rowIcon: {},
  rowName: {
    flex: 1,
  },
  checkShell: {
    width: 26,
    height: 26,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    textAlign: 'center',
    paddingVertical: 20,
  },
});
