#!/usr/bin/env npx ts-node
/**
 * Dumps the schema produced by running all RN migrations against an in-memory
 * SQLite database. Output is normalized JSON, suitable for diffing against
 * the Go server's schema dump.
 *
 * The JSON shape MUST match the Go side byte-for-byte:
 *   [
 *     {"type": "index", "name": "idx_...", "sql": "CREATE INDEX ... (normalized)"},
 *     {"type": "table", "name": "tbl", "sql": "CREATE TABLE ... (normalized)"},
 *   ]
 *
 * Normalization rules:
 *   - Sort by (type, name) ascending
 *   - Collapse whitespace to single spaces
 *   - Strip trailing semicolons
 *   - Exclude internal sqlite_* tables
 *   - Exclude CLIENT-ONLY tables (never synced, never present on the Go engine)
 *
 * Usage:
 *   npx ts-node scripts/dump-schema.ts > rn-schema.json
 *   npx ts-node scripts/dump-schema.ts --output rn-schema.json
 *
 * Exit codes:
 *   0 — schema dumped successfully
 *   1 — error during dump
 */

// React Native's Metro bundler defines __DEV__; standalone ts-node needs it set manually.
(globalThis as any).__DEV__ = true;

import {createInMemoryDatabase} from '../src/database/__test_utils__/testDatabase';
import {runMigrations} from '../src/database/migrations';
import {dumpSchema} from '../src/database/__test_utils__/dumpSchema';

/**
 * Tables that exist ONLY on the RN client and are never synced to the Go
 * engine. They must be excluded from the schema dump so the parity gate
 * (RN ↔ Go) does not report them as "RN-only" drift.
 *
 * INTERIM MECHANISM (decision D6): this exclusion list is scaffolding for
 * senju's client-only sidecar tables and is scheduled for deletion — it
 * shrinks as 02-Followup-Stub-Plan drops the sidecar tables (B5 / Track A)
 * and is removed entirely once the last entry is gone. End state: zero dump
 * exclusions; "app-only table" is not a category in this architecture
 * (local-only state lives in AsyncStorage; engine-appropriate data gets
 * mirrored migrations on both sides).
 */
const CLIENT_ONLY_TABLES = new Set<string>([
  'personas',                  // dies in Phase 2 / B3 (persona → user entities)
  'character_favorites',       // becomes synced in Phase 2 / B2 (Go mirror)
  'chat_conversation_settings',// synced redesign in Phase 2 / B2
]);

/**
 * True for client-only tables AND for indexes defined on them (the index
 * name differs from the table name, so a name-only check lets them leak
 * into the parity dump). Interim with CLIENT_ONLY_TABLES — see D6 note above.
 */
function isClientOnlyEntry(entry: {type: string; name: string; sql: string}): boolean {
  if (CLIENT_ONLY_TABLES.has(entry.name)) {
    return true;
  }
  if (entry.type === 'index') {
    // Index SQL shape: CREATE [UNIQUE] INDEX idx_x ON <table> (<cols>).
    // Grab the first identifier after ON (optionally quoted) — table names
    // in this schema are plain identifiers.
    const onTable = entry.sql.match(/\bON\s+["'`\[]?(\w+)/i);
    return onTable !== null && CLIENT_ONLY_TABLES.has(onTable[1]);
  }
  return false;
}

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
    // silent=true suppresses migration log output
    await runMigrations(db, true);
    const schema = (await dumpSchema(db)).filter(
      entry => !isClientOnlyEntry(entry),
    );
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
