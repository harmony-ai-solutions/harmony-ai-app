/**
 * EmojiGrid - FlatList-based emoji grid with category headers
 *
 * Uses a row-based data model so that category headers can span the full
 * container width without being squeezed into a single numColumns cell.
 * Each row is either a "header" row or an array of emoji entries.
 */
import React, { memo, useMemo } from 'react';
import { FlatList, StyleSheet, View, Dimensions } from 'react-native';
import { Theme } from '../../theme/types';
import { EmojiCategory, EmojiEntry } from '../../types/emoji';
import { EmojiAction } from '../../database/models';
import EmojiItem from './EmojiItem';
import { ThemedText } from '../themed/ThemedText';

interface EmojiGridProps {
  categories: EmojiCategory[];
  activeCategory: string;
  onEmojiPress: (emoji: EmojiEntry) => void;
  onEmojiLongPress?: (emoji: EmojiEntry) => void;
  theme: Theme;
  actionsMap?: Map<string, EmojiAction> | null;
  /** Override emoji cell size (default 36) */
  emojiSize?: number;
}

// Row types — each FlatList item is a full row
type GridRow =
  | { type: 'header'; id: string; title: string }
  | { type: 'emoji-row'; id: string; emojis: EmojiEntry[] };

const DEFAULT_EMOJI_SIZE = 36;
const SCREEN_WIDTH = Dimensions.get('window').width;

export const EmojiGrid: React.FC<EmojiGridProps> = memo(({
  categories,
  activeCategory,
  onEmojiPress,
  onEmojiLongPress,
  theme,
  actionsMap,
  emojiSize = DEFAULT_EMOJI_SIZE,
}) => {
  const emojisPerRow = Math.max(1, Math.floor((SCREEN_WIDTH - 24) / emojiSize));

  // Build row-based data:  headers + emoji rows (each row is up to emojisPerRow items)
  const gridData = useMemo((): GridRow[] => {
    const rows: GridRow[] = [];

    const filteredCategories = activeCategory
      ? categories.filter(c => c.id === activeCategory)
      : categories;

    for (const category of filteredCategories) {
      if (category.emojis.length === 0) continue;

      // Category header row (spans full width)
      rows.push({
        type: 'header',
        id: `header-${category.id}`,
        title: category.name,
      });

      // Split emojis into rows of emojisPerRow
      for (let i = 0; i < category.emojis.length; i += emojisPerRow) {
        rows.push({
          type: 'emoji-row',
          id: `${category.id}-row-${i}`,
          emojis: category.emojis.slice(i, i + emojisPerRow),
        });
      }
    }

    return rows;
  }, [categories, activeCategory, emojisPerRow]);

  // Render each row
  const renderItem = ({ item }: { item: GridRow }) => {
    if (item.type === 'header') {
      return (
        <View style={styles.headerContainer}>
          <ThemedText variant="secondary" size={12} weight="medium">
            {item.title}
          </ThemedText>
        </View>
      );
    }

    return (
      <View style={styles.emojiRow}>
        {item.emojis.map(emoji => (
          <EmojiItem
            key={emoji.id}
            emoji={emoji}
            size={emojiSize}
            onPress={onEmojiPress}
            onLongPress={onEmojiLongPress}
            action={actionsMap?.get(emoji.native) ?? null}
            theme={theme}
          />
        ))}
      </View>
    );
  };

  const keyExtractor = (item: GridRow) => item.id;

  const ROW_HEIGHT = emojiSize + 4;
  const HEADER_HEIGHT = 28;

  return (
    <FlatList
      data={gridData}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.contentContainer}
      removeClippedSubviews={true}
      maxToRenderPerBatch={20}
      windowSize={5}
      initialNumToRender={20}
      getItemLayout={(data, index) => {
        const item = data?.[index];
        const length = item?.type === 'header' ? HEADER_HEIGHT : ROW_HEIGHT;
        let offset = 0;
        if (data) {
          for (let i = 0; i < index; i++) {
            offset += data[i]?.type === 'header' ? HEADER_HEIGHT : ROW_HEIGHT;
          }
        }
        return { length, offset, index };
      }}
    />
  );
});

const styles = StyleSheet.create({
  contentContainer: {
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  headerContainer: {
    width: '100%',
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  emojiRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
  },
});

export default EmojiGrid;
