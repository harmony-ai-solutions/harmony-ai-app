/**
 * Emoji Sprite Rendering Utilities
 */
import { ImageRequireSource } from 'react-native';
import { EmojiSet } from '../types/emoji';

// Local sprite sheet assets
const SPRITE_SHEETS: Record<Exclude<EmojiSet, 'native'>, ImageRequireSource> = {
  noto: require('../assets/emoji/sheets/google-64.png'),
  twemoji: require('../assets/emoji/sheets/twitter-64.png'),
};

// Each cell in the sprite sheet is 64px emoji content + 1px transparent border on each side = 66px total.
// The physical sheet image is (sheetCols + 1) * TOTAL_CELL wide (one extra cell column/row exists).
// For 61-column sheets: 62 * 66 = 4092 px — confirmed by actual image dimensions.
const EMOJI_CONTENT_SIZE = 64;   // actual emoji pixel size in the sheet
const CELL_BORDER = 1;           // transparent border on each side
const TOTAL_CELL_SIZE = EMOJI_CONTENT_SIZE + 2 * CELL_BORDER; // 66px

// Dynamic sheet dimensions - set from emoji-mart data (emoji-mart reports used cols, physical = cols+1)
let sheetCols = 61;
let sheetRows = 61;

/**
 * Set the sheet dimensions from emoji-mart data
 * This should be called during EmojiService initialization
 */
export function setSheetDimensions(cols: number, rows: number): void {
  sheetCols = cols;
  sheetRows = rows;
}

/**
 * Get the current sheet dimensions
 */
export function getSheetDimensions(): { cols: number; rows: number } {
  return { cols: sheetCols, rows: sheetRows };
}

/**
 * Get the sprite sheet image source for an emoji set
 */
export function getSpriteSheetSource(emojiSet: EmojiSet): ImageRequireSource | null {
  if (emojiSet === 'native') return null;
  return SPRITE_SHEETS[emojiSet === 'noto' ? 'noto' : 'twemoji'] || null;
}

/**
 * Get style objects for rendering a single emoji from the sprite sheet.
 *
 * Strategy: render the FULL sprite sheet image scaled so that each 64px emoji
 * content cell maps to `displaySize` display pixels, then offset it so the
 * target cell is aligned with the container top-left, and clip with
 * overflow:hidden.
 *
 * Sheet layout (emoji-datasource-twitter/google at 64px size):
 *   - Each cell: 66px (64px emoji + 1px transparent border each side)
 *   - Physical image size: (reportedCols + 1) * 66  [e.g. 62 * 66 = 4092]
 *   - emoji-mart reports cols=61 (max used index), physical count = 62
 *
 * Scale is based on emoji CONTENT size (64px), not cell size (66px), so
 * each emoji renders as exactly `displaySize × displaySize` pixels.
 */
export function getEmojiCropStyle(
  sheetX: number,
  sheetY: number,
  displaySize: number = EMOJI_CONTENT_SIZE,
): {
  container: {
    width: number;
    height: number;
    overflow: 'hidden';
  };
  image: {
    width: number;
    height: number;
    position: 'absolute';
    left: number;
    top: number;
  };
} {
  // Scale factor: map 64px emoji content → displaySize display pixels
  const scale = displaySize / EMOJI_CONTENT_SIZE;

  // Physical sheet pixel dimensions: (reportedCols + 1) * TOTAL_CELL_SIZE
  // For cols=61: (61+1) * 66 = 62 * 66 = 4092 — matches actual PNG dimensions.
  const physicalSheetWidth  = (sheetCols + 1) * TOTAL_CELL_SIZE;
  const physicalSheetHeight = (sheetRows + 1) * TOTAL_CELL_SIZE;

  const scaledSheetWidth  = physicalSheetWidth  * scale;
  const scaledSheetHeight = physicalSheetHeight * scale;

  // Offset: skip (sheetX * 66) cells then skip the 1px left-border to land on emoji content
  const leftOffset = -((sheetX * TOTAL_CELL_SIZE) + CELL_BORDER) * scale;
  const topOffset  = -((sheetY * TOTAL_CELL_SIZE) + CELL_BORDER) * scale;

  return {
    container: {
      width: displaySize,
      height: displaySize,
      overflow: 'hidden',
    },
    image: {
      width: scaledSheetWidth,
      height: scaledSheetHeight,
      position: 'absolute' as const,
      left: leftOffset,
      top: topOffset,
    },
  };
}

/**
 * Get emoji dimensions for rendering
 */
export function getEmojiDimensions(displaySize: number): {
  containerSize: number;
  emojiSize: number;
} {
  return {
    containerSize: displaySize,
    emojiSize: displaySize,
  };
}