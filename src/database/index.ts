/**
 * Database Layer - Main Entry Point
 * 
 * Exports all database functionality for easy imports throughout the app.
 */

// Connection management
export {
  initializeDatabase,
  getDatabase,
  closeDatabase,
  isDatabaseReady,
  executeRawQuery,
  clearDatabaseData,
  wipeDatabaseCompletely,
} from './connection';

// Migration utilities
export {runMigrations, getCurrentVersion} from './migrations';

// Transaction helpers
export {withTransaction, execInTransaction} from './transaction';

// Type definitions
export * from './models';

// Repository exports
export * from './repositories/entities';
export * from './repositories/characters';
export * from './repositories/modules';
export * from './repositories/providers';
