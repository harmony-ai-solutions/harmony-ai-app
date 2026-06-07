import React, { memo, useCallback } from 'react';
import { View, FlatList, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { EmojiText } from './EmojiText';
import { EmojiEntry } from '../../types/emoji';
import { Theme } from '../../theme/types';

interface EmojiAutocompleteProps {
  results: EmojiEntry[];
  query: string;
  onSelect: (emoji: EmojiEntry) => void;
  onDismiss: () => void;
  theme: Theme;
}

export const EmojiAutocomplete: React.FC<EmojiAutocompleteProps> = memo(({ results, query, onSelect, onDismiss, theme }) => {
  if (results.length === 0 || !query) return null;

  const renderItem = useCallback(({ item }: { item: EmojiEntry }) => (
    <TouchableOpacity
      style={[styles.item, { backgroundColor: theme.colors.background.elevated }]}
      onPress={() => onSelect(item)}
      activeOpacity={0.6}
    >
      <EmojiText native={item.native} size={22} emojiEntry={item} />
      <Text style={[styles.shortcode, { color: theme.colors.text.primary }]}>
        :{item.id}:
      </Text>
    </TouchableOpacity>
  ), [onSelect, theme]);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background.surface, borderBottomColor: theme.colors.border.default }]}>
      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: { maxHeight: 52, borderBottomWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  listContent: { paddingHorizontal: 8, paddingVertical: 4, gap: 4 },
  item: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, gap: 6 },
  shortcode: { fontSize: 13, fontWeight: '500' },
});