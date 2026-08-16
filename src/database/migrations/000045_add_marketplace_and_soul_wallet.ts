/**
 * Migration 000045: Marketplace listings + SOUL wallet (client-only)
 *
 * Adds client-only support for selling AI characters on the Market screen:
 *
 *   character_marketplace_listings — one row per AI character that is listed
 *     for sale. Presence of a row (plus visibility='marketplace') is what
 *     makes the character appear on the Market screen.
 *       - profile_id   FK → character_profiles (cascade delete)
 *       - price_souls  the price the creator set, in SOUL currency
 *   soul_wallet       — the local user's SOUL balance (spendable + earned).
 *       A single-row table (id = 1) holding the balance so it survives
 *       app restarts and is independent of any backend.
 *   soul_purchases    — records each AI character the local user has bought
 *       (profile_id + price paid + purchased_at). A purchase grants the buyer
 *       permanent chat access to a marketplace-listed character. The creator's
 *       "revenue" side is represented by the wallet balance in the creator's
 *       own install (the seller UI credits the wallet when an item sells).
 *
 * These tables are deliberately NOT columns on `character_profiles` / the
 * engine schema:
 *  - `getChangedRecords` reads synced tables with `SELECT *` and pushes every
 *    column to the engine, which enforces strict schema parity (see
 *    docs/schema-parity.md). Any new column would break the parity gate.
 *  - Sidecar tables are never selected by the sync layer, so the engine
 *    schema stays untouched (same pattern as character_profile_sources,
 *    character_favorites, character_creators, etc.).
 *  - Excluded from the schema dump in scripts/dump-schema.ts
 *    (CLIENT_ONLY_TABLES).
 *
 * Cascades: deleting a character profile removes its marketplace listing
 * (ON DELETE CASCADE via FK).
 *
 * `CREATE TABLE IF NOT EXISTS` is idempotent and passes the migration SQL
 * guard (no ALTER DROP/RENAME).
 */
export const migration045 = `
-- AI character marketplace listings (client-only)
CREATE TABLE IF NOT EXISTS character_marketplace_listings (
    profile_id TEXT PRIMARY KEY REFERENCES character_profiles(id) ON DELETE CASCADE,
    price_souls REAL NOT NULL DEFAULT 0 CHECK (price_souls >= 0),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Local SOUL wallet balance (client-only, single row id=1)
CREATE TABLE IF NOT EXISTS soul_wallet (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    balance REAL NOT NULL DEFAULT 0 CHECK (balance >= 0),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Purchases of marketplace AI characters (client-only) — grants chat access
CREATE TABLE IF NOT EXISTS soul_purchases (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES character_profiles(id) ON DELETE CASCADE,
    price_souls REAL NOT NULL CHECK (price_souls >= 0),
    purchased_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_soul_purchases_profile ON soul_purchases(profile_id);
`;
