/**
 * EmojiPickerInline - Compact inline emoji picker panel
 *
 * Renders as a non-modal view suitable for embedding directly in a
 * KeyboardAvoidingView between the input bar and the message list.
 * Shows a compact category bar, a few rows of emojis, and an optional
 * search overlay. Emoji size is 28px for a denser layout.
 */
import React, { memo, useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { useEmoji, RecentEmoji } from '../../contexts/EmojiContext';
import { EmojiEntry, EmojiCategory } from '../../types/emoji';
import { EmojiAction } from '../../database/models';
import { EntityEmojiActionService } from '../../services/EntityEmojiActionService';
import { ThemedView } from '../themed/ThemedView';
import { ThemedText } from '../themed/ThemedText';
import EmojiGrid from './EmojiGrid';
import SkinToneSelector from './SkinToneSelector';

// Smaller emoji size for the compact picker
const COMPACT_EMOJI_SIZE = 28;

interface EmojiPickerInlineProps {
  /** Called when the user selects an emoji */
  onEmojiSelected: (emoji: EmojiEntry) => void;
  /** Entity ID for action lookup + advanced editor nav */
  entityId?: string | null;
  /** Navigate to the action editor screen */
  onOpenActionEditor?: () => void;
  /** Optional theme override; uses useAppTheme() if omitted */
  theme?: any;
  /** Override the container style (e.g. remove maxHeight for use in modals) */
  containerStyle?: any;
}

export const EmojiPickerInline: React.FC<EmojiPickerInlineProps> = memo(({
  onEmojiSelected,
  entityId,
  onOpenActionEditor,
  theme: themeProp,
  containerStyle,
}) => {
  const { theme: contextTheme } = useAppTheme();
  const theme = themeProp ?? contextTheme;
  const { emojiService, addRecentEmoji, recentEmojis, loading } = useEmoji();
  const [activeCategory, setActiveCategory] = useState<string>('people');
  const [categories, setCategories] = useState<EmojiCategory[]>([]);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<EmojiEntry[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

  // Skin tone selector state
  const [skinToneEmoji, setSkinToneEmoji] = useState<EmojiEntry | null>(null);

  // Emoji actions state
  const [actionsMap, setActionsMap] = useState<Map<string, EmojiAction> | null>(null);

  // Load actions map
  useEffect(() => {
    if (!entityId) {
      setActionsMap(null);
      return;
    }
    EntityEmojiActionService.getActionsMap(entityId).then(setActionsMap);
  }, [entityId]);

  // Load categories — re-trigger when loading state changes (initialization completes)
  useEffect(() => {
    if (!loading && emojiService && emojiService.getCategories) {
      setCategories(emojiService.getCategories());
    }
  }, [emojiService, loading]);

  // Build display categories with "Recent" prepended
  const displayCategories = useMemo((): EmojiCategory[] => {
    const result: EmojiCategory[] = [];
    if (recentEmojis.length > 0 && !isSearching) {
      const recentEntries: EmojiEntry[] = recentEmojis
        .slice(0, 24)
        .map((r: RecentEmoji) => emojiService.getEmoji(r.id))
        .filter((e): e is EmojiEntry => e !== undefined);
      if (recentEntries.length > 0) {
        result.push({ id: 'recent', name: 'Recent', icon: '🕐', emojis: recentEntries });
      }
    }
    if (!isSearching) {
      result.push(...categories);
    }
    return result;
  }, [categories, recentEmojis, isSearching, emojiService, loading]);

  // Handle search
  const handleSearch = useCallback(async (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setIsSearching(false);
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    try {
      setSearchResults(await emojiService.search(query));
    } catch {
      setSearchResults([]);
    }
  }, [emojiService]);

  // Handle emoji press
  const handleEmojiPress = useCallback((emoji: EmojiEntry) => {
    onEmojiSelected(emoji);
    addRecentEmoji(emoji.id, emoji.native);
  }, [onEmojiSelected, addRecentEmoji]);

  // Handle emoji long press (skin tone)
  const handleEmojiLongPress = useCallback((emoji: EmojiEntry) => {
    if (emoji.skins && emoji.skins.length > 1) {
      setSkinToneEmoji(emoji);
    }
  }, []);

  // Handle skin tone selection
  const handleSkinToneSelect = useCallback((skinIndex: number) => {
    if (skinToneEmoji && skinToneEmoji.skins && skinToneEmoji.skins[skinIndex]) {
      const skin = skinToneEmoji.skins[skinIndex];
      const selected: EmojiEntry = { ...skinToneEmoji, native: skin.native, unified: skin.unified };
      onEmojiSelected(selected);
      addRecentEmoji(selected.id, selected.native);
    }
    setSkinToneEmoji(null);
  }, [skinToneEmoji, onEmojiSelected, addRecentEmoji]);

  if (!theme) return null;

  return (
    <ThemedView
      style={[styles.container, { backgroundColor: theme.colors.background.elevated }, containerStyle]}
      variant="elevated"
    >
      {/* Toolbar: category scroll + search toggle + advanced */}
      <View style={[styles.toolbar, { borderBottomColor: theme.colors.border.default }]}>
        <View style={styles.categoryScroll}>
          {displayCategories.map(cat => {
            const isActive = activeCategory === cat.id && !isSearching;
            return (
              <TouchableOpacity
                key={cat.id}
                style={[
                  styles.catTab,
                  isActive && { backgroundColor: theme.colors.accent.primary + '25' },
                ]}
                onPress={() => { setIsSearching(false); setSearchQuery(''); setActiveCategory(cat.id); }}
                activeOpacity={0.6}
              >
                <ThemedText style={styles.catIcon}>{cat.icon}</ThemedText>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.toolbarActions}>
          <TouchableOpacity
            onPress={() => {
              if (showSearch) { setShowSearch(false); handleSearch(''); }
              else { setShowSearch(true); }
            }}
            style={styles.toolBtn}
          >
            <Icon name={showSearch ? 'close' : 'magnify'} size={20} color={theme.colors.text.secondary} />
          </TouchableOpacity>
          {onOpenActionEditor && (
            <TouchableOpacity onPress={onOpenActionEditor} style={styles.toolBtn}>
              <Icon name="tune-variant" size={18} color={theme.colors.accent.primary} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Search input (collapsible) */}
      {showSearch && (
        <View style={[styles.searchRow, { borderColor: theme.colors.border.default }]}>
          <Icon name="magnify" size={16} color={theme.colors.text.muted} />
          <TextInput
            style={[styles.searchInput, { color: theme.colors.text.primary }]}
            value={searchQuery}
            onChangeText={handleSearch}
            placeholder="Search emoji..."
            placeholderTextColor={theme.colors.text.muted}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
          />
        </View>
      )}

      {/* Emoji grid */}
      {isSearching ? (
        <EmojiGrid
          categories={[{ id: 'search', name: 'Results', icon: '🔍', emojis: searchResults }]}
          activeCategory="search"
          onEmojiPress={handleEmojiPress}
          onEmojiLongPress={handleEmojiLongPress}
          theme={theme}
          actionsMap={actionsMap}
          emojiSize={COMPACT_EMOJI_SIZE}
        />
      ) : (
        <EmojiGrid
          categories={displayCategories}
          activeCategory={activeCategory}
          onEmojiPress={handleEmojiPress}
          onEmojiLongPress={handleEmojiLongPress}
          theme={theme}
          actionsMap={actionsMap}
          emojiSize={COMPACT_EMOJI_SIZE}
        />
      )}

      {/* Skin tone selector */}
      <SkinToneSelector
        visible={skinToneEmoji !== null}
        emoji={skinToneEmoji}
        onSelectSkin={handleSkinToneSelect}
        onClose={() => setSkinToneEmoji(null)}
        theme={theme}
      />
    </ThemedView>
  );
});

const styles = StyleSheet.create({
  container: {
    maxHeight: 240,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.1)',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 38,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  categoryScroll: {
    flex: 1,
    flexDirection: 'row',
    paddingLeft: 4,
  },
  catTab: {
    width: 34,
    height: 34,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 6,
    marginHorizontal: 1,
  },
  catIcon: {
    fontSize: 16,
    textAlign: 'center',
  },
  toolbarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 4,
  },
  toolBtn: {
    width: 34,
    height: 34,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 32,
    marginHorizontal: 8,
    marginVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 16,
    borderWidth: 1,
    gap: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 0,
  },
});

export default EmojiPickerInline;
