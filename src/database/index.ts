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

// Database interface types
export type {
  Database,
  DatabaseTransaction,
  DatabaseResultSet,
  DatabaseOpenOptions,
} from './types';

// Type definitions
export * from './models';

// Repository exports
export * from './repositories/entities';
export * from './repositories/characters';
export * from './repositories/modules';

// Providers — split into per-file repositories (Phase 7-0a).
export * from './repositories/providers/shared';
export * from './repositories/providers/OpenAIProviderConfigRepository';
export * from './repositories/providers/OpenRouterProviderConfigRepository';
export * from './repositories/providers/OpenAICompatibleProviderConfigRepository';
export * from './repositories/providers/HarmonySpeechProviderConfigRepository';
export * from './repositories/providers/ElevenLabsProviderConfigRepository';
export * from './repositories/providers/KindroidProviderConfigRepository';
export * from './repositories/providers/KajiwotoProviderConfigRepository';
export * from './repositories/providers/CharacterAIProviderConfigRepository';
export * from './repositories/providers/LocalAIProviderConfigRepository';
export * from './repositories/providers/MistralProviderConfigRepository';
export * from './repositories/providers/OllamaProviderConfigRepository';
export * from './repositories/providers/ComfyUIProviderConfigRepository';
export * from './repositories/providers/XAIProviderConfigRepository';
export * from './repositories/providers/GoogleProviderConfigRepository';
export * from './repositories/providers/AnthropicProviderConfigRepository';
export * from './repositories/providers/SoulbitsCloudProviderConfigRepository';
