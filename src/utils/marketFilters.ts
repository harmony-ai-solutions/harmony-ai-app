/**
 * marketFilters — pure filtering helpers for the marketplace catalog.
 * Unit-testable, no I/O.
 */

import type { CachedListing, MarketplaceItemType } from '../database/repositories/marketplace';

export interface MarketFilters {
  query?: string;
  itemType?: MarketplaceItemType | 'free';
  /** Free-only chip (price === 0). */
  freeOnly?: boolean;
}

export function isFreeListing(listing: Pick<CachedListing, 'priceSouls'>): boolean {
  return listing.priceSouls === 0;
}

/**
 * Apply search + type + free filters to a list of cached listings.
 * Search covers title / summary / tags (case-insensitive substring).
 */
export function applyMarketFilters(
  listings: CachedListing[],
  filters: MarketFilters,
): CachedListing[] {
  let out = listings;

  const q = filters.query?.trim().toLowerCase();
  if (q) {
    out = out.filter(l => {
      const haystack = [
        l.title,
        l.summary ?? '',
        ...(l.tags ?? []),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }

  const type = filters.itemType;
  if (type && type !== 'free') {
    out = out.filter(l => l.itemType === type);
  }

  if (filters.freeOnly || type === 'free') {
    out = out.filter(l => isFreeListing(l));
  }

  return out;
}