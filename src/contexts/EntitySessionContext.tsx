import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import EntitySessionService, { EntitySession, DualEntitySession } from '../services/EntitySessionService';
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
  // Dual session management
  activeSessions: Map<string, DualEntitySession>;
  isDualSessionActive: (partnerEntityId: string) => boolean;
  startDualSession: (partnerEntityId: string, impersonatedEntityId?: string) => Promise<void>;
  stopDualSession: (partnerEntityId: string) => Promise<void>;
  getDualSession: (partnerEntityId: string) => DualEntitySession | null;
  
  // Message sending
  sendMessage: (partnerEntityId: string, message: string) => Promise<void>;
  
  // Connection requirements
  canStartSession: boolean;
}

const EntitySessionContext = createContext<EntitySessionContextType | undefined>(undefined);

interface EntitySessionProviderProps {
  children: ReactNode;
}

export const EntitySessionProvider: React.FC<EntitySessionProviderProps> = ({ children }) => {
  const [activeSessions, setActiveSessions] = useState<Map<string, DualEntitySession>>(new Map());
  const [retryState, setRetryState] = useState<Map<string, RetryState>>(new Map());
  const entitySessionService = EntitySessionService;
  const { isConnected: isSyncConnected } = useSyncConnection();
  
  const canStartSession = isSyncConnected;

  // Monitor sync connection and clean up sessions if it drops
  useEffect(() => {
    if (!isSyncConnected && activeSessions.size > 0) {
      log.warn('Sync connection lost, clearing all entity sessions');

      // Stop all sessions
      const partnerIds = Array.from(activeSessions.keys());
      for (const partnerId of partnerIds) {
        stopDualSession(partnerId).catch(err => {
          log.error(`Error stopping session ${partnerId}:`, err);
        });
      }
    }
  }, [isSyncConnected, activeSessions.size]);

  useEffect(() => {
    const handleSessionStarted = (partnerEntityId: string, dualSession: DualEntitySession) => {
      log.info('Dual session started for partner:', partnerEntityId);
      
      // Clear retry state and timers
      setRetryState(prev => {
        const newMap = new Map(prev);
        const retry = newMap.get(partnerEntityId);
        if (retry?.retryTimer) {
          clearTimeout(retry.retryTimer);
        }
        newMap.delete(partnerEntityId);
        return newMap;
      });

      setActiveSessions(prev => {
        const newMap = new Map(prev);
        newMap.set(partnerEntityId, dualSession);
        return newMap;
      });
    };

    const handleSessionStopped = (partnerEntityId: string) => {
      log.info('Dual session stopped for partner:', partnerEntityId);
      setActiveSessions(prev => {
        const newMap = new Map(prev);
        newMap.delete(partnerEntityId);
        return newMap;
      });
    };

    const handleSessionError = (partnerEntityId: string, error: string) => {
      log.error('Session error for partner:', partnerEntityId, error);
      // Optionally remove failed session from map
      setActiveSessions(prev => {
        const newMap = new Map(prev);
        newMap.delete(partnerEntityId);
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

  const startDualSession = async (partnerEntityId: string, impersonatedEntityId: string = 'user'): Promise<void> => {
    if (!canStartSession) {
      throw new Error('Sync connection required for entity sessions');
    }

    // Clear any existing retry state
    setRetryState(prev => {
      const newMap = new Map(prev);
      const retry = newMap.get(partnerEntityId);
      if (retry?.retryTimer) {
        clearTimeout(retry.retryTimer);
      }
      newMap.delete(partnerEntityId);
      return newMap;
    });

    log.info(`Starting dual session: partner=${partnerEntityId}, user=${impersonatedEntityId}`);
    
    try {
      // This will create sessions in 'connecting' state and return immediately
      // The sessions will transition to 'active' when INIT_ENTITY responses arrive
      const dualSession = await entitySessionService.startDualSession(partnerEntityId, impersonatedEntityId);
      
      // Add to state immediately (sessions are 'connecting')
      setActiveSessions(prev => {
        const newMap = new Map(prev);
        newMap.set(partnerEntityId, dualSession);
        return newMap;
      });
      
      // Start monitoring for initialization timeout
      startInitializationTimer(partnerEntityId, impersonatedEntityId);
    } catch (error) {
      log.error(`Failed to start dual session for ${partnerEntityId}:`, error);
      // Attempt retry
      scheduleRetry(partnerEntityId, impersonatedEntityId, error);
      throw error;
    }
  };

  const startInitializationTimer = (partnerEntityId: string, impersonatedEntityId: string) => {
    // Wait up to 15 seconds for both sessions to become active
    const timeoutId = setTimeout(() => {
      setActiveSessions(currentSessions => {
        const session = currentSessions.get(partnerEntityId);
        
        if (!session) {
          log.warn(`Initialization timeout: session ${partnerEntityId} no longer exists`);
          return currentSessions;
        }
        
        // Check if still not active
        if (session.userSession.status !== 'active' || session.partnerSession.status !== 'active') {
          log.warn(`Initialization timeout for ${partnerEntityId}: user=${session.userSession.status}, partner=${session.partnerSession.status}`);
          
          // Trigger retry
          const error = new Error('Session initialization timeout');
          scheduleRetry(partnerEntityId, impersonatedEntityId, error);
        }
        return currentSessions;
      });
    }, 15000); // 15 second timeout
    
    // Store timeout ID in retry state
    setRetryState(prev => {
      const newMap = new Map(prev);
      const current = newMap.get(partnerEntityId) || {
        attempts: 0,
        nextRetryDelay: DEFAULT_RETRY_POLICY.initialDelay
      };
      current.retryTimer = timeoutId;
      newMap.set(partnerEntityId, current);
      return newMap;
    });
  };

  const scheduleRetry = (partnerEntityId: string, impersonatedEntityId: string, error: any) => {
    // Check if this is a retryable error
    if (!isRetryableError(error)) {
      log.info(`Error is not retryable for ${partnerEntityId}, giving up`);
      return;
    }
    
    setRetryState(prev => {
      const currentRetry = prev.get(partnerEntityId) || {
        attempts: 0,
        nextRetryDelay: DEFAULT_RETRY_POLICY.initialDelay
      };
      
      // Check if we've exceeded max attempts
      if (currentRetry.attempts >= DEFAULT_RETRY_POLICY.maxAttempts) {
        log.error(`Max retry attempts (${DEFAULT_RETRY_POLICY.maxAttempts}) exceeded for ${partnerEntityId}`);
        
        // Emit permanent failure
        entitySessionService.emit('session:error', partnerEntityId, 
          `Failed to initialize session after ${currentRetry.attempts} attempts`);
        
        const newMap = new Map(prev);
        newMap.delete(partnerEntityId);
        return newMap;
      }
      
      const nextAttempt = currentRetry.attempts + 1;
      const delay = Math.min(
        currentRetry.nextRetryDelay,
        DEFAULT_RETRY_POLICY.maxDelay
      );
      
      log.info(`Scheduling retry ${nextAttempt}/${DEFAULT_RETRY_POLICY.maxAttempts} for ${partnerEntityId} in ${delay}ms`);
      
      const newMap = new Map(prev);
      newMap.set(partnerEntityId, {
        attempts: nextAttempt,
        nextRetryDelay: delay * DEFAULT_RETRY_POLICY.backoffMultiplier,
        retryTimer: setTimeout(() => {
          retryInitialization(partnerEntityId, impersonatedEntityId);
        }, delay)
      });
      return newMap;
    });
  };

  const retryInitialization = async (partnerEntityId: string, impersonatedEntityId: string) => {
    log.info(`Retrying initialization for ${partnerEntityId}`);
    
    // Clean up any existing session
    await stopDualSession(partnerEntityId);
    
    // Retry
    try {
      await startDualSession(partnerEntityId, impersonatedEntityId);
    } catch (error) {
      log.error(`Retry failed for ${partnerEntityId}:`, error);
      // scheduleRetry will be called again by startDualSession's catch block
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

  const stopDualSession = async (partnerEntityId: string): Promise<void> => {
    log.info(`Stopping dual session for partner ${partnerEntityId}`);
    
    // Cancel any pending retries
    setRetryState(prev => {
      const retry = prev.get(partnerEntityId);
      if (retry?.retryTimer) {
        clearTimeout(retry.retryTimer);
        log.info(`Cancelled pending retry for ${partnerEntityId}`);
      }
      
      const newMap = new Map(prev);
      newMap.delete(partnerEntityId);
      return newMap;
    });
    
    await entitySessionService.stopSession(partnerEntityId);
    // Session will be removed from state via handleSessionStopped event
  };

  const sendMessage = async (partnerEntityId: string, message: string): Promise<void> => {
    const session = activeSessions.get(partnerEntityId);
    if (!session) {
      throw new Error(`No active session for partner ${partnerEntityId}`);
    }
    await entitySessionService.sendTextMessage(partnerEntityId, message);
  };

  const isDualSessionActive = (partnerEntityId: string): boolean => {
    const session = activeSessions.get(partnerEntityId);
    if (!session) return false;
    
    // BOTH sessions must be 'active', not just 'connecting'
    return session.userSession.status === 'active' && 
           session.partnerSession.status === 'active';
  };

  const getDualSession = (partnerEntityId: string): DualEntitySession | null => {
    return activeSessions.get(partnerEntityId) || null;
  };

  const value: EntitySessionContextType = {
    activeSessions,
    isDualSessionActive,
    startDualSession,
    stopDualSession,
    getDualSession,
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
