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

      // Clear retry state and timers
      setRetryState(prev => {
        const newMap = new Map(prev);
        const retry = newMap.get(interactionId);
        if (retry?.retryTimer) {
          clearTimeout(retry.retryTimer);
        }
        newMap.delete(interactionId);
        return newMap;
      });

      setActiveSessions(prev => {
        const newMap = new Map(prev);
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

    // This uses the interactionId tracking from retry state
    // Use participantIds to create a temporary key for retry tracking
    const tempKey = participantIds.sort().join('+');

    // Clear any existing retry state for this key
    setRetryState(prev => {
      const newMap = new Map(prev);
      const retry = newMap.get(tempKey);
      if (retry?.retryTimer) {
        clearTimeout(retry.retryTimer);
      }
      newMap.delete(tempKey);
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

      // Start monitoring for initialization timeout
      startInitializationTimer(session.interactionId, ownEntityId, participantIds);
    } catch (error) {
      log.error(`Failed to start interaction session:`, error);
      // Attempt retry
      scheduleRetry(tempKey, ownEntityId, participantIds, error);
      throw error;
    }
  };

  const startInitializationTimer = (
    interactionId: string,
    ownEntityId: string,
    participantIds: string[]
  ) => {
    // Wait up to 15 seconds for all connections to become active
    const timeoutId = setTimeout(() => {
      setActiveSessions(currentSessions => {
        const session = currentSessions.get(interactionId);

        if (!session) {
          log.warn(`Initialization timeout: session ${interactionId} no longer exists`);
          return currentSessions;
        }

        // Check if any connection is still not active
        const allActive = Array.from(session.connections.values()).every(
          conn => conn.status === 'active'
        );

        if (!allActive) {
          const statuses = Array.from(session.connections.entries())
            .map(([eid, conn]) => `${eid}=${conn.status}`)
            .join(', ');
          log.warn(`Initialization timeout for ${interactionId}: ${statuses}`);

          // Trigger retry
          const error = new Error('Session initialization timeout');
          scheduleRetry(interactionId, ownEntityId, participantIds, error);
        }
        return currentSessions;
      });
    }, 15000); // 15 second timeout

    // Store timeout ID in retry state
    setRetryState(prev => {
      const newMap = new Map(prev);
      const current = newMap.get(interactionId) || {
        attempts: 0,
        nextRetryDelay: DEFAULT_RETRY_POLICY.initialDelay
      };
      current.retryTimer = timeoutId;
      newMap.set(interactionId, current);
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

    // Cancel any pending retries
    setRetryState(prev => {
      const retry = prev.get(interactionId);
      if (retry?.retryTimer) {
        clearTimeout(retry.retryTimer);
        log.info(`Cancelled pending retry for ${interactionId}`);
      }

      const newMap = new Map(prev);
      newMap.delete(interactionId);
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
