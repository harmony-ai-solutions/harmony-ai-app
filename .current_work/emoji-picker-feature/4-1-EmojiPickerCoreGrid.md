# Phase 4: Emoji Picker UI — Core Grid & Categories

## Objective

Build the core native emoji picker component with:
- Category tab bar (horizontal scrollable icons)
- Emoji grid (FlatList with columns)
- Proper theming integration with the existing ThemedView/ThemedText system
- Modal wrapper for showing/hiding the picker

## Codebase References

- [`src/components/chat/ChatInput.tsx`](../../src/components/chat/ChatInput.tsx) — bottom bar layout, icon buttons
- [`src/components/themed/ThemedView.tsx`](../../src/components/themed/ThemedView.tsx) — themed container pattern
- [`src/components/themed/ThemedText.tsx`](../../src/components/themed/ThemedText.tsx) — themed text pattern
- [`src/contexts/ThemeContext.tsx`](../../src/contexts/ThemeContext.tsx) — theme access pattern
- [`src/types/emoji.ts`](../../src/types/emoji.ts) — EmojiEntry, EmojiCategory types
- [`.planning/codebase/CONVENTIONS.md`](../../.planning/codebase/CONVENTIONS.md) — component patterns

---

## Task 1 — Create EmojiItem component

**File:** `src/components/emoji/EmojiItem.tsx`

A single emoji button in the grid. Handles both native (text rendering) and sprite sheet (image rendering) modes.

```typescript
import React, { memo, useCallback } from 'react';
import { TouchableOpacity, Text, View, Image, ImageResolvedSource, StyleSheet } from 'react-native';
import { useEmoji } from '../../contexts/EmojiContext';
import { EmojiEntry } from '../../types/emoji';

interface EmojiItemProps {
  emoji: EmojiEntry;
  size: number;           // display size in px
  onPress: (emoji: EmojiEntry) => void;
  onLongPress?: (emoji: EmojiEntry) => void;
}

export const EmojiItem: React.FC<EmojiItemProps> = memo(({
  emoji,
  size,
  onPress,
  onLongPress,
}) => {
  const { emojiSet, skinTone, emojiService } = useEmoji();

  const handlePress = useCallback(() => onPress(emoji), [emoji, onPress]);
  const handleLongPress = useCallback(() => onLongPress?.(emoji), [emoji, onLongPress]);

  // Resolve which native character to show (considering skin tone)
  const skinIndex = Math.min(skinTone - 1, emoji.skins.length - 1);
  const activeSkin = emoji.skins[skinIndex] ?? emoji.skins[0];
  const nativeChar = activeSkin?.native ?? emoji.native;

  if (emojiSet === 'native') {
    // Native rendering — just use the Unicode character as text
    return (
      <TouchableOpacity
        onPress={handlePress}
        onLongPress={handleLongPress}
        style={[styles.touchable, { width: size + 8, height: size + 8 }]}
        activeOpacity={0.6}
      >
        <Text style={[styles.nativeEmoji, { fontSize: size * 0.78 }]}>
          {nativeChar}
        </Text>
      </TouchableOpacity>
    );
  }

  // Sprite sheet rendering — crop the emoji from the sheet
  const sheet = emojiService.getSpriteSheet(emojiSet);
  const crop = emojiService.getSpriteCrop(activeSkin?.x ?? emoji.sheetX, activeSkin?.y ?? emoji.sheetY);

  if (!sheet) {
    // Fallback to native if sheet not available
    return (
      <TouchableOpacity
        onPress={handlePress}
        onLongPress={handleLongPress}
        style={[styles.touchable, { width: size + 8, height: size + 8 }]}
        activeOpacity={0.6}
      >
        <Text style={[styles.nativeEmoji, { fontSize: size * 0.78 }]}>
          {nativeChar}
        </Text>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      onPress={handlePress}
      onLongPress={handleLongPress}
      style={[styles.touchable, { width: size + 8, height: size + 8 }]}
      activeOpacity={0.6}
    >
      <View style={[styles.cropContainer, { width: size, height: size }]}>
        <Image
          source={Image.resolveAssetSource(sheet)}
          style={{
            position: 'absolute',
            left: -crop.x * (size / 64),
            top: -crop.y * (size / 64),
            width: 3840 * (size / 64),   // approximate full sheet width, will be calculated
            height: 3840 * (size / 64),  // approximate full sheet height, will be calculated
            resizeMode: 'contain',
          }}
          fadeDuration={0}
        />
      </View>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  touchable: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  nativeEmoji: {
    textAlign: 'center',
  },
  cropContainer: {
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
```

> **Implementation note:** The sprite sheet rendering requires knowing the full sheet dimensions. During implementation, we'll use `Image.resolveAssetSource()` to get the actual sheet dimensions, then compute the scale factor dynamically. The exact pixel math will be refined during implementation. An alternative approach is to use individual emoji PNGs from the `emoji-datasource` packages (at 64px) instead of sprite sheets, which simplifies rendering at the cost of more files. **Evaluate both approaches during implementation.**

---

## Task 2 — Create CategoryTabBar component

**File:** `src/components/emoji/CategoryTabBar.tsx`

Horizontal scrollable tab bar showing category icons. Matches the app's existing rounded pill/ badge style.

```typescript
import React, { memo, useCallback, useRef } from 'react';
import {
  ScrollView,
  TouchableOpacity,
  Text,
  StyleSheet,
  ViewStyle,
} from 'react-native';
import { EmojiCategory } from '../../types/emoji';
import { Theme } from '../../theme/types';

interface CategoryTabBarProps {
  categories: EmojiCategory[];
  activeCategory: string;
  onSelectCategory: (categoryId: string) => void;
  theme: Theme;
}

export const CategoryTabBar: React.FC<CategoryTabBarProps> = memo(({
  categories,
  activeCategory,
  onSelectCategory,
  theme,
}) => {
  const scrollViewRef = useRef<ScrollView>(null);

  return (
    <ScrollView
      ref={scrollViewRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[styles.container, { backgroundColor: theme.colors.background.surface }]}
      contentContainerStyle={styles.content}
    >
      {categories.map(category => {
        const isActive = category.id === activeCategory;
        return (
          <TouchableOpacity
            key={category.id}
            onPress={() => onSelectCategory(category.id)}
            style={[
              styles.tab,
              {
                backgroundColor: isActive
                  ? theme.colors.accent.primary + '22'
                  : 'transparent',
                borderBottomColor: isActive
                  ? theme.colors.accent.primary
                  : 'transparent',
              },
            ]}
            activeOpacity={0.6}
          >
            <Text style={[styles.tabIcon, { fontSize: 18 }]}>
              {category.icon}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  container: {
    maxHeight: 44,
  },
  content: {
    paddingHorizontal: 8,
    gap: 2,
  },
  tab: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderBottomWidth: 2,
    borderRadius: 4,
  },
  tabIcon: {
    textAlign: 'center',
  },
});
```

---

## Task 3 — Create EmojiGrid component

**File:** `src/components/emoji/EmojiGrid.tsx`

FlatList-based emoji grid. Renders sections per category with sticky category headers.

```typescript
import React, { memo, useCallback, useMemo, useRef } from 'react';
import {
  FlatList,
  View,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { EmojiItem } from './EmojiItem';
import { ThemedText } from '../themed/ThemedText';
import { EmojiCategory, EmojiEntry } from '../../types/emoji';
import { Theme } from '../../theme/types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const EMOJI_SIZE = 36;
const HORIZONTAL_PADDING = 12;
const EMOJIS_PER_ROW = Math.floor(
  (SCREEN_WIDTH - HORIZONTAL_PADDING * 2) / (EMOJI_SIZE + 8)
);

interface EmojiGridProps {
  categories: EmojiCategory[];
  activeCategory: string;
  onEmojiPress: (emoji: EmojiEntry) => void;
  onEmojiLongPress: (emoji: EmojiEntry) => void;
  theme: Theme;
}

interface GridItem {
  type: 'header' | 'emoji';
  categoryId: string;
  categoryLabel?: string;
  emoji?: EmojiEntry;
}

export const EmojiGrid: React.FC<EmojiGridProps> = memo(({
  categories,
  activeCategory,
  onEmojiPress,
  onEmojiLongPress,
  theme,
}) => {
  const flatListRef = useRef<FlatList>(null);

  // Flatten categories into a single list of headers + emoji rows
  const gridItems = useMemo((): GridItem[] => {
    const items: GridItem[] = [];
    for (const category of categories) {
      items.push({
        type: 'header',
        categoryId: category.id,
        categoryLabel: category.name,
      });
      for (const emoji of category.emojis) {
        items.push({
          type: 'emoji',
          categoryId: category.id,
          emoji,
        });
      }
    }
    return items;
  }, [categories]);

  const renderItem = useCallback(({ item }: { item: GridItem }) => {
    if (item.type === 'header') {
      return (
        <View style={[styles.header, { backgroundColor: theme.colors.background.surface }]}>
          <ThemedText variant="secondary" style={styles.headerText}>
            {item.categoryLabel}
          </ThemedText>
        </View>
      );
    }

    return (
      <EmojiItem
        emoji={item.emoji!}
        size={EMOJI_SIZE}
        onPress={onEmojiPress}
        onLongPress={onEmojiLongPress}
      />
    );
  }, [theme, onEmojiPress, onEmojiLongPress]);

  const getItemLayout = useCallback((_: any, index: number) => ({
    length: EMOJI_SIZE + 8,
    offset: (EMOJI_SIZE + 8) * index,
    index,
  }), []);

  // Scroll to category when active changes
  const scrollToCategory = useCallback((categoryId: string) => {
    const index = gridItems.findIndex(item => item.type === 'header' && item.categoryId === categoryId);
    if (index >= 0) {
      flatListRef.current?.scrollToIndex({ index, animated: true });
    }
  }, [gridItems]);

  return (
    <FlatList
      ref={flatListRef}
      data={gridItems}
      keyExtractor={(item, index) => item.type === 'header' ? `h-${item.categoryId}` : `e-${item.emoji!.id}`}
      renderItem={renderItem}
      numColumns={EMOJIS_PER_ROW}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.gridContent}
      onScrollToIndexFailed={(info) => {
        // Graceful fallback for scroll failures
        flatListRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: true });
      }}
    />
  );
});

const styles = StyleSheet.create({
  gridContent: {
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingBottom: 16,
  },
  header: {
    paddingHorizontal: 4,
    paddingVertical: 8,
    marginTop: 4,
  },
  headerText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
```

---

## Task 4 — Create EmojiPickerModal wrapper

**File:** `src/components/emoji/EmojiPickerModal.tsx`

Modal wrapper that shows/hides the full picker. Integrates all sub-components.

```typescript
import React, { useState, useCallback, memo } from 'react';
import { Modal, View, StyleSheet, TouchableOpacity, SafeAreaView } from 'react-native';
import { EmojiGrid } from './EmojiGrid';
import { CategoryTabBar } from './CategoryTabBar';
import { ThemedView } from '../themed/ThemedView';
import { ThemedText } from '../themed/ThemedText';
import { useAppTheme } from '../../contexts/ThemeContext';
import { useEmoji } from '../../contexts/EmojiContext';
import { EmojiEntry } from '../../types/emoji';

interface EmojiPickerModalProps {
  visible: boolean;
  onClose: () => void;
  onEmojiSelected: (emoji: EmojiEntry) => void;
}

export const EmojiPickerModal: React.FC<EmojiPickerModalProps> = memo(({
  visible,
  onClose,
  onEmojiSelected,
}) => {
  const { theme } = useAppTheme();
  const { emojiService } = useEmoji();
  const [activeCategory, setActiveCategory] = useState('people');
  const [showSkinTonePicker, setShowSkinTonePicker] = useState(false);

  const categories = emojiService.getCategories();

  const handleEmojiPress = useCallback((emoji: EmojiEntry) => {
    onEmojiSelected(emoji);
  }, [onEmojiSelected]);

  const handleEmojiLongPress = useCallback((emoji: EmojiEntry) => {
    // Skin tone picker will be implemented in Phase 5
    setShowSkinTonePicker(true);
  }, []);

  if (!theme) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.modalContainer}>
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={onClose}
        />
        <ThemedView style={[styles.pickerContainer, { backgroundColor: theme.colors.background.base }]}>
          {/* Category tabs */}
          <CategoryTabBar
            categories={categories}
            activeCategory={activeCategory}
            onSelectCategory={setActiveCategory}
            theme={theme}
          />

          {/* Divider */}
          <View style={[styles.divider, { backgroundColor: theme.colors.border.default }]} />

          {/* Emoji grid */}
          <EmojiGrid
            categories={categories}
            activeCategory={activeCategory}
            onEmojiPress={handleEmojiPress}
            onEmojiLongPress={handleEmojiLongPress}
            theme={theme}
          />
        </ThemedView>
      </SafeAreaView>
    </Modal>
  );
});

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    flex: 1,
  },
  pickerContainer: {
    height: '55%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
});
```

---

## Task 5 — Export barrel file

**File:** `src/components/emoji/index.ts`

```typescript
export { EmojiPickerModal } from './EmojiPickerModal';
export { EmojiItem } from './EmojiItem';
export { EmojiGrid } from './EmojiGrid';
export { CategoryTabBar } from './CategoryTabBar';
```

---

## Progress Checklist

- [ ] `src/components/emoji/EmojiItem.tsx` created — renders emoji (native text or sprite sheet crop)
- [ ] `src/components/emoji/CategoryTabBar.tsx` created — horizontal scrollable category tabs
- [ ] `src/components/emoji/EmojiGrid.tsx` created — FlatList grid with section headers
- [ ] `src/components/emoji/EmojiPickerModal.tsx` created — modal wrapper
- [ ] `src/components/emoji/index.ts` barrel export created
- [ ] All components compile without TypeScript errors
- [ ] Components use ThemedView/ThemedText and `useAppTheme()` consistently
