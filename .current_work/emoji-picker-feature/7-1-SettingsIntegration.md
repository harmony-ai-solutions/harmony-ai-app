# Phase 7: Settings Integration

## Objective

Add an "Emoji Style" section to the existing `ThemeSettingsScreen` where users can visually preview and switch between emoji base designs (Native, Google Noto, Twemoji).

## Codebase References

- [`src/screens/settings/ThemeSettingsScreen.tsx`](../../src/screens/settings/ThemeSettingsScreen.tsx) — settings screen to extend
- [`src/components/settings/ThemeCard.tsx`](../../src/components/settings/ThemeCard.tsx) — card selector pattern reference
- [`src/contexts/EmojiContext.tsx`](../../src/contexts/EmojiContext.tsx) — `useEmoji()` hook, `setEmojiSet()`
- [`src/types/emoji.ts`](../../src/types/emoji.ts) — `EmojiSet` type
- [`src/components/navigation/SettingsMenu.tsx`](../../src/components/navigation/SettingsMenu.tsx) — settings menu navigation

---

## Task 1 — Create EmojiStyleCard component

**File:** `src/components/settings/EmojiStyleCard.tsx`

A card component that shows a visual preview of an emoji set, styled consistently with the existing `ThemeCard` component. Displays 4-5 sample emojis in the set's style.

```typescript
import React, { memo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Theme } from '../../theme/types';
import { EmojiSet } from '../../types/emoji';
import { useEmoji } from '../../contexts/EmojiContext';

interface EmojiStyleCardProps {
  emojiSet: EmojiSet;
  label: string;
  description: string;
  sampleEmojis: string[];    // native emoji characters for preview
  isActive: boolean;
  onPress: () => void;
  theme: Theme;
}

export const EmojiStyleCard: React.FC<EmojiStyleCardProps> = memo(({
  emojiSet,
  label,
  description,
  sampleEmojis,
  isActive,
  onPress,
  theme,
}) => {
  const { emojiSet: currentSet } = useEmoji();
  
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.background.elevated,
          borderColor: isActive ? theme.colors.accent.primary : theme.colors.border.default,
        },
      ]}
      activeOpacity={0.7}
    >
      {/* Active indicator */}
      {isActive && (
        <View style={[styles.activeBadge, { backgroundColor: theme.colors.accent.primary }]}>
          <Icon name="check" size={14} color="#fff" />
        </View>
      )}

      {/* Emoji preview row */}
      <View style={styles.previewRow}>
        {sampleEmojis.map((emoji, index) => (
          <Text key={index} style={styles.previewEmoji}>
            {emoji}
          </Text>
        ))}
      </View>

      {/* Label */}
      <Text style={[styles.label, { color: theme.colors.text.primary }]}>
        {label}
      </Text>
      
      {/* Description */}
      <Text style={[styles.description, { color: theme.colors.text.secondary }]}>
        {description}
      </Text>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
    position: 'relative',
  },
  activeBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  previewEmoji: {
    fontSize: 28,
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 2,
  },
  description: {
    fontSize: 13,
  },
});
```

> **Note:** For non-native sets (Noto, Twemoji), the preview emojis will always render as native text in the settings card (since the picker isn't open). That's acceptable for a settings preview. A future enhancement could render actual sprite sheet images here.

---

## Task 2 — Add Emoji Style section to ThemeSettingsScreen

**File:** `src/screens/settings/ThemeSettingsScreen.tsx`

Add a new section between "Current Theme" and "Available Themes" (or between "Theme Mode" and "Current Theme"). Follow the exact same layout pattern as existing sections.

### Import additions:

```typescript
import { useEmoji } from '../../contexts/EmojiContext';
import { EmojiStyleCard } from '../../components/settings/EmojiStyleCard';
import { EmojiSet } from '../../types/emoji';
```

### Add hook:

```typescript
const { emojiSet, setEmojiSet } = useEmoji();
```

### Define available emoji styles:

```typescript
const EMOJI_STYLES: {
  set: EmojiSet;
  label: string;
  description: string;
  sampleEmojis: string[];
}[] = [
  {
    set: 'native',
    label: 'Native (System)',
    description: 'Use your device\'s built-in emoji style',
    sampleEmojis: ['😀', '👍', '❤️', '🎉', '🚀'],
  },
  {
    set: 'noto',
    label: 'Google Noto',
    description: 'Colorful, modern emoji by Google (Apache 2.0)',
    sampleEmojis: ['😀', '👍', '❤️', '🎉', '🚀'],
  },
  {
    set: 'twemoji',
    label: 'Twemoji',
    description: 'Clean, flat emoji originally by Twitter/X (CC-BY 4.0)',
    sampleEmojis: ['😀', '👍', '❤️', '🎉', '🚀'],
  },
];
```

### Add section to ScrollView (insert after "Theme Mode" section):

```tsx
{/* Emoji Style Section */}
<View style={styles.emojiSection}>
  <View
    style={[styles.section, { backgroundColor: theme.colors.background.surface }]}
  >
    <View style={styles.sectionHeader}>
      <Icon name="emoticon-outline" size={20} color={theme.colors.accent.primary} />
      <Text style={[styles.sectionTitle, { color: theme.colors.text.primary }]}>
        Emoji Style
      </Text>
    </View>

    <Text style={[styles.sectionDescription, { color: theme.colors.text.secondary }]}>
      Choose the emoji design used in chat. Changes apply immediately.
    </Text>

    <View style={styles.emojiStylesGrid}>
      {EMOJI_STYLES.map(style => (
        <EmojiStyleCard
          key={style.set}
          emojiSet={style.set}
          label={style.label}
          description={style.description}
          sampleEmojis={style.sampleEmojis}
          isActive={emojiSet === style.set}
          onPress={() => setEmojiSet(style.set)}
          theme={theme}
        />
      ))}
    </View>
  </View>
</View>
```

### Add styles:

```typescript
emojiSection: {
  marginTop: 16,
},
emojiStylesGrid: {
  gap: 10,
  marginTop: 12,
},
sectionDescription: {
  fontSize: 14,
  marginBottom: 8,
},
```

---

## Task 3 (Optional) — Add emoji style entry to SettingsMenu

**File:** `src/components/navigation/SettingsMenu.tsx`

Optionally add a direct navigation item for emoji style in the `SettingsMenu` modal, under the "App Settings" section:

```typescript
// In menuSections array, under "App Settings":
{
  icon: 'emoticon-outline',
  label: 'Emoji Style',
  screen: 'ThemeSettings',  // scrolls to emoji section (or new dedicated screen)
  badge: 'NEW',
},
```

This is optional since the emoji style is already accessible from the existing "Appearance & Theme" screen.

---

## Progress Checklist

- [ ] `src/components/settings/EmojiStyleCard.tsx` created with visual preview card
- [ ] `ThemeSettingsScreen.tsx` updated with "Emoji Style" section
- [ ] Three emoji style options visible: Native, Google Noto, Twemoji
- [ ] Tapping a style card switches the active emoji set immediately
- [ ] Active style shows a checkmark indicator
- [ ] Emoji style preference persists across app restarts (via EmojiContext/AsyncStorage)
- [ ] (Optional) SettingsMenu updated with emoji style entry
