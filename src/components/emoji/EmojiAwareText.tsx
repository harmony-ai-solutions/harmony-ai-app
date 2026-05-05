import React, { memo, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { EmojiText } from './EmojiText';
import { useEmoji } from '../../contexts/EmojiContext';
import EmojiService from '../../services/EmojiService';

interface EmojiAwareTextProps {
  content: string;
  style?: any;
  fontSize?: number;
  color?: string;
}

export const EmojiAwareText: React.FC<EmojiAwareTextProps> = memo(({ content, style, fontSize = 16, color }) => {
  const { emojiSet } = useEmoji();

  const normalizedText = useMemo(() => EmojiService.parseShortcodes(content), [content]);

  // Fast path for native set — no splitting, no image rendering
  if (emojiSet === 'native') {
    return <Text style={style}>{normalizedText}</Text>;
  }

  const segments = useMemo(() => EmojiService.splitTextOnEmojis(normalizedText), [normalizedText]);

  const textStyle = [{ fontSize }, style, color ? { color } : null];

  return (
    <View style={[styles.container, { alignItems: 'flex-end' }]}>
      {segments.map((segment, index) => {
        if (segment.type === 'text') {
          return <Text key={index} style={textStyle}>{segment.value}</Text>;
        }
        return <EmojiText key={index} native={segment.value} size={fontSize} emojiEntry={segment.emojiEntry} />;
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  container: { flexDirection: 'row', flexWrap: 'wrap' },
});