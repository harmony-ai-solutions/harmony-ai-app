/**
 * MarketplaceService — app-facing typed API over the in-memory marketplace stub.
 *
 * This is the ONLY module the marketplace screens import (the swap seam for
 * the future real backend). It replaces the doomed SQLite sidecar repos
 * (marketplace cache, ownership cache, content library) with an in-memory stub
 * store — no persistence, no local character/profile access.
 *
 * Key design decisions:
 *   - **Module-level functions** (like the repos it replaces), every method
 *     resolving after ~300 ms artificial latency from the stub backend.
 *   - **Publishing = upload-copy** (A4 ruling): `publishListing` sends a
 *     frozen `cardSnapshot` to the backend store; the local character and its
 *     card are NEVER touched. New listings enter `pending` (moderation).
 *   - **Honest errors**: listings throw `MarketplaceError` (404 not_found,
 *     409 listing_not_available, 503 backend-unavailable); `acquire` throws
 *     `InsufficientCreditsError` (a 402 quota_exceeded MarketplaceError with
 *     the remaining balance) when the wallet is short. No fake success.
 *   - **Types are REST-shaped** and documented for the future backend concept
 *     (Phase 9); they pre-match the `soulbits-api-client` error/subscription
 *     wire shapes where the client already anticipates them.
 */

import { createLogger } from '../../utils/logger';
import * as marketplaceBackend from './marketplaceStubBackend';
import { walletService } from '../wallet/WalletService';
import { InsufficientCreditsError, MarketplaceError } from '../stub/StubServiceError';
import type { ListingRecord } from './marketplaceStubBackend';

const log = createLogger('[Marketplace]');

// ── Types (REST-shaped, documented for the future backend) ───────────────

/**
 * Frozen character-card payload stored with a listing at publish time.
 * Mirrors the profile columns it snapshots (name/description/personality/
 * base_prompt/scenario/mes_example/voice_characteristics/typing_speed_wpm/
 * audio_response_chance_percent/image_data/image_mime), nullable as
 * appropriate. Defined here (NOT in the snapshot module that was deleted in
 * Phase 2) and structurally identical to the fixture seed shape.
 */
export interface CharacterSnapshot {
  name: string;
  description: string | null;
  personality: string | null;
  base_prompt: string | null;
  scenario: string | null;
  mes_example: string | null;
  voice_characteristics: string | null;
  typing_speed_wpm: number | null;
  audio_response_chance_percent: number | null;
  image_data: string | null;
  image_mime: string | null;
}

export type MarketplaceListingStatus = 'active' | 'pending' | 'removed';

/** Public market-feed card (the wire summary shape). */
export interface MarketplaceListingSummary {
  id: string;
  title: string;
  creatorName: string;
  creatorAvatarText?: string;
  priceSouls: number;
  thumbnailText?: string;
  status: MarketplaceListingStatus;
  /** Internal popularity counter — drives the 'popular' sort. */
  salesCount: number;
  /** ISO 8601 timestamp. */
  createdAt: string;
}

/**
 * Full listing detail (summary + description, tags and frozen snapshot).
 * Preview fields are detail-only: they render the "preview context" screen
 * (image + teaser + unlock hint) before a paid listing is acquired — the feed
 * card never carries them.
 */
export interface MarketplaceListingDetail extends MarketplaceListingSummary {
  description: string;
  tags: string[];
  snapshot: CharacterSnapshot;
  /** Asset family — mirrors the publish draft's `kind` (defaults to 'character_card'). */
  kind?: 'character_card' | 'text' | 'theme';
  /** Detail-screen teaser (preview context shown before acquisition). */
  previewText?: string | null;
  /** Base64 preview image (rendered only when present). */
  previewImageData?: string | null;
  /** MIME type of `previewImageData`. */
  previewMimeType?: string | null;
}

/** Query options for the public feed. */
export interface MarketplaceListingQuery {
  search?: string;
  sort?: 'recent' | 'price' | 'popular';
}

/**
 * Draft payload for publishing (upload-copy: the caller supplies the frozen
 * card). `kind` selects the delivered asset family ('character_card' default):
 * character listings deliver the frozen card; text/theme listings carry their
 * body in `text` and deliver a `text`/`theme` asset instead of the card.
 */
export interface PublishListingDraft {
  title: string;
  description: string;
  priceSouls: number;
  tags?: string[];
  cardSnapshot: CharacterSnapshot;
  /** Asset family — defaults to 'character_card'. */
  kind?: 'character_card' | 'text' | 'theme';
  /** Plain-text payload — REQUIRED for kind 'text' / 'theme'. */
  text?: string | null;
  /** Detail-screen teaser (preview context shown before acquisition). */
  previewText?: string | null;
  /** Local character profile this listing is published FROM (chat-lock linkage). */
  sourceProfileId?: string | null;
}

/** Owner-only listing edits (updateListing). */
export interface ListingUpdateChanges {
  title?: string;
  description?: string;
  priceSouls?: number;
  tags?: string[];
  /** Pass null to clear the teaser. */
  previewText?: string | null;
}

/**
 * Result of a successful acquisition (throws MarketplaceError on failure).
 * `deliveredEntryId` / `deliveredAssetId` let the UI deep-link into MyLibrary
 * right after acquiring (the library entry + its content asset ids).
 */
export interface AcquireResult {
  ok: true;
  listingId: string;
  /** Library entry id of the delivered asset. */
  deliveredEntryId?: string;
  /** Content-asset id inside the delivered library entry. */
  deliveredAssetId?: string;
}

/**
 * A delivered asset in the user's library (replaces contentLibrary repo +
 * marketplace ownership cache). REST-shaped for the future backend.
 */
export interface ContentAsset {
  id: string;
  title: string;
  /** Asset family — determines which payload field is populated. */
  kind: 'character_card' | 'text' | 'theme';
  /** Frozen character-card payload (kind === 'character_card'). */
  snapshot?: CharacterSnapshot | null;
  /** Plain-text payload (kind === 'text'). */
  text?: string | null;
  thumbnailText?: string | null;
  /** ISO 8601 timestamp. */
  createdAt: string;
}

/** One entry in the user's library (how the asset was obtained + the asset). */
export interface OwnedLibraryEntry {
  /** Library entry id (unique per acquired asset). */
  id: string;
  /** The marketplace listing this entry came from. */
  listingId: string;
  title: string;
  /** How the entry was obtained. */
  kind: 'purchase' | 'free' | 'own';
  /** ISO 8601 timestamp. */
  acquiredAt: string;
  /** The delivered content asset (frozen at acquire time). */
  asset: ContentAsset;
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * The public market feed — active listings only, newest first by default.
 * Supports a case-insensitive text search over title/creator/description/tags
 * and a sort key (`recent` default | `price` | `popular`).
 */
export async function getListings(
  query?: MarketplaceListingQuery,
): Promise<MarketplaceListingSummary[]> {
  let records = await marketplaceBackend.listListings();

  const search = query?.search?.trim().toLowerCase();
  if (search) {
    records = records.filter(
      r =>
        r.title.toLowerCase().includes(search) ||
        r.creatorName.toLowerCase().includes(search) ||
        r.description.toLowerCase().includes(search) ||
        r.tags.some(t => t.toLowerCase().includes(search)),
    );
  }

  switch (query?.sort) {
    case 'price':
      records = [...records].sort((a, b) => a.priceSouls - b.priceSouls);
      break;
    case 'popular':
      records = [...records].sort((a, b) => b.salesCount - a.salesCount);
      break;
    case 'recent':
    default:
      records = [...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      break;
  }

  return records.map(toSummary);
}

/**
 * Full listing detail by id (any status — the public feed only surfaces
 * `active`, but a deep link may reference a pending/removed listing).
 * @throws {MarketplaceError} 404 `not_found` when the id is unknown.
 */
export async function getListing(id: string): Promise<MarketplaceListingDetail> {
  const record = await marketplaceBackend.getListingRecord(id);
  return toDetail(record);
}

/**
 * Publish a listing — upload-copy semantics (A4): the supplied `cardSnapshot`
 * is frozen into the stub store; the local character/profile is NEVER touched.
 * New listings enter `pending` (moderation review). `kind` selects the
 * delivered asset family; text/theme listings require a non-empty `text`
 * payload. When the draft was published FROM a local character profile, pass
 * `sourceProfileId` so the profile→listing linkage (chat-lock) works.
 *
 * @throws {MarketplaceError} 400 `invalid_draft` for an empty title, a
 *   negative/non-finite price, or a text/theme listing without `text`;
 *   503 `stub_backend_unavailable` when the simulated backend op fails
 *   (honest failure — no fake success).
 */
export async function publishListing(
  draft: PublishListingDraft,
): Promise<MarketplaceListingSummary> {
  const title = draft.title.trim();
  if (!title) {
    throw new MarketplaceError(400, 'listing title is required', { code: 'invalid_draft' });
  }
  if (!Number.isFinite(draft.priceSouls) || draft.priceSouls < 0) {
    throw new MarketplaceError(400, 'listing price must be a non-negative number of souls', {
      code: 'invalid_draft',
    });
  }
  const kind = draft.kind ?? 'character_card';
  if (kind !== 'character_card' && !(draft.text ?? '').trim()) {
    throw new MarketplaceError(
      400,
      'text/theme listings require a non-empty text payload',
      { code: 'invalid_draft' },
    );
  }

  const record = await marketplaceBackend.insertListing({
    title,
    description: draft.description.trim(),
    priceSouls: draft.priceSouls,
    tags: draft.tags ?? [],
    snapshot: draft.cardSnapshot,
    kind,
    text: draft.text ?? null,
    previewText: draft.previewText ?? null,
    sourceProfileId: draft.sourceProfileId ?? null,
  });
  log.info(`Published listing "${record.title}" (${record.id}) — pending review`);
  return toSummary(record);
}

/**
 * Delist one of the marketplace listings (soft-delete → `removed`).
 * Honest failure: when the simulated backend op fails, THROW (503) — the
 * listing stays active and the caller can retry. Never fake success.
 *
 * @throws {MarketplaceError} 404 `not_found` | 503 `stub_backend_unavailable`.
 */
export async function delistListing(id: string): Promise<void> {
  await marketplaceBackend.delistListingRecord(id);
  log.info(`Delisted listing ${id}`);
}

/**
 * Owner-only listing edit (title/description/price/tags/previewText). The
 * listing's status is NEVER changed by an update. Validation mirrors publish
 * (title required, price non-negative).
 *
 * @throws {MarketplaceError} 400 `invalid_draft` | 403 `forbidden` (not the
 *   current user's listing) | 404 `not_found` | 503.
 */
export async function updateListing(
  id: string,
  changes: ListingUpdateChanges,
): Promise<MarketplaceListingDetail> {
  if (changes.title !== undefined && !changes.title.trim()) {
    throw new MarketplaceError(400, 'listing title is required', { code: 'invalid_draft' });
  }
  if (
    changes.priceSouls !== undefined &&
    (!Number.isFinite(changes.priceSouls) || changes.priceSouls < 0)
  ) {
    throw new MarketplaceError(400, 'listing price must be a non-negative number of souls', {
      code: 'invalid_draft',
    });
  }

  const record = await marketplaceBackend.updateListingRecord(id, {
    title: changes.title?.trim(),
    description: changes.description?.trim(),
    priceSouls: changes.priceSouls,
    tags: changes.tags ? [...changes.tags] : undefined,
    previewText: changes.previewText,
  });
  log.info(`Updated listing ${id}`);
  return toDetail(record);
}

/**
 * Re-list a removed listing (soft-undelete → `active`). ONLY `removed` →
 * `active` is allowed; any other status throws 409.
 *
 * @throws {MarketplaceError} 403 `forbidden` | 404 `not_found` |
 *   409 `listing_not_available` | 503.
 */
export async function relistListing(id: string): Promise<MarketplaceListingDetail> {
  const record = await marketplaceBackend.relistListingRecord(id);
  log.info(`Relisted listing ${id}`);
  return toDetail(record);
}

/**
 * Remove an entry from the user's library AND revoke ownership of its listing
 * (the listing can then be acquired again).
 *
 * @throws {MarketplaceError} 404 `not_found` when the entry id is unknown.
 */
export async function removeLibraryEntry(entryId: string): Promise<void> {
  await marketplaceBackend.removeLibraryEntryRecord(entryId);
  log.info(`Removed library entry ${entryId}`);
}

/**
 * The ACTIVE listing published from a local character profile (for the price
 * pill / acquire entry on the AI profile), or null when the profile has no
 * live listing. Pending/removed listings never surface here.
 */
export async function getListingForProfile(
  profileId: string,
): Promise<MarketplaceListingDetail | null> {
  const record = await marketplaceBackend.getListingForProfileRecord(profileId);
  return record ? toDetail(record) : null;
}

/**
 * Chat-lock rule being restored: a character published to the marketplace is
 * VIEWABLE for free but CHAT is locked (preview context) until acquired. True
 * when there is an `active` listing published FROM this profile whose creator
 * is not the local user and which is not in the library. Own listings and
 * never-published profiles are never locked; pending/removed listings never
 * lock.
 */
export async function isChatLocked(profileId: string): Promise<boolean> {
  const record = await marketplaceBackend.getListingForProfileRecord(profileId);
  if (!record) return false;
  return marketplaceBackend.isChatLockedByRecord(record);
}

/**
 * Acquire a listing: checks the wallet balance and debits the price, then
 * delivers the asset into the library. Idempotent — re-acquiring an owned
 * listing returns the existing library entry without a second debit. The
 * result carries `deliveredEntryId` / `deliveredAssetId` so screens can
 * deep-link into MyLibrary after a successful acquisition.
 *
 * @throws {MarketplaceError} 404 `not_found` | 409 `listing_not_available`
 *   when the listing is not `active`.
 * @throws {InsufficientCreditsError} 402 `quota_exceeded` when the wallet
 *   balance is below the price (carries `soulCreditsAvailable`).
 */
export async function acquire(listingId: string): Promise<AcquireResult> {
  const record = await marketplaceBackend.getListingRecord(listingId);
  if (record.status !== 'active') {
    throw new MarketplaceError(
      409,
      `listing is not available for acquisition (status: ${record.status})`,
      { code: 'listing_not_available' },
    );
  }

  // Already owned → idempotent, no debit.
  if (await marketplaceBackend.isListingOwned(listingId)) {
    const owned = await marketplaceBackend.acquireListingRecord(listingId);
    return {
      ok: true,
      listingId,
      deliveredEntryId: owned.id,
      deliveredAssetId: owned.asset.id,
    };
  }

  const balance = await walletService.getBalance();
  if (balance < record.priceSouls) {
    throw new InsufficientCreditsError(balance);
  }

  await walletService.debit(record.priceSouls);
  const entry = await marketplaceBackend.acquireListingRecord(listingId);
  log.info(`Acquired "${record.title}" (${listingId}) for ${record.priceSouls} souls`);
  return {
    ok: true,
    listingId,
    deliveredEntryId: entry.id,
    deliveredAssetId: entry.asset.id,
  };
}

/** Listings published by the current user (all statuses, newest first). */
export async function getMyListings(): Promise<MarketplaceListingSummary[]> {
  const records = await marketplaceBackend.getMyListingsRecords();
  return records.map(toSummary);
}

/** The user's owned library (replaces contentLibrary repo + ownership cache). */
export async function getLibrary(): Promise<OwnedLibraryEntry[]> {
  return marketplaceBackend.getLibraryEntries();
}

/**
 * Fetch a content asset by id (ContentAssetScreen's data path).
 * @throws {MarketplaceError} 404 `not_found` when the id is unknown.
 */
export async function getContentAsset(id: string): Promise<ContentAsset> {
  return marketplaceBackend.getContentAssetRecord(id);
}

/**
 * Re-seed the store from fixtures (pull-to-refresh). Runtime mutations
 * (published/delisted listings) are discarded — that IS the point of a refresh.
 */
export async function refresh(): Promise<void> {
  await marketplaceBackend.refreshFromFixtures();
  log.info('Marketplace store re-seeded from fixtures');
}

// ── Helpers ──────────────────────────────────────────────────────────────

function toSummary(record: ListingRecord): MarketplaceListingSummary {
  return {
    id: record.id,
    title: record.title,
    creatorName: record.creatorName,
    creatorAvatarText: record.creatorAvatarText,
    priceSouls: record.priceSouls,
    thumbnailText: record.thumbnailText,
    status: record.status,
    salesCount: record.salesCount,
    createdAt: record.createdAt,
  };
}

/** Full detail mapping (summary + description, tags, snapshot, preview). */
function toDetail(record: ListingRecord): MarketplaceListingDetail {
  return {
    ...toSummary(record),
    description: record.description,
    tags: [...record.tags],
    snapshot: record.snapshot,
    kind: record.kind ?? 'character_card',
    previewText: record.previewText ?? null,
    previewImageData: record.previewImageData ?? null,
    previewMimeType: record.previewMimeType ?? null,
  };
}