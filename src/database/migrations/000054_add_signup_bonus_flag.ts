/**
 * Migration 000054: Signup soul bonus flag (client-only)
 *
 * Grants every first-time signup a one-time free 50 SOUL bonus. The
 * soul_wallet table gains a `signup_bonus_claimed` flag (0/1):
 *
 *   - `0` → the bonus has NOT been granted yet on this device/install
 *   - `1` → the bonus HAS been granted — it can only ever be claimed once
 *
 * The flag lives on the single-row soul_wallet (id = 1), so it survives app
 * restarts and is independent of any backend. `ALTER TABLE ADD COLUMN` (not
 * DROP/RENAME) is safe on older Android SQLite and passes the migration SQL
 * guard; the default `0` keeps existing wallets unclaimed.
 */
export const migration054 = `
ALTER TABLE soul_wallet ADD COLUMN signup_bonus_claimed INTEGER NOT NULL DEFAULT 0;
`;