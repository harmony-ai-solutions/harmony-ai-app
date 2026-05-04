# Phase 5: Emoji Picker UI — Search & Skin Tones

## Objective

Add two key UX features to the emoji picker:
1. **Search bar** — debounced keyword search using `emoji-mart`'s `SearchIndex`
2. **Skin tone selector** — long-press on an emoji shows skin tone variants
3. **Recent/frequent emoji** — shows recently used emojis at the top of the picker

## Codebase References

- [`src/components/emoji/EmojiPickerModal.tsx`](../../src/components/emoji/EmojiPickerModal.tsx) — picker modal to extend
- [`src/components/emoji/EmojiGrid.tsx`](../../src/components/emoji/EmojiGrid.tsx) — grid to add recent section
- [`src/contexts/EmojiContext.tsx`](../../src/contexts/EmojiContext.tsx) — `recentEmojis`, `skinTone`, `addRecentEmoji`
- [`src/services/EmojiService.ts`](../../src/services/EmojiService.ts) — `search()` method
- [`src/components/chat/ChatInput.tsx`](../../src/components/chat/ChatInput.tsx) — text input styling reference

---

## Task 1 — Create EmojiSearchBar component

**File:** `src/components/emoji/EmojiSearchBar.tsx`

A themed search text input at the top of the picker. Debounces input and calls the parent's search handler.

```typescript
import React, { useState, useCallback, useRef, memo } from 'react';
import {
  TextInput,
  View,
  StyleSheet,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Theme } from '../../theme/types';

interface EmojiSearchBarProps {
  onSearch: (query: string) => void;
  theme: Theme;
  placeholder?: string;
}

export const EmojiSearchBar: React.FC<EmojiSearchBarProps> = memo(({
  onSearch,
  theme,
  placeholder = 'Search emoji...',
}) => {
  const [query, setQuery] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChangeText = useCallback((text: string) => {
    setQuery(text);
    
    // Debounce search by 200ms
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onSearch(text.trim());
    }, 200);
  }, [onSearch]);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background.elevated }]}>
      <Icon
        name="magnify"
        size={18}
        color={theme.colors.text.muted}
        style={styles.icon}
      />
      <TextInput
        value={query}
        onChangeText={handleChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.text.muted}
        style={[styles.input, { color: theme.colors.text.primary }]}
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
      />
      {query.length > 0 && (
        <Icon
          name="close-circle"
          size={16}
          color={theme.colors.text.muted}
          onPress={() => { setQuery(''); onSearch(''); }}
          style={styles.clearIcon}
        />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    marginVertical: 8,
    paddingHorizontal: 12,
    height: 36,
    borderRadius: 18,
  },
  icon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 0,
  },
  clearIcon: {
    padding: 4,
  },
});
```

---

## Task 2 — Create SkinToneSelector component

**File:** `src/components/emoji/SkinToneSelector.tsx`

A small popup shown on emoji long-press. Displays all available skin tone variants of the emoji.

```typescript
import React, { memo, useCallback } from 'react';
import { View, TouchableOpacity, Text, StyleSheet, Modal } from 'react-native';
import { Theme } from '../../theme/types';
import { EmojiEntry } from '../../types/emoji';

interface SkinToneSelectorProps {
  visible: boolean;
  emoji: EmojiEntry | null;
  onSelectSkin: (nativeChar: string) => void;
  onClose: () => void;
  theme: Theme;
}

const SKIN_TONE_LABELS = ['Default', 'Light', 'Medium-Light', 'Medium', 'Medium-Dark', 'Dark'];

export const SkinToneSelector: React.FC<SkinToneSelectorProps> = memo(({
  visible,
  emoji,
  onSelectSkin,
  onClose,
  theme,
}) => {
  if (!visible || !emoji) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
        <View style={[styles.popup, { backgroundColor: theme.colors.background.elevated }]} onStartSetResponder={() => true}>
          {emoji.skins.map((skin, index) => (
            <TouchableOpacity
              key={index}
              style={styles.skinOption}
              onPress={() => onSelectSkin(skin.native)}
            >
              <Text style={styles.skinEmoji}>{skin.native}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </TouchableOpacity>
    </Modal>
  );
});

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  popup: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: 12,
    gap: 8,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  skinOption: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  skinEmoji: {
    fontSize: 28,
    textAlign: 'center',
  },
});
```

---

## Task 3 — Update EmojiPickerModal with search, skin tones, and recent emojis

**File:** `src/components/emoji/EmojiPickerModal.tsx`

Extend the modal created in Phase 4 to include:

1. **SearchBar** at the top — when a query is active, show search results instead of category grid
2. **SkinToneSelector** popup on long-press
3. **Recent emojis section** prepended to the categories list (populated from `EmojiContext.recentEmojis`)

Key changes to the existing modal:

```typescript
// Inside EmojiPickerModal, add state:
const [searchQuery, setSearchQuery] = useState('');
const [searchResults, setSearchResults] = useState<EmojiEntry[]>([]);
const [skinToneEmoji, setSkinToneEmoji] = useState<EmojiEntry | null>(null);

// From EmojiContext:
const { emojiService, recentEmojis, addRecentEmoji } = useEmoji();

// Build categories with "Recent" section prepended:
const displayCategories = useMemo(() => {
  const cats = emojiService.getCategories();
  if (recentEmojis.length > 0 && !searchQuery) {
    const recentCat: EmojiCategory = {
      id: 'recent',
      name: 'Recently Used',
      icon: '🕐',
      emojis: recentEmojis.map(r => emojiService.getEmoji(r.id)).filter(Boolean) as EmojiEntry[],
    };
    return [recentCat, ...cats];
  }
  return cats;
}, [emojiService, recentEmojis, searchQuery]);

// Search handler:
const handleSearch = useCallback(async (query: string) => {
  setSearchQuery(query);
  if (query.trim()) {
    const results = await emojiService.search(query);
    setSearchResults(results);
  } else {
    setSearchResults([]);
  }
}, [emojiService]);

// Emoji press handler — add to recent:
const handleEmojiPress = useCallback((emoji: EmojiEntry) => {
  addRecentEmoji(emoji.id, emoji.native);
  onEmojiSelected(emoji);
}, [onEmojiSelected, addRecentEmoji]);

// Skin tone selection:
const handleSkinToneSelect = useCallback((nativeChar: string) => {
  setSkinToneEmoji(null);
  onEmojiSelected({ /* construct entry with selected skin */ } as EmojiEntry);
}, [onEmojiSelected]);
```

Update the render to include search bar and toggle between search/grid modes:

```typescript
<ThemedView style={[styles.pickerContainer, { backgroundColor: theme.colors.background.base }]}>
  {/* Search bar */}
  <EmojiSearchBar
    onSearch={handleSearch}
    theme={theme}
  />

  {/* Category tabs (hidden during search) */}
  {!searchQuery && (
    <>
      <CategoryTabBar ... />
      <View style={styles.divider} ... />
    </>
  )}

  {/* Grid: search results OR category grid */}
  {searchQuery ? (
    <EmojiGrid
      categories={searchResults.length > 0 ? [{ id: 'search', name: 'Results', icon: '🔍', emojis: searchResults }] : []}
      ...
    />
  ) : (
    <EmojiGrid
      categories={displayCategories}
      ...
    />
  )}

  {/* Skin tone selector popup */}
  <SkinToneSelector
    visible={skinToneEmoji !== null}
    emoji={skinToneEmoji}
    onSelectSkin={handleSkinToneSelect}
    onClose={() => setSkinToneEmoji(null)}
    theme={theme}
  />
</ThemedView>
```

---

## Progress Checklist

- [ ] `src/components/emoji/EmojiSearchBar.tsx` created with debounced search
- [ ] `src/components/emoji/SkinToneSelector.tsx` created with skin tone popup
- [ ] `EmojiPickerModal.tsx` updated with search, skin tones, and recent emoji sections
- [ ] Search returns results via `EmojiService.search()`
- [ ] Recent emojis show at top of picker and persist across app restarts
- [ ] Skin tone long-press shows variant selector
- [ ] All components compile without TypeScript errors
