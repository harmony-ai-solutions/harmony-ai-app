import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import ConnectionStateManager from '../services/ConnectionStateManager';
import ConnectionManager from '../services/connection/ConnectionManager';
import SyncService from '../services/SyncService';
import { ToastAndroid, Platform, Alert } from 'react-native';

interface SyncConnectionContextType {
  // Pairing state
  isPaired: boolean;
  
  // Sync connection state
  isConnected: boolean;
  isConnecting: boolean;
  isReconnecting: boolean;
  reconnectAttempt: number;
  nextReconnectIn: number;
  
  // Actions
  connect: () => Promise<void>;
  disconnect: () => void;
  reconnect: () => Promise<void>;
  
  // UI helpers
  showToast: (message: string) => void;
}

const SyncConnectionContext = createContext<SyncConnectionContextType | undefined>(undefined);

interface SyncConnectionProviderProps {
  children: ReactNode;
}

export const SyncConnectionProvider: React.FC<SyncConnectionProviderProps> = ({ children }) => {
  const [isPaired, setIsPaired] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [nextReconnectIn, setNextReconnectIn] = useState(0);
  const [reconnectTimeoutId, setReconnectTimeoutId] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [lastConnectionError, setLastConnectionError] = useState<string>('');
  
  const hasInitialized = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const connectionManager = ConnectionManager;
  
  const RECONNECT_INTERVALS = [1000, 2000, 4000, 8000, 16000, 30000];

  useEffect(() => {
    // Listen to sync connection events from ConnectionManager
    const handleSyncConnected = () => {
      console.log('[SyncConnectionContext] Sync connected');
      ConnectionStateManager.markConnected();
      setIsConnected(true);
      setIsConnecting(false);
      setIsReconnecting(false);
      reconnectAttemptsRef.current = 0;
      setReconnectAttempts(0);
      setNextReconnectIn(0);
      setLastConnectionError('');
      showToast('Connected to Harmony Link');
    };

    const handleSyncDisconnected = () => {
      console.log('[SyncConnectionContext] Sync disconnected');
      ConnectionStateManager.markDisconnected();
      setIsConnected(false);
      
      // Only schedule reconnect if we're not already handling a connection failure
      // (i.e., if we were successfully connected and then disconnected)
      // If isConnecting is true, it means we're in the middle of a connection attempt
      // that failed, and the catch block will handle scheduling the reconnect
      if (isPaired && !isReconnecting && !isConnecting) {
        console.log('[SyncConnectionContext] Connection lost. Scheduling auto-reconnect...');
        scheduleReconnect();
      } else if (isConnecting) {
        console.log('[SyncConnectionContext] Disconnect during connection attempt - catch block will handle reconnect');
      }
      
      setIsConnecting(false);
    };

    const handleSyncError = (error: any) => {
      console.error('[SyncConnectionContext] Sync connection error:', error);
      const errorMessage = error?.message || error?.toString?.() || 'Connection error';
      setLastConnectionError(errorMessage);
      
      // Only show toast for the first connection attempt, not during reconnects
      if (reconnectAttempts === 0 && !isReconnecting) {
        showToast(`Connection error: ${errorMessage}`);
      }
      
      // Connection errors usually mean the connection is broken, schedule reconnect
      // This handles cases where the connection drops after being established
      if (isConnected && isPaired && !isReconnecting && !isConnecting) {
        console.log('[SyncConnectionContext] Connection error detected while connected, scheduling reconnect...');
        ConnectionStateManager.markDisconnected();
        setIsConnected(false);
        scheduleReconnect();
      }
    };

    const handleCertVerificationFailed = (error: any) => {
      console.log('[SyncConnectionContext] Certificate verification failed');
      if (reconnectTimeoutId) {
        clearTimeout(reconnectTimeoutId);
        setReconnectTimeoutId(null);
      }
      setIsReconnecting(false);
      setNextReconnectIn(0);
    };

    const handleStateChange = (state: any) => {
      console.log('[SyncConnectionContext] State changed:', state);
      setIsPaired(state.isPaired || false);
      setIsConnected(state.isConnected || false);
    };

    const handleSyncCompleted = (session: any) => {
      console.log('[SyncConnectionContext] Sync completed:', session);
      showToast(`Sync complete! Sent: ${session.recordsSent}, Received: ${session.recordsReceived}`);
    };

    const handleSyncErrorEvent = (error: string) => {
      console.error('[SyncConnectionContext] Sync service error:', error);
      showToast(`Sync failed: ${error}`);
    };

    // ConnectionManager event listeners
    connectionManager.on('connected:sync', handleSyncConnected);
    connectionManager.on('disconnected:sync', handleSyncDisconnected);
    connectionManager.on('error:sync', handleSyncError);
    connectionManager.on('cert:verification_failed', handleCertVerificationFailed);
    
    // ConnectionStateManager listeners
    ConnectionStateManager.on('state:changed', handleStateChange);

    // SyncService listeners
    SyncService.on('sync:completed', handleSyncCompleted);
    SyncService.on('sync:error', handleSyncErrorEvent);

    // Initialize on mount
    if (!hasInitialized.current) {
      hasInitialized.current = true;
      initializeConnection();
    }

    return () => {
      connectionManager.off('connected:sync', handleSyncConnected);
      connectionManager.off('disconnected:sync', handleSyncDisconnected);
      connectionManager.off('error:sync', handleSyncError);
      connectionManager.off('cert:verification_failed', handleCertVerificationFailed);
      ConnectionStateManager.off('state:changed', handleStateChange);
      SyncService.off('sync:completed', handleSyncCompleted);
      SyncService.off('sync:error', handleSyncErrorEvent);
      
      if (reconnectTimeoutId) {
        clearTimeout(reconnectTimeoutId);
      }
    };
  }, [isPaired, reconnectTimeoutId, lastConnectionError, reconnectAttempts, isReconnecting]);

  const scheduleReconnect = () => {
    if (reconnectTimeoutId !== null) {
      console.log('[SyncConnectionContext] Reconnect already scheduled');
      return;
    }
    
    // Use ref for counter to avoid stale closure issues
    const currentAttempt = reconnectAttemptsRef.current;
    const delay = RECONNECT_INTERVALS[Math.min(currentAttempt, RECONNECT_INTERVALS.length - 1)];
    const attemptNumber = currentAttempt + 1;
    
    console.log(`[SyncConnectionContext] Scheduling reconnect attempt ${attemptNumber} in ${delay}ms`);
    
    setIsReconnecting(true);
    setNextReconnectIn(delay);
    
    const timeoutId = setTimeout(async () => {
      console.log(`[SyncConnectionContext] Executing reconnect attempt ${attemptNumber}`);
      
      // Update both ref and state
      reconnectAttemptsRef.current = attemptNumber;
      setReconnectAttempts(attemptNumber);
      setNextReconnectIn(0);
      setReconnectTimeoutId(null);
      
      try {
        // Check if JWT token is expired before attempting connection
        const isTokenExpired = ConnectionStateManager.getIsTokenExpired();
        
        if (isTokenExpired) {
          console.log('[SyncConnectionContext] Token expired, performing handshake to refresh...');
          await connectWithRefresh();
        } else {
          console.log('[SyncConnectionContext] Token valid, connecting normally...');
          await connect();
        }
      } catch (error) {
        console.error('[SyncConnectionContext] Auto-reconnect failed:', error);
        // Schedule next reconnect attempt - ref already incremented
        console.log('[SyncConnectionContext] Scheduling next reconnect after failed attempt');
        scheduleReconnect();
      }
    }, delay);
    
    setReconnectTimeoutId(timeoutId);
  };

  const reconnect = async (): Promise<void> => {
    console.log('[SyncConnectionContext] Manual reconnect triggered');
    
    if (reconnectTimeoutId) {
      clearTimeout(reconnectTimeoutId);
      setReconnectTimeoutId(null);
    }
    
    reconnectAttemptsRef.current = 0;
    setReconnectAttempts(0);
    setIsReconnecting(false);
    setNextReconnectIn(0);
    
    // Disconnect existing sync connection
    connectionManager.disconnectConnection('sync');
    await ConnectionStateManager.markDisconnected();
    setIsConnected(false);
    
    await connect();
  };

  const initializeConnection = async () => {
    try {
      await ConnectionStateManager.initialize();
      const summary = ConnectionStateManager.getConnectionSummary();
      
      setIsPaired(summary.isPaired);
      setIsConnected(summary.isConnected);
      
      console.log('[SyncConnectionContext] Initialized:', summary);
      
      if (summary.isPaired && !summary.isTokenExpired) {
        console.log('[SyncConnectionContext] Auto-connecting...');
        try {
          await connect();
        } catch (connectError: any) {
          console.log('[SyncConnectionContext] Scheduling reconnect after initialization failure');
          scheduleReconnect();
        }
      } else if (summary.isPaired && summary.requiresRepair) {
        console.log('[SyncConnectionContext] Token expired, attempting re-handshake...');
        await connectWithRefresh();
      }
    } catch (error) {
      console.error('[SyncConnectionContext] Initialization error:', error);
    }
  };

  const connect = async (): Promise<void> => {
    if (isConnecting) {
      console.log('[SyncConnectionContext] Already connecting');
      return;
    }

    try {
      setIsConnecting(true);
      console.log('[SyncConnectionContext] Connecting to sync...');
      
      const savedMode = await ConnectionStateManager.getSecurityMode();
      const url = savedMode === 'unencrypted'
        ? await ConnectionStateManager.getWSUrl()
        : await ConnectionStateManager.getWSSUrl();
      
      if (!url) {
        throw new Error('No server URL configured');
      }
      
      const mode = savedMode || 'secure';
      
      // Create sync connection via ConnectionManager
      await connectionManager.createConnection('sync', 'sync', url, mode as any);
      
      console.log('[SyncConnectionContext] Sync connection established');
    } catch (error: any) {
      console.error('[SyncConnectionContext] Connect failed:', error);
      const errorMessage = error?.message || 'Unknown error';
      setLastConnectionError(errorMessage);
      setIsConnecting(false);
      setIsConnected(false);
      
      if (reconnectAttempts === 0) {
        showToast('Failed to connect to Harmony Link');
      }
      
      throw error;
    }
  };

  const connectWithRefresh = async (): Promise<void> => {
    if (isConnecting) return;

    try {
      setIsConnecting(true);
      console.log('[SyncConnectionContext] Attempting to refresh token...');
      
      const wsUrl = await ConnectionStateManager.getWSUrl();
      if (!wsUrl) throw new Error('No WS URL available');
      
      // Create connection with timeout handling
      const connectionPromise = connectionManager.createConnection('sync', 'sync', wsUrl, 'unencrypted');
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Handshake connection timeout')), 10000)
      );
      
      await Promise.race([connectionPromise, timeoutPromise]);
      await SyncService.requestHandshake();
      
      console.log('[SyncConnectionContext] Token refresh successful, switching to encrypted connection...');
      
      // Disconnect from unencrypted connection
      connectionManager.disconnectConnection('sync');
      
      // Reset isConnecting so connect() can proceed
      setIsConnecting(false);
      
      // Now connect with the fresh token using encrypted mode
      await connect();
    } catch (error: any) {
      console.error('[SyncConnectionContext] Token refresh failed:', error);
      
      // Clean up failed connection
      connectionManager.disconnectConnection('sync');
      setIsConnecting(false);
      setIsConnected(false);
      
      const errorMessage = error?.message || 'Unknown error';
      setLastConnectionError(errorMessage);
      
      // Get current paired state
      const currentSummary = ConnectionStateManager.getConnectionSummary();
      console.log('[SyncConnectionContext] Handshake failed, isPaired:', currentSummary.isPaired);
      
      // Schedule reconnect for handshake failures too
      if (currentSummary.isPaired) {
        console.log('[SyncConnectionContext] Scheduling reconnect after handshake failure');
        scheduleReconnect();
      }
    }
  };

  const disconnect = () => {
    console.log('[SyncConnectionContext] Manual disconnect');
    
    if (reconnectTimeoutId) {
      clearTimeout(reconnectTimeoutId);
      setReconnectTimeoutId(null);
    }
    
    setIsReconnecting(false);
    setReconnectAttempts(0);
    setNextReconnectIn(0);
    
    connectionManager.disconnectConnection('sync');
    ConnectionStateManager.markDisconnected();
    setIsConnected(false);
  };

  const showToast = (message: string) => {
    console.log('[SyncConnectionContext] Toast:', message);
    if (Platform.OS === 'android') {
      ToastAndroid.show(message, ToastAndroid.SHORT);
    } else {
      Alert.alert('Harmony Link', message);
    }
  };

  const value: SyncConnectionContextType = {
    isPaired,
    isConnected,
    isConnecting,
    isReconnecting,
    reconnectAttempt: reconnectAttempts,
    nextReconnectIn,
    connect,
    disconnect,
    reconnect,
    showToast,
  };

  return (
    <SyncConnectionContext.Provider value={value}>
      {children}
    </SyncConnectionContext.Provider>
  );
};

export const useSyncConnection = (): SyncConnectionContextType => {
  const context = useContext(SyncConnectionContext);
  if (!context) {
    throw new Error('useSyncConnection must be used within SyncConnectionProvider');
  }
  return context;
};
