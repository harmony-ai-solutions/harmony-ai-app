/**
 * Database Context
 * 
 * Manages database initialization and provides database status to the entire app
 */

import React, {createContext, useContext, useEffect, useState, ReactNode} from 'react';
import {initializeDatabase, isDatabaseReady, closeDatabase} from '../database';
import {runWipeRebuildIfPending} from '../services/WipeRebuildFlag';
import {createLogger} from '../utils/logger';

const log = createLogger('[DatabaseContext]');

interface DatabaseContextType {
  isReady: boolean;
  isLoading: boolean;
  error: string | null;
  /**
   * True while the one-time wipe-and-rebuild runs in the boot window (D61).
   * Feeds the "Rebuilding from Soulbits Engine…" label on the loading screen
   * (D58 as amended by D61) and clears when the WIPE completes — not when the
   * first post-wipe pull finalizes.
   */
  isRebuilding: boolean;
  retryInitialization: () => Promise<void>;
}

const DatabaseContext = createContext<DatabaseContextType>({
  isReady: false,
  isLoading: true,
  error: null,
  isRebuilding: false,
  retryInitialization: async () => {},
});

interface DatabaseProviderProps {
  children: ReactNode;
}

/**
 * Database Provider Component
 * 
 * Initializes the database on mount and provides status to child components
 */
export function DatabaseProvider({children}: DatabaseProviderProps) {
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRebuilding, setIsRebuilding] = useState(false);

  const initializeDb = async () => {
    try {
      setIsLoading(true);
      setError(null);
      setIsRebuilding(false);

      log.info('Initializing database...');

      // D61 boot-window wipe check — the FIRST step of initializeDb, strictly
      // before any sync trigger fires (React mounts screens child-first, before
      // the on-connect sync effect) and before the DB is opened, so no screen
      // ever renders against a half-wiped database. One-time persisted flag:
      // read → wipe (close lazy syncDb + reset SyncService state + production
      // wipe + D19 prefs sweep) → clear flag → initializeDatabase(). Reused
      // set-only by phase 4-5's purge-floor rebuild reaction.
      const wiped = await runWipeRebuildIfPending(setIsRebuilding);

      await initializeDatabase();

      // Verify database is ready
      const ready = isDatabaseReady();
      setIsReady(ready);

      if (ready) {
        log.info(
          wiped
            ? 'Database initialized successfully (after wipe-rebuild)'
            : 'Database initialized successfully',
        );
      } else {
        throw new Error('Database initialization completed but database is not ready');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      log.error('Database initialization failed:', errorMessage);
      setError(errorMessage);
      setIsReady(false);
    } finally {
      setIsLoading(false);
    }
  };

  const retryInitialization = async () => {
    log.info('Retrying database initialization...');
    await initializeDb();
  };

  useEffect(() => {
    // Initialize database on mount
    initializeDb();

    // Cleanup on unmount
    return () => {
      log.info('Cleaning up database connection...');
      closeDatabase().catch(err => {
        log.error('Failed to close database:', err);
      });
    };
  }, []);

  return (
    <DatabaseContext.Provider
      value={{
        isReady,
        isLoading,
        error,
        isRebuilding,
        retryInitialization,
      }}>
      {children}
    </DatabaseContext.Provider>
  );
}

/**
 * Hook to access database context
 */
export function useDatabase(): DatabaseContextType {
  const context = useContext(DatabaseContext);
  
  if (!context) {
    throw new Error('useDatabase must be used within a DatabaseProvider');
  }
  
  return context;
}
