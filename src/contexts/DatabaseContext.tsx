/**
 * Database Context
 * 
 * Manages database initialization and provides database status to the entire app
 */

import React, {createContext, useContext, useEffect, useState, ReactNode} from 'react';
import {initializeDatabase, isDatabaseReady, closeDatabase} from '../database';
import {createLogger} from '../utils/logger';

const log = createLogger('[DatabaseContext]');

interface DatabaseContextType {
  isReady: boolean;
  isLoading: boolean;
  error: string | null;
  retryInitialization: () => Promise<void>;
}

const DatabaseContext = createContext<DatabaseContextType>({
  isReady: false,
  isLoading: true,
  error: null,
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

  const initializeDb = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      log.info('Initializing database...');
      await initializeDatabase();
      
      // Verify database is ready
      const ready = isDatabaseReady();
      setIsReady(ready);
      
      if (ready) {
        log.info('Database initialized successfully');
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
