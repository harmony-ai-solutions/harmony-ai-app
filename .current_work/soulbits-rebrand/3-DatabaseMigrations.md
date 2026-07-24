# Phase 3: Database Migrations

> **Goal**: Rename `device_type` values from `'harmony_link'` / `'harmony_app'` to `'soulbits_engine'` / `'soulbits_app'` via new upward migration `000033`.

## Context

Both repos share migration numbering 000001–000032. The next migration is **`000033`**.

The `sync_devices.device_type` column is `TEXT NOT NULL` (no DEFAULT). No default value change is needed — only existing rows need updating.

- **harmony-ai-app**: TypeScript migration files (`src/database/migrations/000033_*.ts`)
- **harmony-link-private** (soulbits-engine): `.sql` migration files (`database/migrations/000033_*.up.sql` / `.down.sql`)

## Files to Create

### harmony-ai-app: `src/database/migrations/000033_rename_device_type_for_soulbits.ts`

```typescript
export const migration033 = `
-- 33.0 Rename device_type values for Soulbits rebrand
UPDATE sync_devices SET device_type = 'soulbits_engine' WHERE device_type = 'harmony_link';
UPDATE sync_devices SET device_type = 'soulbits_app' WHERE device_type = 'harmony_app';
`;
```

Also register it in the migration runner (likely `src/database/migrations.ts` or the index file that exports all migrations).

### harmony-link-private: `database/migrations/000033_rename_device_type_for_soulbits.up.sql`

```sql
-- 33.0 Rename device_type values for Soulbits rebrand
UPDATE sync_devices SET device_type = 'soulbits_engine' WHERE device_type = 'harmony_link';
UPDATE sync_devices SET device_type = 'soulbits_app' WHERE device_type = 'harmony_app';
```

And `database/migrations/000033_rename_device_type_for_soulbits.down.sql`:
```sql
-- Rollback: restore old device_type values
UPDATE sync_devices SET device_type = 'harmony_link' WHERE device_type = 'soulbits_engine';
UPDATE sync_devices SET device_type = 'harmony_app' WHERE device_type = 'soulbits_app';
```

## ⚠️ Verification

- The server-side engine was already updated to use `soulbits_engine` as its own device identity. Verify the server code now accepts `soulbits_app` as the mobile app device_type.
- See `eventserver/synchronization.go` for device_type validation logic.
