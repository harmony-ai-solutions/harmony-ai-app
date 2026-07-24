# Phase 3-2: Roll-Forward Test

## Objective

Verify that for every version boundary N → N+1, applying migration N+1 to a database at version N succeeds and produces the expected incremental schema change. This catches misordered migrations, missing dependencies (migration 20 referencing a table created in migration 22), and forward-incompatibility issues that the full-rebuild snapshot test (Phase 3-1) cannot detect.

## Context

The Phase 3-1 snapshot test catches drift in the *final* schema, but it does not catch:

- A migration that depends on a table created in a later migration (only manifests when migrating incrementally)
- A migration that succeeds when run after the full set but fails when run in correct historical order
- Off-by-one errors in the migration runner's version tracking

Real users have databases at various migration versions. The app's `runMigrations()` is called on every boot and applies pending migrations. If migration N+1 fails on a database at version N, every user with that version is bricked.

## Prerequisites

- Phase 2-1, 2-2, 2-3 complete.
- Phase 3-1 complete (the snapshot test framework and `dumpSchema` utility exist).
- The migration runner must expose a way to run migrations up to a specific version (not just "all"). If it doesn't currently, add it (see step 1).

## Implementation Steps

### 1. Add a "migrate-to-version-N" entry point

Check the migration runner. It likely has a function like `runMigrations(db, silent)` that applies all pending migrations. We need a variant that applies only migrations 1..N.

If the runner is structured as a list of `{version: number, up: string}` objects, expose:

```typescript
// src/database/migrations/index.ts (or wherever runMigrations lives)

import type {Database} from '../types';

interface Migration {
  version: number;
  up: string;
  // ... possibly name, down, etc.
}

export const MIGRATIONS: Migration[] = [
  // ... populated from the numbered files
];

export async function runMigrations(db: Database, silent?: boolean): Promise<void> {
  return runMigrationsToVersion(db, MIGRATIONS.length, silent);
}

export async function runMigrationsToVersion(
  db: Database,
  targetVersion: number,
  silent?: boolean,
): Promise<void> {
  // ... apply migrations 1..targetVersion, tracking the version in schema_migrations
}
```

The exact shape depends on what's already there. **Read `src/database/migrations/` carefully before refactoring** — the runner may already support this internally.

### 2. Discover migrations dynamically

For the test to remain useful as new migrations are added, it must discover them automatically. Two options:

**Option A: Dynamic import via glob (Jest-specific)**

```typescript
const migrationContext = require.context('../migrations', false, /^\.\/000\d{3}.*\.ts$/);
const migrationCount = migrationContext.keys().length;
```

`require.context` is a webpack feature; Jest supports it via `babel-plugin-dynamic-import-node` or just by enabling it in the Jest config. May require setup.

**Option B: Static enumeration (recommended)**

Maintain a barrel file `src/database/migrations/index.ts` that imports each numbered migration and builds the `MIGRATIONS` array. The test imports `MIGRATIONS.length`. New migrations require updating the barrel — slight friction but explicit and reliable.

Verify which approach the codebase already uses and align.

### 3. Implement the test

Create `src/database/__tests__/migrations.rollforward.test.ts`:

```typescript
import {createInMemoryDatabase} from '../__test_utils__/testDatabase';
import {dumpSchema, renderSchema} from '../__test_utils__/dumpSchema';
import {runMigrationsToVersion, MIGRATIONS} from '../migrations';
import type {NodeDatabase} from '../__test_utils__/nodeDatabase';

describe('migration roll-forward', () => {
  let db: NodeDatabase;

  beforeEach(() => {
    db = createInMemoryDatabase();
  });

  afterEach(async () => {
    await db.close();
  });

  // Sanity: confirm we're actually testing all migrations.
  it('test harness discovers all migrations', () => {
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(32);
    // Confirm versions are sequential starting at 1
    for (let i = 0; i < MIGRATIONS.length; i++) {
      expect(MIGRATIONS[i].version).toBe(i + 1);
    }
  });

  // Snapshot every Nth version boundary — 1, 5, 10, 15, 20, 25, final.
  // Snapshotting every version would be noisy; this gives enough resolution
  // to localize a regression without bloating the .snap file.
  const snapshotVersions = (() => {
    const versions: number[] = [];
    for (let v = 1; v <= MIGRATIONS.length; v++) {
      if (v === 1 || v === MIGRATIONS.length || v % 5 === 0) {
        versions.push(v);
      }
    }
    return versions;
  })();

  describe.each(snapshotVersions)('schema at version %i', (version) => {
    it('matches snapshot', async () => {
      await runMigrationsToVersion(db, version, true);
      const schema = await dumpSchema(db);
      expect(renderSchema(schema)).toMatchSnapshot(`v${version}`);
    });
  });

  // Critical: every version boundary upgrades cleanly.
  it.each(MIGRATIONS.map((m, i) => [m.version, i] as const))(
    'incremental migration to v%s succeeds',
    async (version) => {
      // Build DB at version N-1, then apply migration N
      if (version > 1) {
        await runMigrationsToVersion(db, version - 1, true);
      }
      // This must not throw:
      await runMigrationsToVersion(db, version, true);

      // Sanity: schema_migrations table records the version
      const [result] = await db.executeSql(
        'SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1',
      );
      if (result.rows.length > 0) {
        expect(result.rows.item(0).version).toBe(version);
      }
    },
  );

  // End-to-end: build at version 1, then migrate to final in one step.
  it('migrates from v1 to latest in one step', async () => {
    await runMigrationsToVersion(db, 1, true);
    await runMigrationsToVersion(db, MIGRATIONS.length, true);
    const schema = await dumpSchema(db);
    expect(renderSchema(schema)).toMatchSnapshot('v1-to-latest');
  });
});
```

> **Note on `schema_migrations` table**: The migration runner likely tracks applied versions in a table of that name. Confirm the table name and adjust the query. If the runner uses a different mechanism (e.g., a `user_version` PRAGMA), adapt the assertion.

### 4. Generate snapshots and review

```bash
npx jest migrations.rollforward --updateSnapshot
```

Inspect the generated `.snap` file. Confirm:
- Each snapshot for version N is a strict subset of version N+1 (schema only grows)
- No snapshot is empty (would indicate a migration failed silently)

### 5. Commit snapshots

The roll-forward `.snap` file is also committed.

## Files to Create

- `src/database/__tests__/migrations.rollforward.test.ts`
- `src/database/__tests__/__snapshots__/migrations.rollforward.test.ts.snap`

## Files to Modify

- `src/database/migrations/index.ts` (or equivalent) — expose `runMigrationsToVersion` and a `MIGRATIONS` array if not already present

## Validation

- [ ] `MIGRATIONS.length` matches the number of migration files on disk (use Grep tool to count `000*.ts` files)
- [ ] Every incremental migration succeeds without throwing
- [ ] Snapshots for v1, v5, v10, v15, v20, v25, v(latest) are committed
- [ ] Each snapshot is a strict subset of the next (verify visually)
- [ ] v1-to-latest snapshot matches the latest snapshot (same end state regardless of how you get there)

## Open Questions to Resolve During Implementation

- **Does the migration runner apply each migration in its own transaction?** If yes, a failed migration leaves the DB at version N-1 (clean). If no, a failed migration leaves the DB in an inconsistent state. Verify and document.
- **Are there any data migrations (not just schema)?** Search for `INSERT INTO` in migration files. If found, the snapshot test must account for seeded data — add a separate snapshot of `SELECT * FROM <seeded-table>` after migrations.
- **What's the migration version tracking mechanism?** `schema_migrations` table? `PRAGMA user_version`? Both? This affects the assertions in step 3.

## Estimated Effort

One day. The migration runner may need refactoring to expose `runMigrationsToVersion`, which is most of the work.
