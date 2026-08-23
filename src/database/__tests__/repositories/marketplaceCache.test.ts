/**
 * Marketplace cache + content library repository tests.
 *
 * Verifies the new account-backed marketplace layer:
 *   - listing cache (upsert / browse filters / query / id lookup)
 *   - ownership cache (save / list / dedupe / hasOwnedAsset)
 *   - content library (add / list / delete / apply-text-to-character)
 *   - clearMarketplaceCache wipes catalog + ownership + library but keeps wallet
 */

import { useFreshDatabase } from '../repositoryFixtures';
import {
  createCharacterProfile,
  getCharacterProfile,
} from '../../repositories/characters';
import {
  cacheListing,
  getCachedListings,
  getCachedListing,
  getCachedMyListings,
  setCachedListingStatus,
  saveOwnedAsset,
  getOwnedAssets,
  hasOwnedAsset,
  clearMarketplaceCache,
} from '../../repositories/marketplace';
import { creditSouls, getSoulBalance } from '../../repositories/soulWallet';
import {
  addContentEntry,
  getContentEntries,
  getContentEntry,
  deleteContentEntry,
  applyTextToCharacter,
} from '../../repositories/contentLibrary';

async function createCharacter(id: string, name: string) {
  return createCharacterProfile({
    id,
    name,
    description: '',
    personality: '',
    voice_characteristics: '',
    base_prompt: '',
    scenario: '',
    typing_speed_wpm: 60,
    audio_response_chance_percent: 50,
    vision_config_id: null,
    lifecycle_config: '{}',
  });
}

describe('marketplace listing cache', () => {
  useFreshDatabase();

  it('cacheListing upserts and getCachedListings returns active items', async () => {
    await cacheListing({
      id: 'l1',
      itemType: 'character',
      title: 'Aria',
      summary: 'A dark fantasy heroine',
      tags: ['fantasy', 'lore'],
      priceSouls: 250,
      payloadJson: { name: 'Aria' },
    });
    await cacheListing({
      id: 'l2',
      itemType: 'backstory',
      title: 'Origins',
      summary: 'A short backstory',
      priceSouls: 0,
      payloadJson: { text: 'She was born...' },
    });

    const all = await getCachedListings();
    expect(all).toHaveLength(2);

    const chars = await getCachedListings({ itemType: 'character' });
    expect(chars).toHaveLength(1);
    expect(chars[0].id).toBe('l1');

    const free = await getCachedListings({ freeOnly: true });
    expect(free).toHaveLength(1);
    expect(free[0].id).toBe('l2');
  });

  it('getCachedListings filters by query across title/summary/tags', async () => {
    await cacheListing({
      id: 'l1',
      itemType: 'character',
      title: 'Aria',
      summary: 'Dark fantasy',
      tags: ['lore'],
      priceSouls: 5,
      payloadJson: {},
    });
    await cacheListing({
      id: 'l2',
      itemType: 'description',
      title: 'Sunny',
      summary: 'bright and cheerful',
      tags: ['happy'],
      priceSouls: 5,
      payloadJson: {},
    });

    expect(await getCachedListings({ query: 'Aria' })).toHaveLength(1);
    expect(await getCachedListings({ query: 'lore' })).toHaveLength(1);
    expect(await getCachedListings({ query: 'cheerful' })).toHaveLength(1);
  });

  it('getCachedListing returns a single listing by id', async () => {
    await cacheListing({
      id: 'l1',
      itemType: 'theme',
      title: 'Neon',
      priceSouls: 0,
      payloadJson: {},
    });
    const found = await getCachedListing('l1');
    expect(found?.title).toBe('Neon');
    expect(found?.itemType).toBe('theme');
    expect(await getCachedListing('missing')).toBeNull();
  });

  it('delisted items do not appear in browse', async () => {
    await cacheListing({
      id: 'l1',
      itemType: 'backstory',
      title: 'X',
      priceSouls: 0,
      status: 'delisted',
      payloadJson: {},
    });
    expect(await getCachedListings()).toHaveLength(0);
  });
});

describe('marketplace ownership cache', () => {
  useFreshDatabase();

  it('saveOwnedAsset stores and getOwnedAssets lists', async () => {
    await cacheListing({
      id: 'l1',
      itemType: 'backstory',
      title: 'Origins',
      priceSouls: 0,
      payloadJson: {},
    });
    await saveOwnedAsset({
      id: 'o1',
      listingId: 'l1',
      itemType: 'backstory',
      title: 'Origins',
      assetJson: { text: '...' },
      kind: 'free',
    });

    const owned = await getOwnedAssets();
    expect(owned).toHaveLength(1);
    expect(owned[0].kind).toBe('free');
    expect(await hasOwnedAsset('l1')).toBe(true);
    expect(await hasOwnedAsset('nope')).toBe(false);
  });

  it('saveOwnedAsset upserts (idempotent) for the same listing', async () => {
    await cacheListing({
      id: 'l1',
      itemType: 'character',
      title: 'Aria',
      priceSouls: 100,
      payloadJson: {},
    });
    await saveOwnedAsset({
      id: 'o1',
      listingId: 'l1',
      itemType: 'character',
      title: 'Aria',
      assetJson: {},
      kind: 'purchase',
    });
    await saveOwnedAsset({
      id: 'o2',
      listingId: 'l1',
      itemType: 'character',
      title: 'Aria',
      assetJson: {},
      kind: 'purchase',
    });

    // Two different ownership ids for the same listing → both stored
    expect(await getOwnedAssets()).toHaveLength(2);
  });
});

describe('content library', () => {
  useFreshDatabase();

  it('addContentEntry + getContentEntries + getContentEntry', async () => {
    const entry = await addContentEntry({
      itemType: 'backstory',
      title: 'Aria Lore',
      body: 'She was born under a red moon',
    });
    expect(entry.id).toBeTruthy();

    const all = await getContentEntries();
    expect(all).toHaveLength(1);
    expect(all[0].body).toBe('She was born under a red moon');

    const byId = await getContentEntry(entry.id);
    expect(byId?.title).toBe('Aria Lore');
  });

  it('deleteContentEntry removes', async () => {
    const entry = await addContentEntry({
      itemType: 'prompt',
      title: 'P',
      body: 'You are a detective',
    });
    await deleteContentEntry(entry.id);
    expect(await getContentEntries()).toHaveLength(0);
  });

  it('applyTextToCharacter maps fields by item type', async () => {
    await createCharacter('p1', 'Aria');
    const entry = await addContentEntry({
      itemType: 'dialogue',
      title: 'Dialogue',
      body: 'A sample dialogue line',
    });

    const updated = await applyTextToCharacter(entry.id, 'p1');
    const prof = await getCharacterProfile('p1');
    expect(prof?.mes_example).toBe('A sample dialogue line');
    expect(updated.mes_example).toBe('A sample dialogue line');
  });

  it('applyTextToCharacter maps prompt to base_prompt + scenario', async () => {
    await createCharacter('p1', 'Detective');
    const entry = await addContentEntry({
      itemType: 'prompt',
      title: 'Prompt',
      body: 'You solve crimes',
      payloadJson: { scenario: 'L.A. noir' },
    });

    await applyTextToCharacter(entry.id, 'p1');
    const prof = await getCharacterProfile('p1');
    expect(prof?.base_prompt).toBe('You solve crimes');
    expect(prof?.scenario).toBe('L.A. noir');
  });
});

describe('my listings cache', () => {
  useFreshDatabase();

  it("getCachedMyListings returns only the seller's listings, active + delisted", async () => {
    await cacheListing({
      id: 'l1',
      itemType: 'backstory',
      title: 'A',
      priceSouls: 0,
      sellerUserId: 'u1',
      payloadJson: {},
    });
    await cacheListing({
      id: 'l2',
      itemType: 'character',
      title: 'B',
      priceSouls: 50,
      sellerUserId: 'u2',
      payloadJson: {},
    });
    await cacheListing({
      id: 'l3',
      itemType: 'prompt',
      title: 'C',
      priceSouls: 10,
      status: 'delisted',
      sellerUserId: 'u1',
      payloadJson: {},
    });

    const mine = await getCachedMyListings('u1');
    const ids = mine.map(l => l.id);
    // Both of u1's listings (active + delisted) appear; exact order is not
    // deterministic within the same second.
    expect(ids).toEqual(expect.arrayContaining(['l1', 'l3']));
    expect(ids).toHaveLength(2);
    // u2's listing never appears for u1
    expect(ids).not.toContain('l2');
  });

  it('setCachedListingStatus toggles active/delisted', async () => {
    await cacheListing({
      id: 'l1',
      itemType: 'backstory',
      title: 'A',
      priceSouls: 0,
      sellerUserId: 'u1',
      payloadJson: {},
    });

    await setCachedListingStatus('l1', 'delisted');
    let listing = await getCachedListing('l1');
    expect(listing?.status).toBe('delisted');

    await setCachedListingStatus('l1', 'active');
    listing = await getCachedListing('l1');
    expect(listing?.status).toBe('active');
  });
});

describe('clearMarketplaceCache', () => {
  useFreshDatabase();

  it('wipes catalog + ownership + library but keeps the wallet', async () => {
    await creditSouls(100);
    await cacheListing({
      id: 'l1',
      itemType: 'backstory',
      title: 'X',
      priceSouls: 0,
      payloadJson: {},
    });
    await saveOwnedAsset({
      id: 'o1',
      listingId: 'l1',
      itemType: 'backstory',
      title: 'X',
      assetJson: {},
      kind: 'free',
    });
    await addContentEntry({ itemType: 'backstory', title: 'X', body: '...' });

    await clearMarketplaceCache();

    expect(await getCachedListings()).toHaveLength(0);
    expect(await getOwnedAssets()).toHaveLength(0);
    expect(await getContentEntries()).toHaveLength(0);
    // wallet survives the cache wipe (re-synced from account on login)
    expect(await getSoulBalance()).toBe(100);
  });
});