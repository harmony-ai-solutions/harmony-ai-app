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
 */
const CLIENT_ONLY_TABLES = new Set<string>([
  'character_profile_sources',
  'character_categories',
  'character_category_members',
  'character_favorites',
  'character_likes',
  'character_saves',
  'character_image_likes',
  'character_image_comments',
  'character_creators',
  'personas',
  'user_posts',
  'user_post_likes',
  'user_post_comments',
  'follows',
  'blocked_users',
  'notifications',
  'chat_conversation_settings',
  'character_marketplace_listings',
  'soul_wallet',
  'soul_purchases',
]);

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
      entry => !CLIENT_ONLY_TABLES.has(entry.name),
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
