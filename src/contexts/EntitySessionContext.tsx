import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import EntitySessionService, { EntitySession } from '../services/EntitySessionService';
import { useSyncConnection } from './SyncConnectionContext';

interface EntitySessionContextType {
  activeSession: EntitySession | null;
  isSessionActive: (entityId: string) => boolean;
  startSession: (entityId: string, characterId: string) => Promise<void>;
  stopSession: (entityId: string) => Promise<void>;
  sendMessage: (entityId: string, message: string) => Promise<void>;
  canStartSession: boolean;
}

const EntitySessionContext = createContext<EntitySessionContextType | undefined>(undefined);

interface EntitySessionProviderProps {
  children: ReactNode;
}

export const EntitySessionProvider: React.FC<EntitySessionProviderProps> = ({ children }) => {
  const [activeSession, setActiveSession] = useState<EntitySession | null>(null);
  const entitySessionService = EntitySessionService;
  const { isConnected: isSyncConnected } = useSyncConnection();
  
  const canStartSession = isSyncConnected;

  useEffect(() => {
    const handleSessionStarted = (session: EntitySession) => {
      console.log('[EntitySessionContext] Session started:', session.entityId);
      setActiveSession(session);
    };

    const handleSessionStopped = (entityId: string) => {
      console.log('[EntitySessionContext] Session stopped:', entityId);
      setActiveSession(prev => prev?.entityId === entityId ? null : prev);
    };

    const handleSessionError = (entityId: string, error: string) => {
      console.error('[EntitySessionContext] Session error:', entityId, error);
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

  const startSession = async (entityId: string, characterId: string): Promise<void> => {
    if (!canStartSession) {
      throw new Error('Sync connection required for entity sessions');
    }

    console.log(`[EntitySessionContext] Starting session for entity ${entityId}`);
    const session = await entitySessionService.startEntitySession(entityId, characterId);
    setActiveSession(session);
  };

  const stopSession = async (entityId: string): Promise<void> => {
    console.log(`[EntitySessionContext] Stopping session for entity ${entityId}`);
    await entitySessionService.stopEntitySession(entityId);
  };

  const sendMessage = async (entityId: string, message: string): Promise<void> => {
    await entitySessionService.sendChatMessage(entityId, message);
  };

  const isSessionActive = (entityId: string): boolean => {
    return activeSession?.entityId === entityId && activeSession?.status === 'active';
  };

  const value: EntitySessionContextType = {
    activeSession,
    isSessionActive,
    startSession,
    stopSession,
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
