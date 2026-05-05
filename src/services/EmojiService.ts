/**
 * EmojiService - Singleton service for emoji data management
 *
 * Data sources:
 *  - @emoji-mart/data          → categories, names, keywords, native characters, unified codepoints
 *  - emoji-datasource-twitter  → correct sprite sheet_x / sheet_y coordinates that match
 *                                our bundled PNG sheets (google-64.png / twitter-64.png).
 *
 * Why two sources? @emoji-mart/data coordinates reflect an older emoji spec and do NOT
 * match our emoji-datasource v16 PNGs. The emoji-datasource JSON is generated from the
 * same source as the PNG sprite sheets, so its sheet_x/sheet_y values are authoritative.
 */
import { createLogger } from '../utils/logger';
import { EmojiSet, EmojiEntry, EmojiCategory, TextSegment } from '../types/emoji';
import { setSheetDimensions } from '../utils/emojiSprite';

const log = createLogger('[EmojiService]');

// Sprite sheet assets (local copies)
const SPRITE_SHEETS: Record<Exclude<EmojiSet, 'native'>, any> = {
  noto: require('../assets/emoji/sheets/google-64.png'),
  twemoji: require('../assets/emoji/sheets/twitter-64.png'),
};

// Category metadata
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

// Unified → sprite position lookup built from emoji-datasource
// Keys are uppercase unified codepoints (e.g. "1F600", "1F44B-1F3FB")
type SpritePos = { x: number; y: number };
let spriteCoords: Map<string, SpritePos> = new Map();

// Import emoji-mart data (lazy loaded)
let emojiData: any = null;

class EmojiServiceClass {
  private initialized = false;
  private allEmojis: Map<string, EmojiEntry> = new Map();
  private nativeToEmoji: Map<string, EmojiEntry> = new Map();
  private shortcodeToNative: Map<string, string> = new Map();
  private categories: EmojiCategory[] = [];

  /**
   * Initialize the service - loads emoji data
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      log.debug('Already initialized, skipping');
      return;
    }

    try {
      log.info('Initializing emoji service...');

      // Load emoji-mart data for structure (categories, names, keywords, native chars)
      // We use the base (native) dataset which has all emoji metadata but without
      // provider-specific sprite coordinates.
      const dataModule = await import('@emoji-mart/data');
      emojiData = (dataModule as any).default || dataModule;

      // Load emoji-datasource-twitter for correct sprite coordinates.
      // We use require() here because Metro (React Native bundler) handles JSON
      // require() reliably; dynamic import() for JSON can be unreliable with Metro.
      // The twitter and google sprite sheets share identical cell positions, so
      // a single datasource JSON works for both sprite sheet providers.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const dsData: any[] = require('emoji-datasource-twitter/emoji.json');
      this.buildSpriteCoords(dsData);

      // The physical sheet image is (maxIndex + 1) * 66px, not sheetCols * 66px.
      // emoji-datasource v16 has max_x = 61, so 62 * 66 = 4092 — matching PNG dims.
      // We pass max+1 to setSheetDimensions so emojiSprite.ts knows the true grid.
      setSheetDimensions(61, 61);  // max used index (0-based), physical = max+1 cells

      // Build categories and maps
      this.buildCategories(emojiData);

      this.initialized = true;
      log.info(`Emoji service initialized with ${this.allEmojis.size} emojis, ${this.categories.length} categories`);
    } catch (error) {
      log.error('Failed to initialize emoji service:', error);
      throw error;
    }
  }

  /**
   * Build the unified → sprite position lookup from emoji-datasource JSON.
   * Keys are uppercase unified strings (e.g. "1F600", "1F44B-1F3FB").
   */
  private buildSpriteCoords(dsData: any[]): void {
    spriteCoords = new Map();
    for (const e of dsData) {
      if (e.unified) {
        spriteCoords.set(e.unified.toUpperCase(), { x: e.sheet_x, y: e.sheet_y });
      }
      if (e.skin_variations) {
        for (const sv of Object.values(e.skin_variations) as any[]) {
          if (sv.unified) {
            spriteCoords.set(sv.unified.toUpperCase(), { x: sv.sheet_x, y: sv.sheet_y });
          }
        }
      }
    }
    log.debug(`Sprite coord map built with ${spriteCoords.size} entries`);
  }

  /**
   * Convert a unified codepoint string to its native emoji character.
   * e.g. "1F600" → "😀", "1F44B-1F3FB" → "👋🏻"
   */
  private unifiedToNative(unified: string): string {
    return unified.split('-')
      .map(cp => String.fromCodePoint(parseInt(cp, 16)))
      .join('');
  }

  /**
   * Build categories from emoji-mart data (v5 format)
   *
   * emoji-mart v5 structure:
   *   data.categories = [ { id, emojis: [id, ...] }, ... ]
   *   data.emojis[id] = { id, name, keywords, skins: [{ unified, native }] }
   *
   * Sprite positions come from the emoji-datasource lookup (spriteCoords).
   */
  private buildCategories(data: any): void {
    const emojis = data.emojis || {};
    const dataCategories: { id: string; emojis: string[] }[] = data.categories || [];

    this.categories = [];
    this.allEmojis = new Map();
    this.nativeToEmoji = new Map();
    this.shortcodeToNative = new Map();

    for (const dataCat of dataCategories) {
      const catId = dataCat.id;
      const meta = CATEGORY_META[catId];
      if (!meta) continue; // skip unknown categories

      const categoryEmojis: EmojiEntry[] = [];

      for (const emojiId of dataCat.emojis) {
        const raw = emojis[emojiId];
        if (!raw) continue;

        const rawSkins: { unified: string; native?: string }[] = raw.skins || [];

        // Base emoji from skins[0]
        const baseSkin = rawSkins[0] || {};
        const baseUnified = baseSkin.unified || '';
        const baseNative = baseSkin.native || this.unifiedToNative(baseUnified);

        // Map all skin variants using datasource coordinates
        const skins = rawSkins.map((skin) => {
          const unifiedKey = (skin.unified || baseUnified).toUpperCase();
          const pos = spriteCoords.get(unifiedKey);
          const native = skin.native || this.unifiedToNative(skin.unified || baseUnified);
          return {
            unified: skin.unified || baseUnified,
            native,
            sheetX: pos?.x ?? 0,
            sheetY: pos?.y ?? 0,
          };
        });

        const basePos = spriteCoords.get(baseUnified.toUpperCase());

        const entry: EmojiEntry = {
          id: emojiId,
          name: raw.name || emojiId,
          native: baseNative,
          unified: baseUnified,
          category: catId,
          keywords: raw.keywords || [],
          skins,
          sheetX: basePos?.x ?? 0,
          sheetY: basePos?.y ?? 0,
        };

        categoryEmojis.push(entry);
        this.allEmojis.set(emojiId, entry);

        if (baseNative) {
          this.nativeToEmoji.set(baseNative, entry);
        }

        // Map skin-tone natives back to base entry
        for (let si = 1; si < skins.length; si++) {
          if (skins[si].native && skins[si].native !== baseNative) {
            this.nativeToEmoji.set(skins[si].native, entry);
          }
        }

        // Map id as shortcode
        this.shortcodeToNative.set(emojiId, baseNative);
      }

      this.categories.push({
        id: catId,
        name: meta.name,
        icon: meta.icon,
        emojis: categoryEmojis,
      });
    }

    // Also map shortcodes from the id field
    for (const [id, entry] of this.allEmojis) {
      this.shortcodeToNative.set(id, entry.native);
    }
  }

  /**
   * Get all categories (excludes 'frequent')
   */
  getCategories(): EmojiCategory[] {
    return this.categories.filter(c => c.id !== 'frequent');
  }

  /**
   * Lookup emoji by id
   */
  getEmoji(id: string): EmojiEntry | undefined {
    return this.allEmojis.get(id);
  }

  /**
   * Reverse lookup by Unicode character
   */
  getEmojiByNative(nativeChar: string): EmojiEntry | undefined {
    return this.nativeToEmoji.get(nativeChar);
  }

  /**
   * Search emojis
   */
  async search(query: string): Promise<EmojiEntry[]> {
    if (!query.trim()) return [];

    const normalizedQuery = query.toLowerCase().trim();
    const results: EmojiEntry[] = [];

    for (const entry of this.allEmojis.values()) {
      // Search in name
      if (entry.name.toLowerCase().includes(normalizedQuery)) {
        results.push(entry);
        continue;
      }

      // Search in keywords
      for (const keyword of entry.keywords) {
        if (keyword.toLowerCase().includes(normalizedQuery)) {
          results.push(entry);
          break;
        }
      }

      // Limit results
      if (results.length >= 50) break;
    }

    return results;
  }

  /**
   * Autocomplete search by shortcode prefix
   */
  searchByShortcodePrefix(prefix: string, limit = 8): EmojiEntry[] {
    if (!prefix.startsWith(':')) {
      prefix = ':' + prefix;
    }
    if (!prefix.endsWith(':')) {
      prefix = prefix + ':';
    }

    const normalizedPrefix = prefix.toLowerCase();
    const results: EmojiEntry[] = [];

    for (const [shortcode, native] of this.shortcodeToNative) {
      if (shortcode.startsWith(normalizedPrefix.slice(1, -1))) {
        const entry = this.nativeToEmoji.get(native);
        if (entry && !results.includes(entry)) {
          results.push(entry);
          if (results.length >= limit) break;
        }
      }
    }

    return results;
  }

  /**
   * Convert shortcodes to emojis (e.g., :joy: -> 😂)
   */
  parseShortcodes(text: string): string {
    const shortcodeRegex = /:([a-zA-Z0-9_+-]+):/g;

    return text.replace(shortcodeRegex, (match, shortcode) => {
      const native = this.shortcodeToNative.get(shortcode.toLowerCase());
      return native || match;
    });
  }

  /**
   * Split text into text and emoji segments
   */
  splitTextOnEmojis(text: string): TextSegment[] {
    const emojiRegex = require('emoji-regex')();
    const segments: TextSegment[] = [];
    let lastIndex = 0;

    let match;
    while ((match = emojiRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        segments.push({
          type: 'text',
          value: text.slice(lastIndex, match.index),
        });
      }

      const nativeChar = match[0];
      const emojiEntry = this.nativeToEmoji.get(nativeChar);

      segments.push({
        type: 'emoji',
        value: nativeChar,
        emojiEntry,
      });

      lastIndex = match.index + nativeChar.length;
    }

    if (lastIndex < text.length) {
      segments.push({
        type: 'text',
        value: text.slice(lastIndex),
      });
    }

    return segments;
  }

  /**
   * Get sprite sheet for emoji set
   */
  getSpriteSheet(emojiSet: EmojiSet): any {
    if (emojiSet === 'native') return null;
    return SPRITE_SHEETS[emojiSet === 'noto' ? 'noto' : 'twemoji'] || null;
  }
}

// Export singleton instance
export const EmojiService = new EmojiServiceClass();
export default EmojiService;
