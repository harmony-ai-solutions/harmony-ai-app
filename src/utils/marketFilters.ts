/**
 * marketFilters — pure filtering helpers for the marketplace catalog.
 * Unit-testable, no I/O. Operates on the stub `MarketplaceListingSummary` shape
 * (Phase-1 service type) — every stub listing is a character card, so `itemType`
 * is supplied by the caller (defaults to `character`).
 */

import type { MarketplaceListingSummary } from '../services/marketplace/MarketplaceService';
import type { MarketplaceItemType } from './marketTypes';

export interface MarketFilterableListing extends MarketplaceListingSummary {
  /** Stub feed has no item-type column — callers supply it ('character'). */
  itemType?: MarketplaceItemType;
}

export interface MarketFilters {
  query?: string;
  itemType?: MarketplaceItemType | 'free';
  /** Free-only chip (price === 0). */
  freeOnly?: boolean;
}

export function isFreeListing(listing: Pick<MarketplaceListingSummary, 'priceSouls'>): boolean {
  return listing.priceSouls === 0;
}

/**
 * Apply search + type + free filters to a list of stub listings.
 * Search covers title / creator name (case-insensitive substring).
 */
export function applyMarketFilters(
  listings: MarketFilterableListing[],
  filters: MarketFilters,
): MarketFilterableListing[] {
  let out = listings;

  const q = filters.query?.trim().toLowerCase();
  if (q) {
    out = out.filter(l => {
      const haystack = [l.title, l.creatorName ?? ''].join(' ').toLowerCase();
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