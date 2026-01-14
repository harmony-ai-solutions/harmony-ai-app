/**
 * Database Migration System (Forward-Only)
 * 
 * Manages database schema evolution through SQL migration files.
 * Only supports forward migrations - no rollback functionality.
 */

import {SQLiteDatabase} from 'react-native-sqlite-storage';
import {migration001} from './migrations/000001_initial_schema';
import {migration002} from './migrations/000002_make_character_profile_optional';
import {migration003} from './migrations/000003_add_character_card_fields';
import {migration004} from './migrations/000004_add_cognition_generate_expressions';

// Migration definition
interface Migration {
  version: number;
  description: string;
  sql: string;
}

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
];

/**
 * Create the schema_migrations table if it doesn't exist
 */
async function createMigrationsTable(
  db: SQLiteDatabase,
  silent: boolean = false
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
    console.log('[Migrations] Created schema_migrations table');
  }
}

/**
 * Get list of applied migration versions
 */
async function getAppliedMigrations(db: SQLiteDatabase): Promise<Set<number>> {
  const [results] = await db.executeSql('SELECT version FROM schema_migrations');
  
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
  silent: boolean = false
): Promise<void> {
  if (!silent) {
    console.log(
      `[Migrations] Applying migration ${migration.version}: ${migration.description}`
    );
  }

  try {
    // Execute the migration SQL
    // Note: SQLite doesn't support multiple statements in executeSql,
    // so we need to split and execute individually
    const statements = migration.sql
      .split(';')
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0);
    
    for (const statement of statements) {
      await db.executeSql(statement);
    }
    
    // Record the migration
    await db.executeSql(
      'INSERT INTO schema_migrations (version, description) VALUES (?, ?)',
      [migration.version, migration.description]
    );

    if (!silent) {
      console.log(
        `[Migrations] Successfully applied migration ${migration.version}`
      );
    }
  } catch (error) {
    console.error(
      `[Migrations] Failed to apply migration ${migration.version}:`,
      error
    );
    throw error;
  }
}

/**
 * Run all pending migrations
 * This is the main entry point called during database initialization
 */
export async function runMigrations(
  db: SQLiteDatabase,
  silent: boolean = false
): Promise<void> {
  if (!silent) {
    console.log('[Migrations] Starting migration process...');
  }

  try {
    // Ensure migrations table exists
    await createMigrationsTable(db, silent);

    // Get already applied migrations
    const appliedVersions = await getAppliedMigrations(db);
    if (!silent) {
      console.log(
        `[Migrations] Found ${appliedVersions.size} previously applied migrations`
      );
    }

    // Find pending migrations
    const pendingMigrations = MIGRATIONS.filter(
      m => !appliedVersions.has(m.version)
    );

    if (pendingMigrations.length === 0) {
      if (!silent) {
        console.log('[Migrations] Database is up to date');
      }
      return;
    }

    if (!silent) {
      console.log(
        `[Migrations] Applying ${pendingMigrations.length} pending migrations`
      );
    }

    // Apply each pending migration in order
    for (const migration of pendingMigrations) {
      await applyMigration(db, migration, silent);
    }

    if (!silent) {
      console.log('[Migrations] All migrations completed successfully');
    }
  } catch (error) {
    console.error('[Migrations] Migration process failed:', error);
    throw error;
  }
}

/**
 * Get current database schema version
 */
export async function getCurrentVersion(db: SQLiteDatabase): Promise<number> {
  try {
    const [results] = await db.executeSql(
      'SELECT MAX(version) as version FROM schema_migrations'
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
