/**
 * Pure market filters + serializers tests (no DB / no RN).
 */
import {
  applyMarketFilters,
  isFreeListing,
} from '../marketFilters';
import type { CachedListing } from '../../database/repositories/marketplace';
import {
  listingDtoToCache,
  ownedAssetDtoToCache,
  type MarketplaceListingDTO,
  type OwnedAssetDTO,
} from '../../services/marketplace/marketplaceTypes';

function makeListing(partial: Partial<CachedListing>): CachedListing {
  return {
    id: 'x',
    itemType: 'character',
    title: 'T',
    summary: null,
    tags: [],
    priceSouls: 0,
    status: 'active',
    salesCount: 0,
    sellerUserId: null,
    previewText: null,
    previewImageData: null,
    previewMimeType: null,
    payloadJson: {},
    cachedAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  };
}

describe('market filters', () => {
  it('search covers title, summary, and tags', () => {
    const rows = [
      makeListing({ id: '1', title: 'Aria', summary: 'dark fantasy', tags: ['lore'] }),
      makeListing({ id: '2', title: 'Sunny', summary: 'bright', tags: ['happy'] }),
    ];
    expect(applyMarketFilters(rows, { query: 'aria' }).map(r => r.id)).toEqual(['1']);
    expect(applyMarketFilters(rows, { query: 'lore' }).map(r => r.id)).toEqual(['1']);
    expect(applyMarketFilters(rows, { query: 'bright' }).map(r => r.id)).toEqual(['2']);
  });

  it('type filtering narrows by item type', () => {
    const rows = [
      makeListing({ id: '1', itemType: 'character' }),
      makeListing({ id: '2', itemType: 'backstory' }),
    ];
    expect(applyMarketFilters(rows, { itemType: 'character' }).map(r => r.id)).toEqual(['1']);
    expect(applyMarketFilters(rows, { itemType: 'backstory' }).map(r => r.id)).toEqual(['2']);
  });

  it('free filter keeps only price 0', () => {
    const rows = [
      makeListing({ id: '1', priceSouls: 0 }),
      makeListing({ id: '2', priceSouls: 50 }),
    ];
    expect(applyMarketFilters(rows, { freeOnly: true }).map(r => r.id)).toEqual(['1']);
    expect(applyMarketFilters(rows, { itemType: 'free' }).map(r => r.id)).toEqual(['1']);
  });

  it('isFreeListing is true only at price 0', () => {
    expect(isFreeListing(makeListing({ priceSouls: 0 }))).toBe(true);
    expect(isFreeListing(makeListing({ priceSouls: 1 }))).toBe(false);
  });
});

describe('marketplace serializers', () => {
  it('listingDtoToCache maps snake→camel and parses tags', () => {
    const dto: MarketplaceListingDTO = {
      id: 'l1',
      seller_user_id: 'u1',
      item_type: 'backstory',
      title: 'Origins',
      summary: 'Lore',
      tags: '["fantasy","dark"]',
      price_souls: 0,
      status: 'active',
      sales_count: 3,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
      preview_text: 'Snippet',
    };
    const cache = listingDtoToCache(dto);
    expect(cache.id).toBe('l1');
    expect(cache.itemType).toBe('backstory');
    expect(cache.tags).toEqual(['fantasy', 'dark']);
    expect(cache.priceSouls).toBe(0);
    expect(cache.salesCount).toBe(3);
    expect(cache.previewText).toBe('Snippet');
    expect((cache as { PreviewText?: unknown }).PreviewText).toBeUndefined();
  });

  it('listingDtoToCache tolerates malformed tags', () => {
    const dto: MarketplaceListingDTO = {
      id: 'l1',
      seller_user_id: 'u1',
      item_type: 'theme',
      title: 'Neon',
      summary: null,
      tags: 'not-json',
      price_souls: 0,
      status: 'active',
      sales_count: 0,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    expect(listingDtoToCache(dto).tags).toEqual([]);
  });

  it('ownedAssetDtoToCache maps snake→camel + parses dates', () => {
    const dto: OwnedAssetDTO = {
      id: 'o1',
      listing_id: 'l1',
      item_type: 'dialogue',
      title: 'Dialogues',
      asset_json: { text: 'Hi' },
      kind: 'free',
      acquired_at: '2026-03-01T12:00:00Z',
    };
    const cache = ownedAssetDtoToCache(dto);
    expect(cache.listingId).toBe('l1');
    expect(cache.kind).toBe('free');
    expect(cache.acquiredAt.toISOString()).toBe('2026-03-01T12:00:00.000Z');
  });
});