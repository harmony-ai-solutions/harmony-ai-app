/**
 * Migration 000043: drop dead sync-infra tables (paired with engine 000043)
 *
 * §9-A14 (engine contract 21-Engine-Contract-Persona-Enums.md): `sync_devices`
 * and `sync_history` were mistakenly-ported engine mirrors with a ZERO-caller
 * repo (`src/database/repositories/sync.ts` — every function there has zero
 * consumers, verified by grep). The app never needed them. This migration
 * DROPs both tables and the paired change set deletes the repo file and the
 * `SyncDevice`/`SyncHistory` model types.
 *
 * Lockstep note: engine 000043 (`sync_devices.synced_tables` TEXT NOT NULL
 * DEFAULT '[]' registry) and app 000043 (these drops) are deliberately DIFFERENT
 * content with the SAME number, per §9-A14 — the pairing makes both tables
 * Go-only (engine-local sync infrastructure). The engine half already landed
 * on `feat/engine-track-phase2` (e032869).
 *
 * Dev-DB note: devices that already synced keep orphaned empty tables until
 * wiped — harmless, covered by the extended dev-DB wipe note. The migration
 * uses `DROP TABLE IF EXISTS` so an already-wiped DB applies cleanly.
 */
export const migration043 = `
DROP TABLE IF EXISTS sync_devices;
DROP TABLE IF EXISTS sync_history;
`;
