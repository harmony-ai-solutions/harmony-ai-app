# Phase 5-1: RN Schema Dump Utility

## Objective

Build a CLI utility that dumps the RN app's database schema (produced by running all migrations) as a normalized JSON file. This file is the input to the cross-language parity CI gate (Phase 5-3).

## Context

The Go backend (`harmony-link-private`) has its own set of numbered migrations that must produce an identical schema. Currently, parity is enforced only by humans writing `// Mirrors Harmony Link migration XXXX` comments in each RN migration file. There's no automated check.

This phase produces the RN side of the comparison. Phase 5-2 produces the Go side. Phase 5-3 wires them together in CI.

## Prerequisites

- Phase 3-1 complete (the `dumpSchema` utility exists — it's reused here).

## Implementation Steps

### 1. Create the dump CLI

Create `scripts/dump-schema.ts`:

```typescript
#!/usr/bin/env npx ts-node
/**
 * Dumps the schema produced by running all RN migrations against an in-memory
 * SQLite database. Output is normalized JSON, suitable for diffing against
 * the Go server's schema dump.
 *
 * Usage:
 *   npx ts-node scripts/dump-schema.ts > rn-schema.json
 *   npx ts-node scripts/dump-schema.ts --output rn-schema.json
 *
 * Exit codes:
 *   0 — schema dumped successfully
 *   1 — error during dump
 */

import {createInMemoryDatabase} from '../src/database/__test_utils__/testDatabase';
import {runMigrations} from '../src/database/migrations';
import {dumpSchema} from '../src/database/__test_utils__/dumpSchema';

interface Args {
  output?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--output' && argv[i + 1]) {
      args.output = argv[++i];
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const db = createInMemoryDatabase();
  try {
    await runMigrations(db, true);
    const schema = await dumpSchema(db);
    const json = JSON.stringify(schema, null, 2);

    if (args.output) {
      const fs = await import('fs/promises');
      await fs.writeFile(args.output, json + '\n', 'utf8');
      console.error(`Schema written to ${args.output}`);
    } else {
      process.stdout.write(json + '\n');
    }
  } finally {
    await db.close();
  }
}

main().catch(err => {
  console.error('Failed to dump schema:', err);
  process.exit(1);
});
```

### 2. Add `ts-node` as a dev dependency (if not present)

```bash
npm install --save-dev ts-node
```

`ts-node` is needed because `scripts/dump-schema.ts` is TypeScript. Confirm it's already in `devDependencies` (the repo uses TypeScript throughout, so it's likely present).

### 3. Add an npm script

```json
{
  "scripts": {
    "schema:dump": "ts-node scripts/dump-schema.ts"
  }
}
```

### 4. Run it locally and inspect the output

```bash
npm run schema:dump > rn-schema.json
head rn-schema.json
```

Verify the output is well-formed JSON with entries for every table, index, trigger, and view.

### 5. Decide on a canonical schema representation

The Phase 3-1 `dumpSchema` produces a sorted, whitespace-normalized array. This is one valid representation. For cross-language comparison, alternatives:

- **Sorted JSON** (current) — easy to diff with the Go side's JSON output
- **SQL DDL string** — closer to what `sqlite3 .schema` produces; more familiar
- **Hash only** — fastest diff, but loses diff context

Recommendation: stick with sorted JSON for parity. The Go side produces the same shape.

### 6. Commit a baseline schema dump

Generate `schema/rn-schema.json` at the repo root (or in `docs/schema/`). Commit it. This becomes the "blessed" expected schema that the Go side must match.

> **Question for the team**: do you want this committed, or generated fresh in CI? Committing it makes PRs that change the schema very visible in `git diff`. Generating in CI is more current but obscures changes. Recommendation: commit it.

## Files to Create

- `scripts/dump-schema.ts` — the CLI
- `schema/rn-schema.json` (or `docs/schema/rn-schema.json`) — committed baseline

## Files to Modify

- `package.json` — add `ts-node` (if missing) and the `schema:dump` script

## Validation

- [ ] `npm run schema:dump` produces valid JSON to stdout
- [ ] `npm run schema:dump -- --output foo.json` writes the file
- [ ] JSON contains every expected table (cross-check against the Phase 3-1 snapshot)
- [ ] Output is deterministic (running twice produces identical bytes)
- [ ] Baseline `rn-schema.json` committed to the repo

## Open Questions to Resolve During Implementation

- **Should the dump include `sqlite_sequence` content?** Its values change as data is inserted; the schema-only dump (no data) avoids this. Confirm `dumpSchema` skips it (it filters `name NOT LIKE 'sqlite_%'`).
- **Should the dump include indexes explicitly created by migrations vs. implicit ones (e.g., UNIQUE constraints auto-create indexes)?** `sqlite_master` includes both. Either include all and accept some noise, or filter to explicit indexes only.
- **Format**: JSON vs. SQL DDL. Pick one and have the Go side match.

## Estimated Effort

Half a day.
