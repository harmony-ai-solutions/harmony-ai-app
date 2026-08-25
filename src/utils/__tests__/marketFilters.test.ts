/**
 * Pure market filters tests (no DB / no RN).
 *
 * The stub marketplace operates on `MarketplaceListingSummary` (Phase-1
 * service type); the old snake→camel wire serializers died with
 * `marketplaceTypes.ts` in Phase 2 and are not ported — the stub owns its
 * internal shape and there is no wire format to convert.
 */
import {
  applyMarketFilters,
  isFreeListing,
  type MarketFilterableListing,
} from '../marketFilters';

function makeListing(partial: Partial<MarketFilterableListing>): MarketFilterableListing {
  return {
    id: 'x',
    title: 'T',
    creatorName: 'Creator',
    priceSouls: 0,
    status: 'active',
    salesCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    itemType: 'character',
    ...partial,
  };
}

describe('market filters', () => {
  it('search covers title and creator name', () => {
    const rows = [
      makeListing({ id: '1', title: 'Aria', creatorName: 'Dark Fantasy Studio' }),
      makeListing({ id: '2', title: 'Sunny', creatorName: 'Bright Works' }),
    ];
    expect(applyMarketFilters(rows, { query: 'aria' }).map(r => r.id)).toEqual(['1']);
    expect(applyMarketFilters(rows, { query: 'bright' }).map(r => r.id)).toEqual(['2']);
    expect(applyMarketFilters(rows, { query: 'studio' }).map(r => r.id)).toEqual(['1']);
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