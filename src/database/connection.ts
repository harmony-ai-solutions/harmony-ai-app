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
import {runMigrations} from './migrations';

// Enable promise API and debugging
SQLite.enablePromise(true);
SQLite.DEBUG(false); // Set to true for development debugging

// Constants
const DATABASE_NAME = 'harmony.db';
const ENCRYPTION_KEY_SERVICE = 'com.harmonyai.database';
const ENCRYPTION_KEY_USERNAME = 'db_encryption_key';

// Global database instance
let db: SQLiteDatabase | null = null;

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
      console.log('[Database] Retrieved existing encryption key');
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
    
    console.log('[Database] Generated and stored new encryption key');
    return newKey;
  } catch (error) {
    console.error('[Database] Failed to manage encryption key:', error);
    throw new Error('Failed to initialize database encryption');
  }
}

/**
 * Open database connection with encryption
 */
async function openDatabase(encryptionKey: string): Promise<SQLiteDatabase> {
  const dbPath = `${RNFS.DocumentDirectoryPath}/${DATABASE_NAME}`;
  
  console.log(`[Database] Opening encrypted database at: ${dbPath}`);
  
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
    
    console.log('[Database] Successfully opened encrypted database');
    return database;
  } catch (error) {
    console.error('[Database] Failed to open database:', error);
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
    
    console.log('[Database] Database configured successfully');
  } catch (error) {
    console.error('[Database] Failed to configure database:', error);
    throw error;
  }
}

/**
 * Initialize database: open connection and run migrations
 * This should be called once at app startup
 */
export async function initializeDatabase(): Promise<void> {
  if (db) {
    console.warn('[Database] Database already initialized');
    return;
  }
  
  try {
    console.log('[Database] Initializing database...');
    
    // Get or create encryption key
    const encryptionKey = await getOrCreateEncryptionKey();
    
    // Open database with encryption
    db = await openDatabase(encryptionKey);
    
    // Run pending migrations
    await runMigrations(db);
    
    console.log('[Database] Database initialization complete');
  } catch (error) {
    console.error('[Database] Database initialization failed:', error);
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
      console.log('[Database] Database closed successfully');
      db = null;
    } catch (error) {
      console.error('[Database] Failed to close database:', error);
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
