/**
 * CategoryTabBar - Horizontal scrollable category tabs
 */
import React, { memo } from 'react';
import { ScrollView, TouchableOpacity, StyleSheet, View, Text } from 'react-native';
import { Theme } from '../../theme/types';
import { EmojiCategory } from '../../types/emoji';

interface CategoryTabBarProps {
  categories: EmojiCategory[];
  activeCategory: string;
  onSelectCategory: (categoryId: string) => void;
  theme: Theme;
}

const TAB_SIZE = 40;

export const CategoryTabBar: React.FC<CategoryTabBarProps> = memo(({
  categories,
  activeCategory,
  onSelectCategory,
  theme,
}) => {
  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background.surface }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {categories.map(category => {
          const isActive = activeCategory === category.id;

          return (
            <TouchableOpacity
              key={category.id}
              style={[
                styles.tab,
                isActive && {
                  backgroundColor: theme.colors.accent.primary + '30',
                  borderBottomWidth: 2,
                  borderBottomColor: theme.colors.accent.primary,
                },
              ]}
              onPress={() => onSelectCategory(category.id)}
              activeOpacity={0.7}
            >
              <Text style={[styles.icon, { fontSize: 18 }]}>
                {category.icon}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    height: 50,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  scrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  tab: {
    width: TAB_SIZE,
    height: TAB_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 2,
    borderRadius: 8,
  },
  icon: {
    textAlign: 'center',
  },
});

export default CategoryTabBar;