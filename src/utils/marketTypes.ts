/**
 * marketTypes — UI vocabulary for marketplace item types + content-asset kinds.
 *
 * Self-contained (zero DB/service imports) so screens and market components can
 * share the icon/label/type helpers without touching the (doomed, Phase 4)
 * marketplace repos. Replaces the helpers previously exported from
 * `services/marketplace/marketplaceTypes.ts` (deleted in Phase 2).
 *
 * Note: the in-memory stub marketplace only ships character-card listings, so
 * every stub listing maps to `itemType === 'character'`. The full type union is
 * kept so the publish wizard / filter dropdown keep their shape for the future
 * backend (Phase 9).
 */

/** What can be listed for sale (or given away free). Mirrors the backend enum. */
export type MarketplaceItemType =
  | 'character'
  | 'backstory'
  | 'description'
  | 'personality'
  | 'prompt'
  | 'dialogue'
  | 'theme';

/** Every item type the marketplace supports (v1). */
export const MARKETPLACE_ITEM_TYPES: readonly MarketplaceItemType[] = [
  'character',
  'backstory',
  'description',
  'personality',
  'prompt',
  'dialogue',
  'theme',
];

/** i18n key (inside the `market` namespace) for a type's short label. */
export function itemTypeLabelKey(type: MarketplaceItemType): string {
  return `itemType${type.charAt(0).toUpperCase()}${type.slice(1)}`;
}

/** Material icon name for a type (used on cards / chips / rows). */
export function itemTypeIcon(type: MarketplaceItemType): string {
  switch (type) {
    case 'character':
      return 'account-heart';
    case 'backstory':
      return 'book-open-page-variant-outline';
    case 'description':
      return 'text-box-outline';
    case 'personality':
      return 'emoticon-outline';
    case 'prompt':
      return 'lightbulb-on-outline';
    case 'dialogue':
      return 'chat-processing-outline';
    case 'theme':
      return 'palette-outline';
    default:
      return 'package-variant-closed';
  }
}

/** True when a type is delivered/consumed as plain text. */
export function isTextItemType(type: MarketplaceItemType): boolean {
  return (
    type === 'backstory' ||
    type === 'description' ||
    type === 'personality' ||
    type === 'prompt' ||
    type === 'dialogue'
  );
}

/** Material icon name for a delivered content asset kind (library rows). */
export function contentKindIcon(kind: 'character_card' | 'text' | 'theme'): string {
  switch (kind) {
    case 'character_card':
      return 'account-heart';
    case 'text':
      return 'text-box-outline';
    case 'theme':
      return 'palette-outline';
    default:
      return 'package-variant-closed';
  }
}

/**
 * Format a SOUL price for badges/labels. Moved here from the pay-gate helper
 * service deleted in Phase 2.
 */
export function formatSoulPrice(price: number): string {
  const n = Number(price) || 0;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}