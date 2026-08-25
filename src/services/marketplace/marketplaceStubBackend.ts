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
/** Seeded probability that an update/re-list op hits an honest backend failure. */
const UPDATE_TRANSIENT_FAIL_RATE = 0.1;
const RELIST_TRANSIENT_FAIL_RATE = 0.1;

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
  /** Asset family — determines how the delivered asset is built. */
  kind: 'character_card' | 'text' | 'theme';
  /** Plain-text payload (the delivered body for kind 'text' / 'theme'). */
  text?: string | null;
  /** Detail-screen teaser (preview context shown before acquisition). */
  previewText?: string | null;
  /** Base64 preview image (the UI renders it only when present). */
  previewImageData?: string | null;
  /** MIME type of `previewImageData`. */
  previewMimeType?: string | null;
  /**
   * Local character profile this listing was published FROM (upload-copy
   * linkage — powers `getListingForProfile` / `isChatLocked`). Fixture
   * listings are remote previews and are always null.
   */
  sourceProfileId?: string | null;
}

const listings = new Map<string, ListingRecord>();
const ownedListingIds = new Set<string>();
const contentAssets = new Map<string, ContentAsset>();
const library = new Map<string, OwnedLibraryEntry>();

/**
 * Profile → listing index (upload-copy linkage). Maintained on insert: a
 * sourceProfileId maps to the LATEST listing published from it (re-publishing
 * the same character replaces the mapping — one live listing per profile).
 */
const sourceProfileIndex = new Map<string, string>();

// ── Seeding / reset ──────────────────────────────────────────────────────

function reseed(): void {
  listings.clear();
  ownedListingIds.clear();
  contentAssets.clear();
  library.clear();
  sourceProfileIndex.clear();

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
      kind: seed.kind ?? 'character_card',
      text: seed.text ?? null,
      previewText: seed.previewText ?? null,
      previewImageData: seed.previewImageData ?? null,
      previewMimeType: seed.previewMimeType ?? null,
      sourceProfileId: seed.sourceProfileId ?? null,
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
 * the status). The `kind` / `text` payload is stored as-is; when the draft
 * was published FROM a local character profile, `sourceProfileId` links the
 * listing back to it (see `sourceProfileIndex`). Honest failure: rolls the
 * seeded transient failure and throws 503 when it hits.
 */
export async function insertListing(input: {
  title: string;
  description: string;
  priceSouls: number;
  tags: string[];
  snapshot: CharacterSnapshot;
  kind: 'character_card' | 'text' | 'theme';
  text: string | null;
  previewText: string | null;
  sourceProfileId: string | null;
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
    kind: input.kind,
    text: input.text,
    previewText: input.previewText,
    previewImageData: null,
    previewMimeType: null,
    sourceProfileId: input.sourceProfileId,
  };
  listings.set(record.id, record);
  if (record.sourceProfileId) {
    sourceProfileIndex.set(record.sourceProfileId, record.id);
  }
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
 * Idempotent — re-acquiring an owned listing returns the EXISTING library
 * entry (no second debit, no duplicate entry). Returns the delivered entry so
 * the service can expose deep-link ids (deliveredEntryId / deliveredAssetId).
 */
export async function acquireListingRecord(listingId: string): Promise<OwnedLibraryEntry> {
  await simulateLatency();
  const record = listings.get(listingId);
  if (!record) {
    throw new MarketplaceError(404, `listing not found: ${listingId}`, { code: 'not_found' });
  }
  const existing = [...library.values()].find(e => e.listingId === listingId);
  if (existing) {
    return existing;
  }
  ownedListingIds.add(listingId);
  record.salesCount += 1;
  const entry = libraryEntryFor(record, 'purchase');
  contentAssets.set(entry.asset.id, entry.asset);
  library.set(entry.id, entry);
  return entry;
}

// ── Listing management (owner-only) ─────────────────────────────────────

/**
 * Apply owner-only edits to a listing (title/description/price/tags/preview).
 * The listing's status is NEVER changed by an update. Honest failure: rolls
 * the seeded transient failure (same ~10% as delist) and throws 503 when it
 * hits — the store is left untouched on failure.
 *
 * @throws {MarketplaceError} 404 `not_found` | 403 `forbidden` (not the
 *   current user's listing) | 503 `stub_backend_unavailable`.
 */
export async function updateListingRecord(
  id: string,
  changes: {
    title?: string;
    description?: string;
    priceSouls?: number;
    tags?: string[];
    previewText?: string | null;
  },
): Promise<ListingRecord> {
  await simulateLatency();
  const record = listings.get(id);
  if (!record) {
    throw new MarketplaceError(404, `listing not found: ${id}`, { code: 'not_found' });
  }
  if (record.creatorUserId !== CURRENT_USER_ID) {
    throw new MarketplaceError(403, 'you do not own this listing', { code: 'forbidden' });
  }
  if (simulateTransientFailure(`update:${id}`, UPDATE_TRANSIENT_FAIL_RATE)) {
    throw new MarketplaceError(
      503,
      'marketplace backend temporarily unavailable',
      { code: 'stub_backend_unavailable' },
    );
  }
  if (changes.title !== undefined) record.title = changes.title;
  if (changes.description !== undefined) record.description = changes.description;
  if (changes.priceSouls !== undefined) record.priceSouls = changes.priceSouls;
  if (changes.tags !== undefined) record.tags = [...changes.tags];
  if (changes.previewText !== undefined) record.previewText = changes.previewText;
  return record;
}

/**
 * Re-list a removed listing (soft-undelete → status `active`). ONLY
 * `removed` → `active` is allowed — pending and active listings cannot be
 * re-listed. Honest failure: rolls the seeded transient failure and throws
 * 503 when it hits.
 *
 * @throws {MarketplaceError} 404 `not_found` | 403 `forbidden` |
 *   409 `listing_not_available` (not `removed`) | 503.
 */
export async function relistListingRecord(id: string): Promise<ListingRecord> {
  await simulateLatency();
  const record = listings.get(id);
  if (!record) {
    throw new MarketplaceError(404, `listing not found: ${id}`, { code: 'not_found' });
  }
  if (record.creatorUserId !== CURRENT_USER_ID) {
    throw new MarketplaceError(403, 'you do not own this listing', { code: 'forbidden' });
  }
  if (record.status !== 'removed') {
    throw new MarketplaceError(
      409,
      `listing cannot be re-listed (status: ${record.status})`,
      { code: 'listing_not_available' },
    );
  }
  if (simulateTransientFailure(`relist:${id}`, RELIST_TRANSIENT_FAIL_RATE)) {
    throw new MarketplaceError(
      503,
      'marketplace backend temporarily unavailable',
      { code: 'stub_backend_unavailable' },
    );
  }
  record.status = 'active';
  return record;
}

/**
 * Remove an entry from the user's library and REVOKE ownership of its
 * listing (the listing can then be acquired again). The delivered content
 * asset is removed with the entry.
 * @throws {MarketplaceError} 404 `not_found` when the entry id is unknown.
 */
export async function removeLibraryEntryRecord(entryId: string): Promise<void> {
  await simulateLatency();
  const entry = library.get(entryId);
  if (!entry) {
    throw new MarketplaceError(404, `library entry not found: ${entryId}`, { code: 'not_found' });
  }
  library.delete(entryId);
  contentAssets.delete(entry.asset.id);
  ownedListingIds.delete(entry.listingId);
}

// ── Profile → listing linkage (chat-lock semantics) ─────────────────────

/**
 * The ACTIVE listing published from a local character profile, or null when
 * the profile has no live listing (unknown profile / pending / removed all
 * resolve to null — pending/removed listings never surface as live).
 */
export async function getListingForProfileRecord(
  profileId: string,
): Promise<ListingRecord | null> {
  await simulateLatency();
  const listingId = sourceProfileIndex.get(profileId);
  if (!listingId) return null;
  const record = listings.get(listingId);
  if (!record || record.status !== 'active') return null;
  return record;
}

/**
 * Chat-lock rule for a listing record: the character is VIEWABLE for free but
 * CHAT is locked (preview context) when the listing is `active`, was
 * published FROM a local profile (`sourceProfileId`), is NOT the local user's
 * own listing, and is NOT owned (in the library). Pending/removed listings
 * never lock. Synchronous pure helper (the store read happens in
 * `getListingForProfileRecord`).
 */
export function isChatLockedByRecord(record: ListingRecord): boolean {
  return (
    !!record.sourceProfileId &&
    record.status === 'active' &&
    record.creatorUserId !== CURRENT_USER_ID &&
    !ownedListingIds.has(record.id)
  );
}

/**
 * Test-only seeding hook for the chat-lock matrix: the public publish API
 * always creates LOCAL listings (creatorUserId === CURRENT_USER_ID), so a
 * foreign-creator listing with a `sourceProfileId` can only exist through a
 * fixture or this hook. Never used by production code paths.
 */
export function __seedForeignListingForTest(input: {
  id: string;
  title: string;
  sourceProfileId: string;
  status?: ListingRecord['status'];
  creatorName?: string;
  priceSouls?: number;
  salesCount?: number;
}): void {
  const creatorName = input.creatorName ?? 'Foreign Creator';
  const record: ListingRecord = {
    id: input.id,
    title: input.title,
    creatorUserId: `user-${creatorName.toLowerCase().replace(/[^a-z]/g, '-')}`,
    creatorName,
    priceSouls: input.priceSouls ?? 0,
    status: input.status ?? 'active',
    createdAt: new Date().toISOString(),
    description: `Test listing: ${input.title}.`,
    tags: [],
    snapshot: {
      name: input.title,
      description: null,
      personality: null,
      base_prompt: null,
      scenario: null,
      mes_example: null,
      voice_characteristics: null,
      typing_speed_wpm: null,
      audio_response_chance_percent: null,
      image_data: null,
      image_mime: null,
    },
    salesCount: input.salesCount ?? 0,
    kind: 'character_card',
    sourceProfileId: input.sourceProfileId,
  };
  listings.set(record.id, record);
  sourceProfileIndex.set(input.sourceProfileId, record.id);
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

/**
 * Derive the content asset for a listing (upload-copy of its payload).
 * `character_card` listings deliver the frozen card snapshot; `text` / `theme`
 * listings deliver their `text` payload instead (a theme stores its
 * label/description in `text` — the asset kind is `theme`, the body is the
 * theme payload).
 */
function assetFromListing(record: ListingRecord): ContentAsset {
  const base = {
    id: `asset-${record.id}`,
    title: record.title,
    thumbnailText: record.thumbnailText ?? null,
    createdAt: record.createdAt,
  };
  if (record.kind === 'character_card') {
    return {
      ...base,
      kind: 'character_card',
      snapshot: { ...record.snapshot },
    };
  }
  return {
    ...base,
    kind: record.kind,
    text: record.text ?? null,
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