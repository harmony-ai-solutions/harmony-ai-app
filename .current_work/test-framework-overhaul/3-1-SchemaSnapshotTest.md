# Phase 3-1: Schema Snapshot Test

## Objective

Establish a snapshot of the schema produced by running all 32 (and counting) migrations against a clean SQLite database. Any future migration that changes the schema will cause the snapshot to differ, forcing the change to be reviewed and the snapshot updated explicitly. This catches ~80% of accidental schema drift.

## Context

The repo currently has 32 numbered migration files in `src/database/migrations/`. Each exports a SQL string. Comments like "Mirrors Harmony Link migration XXXX" are the only enforcement of parity with the Go backend — there's no automated check that the migrations produce the expected schema, let alone one matching the server.

The approach: after running `runMigrations(db)` on a fresh `:memory:` SQLite, query `sqlite_master`, normalize the result, and store as a Jest snapshot. The normalization strips volatile elements (rootpage, statement ordering) and focuses on the SQL text itself.

## Prerequisites

- Phase 2-1, 2-2, 2-3 complete (the `Database` interface and `NodeDatabase` adapter exist).
- Phase 1-2 done (the broken test runner is gone) OR this test is added in parallel — no direct dependency.

## Implementation Steps

### 1. Locate the migrations barrel

`connection.ts` imports `runMigrations` from `./migrations`. Confirm the path — it's likely `src/database/migrations/index.ts` or `src/database/migrations.ts`. Note the exact signature (`(db: Database, silent?: boolean) => Promise<void>` post-Phase 2-3).

### 2. Implement the schema dumper

Create `src/database/__test_utils__/dumpSchema.ts`:

```typescript
import type {Database} from '../types';

export interface NormalizedSchemaEntry {
  type: 'table' | 'index' | 'trigger' | 'view';
  name: string;
  sql: string;
}

/**
 * Dump and normalize the schema of a Database.
 *
 * Normalization:
 *  - Sort entries by (type, name) so ordering is deterministic
 *  - Collapse runs of whitespace in SQL text to a single space
 *  - Uppercase SQL keywords (optional — see open question)
 *  - Strip trailing semicolons
 *  - Exclude sqlite_internal tables (name LIKE 'sqlite_%')
 */
export async function dumpSchema(db: Database): Promise<NormalizedSchemaEntry[]> {
  const [result] = await db.executeSql(
    `SELECT type, name, sql FROM sqlite_master
     WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
     ORDER BY type, name`,
  );

  const entries: NormalizedSchemaEntry[] = [];
  for (let i = 0; i < result.rows.length; i++) {
    const row = result.rows.item(i);
    entries.push({
      type: row.type,
      name: row.name,
      sql: normalizeSql(row.sql),
    });
  }
  return entries;
}

function normalizeSql(sql: string): string {
  return sql
    .replace(/\s+/g, ' ')       // collapse whitespace
    .replace(/;\s*$/, '')       // strip trailing semicolon
    .trim();
}

/**
 * Render the schema as a deterministic string for snapshotting.
 */
export function renderSchema(entries: NormalizedSchemaEntry[]): string {
  return entries
    .map(e => `-- ${e.type}: ${e.name}\n${e.sql};`)
    .join('\n\n') + '\n';
}
```

### 3. Write the snapshot test

Create `src/database/__tests__/migrations.snapshot.test.ts`:

```typescript
import {createInMemoryDatabase} from '../__test_utils__/testDatabase';
import {dumpSchema, renderSchema} from '../__test_utils__/dumpSchema';
import {runMigrations} from '../migrations'; // adjust path
import type {NodeDatabase} from '../__test_utils__/nodeDatabase';

describe('migration schema snapshot', () => {
  let db: NodeDatabase;

  beforeEach(() => {
    db = createInMemoryDatabase();
  });

  afterEach(async () => {
    await db.close();
  });

  it('all migrations produce the expected schema', async () => {
    await runMigrations(db, true);
    const schema = await dumpSchema(db);
    expect(renderSchema(schema)).toMatchSnapshot();
  });

  it('schema has at least the core tables', async () => {
    // Sanity check — guards against the snapshot being empty due to a bug
    await runMigrations(db, true);
    const schema = await dumpSchema(db);
    const tableNames = schema
      .filter(e => e.type === 'table')
      .map(e => e.name);

    // These tables are referenced throughout the codebase; assert they exist.
    const expectedTables = [
      'character_profiles',
      'entities',
      'provider_config_openai',
      'backend_configs',
      'sync_devices',     // from migration 000005
      'sync_sessions',    // from migration 000005
      'memories',         // from migration 000016
    ];

    for (const expected of expectedTables) {
      expect(tableNames).toContain(expected);
    }
  });

  it('migration is idempotent (running twice produces the same schema)', async () => {
    await runMigrations(db, true);
    const schema1 = renderSchema(await dumpSchema(db));

    await runMigrations(db, true);
    const schema2 = renderSchema(await dumpSchema(db));

    expect(schema2).toBe(schema1);
  });
});
```

### 4. Generate the initial snapshot

```bash
npx jest migrations.snapshot
```

The first run creates `__snapshots__/migrations.snapshot.test.ts.snap`. Review it manually — confirm it contains all expected tables, indexes, triggers, and views.

### 5. Commit the snapshot

The `.snap` file MUST be committed to the repo. It's the canonical reference. Anyone running `npm test` elsewhere compares against this snapshot.

### 6. Document the update workflow

Add a comment to the top of `migrations.snapshot.test.ts`:

```typescript
/**
 * When you intentionally change the schema (new migration, modified migration):
 *   1. Run: npx jest migrations.snapshot --updateSnapshot
 *   2. Inspect the diff in git carefully
 *   3. Commit the .snap file alongside your migration
 *
 * If you didn't intend to change the schema, this test failing is a signal
 * that your migration is doing something unexpected — investigate.
 */
```

## Files to Create

- `src/database/__test_utils__/dumpSchema.ts` — schema dumper + normalizer
- `src/database/__tests__/migrations.snapshot.test.ts` — the snapshot test
- `src/database/__tests__/__snapshots__/migrations.snapshot.test.ts.snap` — auto-generated on first run, committed to repo

## Validation

- [ ] Snapshot test passes on a clean run
- [ ] Snapshot file is committed and contains all 32 migrations' outputs
- [ ] Idempotency test passes (running migrations twice yields the same schema)
- [ ] Sanity test confirms expected core tables are present
- [ ] A deliberate schema change (e.g., add a column via a new migration) correctly causes the test to fail with a clear diff

## Open Questions to Resolve During Implementation

- **Should `sqlite_sequence` table be included?** It's auto-created when `AUTOINCREMENT` is used. Its content varies based on inserts, but its existence is part of the schema. Decide whether to filter it (recommended — its presence is implicit from AUTOINCREMENT columns).
- **Should `sql` keywords be uppercased for normalization?** SQLite stores them as-written in the migration. If migrations use lowercase `create table`, the snapshot will have lowercase. Don't normalize case — preserve the migration author's style and rely on the diff being reviewed.
- **Does the migration runner use a `schema_migrations` tracking table?** Many do. It will appear in the snapshot — that's fine, it's part of the schema.

## Estimated Effort

Half a day. Most of the time is reviewing the initial snapshot content.
