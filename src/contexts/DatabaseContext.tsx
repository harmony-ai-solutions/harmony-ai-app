/**
 * App bootstrap context (task 3-4).
 *
 * Historically this opened the app-local SQLite replica. After the TS stack
 * deletion there is NO app-local database — the embedded engine's management
 * API is the single data layer (the engine sidecar lifecycle is owned by
 * `services/engine/EngineService`, started by `attachEngineLifecycle`). This
 * context now only hydrates the engine feature flags and reports boot readiness
 * to the app shell.
 */

import React, {createContext, useContext, useEffect, useState, ReactNode} from 'react';
import {loadEngineFeatureFlags} from '../config/engineFeatures';
import {attachEngineLifecycle} from '../services/engine/EngineLifecycle';
import {attachE2EEngineOverride} from '../services/engine/e2eEngineOverride';
import {attachOutreachNotifications} from '../services/notifications/OutreachNotificationService';
import {wireEngineVersionProbe} from '../services/engine/engineVersionProbe';
import {refreshUpdates} from '../services/updates/UpdateAvailableService';
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

export function DatabaseProvider({children}: DatabaseProviderProps) {
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const initializeDb = async () => {
    try {
      setIsLoading(true);
      setError(null);

      log.info('Initializing app data layer...');

      // Engine feature flags (3-2 data layer, 2-5 cloud-mode orchestration):
      // hydrate the persisted overrides before anything reads them. Best-effort
      // — a storage failure falls back to the build-time defaults.
      await loadEngineFeatureFlags();

      // No app-local database to open: the engine management API is the data
      // layer. The app is ready as soon as the flags are hydrated.
      setIsReady(true);
      log.info('App data layer ready (engine management API)');

      // 4-2: attach the AppState-driven engine lifecycle (start on foreground,
      // stop on background with a grace window on the iOS foreground tier). The
      // engine is REQUIRED (3-4), so it starts on the first foreground pass.
      attachEngineLifecycle();

      // 7-13: E2E-only engine-peer override. A no-op unless the e2e build
      // injected the container engine's LAN peer (BuildConfig); when it did, it
      // arms on engine readiness and points the embedded engine's sync client at
      // the container engine so the standard device-approval handshake runs.
      attachE2EEngineOverride();

      // 7-12: attach the outreach notification client (events WS + AppState
      // policy). It connects whenever an engine connection exists and posts
      // local notifications while backgrounded; a no-op without an engine.
      attachOutreachNotifications();

      // 7-10: wire the runtime contract canary (engine-version probe; evaluated
      // on host readiness) and kick the release-manifest update check. Both are
      // best-effort — a probe/manifest failure must never block boot.
      wireEngineVersionProbe();
      void refreshUpdates().catch(() => {});
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      log.error('App data layer initialization failed:', errorMessage);
      setError(errorMessage);
      setIsReady(false);
    } finally {
      setIsLoading(false);
    }
  };

  const retryInitialization = async () => {
    log.info('Retrying app data layer initialization...');
    await initializeDb();
  };

  useEffect(() => {
    initializeDb();
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
 * Hook to access the bootstrap context.
 */
export function useDatabase(): DatabaseContextType {
  const context = useContext(DatabaseContext);

  if (!context) {
    throw new Error('useDatabase must be used within a DatabaseProvider');
  }

  return context;
}
