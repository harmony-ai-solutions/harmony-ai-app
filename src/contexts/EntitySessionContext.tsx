import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import EntitySessionService, { InteractionSession } from '../services/EntitySessionService';
import { useSyncConnection } from './SyncConnectionContext';
import { createLogger } from '../utils/logger';

const log = createLogger('[EntitySessionContext]');

interface RetryState {
  attempts: number;
  nextRetryDelay: number;
  retryTimer?: any;
}

const DEFAULT_RETRY_POLICY = {
  maxAttempts: 3,
  initialDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 2
};

interface EntitySessionContextType {
  // Interaction session management
  activeSessions: Map<string, InteractionSession>;
  isSessionActive: (interactionId: string) => boolean;
  startInteractionSession: (ownEntityId: string, participantIds: string[], replyMode?: string) => Promise<void>;
  stopInteractionSession: (interactionId: string) => Promise<void>;
  getInteractionSession: (interactionId: string) => InteractionSession | null;

  // Message sending
  sendMessage: (interactionId: string, message: string) => Promise<void>;

  // Connection requirements
  canStartSession: boolean;
}

const EntitySessionContext = createContext<EntitySessionContextType | undefined>(undefined);

interface EntitySessionProviderProps {
  children: ReactNode;
}

export const EntitySessionProvider: React.FC<EntitySessionProviderProps> = ({ children }) => {
  const [activeSessions, setActiveSessions] = useState<Map<string, InteractionSession>>(new Map());
  const [retryState, setRetryState] = useState<Map<string, RetryState>>(new Map());
  const entitySessionService = EntitySessionService;
  const { isConnected: isSyncConnected } = useSyncConnection();

  const canStartSession = isSyncConnected;

  // Monitor sync connection and clean up sessions when it drops.
  useEffect(() => {
    if (!isSyncConnected) {
      log.warn('Sync connection lost, clearing all entity sessions');
      entitySessionService.closeAllSessions();
    }
  }, [isSyncConnected]);

  useEffect(() => {
    const handleSessionStarted = (interactionId: string, session: InteractionSession) => {
      log.info('Interaction session started:', interactionId);

      // Clear retry state and timers — clean up by both interactionId and
      // participant-based fallback key (used when session creation failed)
      setRetryState(prev => {
        const newMap = new Map(prev);
        // Clean up by interactionId
        const retry = newMap.get(interactionId);
        if (retry?.retryTimer) {
          clearTimeout(retry.retryTimer);
        }
        newMap.delete(interactionId);
        // Also clean up by participant-based fallback key
        const fallbackKey = session.participantIds.sort().join('+');
        const fallbackRetry = newMap.get(fallbackKey);
        if (fallbackRetry?.retryTimer) {
          clearTimeout(fallbackRetry.retryTimer);
        }
        newMap.delete(fallbackKey);
        return newMap;
      });

      setActiveSessions(prev => {
        const newMap = new Map(prev);
        // Remove stale entries with temp UUIDv7 keys pointing to the same session
        // (the InteractionService re-keys from temp UUIDv7 to canonical ID)
        for (const [key, existing] of newMap.entries()) {
          if (existing === session && key !== interactionId) {
            newMap.delete(key);
          }
        }
        newMap.set(interactionId, session);
        return newMap;
      });
    };

    const handleSessionStopped = (interactionId: string) => {
      log.info('Interaction session stopped:', interactionId);
      setActiveSessions(prev => {
        const newMap = new Map(prev);
        newMap.delete(interactionId);
        return newMap;
      });
    };

    const handleSessionError = (interactionId: string, error: string) => {
      log.error('Session error for interaction:', interactionId, error);
      setActiveSessions(prev => {
        const newMap = new Map(prev);
        newMap.delete(interactionId);
        return newMap;
      });
    };

    entitySessionService.on('session:started', handleSessionStarted);
    entitySessionService.on('session:stopped', handleSessionStopped);
    entitySessionService.on('session:error', handleSessionError);

    return () => {
      entitySessionService.off('session:started', handleSessionStarted);
      entitySessionService.off('session:stopped', handleSessionStopped);
      entitySessionService.off('session:error', handleSessionError);
    };
  }, []);

  const startInteractionSession = async (
    ownEntityId: string,
    participantIds: string[],
    replyMode: string = 'realistic'
  ): Promise<void> => {
    if (!canStartSession) {
      throw new Error('Sync connection required for entity sessions');
    }

    // Derive a participant-based key for pre-session retry deduplication.
    // After the session is created, we switch to interactionId as the primary key.
    const participantKey = participantIds.sort().join('+');

    // Clear any existing retry state for this participant set
    setRetryState(prev => {
      const newMap = new Map(prev);
      const retry = newMap.get(participantKey);
      if (retry?.retryTimer) {
        clearTimeout(retry.retryTimer);
      }
      newMap.delete(participantKey);
      return newMap;
    });

    log.info(`Starting interaction session: ownEntity=${ownEntityId}, participants=[${participantIds.join(', ')}]`);

    try {
      // This will create N+1 connections in 'connecting' state and return immediately
      // The sessions will transition to 'active' when INIT_ENTITY responses arrive
      const session = await entitySessionService.startInteractionSession(ownEntityId, participantIds, replyMode);

      // Add to state immediately (connections are 'connecting')
      setActiveSessions(prev => {
        const newMap = new Map(prev);
        newMap.set(session.interactionId, session);
        return newMap;
      });

      // Use session.interactionId as the primary key for all subsequent tracking
      startInitializationTimer(session.interactionId, ownEntityId, participantIds);
    } catch (error) {
      log.error(`Failed to start interaction session:`, error);
      // No interactionId available — use participant-based fallback key for retry
      scheduleRetry(participantKey, ownEntityId, participantIds, error);
      throw error;
    }
  };

  const startInitializationTimer = (
    interactionId: string,
    ownEntityId: string,
    participantIds: string[]
  ) => {
    // Use participantKey consistently as the retry state key so that
    // handleSessionStarted can find and cancel it via fallbackKey.
    // (interactionId may change from temp UUIDv7 to canonical — can't rely on it)
    const participantKey = participantIds.sort().join('+');

    // Wait up to 15 seconds for all connections to become active
    const timeoutId = setTimeout(() => {
      setActiveSessions(currentSessions => {
        // Find session by participant match (key may have changed from temp UUIDv7 to canonical)
        let foundSession: InteractionSession | null = null;
        let foundKey: string | null = null;
        for (const [key, s] of currentSessions.entries()) {
          if (s.ownEntityId === ownEntityId &&
              s.participantIds.sort().join('+') === participantKey) {
            foundSession = s;
            foundKey = key;
            break;
          }
        }

        if (!foundSession || !foundKey) {
          log.warn(`Initialization timeout: session for participants [${participantIds.join(', ')}] no longer exists`);
          return currentSessions;
        }

        // Check if any connection is still not active
        const allActive = Array.from(foundSession.connections.values()).every(
          conn => conn.status === 'active'
        );

        if (!allActive) {
          const statuses = Array.from(foundSession.connections.entries())
            .map(([eid, conn]) => `${eid}=${conn.status}`)
            .join(', ');
          log.warn(`Initialization timeout for ${foundKey}: ${statuses}`);

          // Trigger retry using participantKey (consistent with startInteractionSession catch path)
          const error = new Error('Session initialization timeout');
          scheduleRetry(participantKey, ownEntityId, participantIds, error);
        }
        return currentSessions;
      });
    }, 15000); // 15 second timeout

    // Store timeout ID in retry state under participantKey (not interactionId)
    setRetryState(prev => {
      const newMap = new Map(prev);
      const current = newMap.get(participantKey) || {
        attempts: 0,
        nextRetryDelay: DEFAULT_RETRY_POLICY.initialDelay
      };
      current.retryTimer = timeoutId;
      newMap.set(participantKey, current);
      return newMap;
    });
  };

  const scheduleRetry = (
    key: string,
    ownEntityId: string,
    participantIds: string[],
    error: any
  ) => {
    // Check if this is a retryable error
    if (!isRetryableError(error)) {
      log.info(`Error is not retryable for ${key}, giving up`);
      return;
    }

    setRetryState(prev => {
      const currentRetry = prev.get(key) || {
        attempts: 0,
        nextRetryDelay: DEFAULT_RETRY_POLICY.initialDelay
      };

      // Check if we've exceeded max attempts
      if (currentRetry.attempts >= DEFAULT_RETRY_POLICY.maxAttempts) {
        log.error(`Max retry attempts (${DEFAULT_RETRY_POLICY.maxAttempts}) exceeded for ${key}`);

        // Emit permanent failure - use a generic key
        entitySessionService.emit('session:error' as any, key,
          `Failed to initialize session after ${currentRetry.attempts} attempts`);

        const newMap = new Map(prev);
        newMap.delete(key);
        return newMap;
      }

      const nextAttempt = currentRetry.attempts + 1;
      const delay = Math.min(
        currentRetry.nextRetryDelay,
        DEFAULT_RETRY_POLICY.maxDelay
      );

      log.info(`Scheduling retry ${nextAttempt}/${DEFAULT_RETRY_POLICY.maxAttempts} for ${key} in ${delay}ms`);

      const newMap = new Map(prev);
      newMap.set(key, {
        attempts: nextAttempt,
        nextRetryDelay: delay * DEFAULT_RETRY_POLICY.backoffMultiplier,
        retryTimer: setTimeout(() => {
          retryInitialization(key, ownEntityId, participantIds);
        }, delay)
      });
      return newMap;
    });
  };

  const retryInitialization = async (
    key: string,
    ownEntityId: string,
    participantIds: string[],
    replyMode?: string
  ) => {
    log.info(`Retrying initialization for ${key}`);

    // Clean up any existing sessions with these participants
    // Find any active session that matches this participant set
    for (const [interactionId, session] of activeSessions.entries()) {
      if (session.ownEntityId === ownEntityId &&
          session.participantIds.sort().join('+') === participantIds.sort().join('+')) {
        await stopInteractionSession(interactionId);
      }
    }

    // Retry
    try {
      await startInteractionSession(ownEntityId, participantIds, replyMode);
    } catch (error) {
      log.error(`Retry failed for ${key}:`, error);
    }
  };

  const isRetryableError = (error: any): boolean => {
    const message = error?.message || '';
    // Don't retry if error explicitly says it's permanent
    if (message.includes('invalid entity') ||
        message.includes('not found') ||
        message.includes('Sync connection required')) {
      return false;
    }

    // Retry on network errors, timeouts, connection failures
    if (message.includes('timeout') ||
        message.includes('Connection') ||
        message.includes('network') ||
        error?.code === 'ECONNREFUSED' ||
        error?.code === 'ETIMEDOUT') {
      return true;
    }

    // Default: retry (conservative approach)
    return true;
  };

  const stopInteractionSession = async (interactionId: string): Promise<void> => {
    log.info(`Stopping interaction session for ${interactionId}`);

    // Cancel any pending retries — clean up by both interactionId and
    // participant-based fallback key to prevent orphaned timers
    const session = activeSessions.get(interactionId);
    setRetryState(prev => {
      const newMap = new Map(prev);
      // Clean up by interactionId
      const retry = prev.get(interactionId);
      if (retry?.retryTimer) {
        clearTimeout(retry.retryTimer);
        log.info(`Cancelled pending retry for ${interactionId}`);
      }
      newMap.delete(interactionId);
      // Also clean up by participant-based fallback key
      if (session) {
        const fallbackKey = session.participantIds.sort().join('+');
        const fallbackRetry = prev.get(fallbackKey);
        if (fallbackRetry?.retryTimer) {
          clearTimeout(fallbackRetry.retryTimer);
          log.info(`Cancelled pending fallback retry for ${fallbackKey}`);
        }
        newMap.delete(fallbackKey);
      }
      return newMap;
    });

    await entitySessionService.stopInteractionSession(interactionId);
    // Session will be removed from state via handleSessionStopped event
  };

  const sendMessage = async (interactionId: string, message: string): Promise<void> => {
    const session = activeSessions.get(interactionId);
    if (!session) {
      throw new Error(`No active session for interaction ${interactionId}`);
    }
    await entitySessionService.sendTextMessage(interactionId, message);
  };

  const isSessionActive = (interactionId: string): boolean => {
    const session = activeSessions.get(interactionId);
    if (!session) return false;

    // ALL connections must be 'active' (not just 'connecting')
    return Array.from(session.connections.values()).every(
      conn => conn.status === 'active'
    );
  };

  const getInteractionSession = (interactionId: string): InteractionSession | null => {
    return activeSessions.get(interactionId) || null;
  };

  const value: EntitySessionContextType = {
    activeSessions,
    isSessionActive,
    startInteractionSession,
    stopInteractionSession,
    getInteractionSession,
    sendMessage,
    canStartSession,
  };

  return (
    <EntitySessionContext.Provider value={value}>
      {children}
    </EntitySessionContext.Provider>
  );
};

export const useEntitySession = (): EntitySessionContextType => {
  const context = useContext(EntitySessionContext);
  if (!context) {
    throw new Error('useEntitySession must be used within EntitySessionProvider');
  }
  return context;
};
