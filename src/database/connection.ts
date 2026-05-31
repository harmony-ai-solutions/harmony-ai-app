/**
 * Database Connection Management with Encryption Support
 * 
 * This module handles:
 * - Opening/closing encrypted SQLite database
 * - Encryption key generation and secure storage (via React Native Keychain)
 * - Database configuration (foreign keys, WAL mode)
 * - Connection pooling and lifecycle management
 */

import SQLite, {SQLiteDatabase} from 'react-native-sqlite-storage';
import RNFS from 'react-native-fs';
import * as Keychain from 'react-native-keychain';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {runMigrations} from './migrations';
import {createLogger} from '../utils/logger';

const log = createLogger('[Database]');

// Enable promise API and debugging
SQLite.enablePromise(true);
SQLite.DEBUG(false); // Set to true for development debugging

// Constants
const DATABASE_NAME = 'harmony.db';
const ENCRYPTION_KEY_SERVICE = 'com.harmonyai.database';
const ENCRYPTION_KEY_USERNAME = 'db_encryption_key';

// Global database instance
let db: SQLiteDatabase | null = null;

// Secondary database connection used exclusively by the sync pipeline.
// WAL mode (enabled in configureDatabase) allows concurrent reads on the
// main connection while this one runs heavy write transactions — so
// ChatDetailScreen message queries are never blocked by a sync.
let syncDb: SQLiteDatabase | null = null;

/**
 * Generate a cryptographically secure random encryption key
 * Returns a hex-encoded string suitable for SQLCipher
 */
function generateEncryptionKey(): string {
  // Generate 32 bytes (256 bits) of random data
  const array = new Uint8Array(32);
  
  // Use React Native's crypto polyfill
  for (let i = 0; i < array.length; i++) {
    array[i] = Math.floor(Math.random() * 256);
  }
  
  // Convert to hex string
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Retrieve or generate database encryption key
 * Keys are securely stored in the device keychain
 */
async function getOrCreateEncryptionKey(): Promise<string> {
  try {
    // Try to retrieve existing key
    const credentials = await Keychain.getGenericPassword({
      service: ENCRYPTION_KEY_SERVICE,
    });
    
    if (credentials && credentials.password) {
      log.info('Retrieved existing encryption key');
      return credentials.password;
    }
    
    // Generate new key if none exists
    const newKey = generateEncryptionKey();
    
    // Store securely in keychain
    await Keychain.setGenericPassword(
      ENCRYPTION_KEY_USERNAME,
      newKey,
      {
        service: ENCRYPTION_KEY_SERVICE,
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
      }
    );
    
    log.info('Generated and stored new encryption key');
    return newKey;
  } catch (error) {
    log.error('Failed to manage encryption key:', error);
    throw new Error('Failed to initialize database encryption');
  }
}

/**
 * Open database connection with encryption
 */
async function openDatabase(encryptionKey: string): Promise<SQLiteDatabase> {
  const dbPath = `${RNFS.DocumentDirectoryPath}/${DATABASE_NAME}`;
  
  log.info(`Opening encrypted database at: ${dbPath}`);
  
  try {
    // Open database with encryption
    // SQLite location: default (documents directory)
    const database = await SQLite.openDatabase({
      name: DATABASE_NAME,
      location: 'default',
      key: encryptionKey, // Enable SQLCipher encryption
    });
    
    // Configure database settings
    await configureDatabase(database);
    
    log.info('Successfully opened encrypted database');
    return database;
  } catch (error) {
    log.error('Failed to open database:', error);
    throw error;
  }
}

/**
 * Configure database settings for optimal performance and data integrity
 */
async function configureDatabase(database: SQLiteDatabase): Promise<void> {
  try {
    // Enable foreign key constraints (CRITICAL for CASCADE deletes)
    await database.executeSql('PRAGMA foreign_keys = ON;');
    
    // Enable Write-Ahead Logging for better concurrency
    await database.executeSql('PRAGMA journal_mode = WAL;');
    
    // Set synchronous mode for better performance while maintaining safety
    await database.executeSql('PRAGMA synchronous = NORMAL;');
    
    log.info('Database configured successfully');
  } catch (error) {
    log.error('Failed to configure database:', error);
    throw error;
  }
}

/**
 * Initialize database: open connection and run migrations
 * This should be called once at app startup
 */
export async function initializeDatabase(
  silent: boolean = false
): Promise<void> {
  if (db) {
    if (!silent) {
      log.warn('Database already initialized');
    }
    return;
  }

  try {
    if (!silent) {
      log.info('Initializing database...');
    }

    // Get or create encryption key
    const encryptionKey = await getOrCreateEncryptionKey();

    // Open database with encryption
    db = await openDatabase(encryptionKey);

    // Run pending migrations
    await runMigrations(db, silent);

    if (!silent) {
      log.info('Database initialization complete');
    }
  } catch (error) {
    log.error('Database initialization failed:', error);
    db = null;
    throw error;
  }
}

/**
 * Get the current database connection
 * Throws error if database is not initialized
 */
export function getDatabase(): SQLiteDatabase {
  if (!db) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return db;
}

/**
 * Close the database connection
 * Should be called when the app is closing
 */
export async function closeDatabase(): Promise<void> {
  if (db) {
    try {
      await db.close();
      log.info('Database closed successfully');
      db = null;
    } catch (error) {
      log.error('Failed to close database:', error);
      throw error;
    }
  }
}

/**
 * Check if database is initialized and ready
 */
export function isDatabaseReady(): boolean {
  return db !== null;
}

/**
 * Clear all data and schema from the database and re-initialize (USE ONLY FOR TESTING)
 */
export async function clearDatabaseData(
  silent: boolean = false
): Promise<void> {
  const database = getDatabase();
  if (!silent) {
    log.info('Dropping all tables for a clean test state...');
  }

  try {
    // Disable foreign keys to allow dropping tables in any order
    await database.executeSql('PRAGMA foreign_keys = OFF;');

    // Get all table names
    const [results] = await database.executeSql(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';"
    );

    for (let i = 0; i < results.rows.length; i++) {
      const tableName = results.rows.item(i).name;
      await database.executeSql(`DROP TABLE IF EXISTS ${tableName};`);
    }

    // Re-enable foreign keys
    await database.executeSql('PRAGMA foreign_keys = ON;');

    if (!silent) {
      log.info('Schema dropped. Re-applying migrations...');
    }

    // Re-run migrations to create tables fresh
    await runMigrations(database, silent);

    if (!silent) {
      log.info('Database reset complete');
    }
  } catch (error) {
    log.error('Failed to reset database:', error);
    throw error;
  }
}

/**
 * Completely wipe the database file and encryption key
 * This works even if the database is not initialized or corrupted
 * USE WITH EXTREME CAUTION - ALL DATA WILL BE PERMANENTLY LOST
 */
export async function wipeDatabaseCompletely(
  silent: boolean = false
): Promise<void> {
  if (!silent) {
    log.info('Wiping database completely...');
  }

  try {
    // Step 1: Close existing connection if any
    if (db) {
      try {
        await db.close();
        db = null;
        if (!silent) {
          log.info('Closed existing database connection');
        }
      } catch (error) {
        log.warn('Failed to close database connection (may already be closed):', error);
        db = null;
      }
    }

    // Step 2: Clear the encryption key from keychain FIRST
    // This ensures we don't try to open the old database with the old key
    try {
      await Keychain.resetGenericPassword({
        service: ENCRYPTION_KEY_SERVICE,
      });
      if (!silent) {
        log.info('Cleared encryption key from keychain');
      }
    } catch (error) {
      log.warn('Failed to clear encryption key (may not exist):', error);
    }

    // Step 2b: Clear sync timestamp from AsyncStorage to allow full sync after wipe
    // This ensures the app requests all data from Harmony Link instead of just changes since last sync
    try {
      await AsyncStorage.removeItem('last_sync_timestamp');
      if (!silent) {
        log.info('Cleared last_sync_timestamp from AsyncStorage');
      }
    } catch (error) {
      log.warn('Failed to clear last_sync_timestamp:', error);
    }

    // Step 3: Force a small delay to ensure SQLite releases all file handles
    await new Promise(resolve => setTimeout(() => resolve(undefined), 200));

    // Step 4: Use SQLite's own deleteDatabase API to properly remove the database
    // This handles SQLite's internal caching and ensures a clean deletion
    try {
      await SQLite.deleteDatabase(DATABASE_NAME);
      if (!silent) {
        log.info('Deleted database using SQLite API');
      }
    } catch (error) {
      log.warn('SQLite deleteDatabase failed, trying manual file deletion:', error);
      
      // Fallback to manual deletion if SQLite API fails
      const dbPath = `${RNFS.DocumentDirectoryPath}/${DATABASE_NAME}`;
      const filesToDelete = [
        dbPath,
        `${dbPath}-wal`,
        `${dbPath}-shm`,
        `${dbPath}-journal`,
      ];

      for (const filePath of filesToDelete) {
        try {
          if (await RNFS.exists(filePath)) {
            await RNFS.unlink(filePath);
            if (!silent) {
              log.info(`Manually deleted ${filePath.split('/').pop()}`);
            }
          }
        } catch (fileError) {
          log.warn(`Failed to delete ${filePath}:`, fileError);
        }
      }
    }

    // Step 5: Another small delay to ensure file system operations complete
    await new Promise(resolve => setTimeout(() => resolve(undefined), 100));

    if (!silent) {
      log.info('Database files wiped. Re-initializing with fresh database...');
    }

    // Step 6: Reinitialize the database (this will create new encryption key and fresh DB)
    await initializeDatabase(silent);

    if (!silent) {
      log.info('Database reinitialized successfully with fresh schema');
    }
  } catch (error) {
    log.error('Failed to wipe database:', error);
    throw error;
  }
}

/**
 * Execute a raw SQL query (for debugging/testing)
 * Use repositories for production code
 */
export async function executeRawQuery(
  sql: string,
  params?: any[]
): Promise<any> {
  const database = getDatabase();
  const [results] = await database.executeSql(sql, params);
  return results;
}

/**
 * Get a secondary database connection reserved for sync write-transactions.
 *
 * The main `getDatabase()` connection is used by all UI-facing reads (message
 * loading, chat-list queries, etc.).  The sync pipeline's `applyBufferedSyncData`
 * can hold a write-transaction for several seconds while applying hundreds of
 * records.  Because the app uses a single shared connection, that transaction
 * blocks every other `executeSql` call — including the queries that
 * ChatDetailScreen needs to load messages on entry.
 *
 * Opening a *second* connection to the same encrypted database gives the sync
 * pipeline its own transaction scope.  With WAL mode enabled
 * (`PRAGMA journal_mode = WAL`, set in `configureDatabase`), SQLite allows
 * concurrent reads on the main connection while this one writes — so the UI
 * stays responsive even during a full sync.
 *
 * No migrations are run on this connection; they are guaranteed to have been
 * applied already by the primary connection during `initializeDatabase()`.
 */
export async function getSyncDatabase(): Promise<SQLiteDatabase> {
  if (syncDb) {
    return syncDb;
  }

  if (!db) {
    throw new Error(
      'Main database not initialized. Call initializeDatabase() first.',
    );
  }

  log.info('Opening secondary database connection for sync…');

  const encryptionKey = await getOrCreateEncryptionKey();
  syncDb = await SQLite.openDatabase({
    name: DATABASE_NAME,
    location: 'default',
    key: encryptionKey,
  });

  // Apply the same PRAGMA settings (foreign keys, WAL, synchronous)
  await configureDatabase(syncDb);

  log.info('Sync database connection opened');
  return syncDb;
}

/**
 * Close the secondary sync database connection.
 * Called during app shutdown alongside closeDatabase().
 */
export async function closeSyncDatabase(): Promise<void> {
  if (syncDb) {
    try {
      await syncDb.close();
      log.info('Sync database connection closed');
      syncDb = null;
    } catch (error) {
      log.error('Failed to close sync database:', error);
      syncDb = null;
    }
  }
}
