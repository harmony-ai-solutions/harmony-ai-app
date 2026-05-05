/**
 * EmojiText - Core rendering primitive for inline emoji display
 */
import React, { memo } from 'react';
import { Text, Image, View, StyleSheet } from 'react-native';
import { useEmoji } from '../../contexts/EmojiContext';
import { EmojiSet, EmojiEntry } from '../../types/emoji';
import { getSpriteSheetSource, getEmojiCropStyle } from '../../utils/emojiSprite';

interface EmojiTextProps {
  native: string;
  size?: number;
  emojiEntry?: EmojiEntry;
  /** Override the active emoji set from context (used for style previews) */
  emojiSet?: EmojiSet;
}

// Native emoji glyphs rendered via Text have font metrics (ascender + descender) that
// make them appear visually larger than their fontSize value. A correction factor of
// ~0.75 applied to fontSize makes native glyphs appear the same visual size as sprite
// sheet glyphs rendered at the same pixel size.
const NATIVE_FONT_SCALE = 0.75;

export const EmojiText: React.FC<EmojiTextProps> = memo(({ native, size = 16, emojiEntry, emojiSet: emojiSetProp }) => {
  const { emojiSet: contextSet } = useEmoji();
  const emojiSet = emojiSetProp ?? contextSet;

  // For 'native' set, render as Text
  if (emojiSet === 'native') {
    return (
      <Text style={[styles.nativeText, { fontSize: Math.round(size * NATIVE_FONT_SCALE) }]}>
        {native}
      </Text>
    );
  }

  // For custom sets, render from sprite sheet.
  // Use integer displaySize to prevent subpixel rounding in overflow:hidden container.
  const displaySize = Math.round(size);
  const spriteSheet = getSpriteSheetSource(emojiSet);
  const sheetX = emojiEntry?.sheetX ?? 0;
  const sheetY = emojiEntry?.sheetY ?? 0;

  if (!spriteSheet || !emojiEntry) {
    // Fallback to native text
    return (
      <Text style={[styles.nativeText, { fontSize: Math.round(size * NATIVE_FONT_SCALE) }]}>
        {native}
      </Text>
    );
  }

  const cropStyle = getEmojiCropStyle(sheetX, sheetY, displaySize);

  return (
    <View
      style={[
        styles.spriteContainer,
        cropStyle.container,
      ]}
    >
      <Image
        source={spriteSheet}
        style={[
          styles.spriteImage,
          cropStyle.image,
        ]}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  nativeText: {
    textAlign: 'center',
  },
  spriteContainer: {
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  spriteImage: {
    position: 'absolute',
  },
});

export default EmojiText;