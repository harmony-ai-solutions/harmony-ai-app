/**
 * Marketplace + SOUL Wallet Repository — client-only commerce layer.
 *
 * Everything here is stored in CLIENT-ONLY sidecar tables (never synced to the
 * engine — strict schema parity, see docs/schema-parity.md), mirroring the
 * `character_favorites` / `character_profile_sources` / `character_creators`
 * pattern:
 *
 *   character_marketplace_listings — AI characters listed for sale on the
 *       Market screen. Presence + visibility='marketplace' is what makes a
 *       character appear there. price_souls is the creator's asking price.
 *   soul_wallet                   — the local user's SOUL balance (spendable
 *       + earned). Single-row table (id=1), survives app restarts.
 *   soul_purchases                — AI characters the local user bought. A
 *       purchase grants permanent chat access to a marketplace character.
 *
 * A profile with no listing row simply means "not for sale".
 */

import { getDatabase } from '../connection';
import { withTransaction } from '../transaction';
import { generateId } from '../../utils/uuid';
import { getCharacterProfile, getCharacterProfileVisibility } from './characters';
import { getCharacterCreator } from './characterSocial';
import {
  getSoulBalance,
  hasClaimedSignupBonus,
  claimSignupBonus,
  creditSouls,
  debitSouls,
} from './soulWallet';
import type { CharacterProfile } from '../models';

// Backward-compatible re-exports — wallet functions now live in soulWallet.ts
export {
  getSoulBalance,
  hasClaimedSignupBonus,
  claimSignupBonus,
  creditSouls,
  debitSouls,
};

// ============================================================================
// Types
// ============================================================================

export interface MarketplaceListing {
  profileId: string;
  priceSouls: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface MarketplaceListingWithProfile extends MarketplaceListing {
  profile: CharacterProfile;
}

export interface SoulPurchase {
  id: string;
  profileId: string;
  priceSouls: number;
  purchasedAt: Date;
}

export type PurchaseResult =
  | { ok: true; balance: number; purchase: SoulPurchase }
  | { ok: false; reason: 'insufficient_balance' | 'already_purchased' | 'not_listed' | 'owner' };

const WALLET_ROW_ID = 1;

// ============================================================================
// Marketplace Listings
// ============================================================================

/**
 * True when a character profile is listed on the marketplace.
 */
export async function isMarketplaceListed(profileId: string): Promise<boolean> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    'SELECT 1 FROM character_marketplace_listings WHERE profile_id = ?',
    [profileId],
  );
  return results.rows.length > 0;
}

/**
 * Get the marketplace listing for a profile, or null when not listed.
 */
export async function getMarketplaceListing(
  profileId: string,
): Promise<MarketplaceListing | null> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    `SELECT profile_id, price_souls, created_at, updated_at
     FROM character_marketplace_listings WHERE profile_id = ?`,
    [profileId],
  );
  if (results.rows.length === 0) return null;
  const row = results.rows.item(0);
  return {
    profileId: row.profile_id,
    priceSouls: Number(row.price_souls),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Upsert a marketplace listing for a profile (idempotent — re-listing updates
 * the price). Setting the visibility to 'marketplace' is the caller's job
 * (setCharacterProfileVisibility); this function only manages the price row.
 */
export async function upsertMarketplaceListing(
  profileId: string,
  priceSouls: number,
): Promise<void> {
  const db = getDatabase();
  const price = Math.max(0, Number(priceSouls) || 0);
  const now = new Date().toISOString();
  await db.executeSql(
    `INSERT INTO character_marketplace_listings (profile_id, price_souls, created_at, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(profile_id) DO UPDATE SET
       price_souls = excluded.price_souls,
       updated_at = excluded.updated_at`,
    [profileId, price, now, now],
  );
}

/**
 * Remove a marketplace listing (keeps the profile itself intact).
 */
export async function removeMarketplaceListing(profileId: string): Promise<void> {
  const db = getDatabase();
  await db.executeSql(
    'DELETE FROM character_marketplace_listings WHERE profile_id = ?',
    [profileId],
  );
}

/**
 * All marketplace-listed, non-deleted character profiles with their prices,
 * ordered by name. Requires BOTH a listing row AND visibility='marketplace'.
 */
export async function getMarketplaceCharacterProfiles(): Promise<
  MarketplaceListingWithProfile[]
> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    `SELECT ml.profile_id, ml.price_souls, ml.created_at, ml.updated_at
     FROM character_marketplace_listings ml
     INNER JOIN character_profiles cp ON cp.id = ml.profile_id
     LEFT JOIN character_profile_sources cps ON cps.profile_id = cp.id
     WHERE cp.deleted_at IS NULL
       AND (cps.visibility = 'marketplace')
     ORDER BY cp.name ASC`,
  );

  const listings: MarketplaceListingWithProfile[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    const profile = await getCharacterProfile(row.profile_id);
    if (!profile) continue;
    listings.push({
      profileId: row.profile_id,
      priceSouls: Number(row.price_souls),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      profile,
    });
  }
  return listings;
}

// ============================================================================
// Purchases
// ============================================================================

/**
 * True when the local user has already purchased this character (grants chat
 * access to marketplace items).
 */
export async function hasPurchased(profileId: string): Promise<boolean> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    'SELECT 1 FROM soul_purchases WHERE profile_id = ?',
    [profileId],
  );
  return results.rows.length > 0;
}

/**
 * All purchases, most-recent first.
 */
export async function getSoulPurchases(): Promise<SoulPurchase[]> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    'SELECT id, profile_id, price_souls, purchased_at FROM soul_purchases ORDER BY purchased_at DESC',
  );
  const purchases: SoulPurchase[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    purchases.push({
      id: row.id,
      profileId: row.profile_id,
      priceSouls: Number(row.price_souls),
      purchasedAt: new Date(row.purchased_at),
    });
  }
  return purchases;
}

/**
 * Buy a marketplace character. Debits the wallet, records the purchase, and —
 * because the creator of a purchased item may be the same install in a
 * single-device setup — credits nothing to the buyer (the funds move to the
 * creator's own wallet by crediting the creator side when they own the item,
 * which the UI handles separately). Returns the result.
 *
 * Guards:
 *   - already purchased → no double charge
 *   - not listed / not marketplace → reject
 *   - insufficient balance → reject
 */
export async function purchaseCharacter(
  profileId: string,
): Promise<PurchaseResult> {
  const listing = await getMarketplaceListing(profileId);
  if (!listing) {
    return { ok: false, reason: 'not_listed' };
  }
  if (await hasPurchased(profileId)) {
    return { ok: false, reason: 'already_purchased' };
  }

  const price = listing.priceSouls;
  const balance = await getSoulBalance();
  if (balance < price) {
    return { ok: false, reason: 'insufficient_balance' };
  }

  const db = getDatabase();
  const id = generateId();
  const now = new Date();

  try {
    await withTransaction(db, async tx => {
      // Debit the wallet
      await tx.executeSql(
        `UPDATE soul_wallet SET balance = balance - ?, updated_at = ?
         WHERE id = ?`,
        [price, now.toISOString(), WALLET_ROW_ID],
      );
      // Record the purchase
      await tx.executeSql(
        `INSERT INTO soul_purchases (id, profile_id, price_souls, purchased_at)
         VALUES (?, ?, ?, ?)`,
        [id, profileId, price, now.toISOString()],
      );
    });
  } catch (err) {
    // Race with another purchase — already_purchased wins, or rethrow.
    if (await hasPurchased(profileId)) {
      return { ok: false, reason: 'already_purchased' };
    }
    throw err;
  }

  const purchase: SoulPurchase = {
    id,
    profileId,
    priceSouls: price,
    purchasedAt: now,
  };
  return { ok: true, balance: balance - price, purchase };
}

// ============================================================================
// Access helper — can this local user chat with this profile?
// ============================================================================

/**
 * Determine whether the current local user can chat with a character profile:
 *   - the user owns it (source 'user' or is the recorded creator) → yes
 *   - the profile is NOT marketplace-listed → yes (public or private)
 *   - the profile IS marketplace-listed and the user purchased it → yes
 *   - otherwise (marketplace, not purchased, not owner) → no (paywall)
 */
export async function canChatWithCharacter(
  profileId: string,
  currentUserId?: string | null,
): Promise<boolean> {
  const visibility = await getCharacterProfileVisibility(profileId);
  if (visibility !== 'marketplace') {
    return true;
  }

  // Owner bypass
  if (currentUserId) {
    try {
      const creator = await getCharacterCreator(profileId);
      if (creator && creator.creatorUserId === currentUserId) {
        return true;
      }
    } catch {
      // fall through
    }
  }

  // Purchased bypass
  if (await hasPurchased(profileId)) {
    return true;
  }

  return false;
}

// ============================================================================
// Generic marketplace cache (account-backed marketplace)
// ============================================================================

/**
 * What can be listed for sale (or given away free). Mirrors the backend enum.
 */
export type MarketplaceItemType =
  | 'character'
  | 'backstory'
  | 'description'
  | 'personality'
  | 'prompt'
  | 'dialogue'
  | 'theme';

export interface CachedListing {
  id: string;
  itemType: MarketplaceItemType;
  title: string;
  summary: string | null;
  tags: string[];
  priceSouls: number;
  status: 'active' | 'delisted';
  salesCount: number;
  sellerUserId: string | null;
  previewText: string | null;
  previewImageData: string | null;
  previewMimeType: string | null;
  payloadJson: unknown;
  cachedAt: Date;
  updatedAt: Date;
}

export interface OwnedAsset {
  id: string;
  listingId: string;
  itemType: MarketplaceItemType;
  title: string;
  assetJson: unknown;
  kind: 'purchase' | 'free' | 'own';
  acquiredAt: Date;
  imageData: string | null;
  imageMime: string | null;
}

/**
 * Upsert a catalog listing row from an API DTO (or a migration).
 */
export async function cacheListing(dto: {
  id: string;
  itemType: MarketplaceItemType;
  title: string;
  summary?: string | null;
  tags?: string[];
  priceSouls: number;
  status?: 'active' | 'delisted';
  salesCount?: number;
  sellerUserId?: string | null;
  previewText?: string | null;
  previewImageData?: string | null;
  previewMimeType?: string | null;
  payloadJson: unknown;
}): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString();
  await db.executeSql(
    `INSERT INTO marketplace_listings_cache
       (id, item_type, title, summary, tags, price_souls, status, sales_count,
        seller_user_id, preview_text, preview_image_data, preview_mime_type,
        payload_json, cached_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       item_type = excluded.item_type,
       title = excluded.title,
       summary = excluded.summary,
       tags = excluded.tags,
       price_souls = excluded.price_souls,
       status = excluded.status,
       sales_count = excluded.sales_count,
       seller_user_id = excluded.seller_user_id,
       preview_text = excluded.preview_text,
       preview_image_data = excluded.preview_image_data,
       preview_mime_type = excluded.preview_mime_type,
       payload_json = excluded.payload_json,
       updated_at = excluded.updated_at`,
    [
      dto.id,
      dto.itemType,
      dto.title,
      dto.summary ?? null,
      dto.tags ? JSON.stringify(dto.tags) : null,
      dto.priceSouls,
      dto.status ?? 'active',
      dto.salesCount ?? 0,
      dto.sellerUserId ?? null,
      dto.previewText ?? null,
      dto.previewImageData ?? null,
      dto.previewMimeType ?? null,
      JSON.stringify(dto.payloadJson ?? null),
      now,
      now,
    ],
  );
}

function rowToCachedListing(row: any): CachedListing {
  let tags: string[] = [];
  try {
    const parsed = JSON.parse(row.tags || '[]');
    if (Array.isArray(parsed)) tags = parsed.filter((t): t is string => typeof t === 'string');
  } catch {
    // ignore malformed tags
  }
  return {
    id: row.id,
    itemType: row.item_type as MarketplaceItemType,
    title: row.title,
    summary: row.summary ?? null,
    tags,
    priceSouls: Number(row.price_souls),
    status: row.status as 'active' | 'delisted',
    salesCount: Number(row.sales_count),
    sellerUserId: row.seller_user_id ?? null,
    previewText: row.preview_text ?? null,
    previewImageData: row.preview_image_data ?? null,
    previewMimeType: row.preview_mime_type ?? null,
    payloadJson: JSON.parse(row.payload_json || 'null'),
    cachedAt: new Date(row.cached_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Offline browse of the cached catalog. Filters by type, free-only, and a
 * text query across title/summary/tags.
 */
export async function getCachedListings(opts?: {
  itemType?: MarketplaceItemType | 'free';
  freeOnly?: boolean;
  query?: string;
}): Promise<CachedListing[]> {
  const db = getDatabase();
  const clauses: string[] = ["status = 'active'"];
  const params: string[] = [];
  if (opts?.itemType && opts.itemType !== 'free') {
    clauses.push('item_type = ?');
    params.push(opts.itemType);
  }
  if (opts?.freeOnly || opts?.itemType === 'free') {
    clauses.push('price_souls = 0');
  }
  if (opts?.query?.trim()) {
    clauses.push(`(title LIKE ? OR summary LIKE ? OR tags LIKE ?)`);
    const like = `%${opts.query.trim()}%`;
    params.push(like, like, like);
  }
  const [results] = await db.executeSql(
    `SELECT * FROM marketplace_listings_cache
     WHERE ${clauses.join(' AND ')}
     ORDER BY updated_at DESC`,
    params,
  );
  const out: CachedListing[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    out.push(rowToCachedListing(results.rows.item(i)));
  }
  return out;
}

/**
 * Get a single cached listing by id (null when not present).
 */
export async function getCachedListing(id: string): Promise<CachedListing | null> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    'SELECT * FROM marketplace_listings_cache WHERE id = ?',
    [id],
  );
  if (results.rows.length === 0) return null;
  return rowToCachedListing(results.rows.item(0));
}

/**
 * The current user's locally-published listings (cached from a local publish
 * fallback or previously synced mine data), newest first. Includes both
 * active and delisted so My Listings can show the full set.
 */
export async function getCachedMyListings(
  sellerUserId: string,
): Promise<CachedListing[]> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    `SELECT * FROM marketplace_listings_cache
     WHERE seller_user_id = ?
     ORDER BY updated_at DESC`,
    [sellerUserId],
  );
  const out: CachedListing[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    out.push(rowToCachedListing(results.rows.item(i)));
  }
  return out;
}

/**
 * Update the status of a cached listing (delist / re-list). No-op when the
 * listing doesn't exist locally.
 */
export async function setCachedListingStatus(
  listingId: string,
  status: 'active' | 'delisted',
): Promise<void> {
  const db = getDatabase();
  await db.executeSql(
    `UPDATE marketplace_listings_cache
     SET status = ?, updated_at = ?
     WHERE id = ?`,
    [status, new Date().toISOString(), listingId],
  );
}

/**
 * Store an owned asset (purchase / free / own) locally. Idempotent — an
 * existing row for the same listing is updated rather than duplicated.
 */
export async function saveOwnedAsset(asset: {
  id: string;
  listingId: string;
  itemType: MarketplaceItemType;
  title: string;
  assetJson: unknown;
  kind: 'purchase' | 'free' | 'own';
  imageData?: string | null;
  imageMime?: string | null;
}): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString();
  await db.executeSql(
    `INSERT INTO marketplace_ownership_cache
       (id, listing_id, item_type, title, asset_json, kind, acquired_at, image_data, image_mime)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       item_type = excluded.item_type,
       title = excluded.title,
       asset_json = excluded.asset_json,
       kind = excluded.kind`,
    [
      asset.id,
      asset.listingId,
      asset.itemType,
      asset.title,
      JSON.stringify(asset.assetJson ?? null),
      asset.kind,
      now,
      asset.imageData ?? null,
      asset.imageMime ?? null,
    ],
  );
}

/**
 * Everything the local user has acquired (purchases + free + own).
 */
export async function getOwnedAssets(): Promise<OwnedAsset[]> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    `SELECT * FROM marketplace_ownership_cache ORDER BY acquired_at DESC`,
  );
  const out: OwnedAsset[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    out.push({
      id: row.id,
      listingId: row.listing_id,
      itemType: row.item_type as MarketplaceItemType,
      title: row.title,
      assetJson: JSON.parse(row.asset_json || 'null'),
      kind: row.kind as 'purchase' | 'free' | 'own',
      acquiredAt: new Date(row.acquired_at),
      imageData: row.image_data ?? null,
      imageMime: row.image_mime ?? null,
    });
  }
  return out;
}

/**
 * True when the local user owns an asset for a given listing id.
 */
export async function hasOwnedAsset(listingId: string): Promise<boolean> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    'SELECT 1 FROM marketplace_ownership_cache WHERE listing_id = ?',
    [listingId],
  );
  return results.rows.length > 0;
}

/**
 * Clear all cached catalog + ownership + library data (e.g. on logout /
 * account switch). Keeps the wallet intact — the balance is re-fetched on
 * the next login.
 */
export async function clearMarketplaceCache(): Promise<void> {
  const db = getDatabase();
  await db.executeSql('DELETE FROM content_library');
  await db.executeSql('DELETE FROM marketplace_ownership_cache');
  await db.executeSql('DELETE FROM marketplace_listings_cache');
}

export default {
  isMarketplaceListed,
  getMarketplaceListing,
  upsertMarketplaceListing,
  removeMarketplaceListing,
  getMarketplaceCharacterProfiles,
  getSoulBalance,
  hasClaimedSignupBonus,
  claimSignupBonus,
  creditSouls,
  debitSouls,
  hasPurchased,
  getSoulPurchases,
  purchaseCharacter,
  canChatWithCharacter,
  cacheListing,
  getCachedListings,
  getCachedListing,
  getCachedMyListings,
  setCachedListingStatus,
  saveOwnedAsset,
  getOwnedAssets,
  hasOwnedAsset,
  clearMarketplaceCache,
};
