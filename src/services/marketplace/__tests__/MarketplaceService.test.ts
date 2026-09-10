/**
 * MarketplaceService + stub backend tests.
 *
 * Covers:
 *   - Listing CRUD: getListings (feed/search/sort), getListing (detail/404)
 *   - publishListing = upload-copy (A4): the stub store is mutated, the local
 *     character is NEVER touched — asserted by scanning the module sources for
 *     zero imports from `database/repositories` or the old marketplace modules,
 *     plus throwing jest.mock factories on the repo modules as a backstop
 *   - acquire: success path (wallet debit + library delivery), idempotent
 *     re-acquire, InsufficientCreditsError (402 quota_exceeded with
 *     soulCreditsAvailable) when the balance is short, and 409 for
 *     non-active listings
 *   - delist honest-failure: the seeded simulateTransientFailure is forced via
 *     jest.mock so the stub THROWS instead of faking success
 *   - refresh() re-seeds fixtures
 *
 * Mocks `src/services/stub/stubBackendUtils` (deviceAuth.test.ts pattern):
 * latency is instant and simulateTransientFailure is controllable, so the
 * suites are fast and deterministic. Backend stores are module-level
 * singletons — `__resetForTests()` runs in beforeEach for order independence.
 */

// Mock the logger so it doesn't emit after tests finish.
jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

// Mock the stub backend utils: instant latency + controllable transient
// failure (stashed on the module exports so tests can drive + assert them).
jest.mock('../../stub/stubBackendUtils', () => {
  const simulateLatency = jest.fn(async () => {});
  const simulateTransientFailure = jest.fn(() => false);
  return {
    simulateLatency,
    simulateTransientFailure,
    __simulateLatency: simulateLatency,
    __simulateTransientFailure: simulateTransientFailure,
  };
});

// Backstop: the marketplace stub service layer must NEVER touch the local DB
// repos. If a repo module is ever imported, these factories throw on load and
// the suite fails loudly. (The marketplace/social/wallet repos were deleted in
// the schema-surgery phase — the surviving characters repo keeps its guard.)
jest.mock('../../../database/repositories/characters', () => {
  throw new Error('MarketplaceService must not import database/repositories/characters');
});

import { readFileSync } from 'fs';
import * as StubBackendUtils from '../../stub/stubBackendUtils';
import * as MarketplaceService from '../MarketplaceService';
import * as MarketplaceBackend from '../marketplaceStubBackend';
import * as WalletBackend from '../../wallet/walletStubBackend';
import { walletService } from '../../wallet/WalletService';
import { InsufficientCreditsError, MarketplaceError } from '../../stub/StubServiceError';
import { MARKETPLACE_LISTING_FIXTURES } from '../../../constants/marketplaceFixtures';
import type { CharacterSnapshot } from '../MarketplaceService';

const mockSimulateTransientFailure = (StubBackendUtils as any)
  .__simulateTransientFailure as jest.Mock;

/** A complete frozen card snapshot for publish drafts (upload-copy payload). */
function makeSnapshot(name = 'Test Companion'): CharacterSnapshot {
  return {
    name,
    description: 'A stub character for tests.',
    personality: 'Cheerful and curious.',
    base_prompt: 'You are a test companion. Be helpful.',
    scenario: 'A cozy testing lab.',
    mes_example: 'Hello! How can I help?',
    voice_characteristics: 'Bright, warm',
    typing_speed_wpm: 30,
    audio_response_chance_percent: 60,
    image_data: null,
    image_mime: null,
  };
}

beforeEach(() => {
  mockSimulateTransientFailure.mockReset();
  mockSimulateTransientFailure.mockReturnValue(false);
  MarketplaceBackend.__resetForTests();
  WalletBackend.__resetForTests();
});

describe('MarketplaceService — listing reads', () => {
  it('seeds at least 10 fixture listings (feed = active only)', async () => {
    expect(MARKETPLACE_LISTING_FIXTURES.length).toBeGreaterThanOrEqual(10);

    const listings = await MarketplaceService.getListings();
    expect(listings.length).toBeGreaterThanOrEqual(8);
    expect(listings.every(l => l.status === 'active')).toBe(true);
    expect(listings[0]).toMatchObject({
      id: expect.any(String),
      title: expect.any(String),
      creatorName: expect.any(String),
      priceSouls: expect.any(Number),
      createdAt: expect.any(String),
    });
  });

  it('defaults to newest-first ordering', async () => {
    const listings = await MarketplaceService.getListings();
    const times = listings.map(l => new Date(l.createdAt).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(listings[0].id).toBe('listing-wren-whimsy');
  });

  it('searches across title/creator/description/tags (case-insensitive)', async () => {
    const results = await MarketplaceService.getListings({ search: 'luna' });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some(l => l.id === 'listing-luna')).toBe(true);

    const byCreator = await MarketplaceService.getListings({ search: 'AURORA' });
    expect(byCreator.every(l => l.creatorName === 'Aurora Vale')).toBe(true);
  });

  it('sorts by price ascending', async () => {
    const listings = await MarketplaceService.getListings({ sort: 'price' });
    const prices = listings.map(l => l.priceSouls);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
    expect(listings[0].id).toBe('listing-echo'); // free listing
  });

  it('sorts by popularity (sales count descending)', async () => {
    const listings = await MarketplaceService.getListings({ sort: 'popular' });
    expect(listings[0].id).toBe('listing-echo'); // highest salesCount fixture
  });

  it('getListing returns the full detail (description, tags, frozen snapshot)', async () => {
    const detail = await MarketplaceService.getListing('listing-luna');
    expect(detail.description).toEqual(expect.any(String));
    expect(detail.tags).toEqual(expect.any(Array));
    expect(detail.snapshot.name).toBe('Luna');
  });

  it('getListing throws MarketplaceError 404 not_found for unknown ids', async () => {
    await expect(MarketplaceService.getListing('missing-listing')).rejects.toMatchObject({
      name: 'MarketplaceError',
      status: 404,
      code: 'not_found',
    });
  });
});

describe('MarketplaceService — publish = upload-copy (A4)', () => {
  it('never imports the local DB or the old marketplace modules', () => {
    // Static assertion: scan the service + backend module sources for the
    // forbidden import surfaces. Zero matches = the local character/profile
    // can never be touched by this layer.
    const forbidden = [
      /from ['"].*database\/repositories/i,
      /from ['"].*(MarketplaceApiService|acquireItem|itemSnapshots|librarySync|marketplaceTypes)/i,
      /MarketplacePurchaseService/i,
    ];
    for (const file of ['MarketplaceService.ts', 'marketplaceStubBackend.ts']) {
      const source = readFileSync(`${__dirname}/../${file}`, 'utf8');
      for (const pattern of forbidden) {
        expect(source).not.toMatch(pattern);
      }
    }
  });

  it('stores the frozen draft snapshot in the stub store and marks it pending', async () => {
    const draft = {
      title: 'My Original Character',
      description: 'An original card built for the market.',
      priceSouls: 25,
      tags: ['original', 'test'],
      cardSnapshot: makeSnapshot('My OC'),
    };

    const published = await MarketplaceService.publishListing(draft);
    expect(published.title).toBe('My Original Character');
    expect(published.status).toBe('pending');
    expect(published.creatorName).toBe('You');

    // Store mutated — the published detail round-trips with the frozen snapshot.
    const detail = await MarketplaceService.getListing(published.id);
    expect(detail.title).toBe('My Original Character');
    expect(detail.snapshot).toEqual(draft.cardSnapshot);

    // Pending listings are NOT in the public feed yet.
    const feed = await MarketplaceService.getListings();
    expect(feed.some(l => l.id === published.id)).toBe(false);

    // ...but they show up in getMyListings().
    const mine = await MarketplaceService.getMyListings();
    expect(mine.some(l => l.id === published.id)).toBe(true);
  });

  it('validates the draft (empty title / negative price)', async () => {
    await expect(
      MarketplaceService.publishListing({
        title: '   ',
        description: 'd',
        priceSouls: 10,
        cardSnapshot: makeSnapshot(),
      }),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_draft' });

    await expect(
      MarketplaceService.publishListing({
        title: 'Bad Price',
        description: 'd',
        priceSouls: -5,
        cardSnapshot: makeSnapshot(),
      }),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_draft' });
  });

  it('publishListing surfaces a backend failure honestly (no fake success)', async () => {
    mockSimulateTransientFailure.mockReturnValue(true);

    await expect(
      MarketplaceService.publishListing({
        title: 'Doomed Listing',
        description: 'Should fail to publish.',
        priceSouls: 10,
        cardSnapshot: makeSnapshot(),
      }),
    ).rejects.toMatchObject({ status: 503, code: 'stub_backend_unavailable' });

    // Nothing was created.
    expect(await MarketplaceService.getMyListings()).toHaveLength(0);
  });
});

describe('MarketplaceService — acquire', () => {
  it('success: debits the wallet and delivers the asset into the library', async () => {
    expect(await walletService.getBalance()).toBe(50);

    const result = await MarketplaceService.acquire('listing-wren'); // 45 souls
    expect(result).toMatchObject({ ok: true, listingId: 'listing-wren' });
    // Deep-link ids for MyLibrary navigation are exposed on the result.
    expect(result.deliveredEntryId).toEqual(expect.any(String));
    expect(result.deliveredAssetId).toEqual(expect.any(String));
    expect(await walletService.getBalance()).toBe(5);

    const library = await MarketplaceService.getLibrary();
    const entry = library.find(e => e.listingId === 'listing-wren');
    expect(entry).toBeDefined();
    expect(entry!.kind).toBe('purchase');
    expect(entry!.asset.snapshot?.name).toBe('Professor Wren');

    // The delivered asset is fetchable via getContentAsset.
    const asset = await MarketplaceService.getContentAsset(entry!.asset.id);
    expect(asset.id).toBe(entry!.asset.id);
  });

  it('acquiring an already-owned listing is idempotent (no second debit)', async () => {
    // listing-echo is pre-seeded as owned (free fixture).
    const result = await MarketplaceService.acquire('listing-echo');
    expect(result).toMatchObject({ ok: true, listingId: 'listing-echo' });
    expect(result.deliveredEntryId).toEqual(expect.any(String));
    expect(result.deliveredAssetId).toEqual(expect.any(String));
    expect(await walletService.getBalance()).toBe(50);

    // A purchase-acquired listing is also idempotent.
    await MarketplaceService.acquire('listing-wren');
    expect(await walletService.getBalance()).toBe(5);
    await MarketplaceService.acquire('listing-wren');
    expect(await walletService.getBalance()).toBe(5);
  });

  it('throws InsufficientCreditsError (402 quota_exceeded) when the balance is short', async () => {
    let err: unknown;
    try {
      await MarketplaceService.acquire('listing-luna'); // 120 souls > 50
    } catch (e) {
      err = e;
    }

    expect(err).toBeInstanceOf(InsufficientCreditsError);
    expect(err).toBeInstanceOf(MarketplaceError);
    const quotaErr = err as InsufficientCreditsError;
    expect(quotaErr.status).toBe(402);
    expect(quotaErr.code).toBe('quota_exceeded');
    expect(quotaErr.soulCreditsAvailable).toBe(50);
    expect(quotaErr.isQuotaError).toBe(true);
    expect(quotaErr.isAuthError).toBe(false);
    expect(quotaErr.isServerError).toBe(false);

    // Wallet untouched, nothing added to the library.
    expect(await walletService.getBalance()).toBe(50);
    const library = await MarketplaceService.getLibrary();
    expect(library.some(e => e.listingId === 'listing-luna')).toBe(false);
  });

  it('rejects non-active listings (pending / removed) with 409', async () => {
    await expect(MarketplaceService.acquire('listing-machine-priest')).rejects.toMatchObject({
      status: 409,
      code: 'listing_not_available',
    });
    await expect(MarketplaceService.acquire('listing-archive')).rejects.toMatchObject({
      status: 409,
      code: 'listing_not_available',
    });
  });

  it('throws MarketplaceError 404 for an unknown listing', async () => {
    await expect(MarketplaceService.acquire('missing-listing')).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    });
  });
});

describe('MarketplaceService — delist (honest failure)', () => {
  it('throws 503 when the simulated backend op fails — no fake success', async () => {
    mockSimulateTransientFailure.mockReturnValue(true);

    await expect(MarketplaceService.delistListing('listing-nyx')).rejects.toMatchObject({
      status: 503,
      code: 'stub_backend_unavailable',
    });

    // The store is untouched — the listing is still active and still listed.
    const listings = await MarketplaceService.getListings();
    expect(listings.some(l => l.id === 'listing-nyx' && l.status === 'active')).toBe(true);
    const detail = await MarketplaceService.getListing('listing-nyx');
    expect(detail.status).toBe('active');
  });

  it('delists successfully when the backend op succeeds (soft-delete → removed)', async () => {
    await MarketplaceService.delistListing('listing-nyx');

    // Gone from the public feed...
    const listings = await MarketplaceService.getListings();
    expect(listings.some(l => l.id === 'listing-nyx')).toBe(false);
    // ...but retained as a soft-deleted record for history.
    const detail = await MarketplaceService.getListing('listing-nyx');
    expect(detail.status).toBe('removed');
  });

  it('throws MarketplaceError 404 for an unknown listing', async () => {
    await expect(MarketplaceService.delistListing('missing-listing')).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    });
  });
});

describe('MarketplaceService — refresh', () => {
  it('re-seeds fixtures, discarding runtime mutations', async () => {
    await MarketplaceService.publishListing({
      title: 'Ephemeral Listing',
      description: 'Will be wiped by refresh.',
      priceSouls: 10,
      cardSnapshot: makeSnapshot(),
    });
    await MarketplaceService.delistListing('listing-nyx');

    await MarketplaceService.refresh();

    const feed = await MarketplaceService.getListings();
    expect(feed.some(l => l.id === 'listing-nyx' && l.status === 'active')).toBe(true);
    expect(feed.some(l => l.title === 'Ephemeral Listing')).toBe(false);
    expect(await MarketplaceService.getMyListings()).toHaveLength(0);
  });
});

describe('MarketplaceService — wire extensions (salesCount, preview, text/theme)', () => {
  it('exposes salesCount on every feed summary (popular-sort source)', async () => {
    const listings = await MarketplaceService.getListings();
    expect(listings.length).toBeGreaterThan(0);
    expect(listings.every(l => typeof l.salesCount === 'number')).toBe(true);
    expect(listings.find(l => l.id === 'listing-echo')?.salesCount).toBe(402);
  });

  it('exposes salesCount on the detail (detail extends summary)', async () => {
    const detail = await MarketplaceService.getListing('listing-luna');
    expect(detail.salesCount).toBe(42);
  });

  it('exposes preview fields on the detail (feed cards do not carry them)', async () => {
    const detail = await MarketplaceService.getListing('listing-luna');
    expect(detail.previewText).toEqual(expect.any(String));
    expect(detail.previewText!.length).toBeGreaterThan(0);
    // Fixtures ship no image assets — the UI renders images only when present.
    expect(detail.previewImageData).toBeNull();
    expect(detail.previewMimeType).toBeNull();
  });

  it('publishListing accepts a text draft and validates the text payload', async () => {
    const published = await MarketplaceService.publishListing({
      title: 'My Field Notes',
      description: 'Notes on companion design.',
      priceSouls: 15,
      tags: ['notes'],
      cardSnapshot: makeSnapshot('Field Notes'),
      kind: 'text',
      text: 'Remember the user, not just the conversation.',
      previewText: 'A short teaser shown before acquisition.',
    });
    expect(published.status).toBe('pending');
    // The preview teaser round-trips onto the pending detail.
    const detail = await MarketplaceService.getListing(published.id);
    expect(detail.previewText).toBe('A short teaser shown before acquisition.');

    // kind 'text' without a body is an invalid draft (honest 400).
    await expect(
      MarketplaceService.publishListing({
        title: 'Empty Body',
        description: 'd',
        priceSouls: 5,
        cardSnapshot: makeSnapshot(),
        kind: 'text',
        text: '   ',
      }),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_draft' });
  });

  it('insertListing stores kind/text/previewText/sourceProfileId on the record', async () => {
    const record = await MarketplaceBackend.insertListing({
      title: 'Stored Payload',
      description: 'd',
      priceSouls: 7,
      tags: ['t'],
      snapshot: makeSnapshot(),
      kind: 'theme',
      text: 'The theme payload.',
      previewText: 'A teaser.',
      sourceProfileId: 'profile-stored',
    });
    expect(record.kind).toBe('theme');
    expect(record.text).toBe('The theme payload.');
    expect(record.previewText).toBe('A teaser.');
    expect(record.sourceProfileId).toBe('profile-stored');
  });

  it('acquiring a text-kind listing delivers a text asset (no snapshot)', async () => {
    // listing-essay is an active fixture text listing (30 souls).
    const result = await MarketplaceService.acquire('listing-essay');
    expect(result.deliveredAssetId).toEqual(expect.any(String));

    const asset = await MarketplaceService.getContentAsset(result.deliveredAssetId!);
    expect(asset.kind).toBe('text');
    expect(asset.text).toContain('the ones who remember');
    expect(asset.snapshot).toBeUndefined();
  });

  it('acquiring a theme-kind listing delivers a theme asset with the theme payload', async () => {
    // listing-starlight-frame is an active fixture theme listing (20 souls).
    const result = await MarketplaceService.acquire('listing-starlight-frame');

    const asset = await MarketplaceService.getContentAsset(result.deliveredAssetId!);
    expect(asset.kind).toBe('theme');
    expect(asset.text).toContain('night sky');
    expect(asset.snapshot).toBeUndefined();
  });
});

describe('MarketplaceService — updateListing (owner-only)', () => {
  it('happy path: applies changes and keeps the status unchanged', async () => {
    const published = await MarketplaceService.publishListing({
      title: 'Original Title',
      description: 'Original description.',
      priceSouls: 10,
      tags: ['old'],
      cardSnapshot: makeSnapshot(),
    });
    expect(published.status).toBe('pending');

    const updated = await MarketplaceService.updateListing(published.id, {
      title: '  New Title  ',
      description: '  New description.  ',
      priceSouls: 33,
      tags: ['new', 'tags'],
      previewText: 'A fresh teaser.',
    });
    expect(updated.title).toBe('New Title');
    expect(updated.description).toBe('New description.');
    expect(updated.priceSouls).toBe(33);
    expect(updated.tags).toEqual(['new', 'tags']);
    expect(updated.previewText).toBe('A fresh teaser.');
    expect(updated.status).toBe('pending'); // update NEVER changes status

    const roundTrip = await MarketplaceService.getListing(published.id);
    expect(roundTrip.title).toBe('New Title');
    expect(roundTrip.previewText).toBe('A fresh teaser.');
  });

  it('throws 403 forbidden for listings owned by someone else', async () => {
    await expect(
      MarketplaceService.updateListing('listing-luna', { title: 'Hijack' }),
    ).rejects.toMatchObject({ status: 403, code: 'forbidden' });
  });

  it('throws 404 for unknown listings', async () => {
    await expect(
      MarketplaceService.updateListing('missing-listing', { title: 'X' }),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' });
  });

  it('validates title / price like publish (400 invalid_draft)', async () => {
    const published = await MarketplaceService.publishListing({
      title: 'Valid',
      description: 'd',
      priceSouls: 10,
      cardSnapshot: makeSnapshot(),
    });

    await expect(
      MarketplaceService.updateListing(published.id, { title: '   ' }),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_draft' });
    await expect(
      MarketplaceService.updateListing(published.id, { priceSouls: -5 }),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_draft' });
  });

  it('throws 503 honestly when the simulated backend op fails (store untouched)', async () => {
    const published = await MarketplaceService.publishListing({
      title: 'Doomed Edit',
      description: 'd',
      priceSouls: 10,
      cardSnapshot: makeSnapshot(),
    });

    mockSimulateTransientFailure.mockReturnValue(true);
    await expect(
      MarketplaceService.updateListing(published.id, { title: 'Changed?' }),
    ).rejects.toMatchObject({ status: 503, code: 'stub_backend_unavailable' });

    mockSimulateTransientFailure.mockReturnValue(false);
    const detail = await MarketplaceService.getListing(published.id);
    expect(detail.title).toBe('Doomed Edit');
  });
});

describe('MarketplaceService — relistListing', () => {
  it('re-lists a removed listing back to active', async () => {
    const published = await MarketplaceService.publishListing({
      title: 'Comeback Listing',
      description: 'd',
      priceSouls: 10,
      cardSnapshot: makeSnapshot(),
    });
    await MarketplaceService.delistListing(published.id);
    expect((await MarketplaceService.getListing(published.id)).status).toBe('removed');

    const relisted = await MarketplaceService.relistListing(published.id);
    expect(relisted.status).toBe('active');

    const feed = await MarketplaceService.getListings();
    expect(feed.some(l => l.id === published.id && l.status === 'active')).toBe(true);
  });

  it('rejects non-removed statuses with 409 listing_not_available', async () => {
    // Owned listing currently active (publish → delist → relist → active).
    const published = await MarketplaceService.publishListing({
      title: 'Already Live',
      description: 'd',
      priceSouls: 10,
      cardSnapshot: makeSnapshot(),
    });
    await MarketplaceService.delistListing(published.id);
    await MarketplaceService.relistListing(published.id);
    await expect(MarketplaceService.relistListing(published.id)).rejects.toMatchObject({
      status: 409,
      code: 'listing_not_available',
    });

    // Owned listing still pending (never delisted).
    const pending = await MarketplaceService.publishListing({
      title: 'Still Pending',
      description: 'd',
      priceSouls: 10,
      cardSnapshot: makeSnapshot(),
    });
    await expect(MarketplaceService.relistListing(pending.id)).rejects.toMatchObject({
      status: 409,
      code: 'listing_not_available',
    });
  });

  it('throws 403 forbidden for someone else\u2019s removed listing', async () => {
    // listing-archive is a removed fixture owned by a foreign creator.
    await expect(MarketplaceService.relistListing('listing-archive')).rejects.toMatchObject({
      status: 403,
      code: 'forbidden',
    });
  });

  it('throws 404 for unknown listings', async () => {
    await expect(MarketplaceService.relistListing('missing-listing')).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    });
  });

  it('throws 503 honestly when the simulated backend op fails (status unchanged)', async () => {
    const published = await MarketplaceService.publishListing({
      title: 'Doomed Relist',
      description: 'd',
      priceSouls: 10,
      cardSnapshot: makeSnapshot(),
    });
    await MarketplaceService.delistListing(published.id);

    mockSimulateTransientFailure.mockReturnValue(true);
    await expect(MarketplaceService.relistListing(published.id)).rejects.toMatchObject({
      status: 503,
      code: 'stub_backend_unavailable',
    });

    mockSimulateTransientFailure.mockReturnValue(false);
    expect((await MarketplaceService.getListing(published.id)).status).toBe('removed');
  });
});

describe('MarketplaceService — removeLibraryEntry', () => {
  it('removes the entry and revokes ownership so the listing can be acquired again', async () => {
    // listing-echo is pre-seeded as owned (free fixture) — find its entry.
    const before = await MarketplaceService.getLibrary();
    const echoEntry = before.find(e => e.listingId === 'listing-echo');
    expect(echoEntry).toBeDefined();

    await MarketplaceService.removeLibraryEntry(echoEntry!.id);

    const after = await MarketplaceService.getLibrary();
    expect(after.some(e => e.id === echoEntry!.id)).toBe(false);

    // Ownership revoked → acquire succeeds again (free, no debit).
    const reacquired = await MarketplaceService.acquire('listing-echo');
    expect(reacquired).toMatchObject({ ok: true, listingId: 'listing-echo' });
    expect(reacquired.deliveredEntryId).toEqual(expect.any(String));
    expect(await walletService.getBalance()).toBe(50);

    const library = await MarketplaceService.getLibrary();
    expect(library.some(e => e.listingId === 'listing-echo')).toBe(true);
  });

  it('throws 404 for unknown library entries', async () => {
    await expect(MarketplaceService.removeLibraryEntry('missing-entry')).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    });
  });
});

describe('MarketplaceService — profile linkage + chat-lock', () => {
  it('no listing → not locked, no profile listing', async () => {
    expect(await MarketplaceService.isChatLocked('profile-unknown')).toBe(false);
    expect(await MarketplaceService.getListingForProfile('profile-unknown')).toBeNull();
  });

  it('own active listing (creator) → never locked', async () => {
    const published = await MarketplaceService.publishListing({
      title: 'My Own Character',
      description: 'd',
      priceSouls: 10,
      cardSnapshot: makeSnapshot('My OC'),
      sourceProfileId: 'profile-mine',
    });
    await MarketplaceService.delistListing(published.id);
    await MarketplaceService.relistListing(published.id); // now active, creator = You

    expect(await MarketplaceService.isChatLocked('profile-mine')).toBe(false);
  });

  it('someone else\u2019s active listing via sourceProfileId → chat locked, listing surfaced', async () => {
    MarketplaceBackend.__seedForeignListingForTest({
      id: 'foreign-active',
      title: 'Foreign Active',
      sourceProfileId: 'profile-foreign-active',
    });

    const listing = await MarketplaceService.getListingForProfile('profile-foreign-active');
    expect(listing).not.toBeNull();
    expect(listing!.id).toBe('foreign-active');
    expect(await MarketplaceService.isChatLocked('profile-foreign-active')).toBe(true);
  });

  it('after acquiring the foreign listing → chat unlocked', async () => {
    MarketplaceBackend.__seedForeignListingForTest({
      id: 'foreign-active',
      title: 'Foreign Active',
      sourceProfileId: 'profile-foreign-active',
    });

    const result = await MarketplaceService.acquire('foreign-active');
    expect(result).toMatchObject({ ok: true, listingId: 'foreign-active' });

    expect(await MarketplaceService.isChatLocked('profile-foreign-active')).toBe(false);
  });

  it('pending / removed listings never lock', async () => {
    MarketplaceBackend.__seedForeignListingForTest({
      id: 'foreign-pending',
      title: 'Foreign Pending',
      sourceProfileId: 'profile-foreign-pending',
      status: 'pending',
    });
    MarketplaceBackend.__seedForeignListingForTest({
      id: 'foreign-removed',
      title: 'Foreign Removed',
      sourceProfileId: 'profile-foreign-removed',
      status: 'removed',
    });

    expect(await MarketplaceService.isChatLocked('profile-foreign-pending')).toBe(false);
    expect(await MarketplaceService.isChatLocked('profile-foreign-removed')).toBe(false);
    expect(await MarketplaceService.getListingForProfile('profile-foreign-pending')).toBeNull();
    expect(await MarketplaceService.getListingForProfile('profile-foreign-removed')).toBeNull();
  });
});

describe('stubBackendUtils (real implementation)', () => {
  it('simulateTransientFailure is seeded — deterministic per key', () => {
    const real = jest.requireActual('../../stub/stubBackendUtils') as typeof StubBackendUtils;

    // failRate 0 never fails; 1 always fails.
    expect(real.simulateTransientFailure('delist:listing-x', 0)).toBe(false);
    expect(real.simulateTransientFailure('delist:listing-x', 1)).toBe(true);

    // Same key + same rate → same roll (deterministic).
    const a = real.simulateTransientFailure('delist:listing-x', 0.5);
    const b = real.simulateTransientFailure('delist:listing-x', 0.5);
    expect(a).toBe(b);
  });
});