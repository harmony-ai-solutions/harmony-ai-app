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
import type { CharacterProfile } from '../models';

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
// SOUL Wallet (local balance)
// ============================================================================

const SIGNUP_BONUS_SOULS = 50;

/**
 * Ensure the single-row wallet exists and return the current balance.
 */
export async function getSoulBalance(): Promise<number> {
  const db = getDatabase();
  await db.executeSql(
    `INSERT OR IGNORE INTO soul_wallet (id, balance, updated_at) VALUES (?, 0, ?)`,
    [WALLET_ROW_ID, new Date().toISOString()],
  );
  const [results] = await db.executeSql(
    'SELECT balance FROM soul_wallet WHERE id = ?',
    [WALLET_ROW_ID],
  );
  if (results.rows.length === 0) return 0;
  return Number(results.rows.item(0).balance);
}

/**
 * True when the one-time signup soul bonus has already been claimed on this
 * install. The flag lives on the single-row wallet, so it survives restarts.
 */
export async function hasClaimedSignupBonus(): Promise<boolean> {
  const db = getDatabase();
  // Ensure the wallet row exists (INSERT OR IGNORE applies the default 0).
  await db.executeSql(
    `INSERT OR IGNORE INTO soul_wallet (id, balance, updated_at) VALUES (?, 0, ?)`,
    [WALLET_ROW_ID, new Date().toISOString()],
  );
  const [results] = await db.executeSql(
    'SELECT signup_bonus_claimed FROM soul_wallet WHERE id = ?',
    [WALLET_ROW_ID],
  );
  if (results.rows.length === 0) return false;
  return Number(results.rows.item(0).signup_bonus_claimed) === 1;
}

/**
 * Claim the one-time first-signup bonus (50 SOUL). Idempotent and atomic:
 * only the FIRST call on an install credits the wallet; every later call is a
 * no-op that returns `{ claimed: false, balance }`. Returns whether this call
 * actually granted the bonus and the resulting balance.
 */
export async function claimSignupBonus(): Promise<{
  claimed: boolean;
  balance: number;
}> {
  const db = getDatabase();
  const now = new Date().toISOString();

  // The transaction's compare-and-set (0 → 1 while crediting) is atomic and
  // serialised by the DB, so concurrent calls can never double-grant. The
  // callback returns whether THIS call performed the credit.
  const granted = await withTransaction(db, async tx => {
    // Ensure the wallet row exists before reading the flag.
    await tx.executeSql(
      `INSERT OR IGNORE INTO soul_wallet (id, balance, updated_at) VALUES (?, 0, ?)`,
      [WALLET_ROW_ID, now],
    );
    // Atomic compare-and-set: only transition 0 → 1 while crediting.
    const [result] = await tx.executeSql(
      `UPDATE soul_wallet
         SET balance = balance + ?,
             signup_bonus_claimed = 1,
             updated_at = ?
       WHERE id = ? AND signup_bonus_claimed = 0`,
      [SIGNUP_BONUS_SOULS, now, WALLET_ROW_ID],
    );
    return result.rowsAffected > 0;
  });

  const balance = await getSoulBalance();
  return { claimed: granted, balance };
}

/**
 * Credit the local wallet (e.g. a marketplace sale proceeds for the creator).
 * Returns the new balance.
 */
export async function creditSouls(amount: number): Promise<number> {
  const db = getDatabase();
  const value = Math.max(0, Number(amount) || 0);
  await db.executeSql(
    `INSERT INTO soul_wallet (id, balance, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       balance = soul_wallet.balance + excluded.balance,
       updated_at = excluded.updated_at`,
    [WALLET_ROW_ID, value, new Date().toISOString()],
  );
  return getSoulBalance();
}

/**
 * Debit the local wallet. Throws when the balance is insufficient.
 * Returns the new balance.
 */
export async function debitSouls(amount: number): Promise<number> {
  const db = getDatabase();
  const value = Math.max(0, Number(amount) || 0);
  const balance = await getSoulBalance();
  if (balance < value) {
    throw new Error('insufficient_soul_balance');
  }
  await db.executeSql(
    `UPDATE soul_wallet SET balance = balance - ?, updated_at = ?
     WHERE id = ?`,
    [value, new Date().toISOString(), WALLET_ROW_ID],
  );
  return balance - value;
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
};
