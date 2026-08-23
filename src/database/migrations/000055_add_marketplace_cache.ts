/**
 * Migration 000055: Marketplace cache + content library (client-only)
 *
 * Adds client-only cache tables for the account-backed Marketplace feature
 * (the cloud backend in `soulbits-cloud-backend` is the source of truth).
 *
 * These tables mirror the backend's `marketplace_listings` /
 * `marketplace_ownership` shape so the app can browse + own content offline
 * and re-sync on the next login (cross-device "stored forever in my account").
 *
 *   marketplace_listings_cache    — browsable catalog cache (any item type:
 *                                   character, backstory, description,
 *                                   personality, prompt, dialogue, theme).
 *                                   price_souls 0 = FREE.
 *   marketplace_ownership_cache   — everything the local user has acquired
 *                                   (purchase / free / own) — the delivered
 *                                   copy lives in asset_json.
 *   content_library               — text + structured assets the user has
 *                                   collected (backstories, prompts, themes),
 *                                   with read / copy / apply-to-character UX.
 *
 * These tables are deliberately NOT synced to the engine:
 *  - `getChangedRecords` reads synced tables with `SELECT *` and pushes every
 *    column to the engine (strict schema parity, docs/schema-parity.md).
 *  - Sidecar tables are never selected by the sync layer, so the engine
 *    schema stays untouched (same pattern as character_profile_sources,
 *    soul_wallet, etc.) — they join CLIENT_ONLY_TABLES in
 *    scripts/dump-schema.ts.
 *
 * `CREATE TABLE IF NOT EXISTS` is idempotent and passes the migration SQL
 * guard (no ALTER DROP/RENAME).
 */
export const migration055 = `
-- Marketplace catalog cache (client-only) — mirrors the cloud backend
CREATE TABLE IF NOT EXISTS marketplace_listings_cache (
    id TEXT PRIMARY KEY,
    item_type TEXT NOT NULL CHECK (item_type IN (
        'character','backstory','description','personality',
        'prompt','dialogue','theme')),
    title TEXT NOT NULL,
    summary TEXT,
    tags TEXT,
    price_souls REAL NOT NULL DEFAULT 0 CHECK (price_souls >= 0),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','delisted')),
    sales_count INTEGER NOT NULL DEFAULT 0,
    seller_user_id TEXT,
    preview_text TEXT,
    preview_image_data TEXT,
    preview_mime_type TEXT,
    payload_json TEXT NOT NULL,
    cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Everything the local user acquired (client-only) — follows the account
CREATE TABLE IF NOT EXISTS marketplace_ownership_cache (
    id TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL REFERENCES marketplace_listings_cache(id) ON DELETE CASCADE,
    item_type TEXT NOT NULL,
    title TEXT NOT NULL,
    asset_json TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'purchase' CHECK (kind IN ('purchase','free','own')),
    acquired_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    image_data TEXT,
    image_mime TEXT
);
CREATE INDEX IF NOT EXISTS idx_marketplace_ownership_listing
    ON marketplace_ownership_cache(listing_id);

-- Collected content (text assets + structured assets like themes)
CREATE TABLE IF NOT EXISTS content_library (
    id TEXT PRIMARY KEY,
    item_type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    payload_json TEXT,
    image_data TEXT,
    image_mime TEXT,
    source_listing_id TEXT REFERENCES marketplace_listings_cache(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;