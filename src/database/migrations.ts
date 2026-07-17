/**
 * Database Migration System (Forward-Only)
 *
 * Manages database schema evolution through SQL migration files.
 * Only supports forward migrations - no rollback functionality.
 */

import { SQLiteDatabase } from 'react-native-sqlite-storage';
import { createLogger } from '../utils/logger';

import { migration001 } from './migrations/000001_initial_schema';
import { migration002 } from './migrations/000002_make_character_profile_optional';
import { migration003 } from './migrations/000003_add_character_card_fields';
import { migration004 } from './migrations/000004_add_cognition_generate_expressions';
import { migration005 } from './migrations/000005_add_sync_tables';
import { migration006 } from './migrations/000006_fix_sync_devices_primary_key';
import { migration007 } from './migrations/000007_add_chat_images';
import { migration008 } from './migrations/000008_remove_provider_name_unique_constraint';
import { migration009 } from './migrations/000009_add_character_chat_behavior';
import { migration010 } from './migrations/000010_rename_chat_messages';
import { migration011 } from './migrations/000011_add_vision_module';
import { migration012 } from './migrations/000012_add_imagination_module';
import { migration013 } from './migrations/000013_character_profile_vision_config';
import { migration014 } from './migrations/000014_add_emotion_state';
import { migration015 } from './migrations/000015_add_lifecycle_config';
import { migration016 } from './migrations/000016_add_memories_table_and_emotional_state_bits';
import { migration017 } from './migrations/000017_add_memories_deleted_at';
import { migration018 } from './migrations/000018_add_entity_alias';
import { migration019 } from './migrations/000019_add_recon_tracking';
import { migration020 } from './migrations/000020_add_provider_llm_params';
import { migration021 } from './migrations/000021_add_sampling_preset_and_extra_params';
import { migration022 } from './migrations/000022_add_entity_emoji_actions';
import { migration023 } from './migrations/000023_add_emoji_actions_deleted_at';
import { migration024 } from './migrations/000024_create_interactions_table';
import { migration025 } from './migrations/000025_drop_session_id';
import { migration026 } from './migrations/000026_add_interaction_summary';
import { migration027 } from './migrations/000027_interaction_memory_fields';
import { migration028 } from './migrations/000028_add_presence_type';
import { migration029 } from './migrations/000029_rag_reindex_flag';
import { migration030 } from './migrations/000030_add_provider_expansion';
import { migration031 } from './migrations/000031_config_uuid_primary_keys';
import { migration032 } from './migrations/000032_add_soulbitscloud_provider';

// Migration definition
interface Migration {
  version: number;
  description: string;
  sql: string;
}

const log = createLogger('[Migrations]');

// All migrations in order
const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'initial_schema',
    sql: migration001,
  },
  {
    version: 2,
    description: 'make_character_profile_optional',
    sql: migration002,
  },
  {
    version: 3,
    description: 'add_character_card_fields',
    sql: migration003,
  },
  {
    version: 4,
    description: 'add_cognition_generate_expressions',
    sql: migration004,
  },
  {
    version: 5,
    description: 'add_sync_tables',
    sql: migration005,
  },
  {
    version: 6,
    description: 'fix_sync_devices_primary_key',
    sql: migration006,
  },
  {
    version: 7,
    description: 'add_chat_images',
    sql: migration007,
  },
  {
    version: 8,
    description: 'remove_provider_name_unique_constraint',
    sql: migration008,
  },
  {
    version: 9,
    description: 'add_character_chat_behavior',
    sql: migration009,
  },
  {
    version: 10,
    description: 'rename_chat_messages',
    sql: migration010,
  },
  {
    version: 11,
    description: 'add_vision_module',
    sql: migration011,
  },
  {
    version: 12,
    description: 'add_imagination_module',
    sql: migration012,
  },
  {
    version: 13,
    description: 'character_profile_vision_config',
    sql: migration013,
  },
  {
    version: 14,
    description: 'add_emotion_state',
    sql: migration014,
  },
  {
    version: 15,
    description: 'add_lifecycle_config',
    sql: migration015,
  },
  {
    version: 16,
    description: 'add_memories_table_and_emotional_state_bits',
    sql: migration016,
  },
  {
    version: 17,
    description: 'add_memories_deleted_at',
    sql: migration017,
  },
  {
    version: 18,
    description: 'add_entity_alias',
    sql: migration018,
  },
  {
    version: 19,
    description: 'add_recon_tracking',
    sql: migration019,
  },
  {
    version: 20,
    description: 'add_provider_llm_params',
    sql: migration020,
  },
  {
    version: 21,
    description: 'add_sampling_preset_and_extra_params',
    sql: migration021,
  },
  {
    version: 22,
    description: 'add_entity_emoji_actions',
    sql: migration022,
  },
  {
    version: 23,
    description: 'add_emoji_actions_deleted_at',
    sql: migration023,
  },
  {
    version: 24,
    description: 'create_interactions_table',
    sql: migration024,
  },
  {
    version: 25,
    description: 'drop_session_id',
    sql: migration025,
  },
  {
    version: 26,
    description: 'add_interaction_summary',
    sql: migration026,
  },
  {
    version: 27,
    description: 'interaction_memory_fields',
    sql: migration027,
  },
  {
    version: 28,
    description: 'add_presence_type',
    sql: migration028,
   },
   {
    version: 29,
    description: 'rag_reindex_flag',
    sql: migration029,
   },
   {
    version: 30,
    description: 'add_provider_expansion',
    sql: migration030,
   },
   {
    version: 31,
    description: 'config_uuid_primary_keys',
    sql: migration031,
   },
   {
    version: 32,
    description: 'add_soulbitscloud_provider',
    sql: migration032,
   },
  ];

/**
 * Create the schema_migrations table if it doesn't exist
 */
async function createMigrationsTable(
  db: SQLiteDatabase,
  silent: boolean = false,
): Promise<void> {
  const sql = `
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      description TEXT
    );
  `;

  await db.executeSql(sql);
  if (!silent) {
    log.info('Created schema_migrations table');
  }
}

/**
 * Get list of applied migration versions
 */
async function getAppliedMigrations(db: SQLiteDatabase): Promise<Set<number>> {
  const [results] = await db.executeSql(
    'SELECT version FROM schema_migrations',
  );

  const appliedVersions = new Set<number>();
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    appliedVersions.add(row.version);
  }

  return appliedVersions;
}

/**
 * Apply a single migration within a transaction
 */
async function applyMigration(
  db: SQLiteDatabase,
  migration: Migration,
  silent: boolean = false,
): Promise<void> {
  if (!silent) {
    log.info(
      `Applying migration ${migration.version}: ${migration.description}`,
    );
  }

  try {
    // Execute the migration SQL
    const statements = migration.sql
      .split(';')
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0);

    for (const statement of statements) {
      try {
        await db.executeSql(statement);
      } catch (stmtError: any) {
        // react-native-sqlite-storage on some Android builds returns
        // SQLITE_OK (code 0) as a rejected promise for ALTER TABLE ADD
        // COLUMN ... DEFAULT statements. The operation actually succeeded;
        // the JS layer falsely wraps it as an error.
        if (stmtError?.code === 0) {
          log.debug(
            `Migration ${migration.version}: swallowed false SQLITE_OK error on: ${statement.substring(0, 80)}`,
          );
          continue;
        }
        throw stmtError;
      }
    }

    // Record the migration
    await db.executeSql(
      'INSERT INTO schema_migrations (version, description) VALUES (?, ?)',
      [migration.version, migration.description],
    );

    if (!silent) {
      log.info(`Successfully applied migration ${migration.version}`);
    }
  } catch (error: any) {
    // Also handle SQLITE_OK at the top level (some statements trigger it
    // without per-statement error wrapping)
    if (error?.code === 0) {
      log.debug(`Migration ${migration.version}: swallowed false SQLITE_OK at top-level`);
      // Record the migration anyway since the statements succeeded
      try {
        await db.executeSql(
          'INSERT INTO schema_migrations (version, description) VALUES (?, ?)',
          [migration.version, migration.description],
        );
      } catch { /* best effort */ }
      if (!silent) {
        log.info(`Successfully applied migration ${migration.version}`);
      }
      return;
    }
    log.error(`Failed to apply migration ${migration.version}:`, error);
    throw error;
  }
}

/**
 * Run all pending migrations
 * This is the main entry point called during database initialization
 */
export async function runMigrations(
  db: SQLiteDatabase,
  silent: boolean = false,
): Promise<void> {
  if (!silent) {
    log.info('Starting migration process...');
  }

  try {
    // Ensure migrations table exists
    await createMigrationsTable(db, silent);

    // Get already applied migrations
    const appliedVersions = await getAppliedMigrations(db);
    if (!silent) {
      log.info(`Found ${appliedVersions.size} previously applied migrations`);
    }

    // Find pending migrations
    const pendingMigrations = MIGRATIONS.filter(
      m => !appliedVersions.has(m.version),
    );

    if (pendingMigrations.length === 0) {
      if (!silent) {
        log.info('Database is up to date');
      }
      return;
    }

    if (!silent) {
      log.info(`Applying ${pendingMigrations.length} pending migrations`);
    }

    // Apply each pending migration in order
    for (const migration of pendingMigrations) {
      await applyMigration(db, migration, silent);
    }

    if (!silent) {
      log.info('All migrations completed successfully');
    }
  } catch (error) {
    log.error('Migration process failed:', error);
    throw error;
  }
}

/**
 * Get current database schema version
 */
export async function getCurrentVersion(db: SQLiteDatabase): Promise<number> {
  try {
    const [results] = await db.executeSql(
      'SELECT MAX(version) as version FROM schema_migrations',
    );

    if (results.rows.length > 0) {
      const row = results.rows.item(0);
      return row.version || 0;
    }

    return 0;
  } catch (error) {
    // Table doesn't exist yet
    return 0;
  }
}
