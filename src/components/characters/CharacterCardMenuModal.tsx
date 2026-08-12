/**
 * CharacterCardMenuModal — context menu shown when the user long-presses a
 * character card on the Characters screen.
 *
 * Offers two actions:
 *   - Delete — removes the character profile (with a destructive confirm)
 *   - Add to category — opens the category-picker sheet to assign this
 *     character to one or more categories
 *
 * Both are delegated to the parent via callbacks so the screen owns all
 * persistence (favorites/categories are client-only tables).
 */

import React from 'react';
import {
  Modal,
  View,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';

interface CharacterCardMenuModalProps {
  visible: boolean;
  characterName: string;
  onClose: () => void;
  /** Delete the character profile */
  onDelete: () => void;
  /** Open the "add to category" picker */
  onAddToCategory: () => void;
}

export const CharacterCardMenuModal: React.FC<CharacterCardMenuModalProps> = ({
  visible,
  characterName,
  onClose,
  onDelete,
  onAddToCategory,
}) => {
  const { theme } = useAppTheme();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const { t } = useTranslation('characters');

  if (!theme) return null;

  const accent = theme.colors.accent.primary;
  const accentSecondary =
    theme.colors.accent.secondary ?? theme.colors.accent.primaryHover;

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
                <ThemedText size={18} weight="bold" numberOfLines={1} style={styles.title}>
                  {characterName}
                </ThemedText>
                <TouchableOpacity
                  onPress={onClose}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityLabel="Close"
                  accessibilityRole="button"
                >
                  <Icon name="close" size={22} color={theme.colors.text.muted} />
                </TouchableOpacity>
              </View>

              {/* Actions */}
              <View style={styles.actions}>
                <TouchableOpacity
                  onPress={() => {
                    onClose();
                    onAddToCategory();
                  }}
                  activeOpacity={0.7}
                  style={[
                    styles.actionRow,
                    { backgroundColor: theme.colors.background.base + '55', borderColor: theme.colors.border.default + '66' },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${characterName} to a category`}
                >
                  <Icon name="shape-outline" size={20} color={accent} />
                  <ThemedText size={15} variant="primary" weight="medium" style={styles.actionLabel}>
                    {t('cardMenuAddToCategory')}
                  </ThemedText>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => {
                    onClose();
                    onDelete();
                  }}
                  activeOpacity={0.7}
                  style={[
                    styles.actionRow,
                    { backgroundColor: theme.colors.background.base + '55', borderColor: theme.colors.border.default + '66' },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${characterName}`}
                >
                  <Icon name="delete-outline" size={20} color={theme.colors.status.error} />
                  <ThemedText size={15} variant="primary" weight="medium" style={styles.actionLabel}>
                    {t('cardMenuDelete')}
                  </ThemedText>
                </TouchableOpacity>
              </View>
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
    gap: 12,
  },
  title: {
    flex: 1,
    letterSpacing: 0.3,
  },
  actions: {
    paddingHorizontal: 20,
    paddingBottom: 8,
    gap: 10,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  actionLabel: {
    flex: 1,
  },
});
