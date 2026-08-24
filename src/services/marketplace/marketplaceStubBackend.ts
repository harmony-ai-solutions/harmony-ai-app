/**
 * marketplaceStubBackend — in-memory marketplace store behind MarketplaceService.
 *
 * The stub is the ONLY data source for the marketplace domain (it replaces the
 * doomed SQLite sidecar repos: marketplace cache, ownership cache, content
 * library). Everything lives in module-level Maps/Sets seeded from
 * `src/constants/marketplaceFixtures.ts`; there is NO persistence and NO local
 * character/profile access — publishing is upload-copy (A4 ruling): the store
 * receives a frozen snapshot and the local character card is never touched.
 *
 * Design decisions:
 *   - Listing statuses: `active | pending | removed`. `active` appears in the
 *     public feed; `removed` is a soft-delete kept for the owner's history.
 *   - Ownership is keyed by listing id (`ownedListingIds`). Acquiring a
 *     listing creates a derived content asset + a library entry (upload-copy
 *     of the listing's snapshot).
 *   - Honest failures: `delistListingRecord` / `insertListing` roll the
 *     seeded `simulateTransientFailure` and throw a 503 when it hits — never
 *     fake success. Tests mock `stubBackendUtils` to force this
 *     deterministically.
 *   - `__resetForTests()` re-seeds the store so suites are order-independent.
 */

import { simulateLatency, simulateTransientFailure } from '../stub/stubBackendUtils';
import { MarketplaceError } from '../stub/StubServiceError';
import { generateId } from '../../utils/uuid';
import {
  MARKETPLACE_LISTING_FIXTURES,
  MARKETPLACE_CONTENT_ASSET_FIXTURES,
} from '../../constants/marketplaceFixtures';
import type { CharacterSnapshot, ContentAsset, OwnedLibraryEntry } from './MarketplaceService';

// ── Constants ────────────────────────────────────────────────────────────

/** Stand-in identity for the signed-in user (the future backend derives this from auth). */
export const CURRENT_USER_ID = 'local-user';
/** Display name the stub attributes to the local user's listings. */
export const CURRENT_USER_DISPLAY_NAME = 'You';

/** Seeded probability that a publish op hits an honest backend failure. */
const PUBLISH_TRANSIENT_FAIL_RATE = 0.03;
/** Seeded probability that a delist op hits an honest backend failure. */
const DELIST_TRANSIENT_FAIL_RATE = 0.1;

// ── Store ────────────────────────────────────────────────────────────────

export interface ListingRecord {
  id: string;
  title: string;
  creatorUserId: string;
  creatorName: string;
  creatorAvatarText?: string;
  priceSouls: number;
  thumbnailText?: string;
  status: 'active' | 'pending' | 'removed';
  /** ISO 8601 timestamp. */
  createdAt: string;
  description: string;
  tags: string[];
  snapshot: CharacterSnapshot;
  /** Internal popularity counter (drives the 'popular' sort in the service). */
  salesCount: number;
}

const listings = new Map<string, ListingRecord>();
const ownedListingIds = new Set<string>();
const contentAssets = new Map<string, ContentAsset>();
const library = new Map<string, OwnedLibraryEntry>();

// ── Seeding / reset ──────────────────────────────────────────────────────

function reseed(): void {
  listings.clear();
  ownedListingIds.clear();
  contentAssets.clear();
  library.clear();

  for (const seed of MARKETPLACE_LISTING_FIXTURES) {
    listings.set(seed.id, {
      id: seed.id,
      title: seed.title,
      creatorUserId: `user-${seed.creatorName.toLowerCase().replace(/[^a-z]/g, '-')}`,
      creatorName: seed.creatorName,
      creatorAvatarText: seed.creatorAvatarText,
      priceSouls: seed.priceSouls,
      thumbnailText: seed.thumbnailText,
      status: seed.status,
      createdAt: seed.createdAt,
      description: seed.description,
      tags: [...seed.tags],
      snapshot: { ...seed.snapshot },
      salesCount: seed.salesCount,
    });
  }

  for (const seed of MARKETPLACE_CONTENT_ASSET_FIXTURES) {
    contentAssets.set(seed.id, {
      id: seed.id,
      title: seed.title,
      kind: seed.kind,
      thumbnailText: seed.thumbnailText ?? null,
      createdAt: seed.createdAt,
      text: seed.text ?? null,
      snapshot: seed.snapshot ? { ...seed.snapshot } : null,
    });
  }

  // Pre-seeded ownership: the free fixture listing is already in the library
  // (kind 'free') with an upload-copy-derived asset.
  const echo = listings.get('listing-echo');
  if (echo) {
    ownedListingIds.add(echo.id);
    const entry = libraryEntryFor(echo, 'free');
    contentAssets.set(entry.asset.id, entry.asset);
    library.set(entry.id, entry);
  }
}

/**
 * Test-only reset — re-seeds the store to its pristine fixture state so test
 * suites are order-independent. Never used by production code paths.
 */
export function __resetForTests(): void {
  reseed();
}

/**
 * Re-seed the store from fixtures (pull-to-refresh). Loses any runtime
 * mutations (published/delisted listings) — that IS the point of a refresh.
 */
export async function refreshFromFixtures(): Promise<void> {
  await simulateLatency();
  reseed();
}

// ── Listing queries ──────────────────────────────────────────────────────

/** All `active` listings (the public market feed), newest first. */
export async function listListings(): Promise<ListingRecord[]> {
  await simulateLatency();
  return [...listings.values()]
    .filter(l => l.status === 'active')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Fetch a listing record by id regardless of status (used by getListing /
 * acquire / delist). Throws MarketplaceError 404 when unknown.
 */
export async function getListingRecord(id: string): Promise<ListingRecord> {
  await simulateLatency();
  const record = listings.get(id);
  if (!record) {
    throw new MarketplaceError(404, `listing not found: ${id}`, { code: 'not_found' });
  }
  return record;
}

/** Listings published by the current user (all statuses, newest first). */
export async function getMyListingsRecords(): Promise<ListingRecord[]> {
  await simulateLatency();
  return [...listings.values()]
    .filter(l => l.creatorUserId === CURRENT_USER_ID)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ── Mutations ────────────────────────────────────────────────────────────

/**
 * Insert a listing (upload-copy semantics: the caller passes a frozen
 * snapshot; the local character is never touched). New listings enter
 * `pending` (moderation review — a future backend's publish pipeline decides
 * the status). Honest failure: rolls the seeded transient failure and throws
 * 503 when it hits.
 */
export async function insertListing(input: {
  title: string;
  description: string;
  priceSouls: number;
  tags: string[];
  snapshot: CharacterSnapshot;
}): Promise<ListingRecord> {
  await simulateLatency();
  if (simulateTransientFailure(`publish:${input.title}`, PUBLISH_TRANSIENT_FAIL_RATE)) {
    throw new MarketplaceError(
      503,
      'marketplace backend temporarily unavailable',
      { code: 'stub_backend_unavailable' },
    );
  }
  const record: ListingRecord = {
    id: generateId(),
    title: input.title,
    creatorUserId: CURRENT_USER_ID,
    creatorName: CURRENT_USER_DISPLAY_NAME,
    priceSouls: input.priceSouls,
    thumbnailText: input.title.slice(0, 12),
    status: 'pending',
    createdAt: new Date().toISOString(),
    description: input.description,
    tags: [...input.tags],
    snapshot: { ...input.snapshot },
    salesCount: 0,
  };
  listings.set(record.id, record);
  return record;
}

/**
 * Delist a listing (soft-delete → status `removed`). Honest failure: when the
 * seeded transient failure hits, THROW — never fake success. The store is left
 * untouched on failure so the caller can retry.
 */
export async function delistListingRecord(id: string): Promise<void> {
  await simulateLatency();
  const record = listings.get(id);
  if (!record) {
    throw new MarketplaceError(404, `listing not found: ${id}`, { code: 'not_found' });
  }
  if (simulateTransientFailure(`delist:${id}`, DELIST_TRANSIENT_FAIL_RATE)) {
    throw new MarketplaceError(
      503,
      'marketplace backend temporarily unavailable',
      { code: 'stub_backend_unavailable' },
    );
  }
  record.status = 'removed';
}

/** True when the local user already owns the listing (idempotent acquire). */
export async function isListingOwned(listingId: string): Promise<boolean> {
  await simulateLatency();
  return ownedListingIds.has(listingId);
}

/**
 * Mark a listing as owned and deliver its asset into the library. Callers
 * (MarketplaceService.acquire) have already validated status + wallet balance.
 * Idempotent — re-acquiring an owned listing is a no-op.
 */
export async function acquireListingRecord(listingId: string): Promise<void> {
  await simulateLatency();
  const record = listings.get(listingId);
  if (!record) {
    throw new MarketplaceError(404, `listing not found: ${listingId}`, { code: 'not_found' });
  }
  if (ownedListingIds.has(listingId)) {
    return;
  }
  ownedListingIds.add(listingId);
  record.salesCount += 1;
  const entry = libraryEntryFor(record, 'purchase');
  contentAssets.set(entry.asset.id, entry.asset);
  library.set(entry.id, entry);
}

// ── Library / content assets ─────────────────────────────────────────────

/** All owned library entries (most recently acquired first). */
export async function getLibraryEntries(): Promise<OwnedLibraryEntry[]> {
  await simulateLatency();
  return [...library.values()].reverse();
}

/** Fetch a content asset by id (ContentAssetScreen's data path). */
export async function getContentAssetRecord(id: string): Promise<ContentAsset> {
  await simulateLatency();
  const asset = contentAssets.get(id);
  if (!asset) {
    throw new MarketplaceError(404, `content asset not found: ${id}`, { code: 'not_found' });
  }
  return asset;
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Derive the content asset for a listing (upload-copy of its snapshot). */
function assetFromListing(record: ListingRecord): ContentAsset {
  return {
    id: `asset-${record.id}`,
    title: record.title,
    kind: 'character_card',
    snapshot: { ...record.snapshot },
    thumbnailText: record.thumbnailText ?? null,
    createdAt: record.createdAt,
  };
}

/** Build a library entry wrapping the listing's derived asset. */
function libraryEntryFor(
  record: ListingRecord,
  kind: OwnedLibraryEntry['kind'],
): OwnedLibraryEntry {
  return {
    id: generateId(),
    listingId: record.id,
    title: record.title,
    kind,
    acquiredAt: new Date().toISOString(),
    asset: assetFromListing(record),
  };
}