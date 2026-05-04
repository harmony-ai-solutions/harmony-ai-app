# Phase 2: Emoji Data Service

## Objective

Create `EmojiService` — a singleton service that provides emoji metadata, category groupings, image resolution (per active emoji set), and search functionality. This is the data backbone for the picker UI.

## Codebase References

- [`src/services/`](../../src/services/) — existing service layer
- [`src/services/ChatPreferencesService.ts`](../../src/services/ChatPreferencesService.ts) — service pattern reference (module exports, AsyncStorage, logger)
- [`src/theme/types.ts`](../../src/theme/types.ts) — type definition pattern
- [`.planning/codebase/CONVENTIONS.md`](../../.planning/codebase/CONVENTIONS.md) — naming conventions (PascalCase services, camelCase functions)

---

## Task 1 — Create emoji type definitions

**File:** `src/types/emoji.ts`

Define the types the service will work with:

```typescript
/**
 * Supported emoji image sets
 */
export type EmojiSet = 'native' | 'noto' | 'twemoji';

/**
 * A single emoji skin variant
 */
export interface EmojiSkin {
  unified: string;       // e.g., '1F600'
  native: string;        // e.g., '😀'
  x: number;             // sprite sheet column
  y: number;             // sprite sheet row
}

/**
 * A single emoji entry for the picker
 */
export interface EmojiEntry {
  id: string;            // emoji-mart id, e.g., 'grinning'
  name: string;          // display name, e.g., 'Grinning Face'
  native: string;        // Unicode character, e.g., '😀'
  unified: string;       // hex codepoint, e.g., '1F600'
  category: string;      // category id, e.g., 'people'
  keywords: string[];    // search keywords
  skins: EmojiSkin[];    // skin tone variants (index 0 = default)
  sheetX: number;        // sprite sheet column
  sheetY: number;        // sprite sheet row
}

/**
 * An emoji category for the picker tabs
 */
export interface EmojiCategory {
  id: string;            // e.g., 'people'
  name: string;          // e.g., 'Smileys & People'
  icon: string;          // representative emoji native character
  emojis: EmojiEntry[];  // emojis in this category
}

/**
 * Emoji style preference persisted to AsyncStorage
 */
export interface EmojiStylePreference {
  set: EmojiSet;
  skinTone: number;      // 1-6, default 1
}
```

---

## Task 2 — Create EmojiService

**File:** `src/services/EmojiService.ts`

This service:
1. Loads emoji data from `@emoji-mart/data` on initialization
2. Transforms it into the `EmojiCategory[]` structure
3. Provides search via `emoji-mart`'s `SearchIndex`
4. Resolves sprite sheet image source based on active `EmojiSet`
5. Provides sprite sheet coordinate math for rendering individual emojis

```typescript
import { init, SearchIndex } from 'emoji-mart';
import data from '@emoji-mart/data';
import { createLogger } from '../utils/logger';
import { EmojiSet, EmojiEntry, EmojiCategory, EmojiSkin } from '../types/emoji';

const log = createLogger('[EmojiService]');

// Sprite sheet image requires — adjust paths if using node_modules directly
const SPRITE_SHEETS: Record<Exclude<EmojiSet, 'native'>, any> = {
  noto: require('../../node_modules/emoji-datasource-google/img/google/sheets-clean/64.png'),
  twemoji: require('../../node_modules/emoji-datasource-twitter/img/twitter/sheets-clean/64.png'),
};

// OR if copied to src/assets:
// const SPRITE_SHEETS: Record<Exclude<EmojiSet, 'native'>, any> = {
//   noto: require('../assets/emoji/sheets/google-64.png'),
//   twemoji: require('../assets/emoji/sheets/twitter-64.png'),
// };

const SPRITE_SIZE = 64; // px — each emoji cell is 64x64
const SHEET_CELL = SPRITE_SIZE + 2; // 1px transparent border on each side

// Category display order with representative icons
const CATEGORY_META: Record<string, { name: string; icon: string }> = {
  frequent:   { name: 'Frequently Used', icon: '🕐' },
  people:     { name: 'Smileys & People', icon: '😀' },
  nature:     { name: 'Animals & Nature', icon: '🐻' },
  foods:      { name: 'Food & Drink',     icon: '🍔' },
  activity:   { name: 'Activities',       icon: '⚽' },
  places:     { name: 'Travel & Places',  icon: '🏠' },
  objects:    { name: 'Objects',          icon: '💡' },
  symbols:    { name: 'Symbols',          icon: '🔣' },
  flags:      { name: 'Flags',            icon: '🏴' },
};

class EmojiService {
  private initialized = false;
  private categories: EmojiCategory[] = [];
  private allEmojis: Map<string, EmojiEntry> = new Map();

  /**
   * Initialize the service — loads emoji data and search index.
   * Call once at app startup.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Initialize emoji-mart search index
      init({ data });

      // Transform emoji-mart data into our category structure
      this.categories = this.buildCategories(data);
      
      // Build flat lookup map
      for (const cat of this.categories) {
        for (const emoji of cat.emojis) {
          this.allEmojis.set(emoji.id, emoji);
        }
      }

      this.initialized = true;
      log.info(`Initialized with ${this.allEmojis.size} emojis in ${this.categories.length} categories`);
    } catch (error) {
      log.error('Failed to initialize EmojiService:', error);
      throw error;
    }
  }

  /**
   * Get all emoji categories (excludes 'frequent' — that's handled separately)
   */
  getCategories(): EmojiCategory[] {
    return this.categories.filter(c => c.id !== 'frequent');
  }

  /**
   * Get a specific emoji by its id
   */
  getEmoji(id: string): EmojiEntry | undefined {
    return this.allEmojis.get(id);
  }

  /**
   * Search emojis by keyword. Returns matching EmojiEntry[].
   */
  async search(query: string): Promise<EmojiEntry[]> {
    if (!query.trim()) return [];
    
    try {
      const results = await SearchIndex.search(query);
      const entries: EmojiEntry[] = [];
      
      for (const emoji of results) {
        const entry = this.allEmojis.get(emoji.id);
        if (entry) entries.push(entry);
      }
      
      return entries;
    } catch (error) {
      log.error('Emoji search failed:', error);
      return [];
    }
  }

  /**
   * Get the sprite sheet image source for a given EmojiSet.
   * Returns null for 'native' (uses system rendering).
   */
  getSpriteSheet(emojiSet: EmojiSet): any | null {
    if (emojiSet === 'native') return null;
    return SPRITE_SHEETS[emojiSet];
  }

  /**
   * Calculate the crop rectangle for an emoji on the sprite sheet.
   * Returns { x, y, width, height } for use with Image resolvedSource.
   */
  getSpriteCrop(sheetX: number, sheetY: number): { x: number; y: number; width: number; height: number } {
    return {
      x: sheetX * SHEET_CELL + 1,
      y: sheetY * SHEET_CELL + 1,
      width: SPRITE_SIZE,
      height: SPRITE_SIZE,
    };
  }

  /**
   * Transform emoji-mart data into our category structure
   */
  private buildCategories(data: any): EmojiCategory[] {
    const categories: EmojiCategory[] = [];

    // emoji-mart data has categories array and emojis map
    for (const cat of data.categories) {
      const meta = CATEGORY_META[cat.id];
      if (!meta) continue;

      const emojis: EmojiEntry[] = [];
      for (const emojiId of cat.emojis) {
        const raw = data.emojis[emojiId];
        if (!raw) continue;

        const skins: EmojiSkin[] = raw.skins?.map((s: any, i: number) => ({
          unified: s.unified || raw.unified,
          native: s.native || raw.native,
          x: s.x ?? raw.sheet_x ?? 0,
          y: s.y ?? raw.sheet_y ?? 0,
        })) ?? [];

        // Ensure at least one skin
        if (skins.length === 0) {
          skins.push({
            unified: raw.unified,
            native: raw.native,
            x: raw.sheet_x ?? 0,
            y: raw.sheet_y ?? 0,
          });
        }

        emojis.push({
          id: raw.id,
          name: raw.name,
          native: raw.native,
          unified: raw.unified,
          category: cat.id,
          keywords: raw.keywords ?? [],
          skins,
          sheetX: raw.sheet_x ?? 0,
          sheetY: raw.sheet_y ?? 0,
        });
      }

      if (emojis.length > 0) {
        categories.push({
          id: cat.id,
          name: meta.name,
          icon: meta.icon,
          emojis,
        });
      }
    }

    return categories;
  }
}

// Export singleton instance
export default new EmojiService();
```

**Key design decisions:**
- **Singleton pattern** — matches existing service pattern (SyncService, etc.)
- **`initialize()` called once** — will be called from `EmojiContext` provider on mount
- **`getSpriteCrop()`** — returns pixel coordinates for cropping individual emojis from the sprite sheet using RN Image `resolveAssetSource`
- **`getSpriteSheet()`** — returns the `require()`'d image for the active set, or `null` for native

---

## Task 3 — Create a sprite sheet rendering utility

**File:** `src/utils/emojiSprite.ts`

Helper to render a cropped emoji from a sprite sheet using React Native's Image component:

```typescript
import { Image, StyleSheet } from 'react-native';
import { ImageResolvedSource } from 'react-native';
import EmojiService from '../services/EmojiService';
import { EmojiSet, EmojiSkin } from '../types/emoji';

/**
 * Get resolved image source for a sprite sheet of a given EmojiSet.
 * Returns null for 'native' set.
 */
export function getSpriteSheetSource(emojiSet: EmojiSet): ImageResolvedSource | null {
  const sheet = EmojiService.getSpriteSheet(emojiSet);
  if (!sheet) return null;
  
  const resolved = Image.resolveAssetSource(sheet);
  return resolved;
}

/**
 * Get style object for cropping a specific emoji from the sprite sheet.
 * Uses overflow:hidden container + absolute positioning pattern.
 */
export function getEmojiCropStyle(sheetX: number, sheetY: number): {
  container: any;
  image: any;
} {
  const SPRITE_SIZE = 64;
  const SHEET_CELL = 66; // 64 + 2px border
  
  const cropX = sheetX * SHEET_CELL + 1;
  const cropY = sheetY * SHEET_CELL + 1;

  return {
    container: {
      width: SPRITE_SIZE,
      height: SPRITE_SIZE,
      overflow: 'hidden',
    },
    image: {
      position: 'absolute' as const,
      left: -cropX,
      top: -cropY,
      width: SPRITE_SIZE,  // will be overridden by actual sheet dimensions
      height: SPRITE_SIZE,
    },
  };
}

/**
 * Dimensions for emoji rendering at different sizes
 */
export function getEmojiDimensions(displaySize: number) {
  return {
    containerSize: displaySize,
    emojiSize: displaySize,
  };
}
```

---

## Progress Checklist

- [ ] `src/types/emoji.ts` created with all type definitions
- [ ] `src/services/EmojiService.ts` created with singleton, categories, search, sprite resolution
- [ ] `src/utils/emojiSprite.ts` created with crop style helpers
- [ ] TypeScript compiles without errors
- [ ] Service can be imported and `initialize()` resolves successfully
