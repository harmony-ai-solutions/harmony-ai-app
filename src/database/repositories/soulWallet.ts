/**
 * SOUL Wallet Repository — client-only wallet (local cache of the account ledger).
 *
 * The cloud backend's `soul_ledger` is the source of truth for a user's SOUL
 * balance across devices; this table is the local cache (offline-usable).
 *
 * Kept deliberately separate from `marketplace.ts` so the wallet concern can
 * grow (real-money top-up, ledger history) without coupling to listings.
 */

import { getDatabase } from '../connection';
import { withTransaction } from '../transaction';

const WALLET_ROW_ID = 1;
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
  // serialised by the DB, so concurrent calls can never double-grant.
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

export default {
  getSoulBalance,
  hasClaimedSignupBonus,
  claimSignupBonus,
  creditSouls,
  debitSouls,
};