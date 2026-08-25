/**
 * CategoryFilterDropdown — compact category filter for the Characters screen.
 *
 * Replaces the row of one-chip-per-category in the filter bar. When a user has
 * many categories, chips overflow and become hard to manage; this dropdown
 * collapses them into a single trigger button that opens an obsidian-glass
 * bottom sheet (same visual language as SelectPicker / ManageCategoriesModal).
 *
 * The trigger shows the currently selected category (or a placeholder for
 * "All"/"Favorites"). Selecting a category in the sheet applies the filter and
 * closes. A "Manage categories" action is also offered inside the sheet.
 */

import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { hexToRgba } from '../../utils/colorUtils';
import { hapticLightPress } from '../../utils/haptics';
import type { CharacterCategory } from '../../services/CategoryPreferencesService';

interface CategoryFilterDropdownProps {
  /** Currently active filter: 'all' | 'favorites' | category id */
  selected: string;
  categories: CharacterCategory[];
  /** categoryId → member count, shown next to each option */
  counts?: Record<string, number>;
  /** Label on the trigger when no specific category is selected */
  placeholder: string;
  /** Header title of the bottom sheet */
  title: string;
  /** Label for the "manage categories" action in the sheet */
  manageLabel: string;
  /** Shown in the sheet when there are no categories */
  emptyLabel: string;
  onSelect: (key: string) => void;
  onManagePress: () => void;
}

export const CategoryFilterDropdown: React.FC<CategoryFilterDropdownProps> = ({
  selected,
  categories,
  counts = {},
  placeholder,
  title,
  manageLabel,
  emptyLabel,
  onSelect,
  onManagePress,
}) => {
  const { theme } = useAppTheme();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  if (!theme) return null;

  const accent = theme.colors.accent.primary;
  const accentSecondary =
    theme.colors.accent.secondary ?? theme.colors.accent.primary;

  const selectedCategory = categories.find(c => c.id === selected);
  const isCategoryActive = !!selectedCategory;
  const displayText = selectedCategory?.name ?? placeholder;

  const handleSelect = (key: string) => {
    onSelect(key);
    setOpen(false);
  };

  return (
    <>
      {/* Trigger button — styled like the existing filter chips */}
      <TouchableOpacity
        onPress={() => {
          hapticLightPress();
          setOpen(true);
        }}
        activeOpacity={0.7}
        style={[
          styles.trigger,
          {
            backgroundColor: isCategoryActive
              ? hexToRgba(accent, 0.22)
              : hexToRgba(theme.colors.background.base, 0.55),
            borderColor: isCategoryActive ? accent : hexToRgba(accent, 0.25),
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel={displayText}
        accessibilityState={{ expanded: open, selected: isCategoryActive }}
        testID="category-filter-dropdown"
      >
        <Icon
          name="shape-outline"
          size={14}
          color={isCategoryActive ? accent : theme.colors.text.muted}
        />
        <ThemedText
          size={13}
          variant={isCategoryActive ? 'accent' : 'primary'}
          weight={isCategoryActive ? 'bold' : 'normal'}
          numberOfLines={1}
          style={styles.triggerText}
        >
          {displayText}
        </ThemedText>
        <Icon
          name="chevron-down"
          size={14}
          color={isCategoryActive ? accent : theme.colors.text.muted}
        />
      </TouchableOpacity>

      {/* Bottom-sheet category list */}
      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <TouchableWithoutFeedback onPress={() => setOpen(false)}>
          <View style={styles.overlay}>
            <TouchableWithoutFeedback>
              <View
                style={[styles.sheet, { paddingBottom: safeBottom }]}
              >
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
                    {title}
                  </ThemedText>
                  <TouchableOpacity
                    onPress={() => setOpen(false)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel="Close"
                  >
                    <Icon name="close" size={22} color={theme.colors.text.muted} />
                  </TouchableOpacity>
                </View>

                {/* Hairline separator */}
                <View
                  style={[
                    styles.headerSeparator,
                    { backgroundColor: theme.colors.border.default + '55' },
                  ]}
                />

                {/* Category options */}
                <FlatList
                  data={categories}
                  keyExtractor={item => item.id}
                  style={styles.list}
                  keyboardShouldPersistTaps="handled"
                  ListEmptyComponent={
                    <ThemedText variant="muted" size={13} style={styles.emptyText}>
                      {emptyLabel}
                    </ThemedText>
                  }
                  renderItem={({ item }) => {
                    const isSelected = item.id === selected;
                    const count = counts[item.id] ?? 0;
                    return (
                      <TouchableOpacity
                        onPress={() => handleSelect(item.id)}
                        activeOpacity={0.65}
                        style={[
                          styles.optionRow,
                          isSelected && { backgroundColor: accent + '18' },
                        ]}
                      >
                        {/* Left accent pip for selected */}
                        {isSelected && (
                          <LinearGradient
                            colors={[accent, accentSecondary]}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 0, y: 1 }}
                            style={styles.rowPip}
                          />
                        )}

                        <Icon
                          name="shape-outline"
                          size={18}
                          color={isSelected ? accent : theme.colors.text.muted}
                        />
                        <ThemedText
                          size={15}
                          weight={isSelected ? 'bold' : 'medium'}
                          variant={isSelected ? 'accent' : 'primary'}
                          numberOfLines={1}
                          style={styles.optionText}
                        >
                          {item.name}
                        </ThemedText>
                        <ThemedText variant="muted" size={12}>
                          {count}
                        </ThemedText>
                        {isSelected && (
                          <Icon name="check-circle" size={20} color={accent} />
                        )}

                        {/* Row separator */}
                        <View
                          style={[
                            styles.rowSeparator,
                            { backgroundColor: theme.colors.border.default + '44' },
                          ]}
                        />
                      </TouchableOpacity>
                    );
                  }}
                />

                {/* Manage categories action */}
                <TouchableOpacity
                  onPress={() => {
                    hapticLightPress();
                    setOpen(false);
                    onManagePress();
                  }}
                  activeOpacity={0.65}
                  accessibilityRole="button"
                  style={[
                    styles.manageRow,
                    {
                      borderTopColor: theme.colors.border.default + '55',
                    },
                  ]}
                >
                  <Icon name="cog-outline" size={18} color={accent} />
                  <ThemedText size={14} variant="accent" weight="medium">
                    {manageLabel}
                  </ThemedText>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
  },
  triggerText: {
    maxWidth: 150,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
    maxHeight: '70%',
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
  headerSeparator: {
    height: StyleSheet.hairlineWidth,
  },
  list: {
    maxHeight: 420,
  },
  emptyText: {
    textAlign: 'center',
    paddingVertical: 20,
    paddingHorizontal: 20,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 12,
  },
  rowPip: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: 3,
  },
  optionText: {
    flex: 1,
  },
  rowSeparator: {
    position: 'absolute',
    left: 20,
    right: 0,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
  },
  manageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingTop: 16,
    paddingBottom: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
