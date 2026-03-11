import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import ConnectionStateManager from '../services/ConnectionStateManager';
import ConnectionManager from '../services/connection/ConnectionManager';
import SyncService from '../services/SyncService';
import { ToastAndroid, Platform, Alert } from 'react-native';
import { createLogger } from '../utils/logger';

const log = createLogger('[SyncConnectionContext]');

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
  const [lastConnectionError, setLastConnectionError] = useState<string>('');
  
  const hasInitialized = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const connectionManager = ConnectionManager;
  
  // use refs for values that are read inside event-handler closures.
  // React state is only safe to read in the render cycle; closures captured inside
  // useEffect see whatever value the state had when the effect last ran.  Using refs
  // gives the handlers the latest value without needing them as effect dependencies.
  const reconnectTimeoutRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isConnectingRef        = useRef(false);
  const isReconnectingRef      = useRef(false);
  const isPairedRef            = useRef(false);
  const isConnectedRef         = useRef(false);

  // Keep refs in sync with state so both UI renders (state) and closures (refs) are accurate.
  const setIsConnectingSync = (value: boolean) => {
    isConnectingRef.current = value;
    setIsConnecting(value);
  };
  const setIsReconnectingSync = (value: boolean) => {
    isReconnectingRef.current = value;
    setIsReconnecting(value);
  };
  const setIsPairedSync = (value: boolean) => {
    isPairedRef.current = value;
    setIsPaired(value);
  };
  const setIsConnectedSync = (value: boolean) => {
    isConnectedRef.current = value;
    setIsConnected(value);
  };

  const RECONNECT_INTERVALS = [1000, 2000, 4000, 8000, 16000, 30000];

  // ---------------------------------------------------------------------------
  // Reconnect scheduling (uses refs – never stale)
  // ---------------------------------------------------------------------------
  const scheduleReconnect = () => {
    if (reconnectTimeoutRef.current !== null) {
      log.info('Reconnect already scheduled');
      return;
    }
    
    const currentAttempt = reconnectAttemptsRef.current;
    const delay = RECONNECT_INTERVALS[Math.min(currentAttempt, RECONNECT_INTERVALS.length - 1)];
    const attemptNumber = currentAttempt + 1;
    
    log.info(`Scheduling reconnect attempt ${attemptNumber} in ${delay}ms`);
    
    setIsReconnectingSync(true);
    setNextReconnectIn(delay);
    
    reconnectTimeoutRef.current = setTimeout(async () => {
      log.info(`Executing reconnect attempt ${attemptNumber}`);
      
      reconnectAttemptsRef.current = attemptNumber;
      setReconnectAttempts(attemptNumber);
      setNextReconnectIn(0);
      reconnectTimeoutRef.current = null;
      
      try {
        const isTokenExpired = ConnectionStateManager.getIsTokenExpired();
        
        if (isTokenExpired) {
          log.info('Token expired, performing handshake to refresh...');
          await connectWithRefresh();
        } else {
          log.info('Token valid, connecting normally...');
          await connect();
        }
      } catch (error) {
        log.error('Auto-reconnect failed:', error);
        log.info('Scheduling next reconnect after failed attempt');
        scheduleReconnect();
      }
    }, delay);
  };

  const cancelReconnect = () => {
    if (reconnectTimeoutRef.current !== null) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  };

  // ---------------------------------------------------------------------------
  // Connection event handlers
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const handleSyncConnected = () => {
      log.info('Sync connected');
      ConnectionStateManager.markConnected();
      setIsConnectedSync(true);
      setIsConnectingSync(false);
      setIsReconnectingSync(false);
      reconnectAttemptsRef.current = 0;
      setReconnectAttempts(0);
      setNextReconnectIn(0);
      setLastConnectionError('');
      showToast('Connected to Harmony Link');
    };

    const handleSyncDisconnected = () => {
      log.info('Sync disconnected');
      ConnectionStateManager.markDisconnected();
      setIsConnectedSync(false);
      
      // read from refs – closures always see the current value
      if (isPairedRef.current && !isReconnectingRef.current && !isConnectingRef.current) {
        log.info('Connection lost. Scheduling auto-reconnect...');
        scheduleReconnect();
      } else if (isConnectingRef.current) {
        log.info('Disconnect during connection attempt – catch block will handle reconnect');
      }
      
      setIsConnectingSync(false);
    };

    const handleSyncError = (error: any) => {
      log.error('Sync connection error:', error);
      const errorMessage = error?.message || error?.toString?.() || 'Connection error';
      setLastConnectionError(errorMessage);

      const isHeartbeatTimeout = error?.code === 'HEARTBEAT_TIMEOUT' || 
                                 errorMessage?.includes('heartbeat timeout');

      if (isHeartbeatTimeout) {
        log.warn('Heartbeat timeout detected – connection is dead');
        
        ConnectionStateManager.markDisconnected();
        setIsConnectedSync(false);
        setIsConnectingSync(false);
        
        if (isPairedRef.current && !isReconnectingRef.current) {
          log.info('Scheduling reconnect after heartbeat timeout');
          scheduleReconnect();
        }
      } else {
        if (reconnectAttemptsRef.current === 0 && !isReconnectingRef.current) {
          showToast(`Connection error: ${errorMessage}`);
        }
        
        if (isConnectedRef.current && isPairedRef.current && !isReconnectingRef.current && !isConnectingRef.current) {
          log.info('Connection error detected while connected, scheduling reconnect...');
          ConnectionStateManager.markDisconnected();
          setIsConnectedSync(false);
          scheduleReconnect();
        }
      }
    };

    const handleCertVerificationFailed = (error: any) => {
      log.info('Certificate verification failed');
      cancelReconnect();
      setIsReconnectingSync(false);
      setNextReconnectIn(0);
    };

    const handleStateChange = (state: any) => {
      log.info('State changed:', state);
      setIsPairedSync(state.isPaired || false);
      setIsConnectedSync(state.isConnected || false);
    };

    const handleSyncCompleted = (session: any) => {
      log.info('Sync completed:', session);
      showToast(`Sync complete! Sent: ${session.recordsSent}, Received: ${session.recordsReceived}`);
    };

    const handleSyncErrorEvent = (error: string) => {
      log.error('Sync service error:', error);
      showToast(`Sync failed: ${error}`);
    };

    connectionManager.on('connected:sync',            handleSyncConnected);
    connectionManager.on('disconnected:sync',         handleSyncDisconnected);
    connectionManager.on('error:sync',                handleSyncError);
    connectionManager.on('cert:verification_failed',  handleCertVerificationFailed);
    ConnectionStateManager.on('state:changed',        handleStateChange);
    SyncService.on('sync:completed',                  handleSyncCompleted);
    SyncService.on('sync:error',                      handleSyncErrorEvent);

    if (!hasInitialized.current) {
      hasInitialized.current = true;
      initializeConnection();
    }

    return () => {
      connectionManager.off('connected:sync',            handleSyncConnected);
      connectionManager.off('disconnected:sync',         handleSyncDisconnected);
      connectionManager.off('error:sync',                handleSyncError);
      connectionManager.off('cert:verification_failed',  handleCertVerificationFailed);
      ConnectionStateManager.off('state:changed',        handleStateChange);
      SyncService.off('sync:completed',                  handleSyncCompleted);
      SyncService.off('sync:error',                      handleSyncErrorEvent);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Connection actions
  // ---------------------------------------------------------------------------
  const connect = async (): Promise<void> => {
    if (isConnectingRef.current) {
      log.info('Already connecting');
      return;
    }

    try {
      setIsConnectingSync(true);
      log.info('Connecting to sync...');
      
      const savedMode = await ConnectionStateManager.getSecurityMode();
      const url = savedMode === 'unencrypted'
        ? await ConnectionStateManager.getWSUrl()
        : await ConnectionStateManager.getWSSUrl();
      
      if (!url) {
        throw new Error('No server URL configured');
      }
      
      const mode = savedMode || 'secure';
      
      await connectionManager.createConnection('sync', 'sync', url, mode as any);
      
      log.info('Sync connection established');
    } catch (error: any) {
      log.error('Connect failed:', error);
      const errorMessage = error?.message || 'Unknown error';
      setLastConnectionError(errorMessage);
      setIsConnectingSync(false);
      setIsConnectedSync(false);
      
      if (reconnectAttemptsRef.current === 0) {
        showToast('Failed to connect to Harmony Link');
      }
      
      throw error;
    }
  };

  const connectWithRefresh = async (): Promise<void> => {
    if (isConnectingRef.current) return;

    try {
      setIsConnectingSync(true);
      log.info('Attempting to refresh token...');
      
      const wsUrl = await ConnectionStateManager.getWSUrl();
      if (!wsUrl) throw new Error('No WS URL available');
      
      const connectionPromise = connectionManager.createConnection('sync', 'sync', wsUrl, 'unencrypted');
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Handshake connection timeout')), 10000)
      );
      
      await Promise.race([connectionPromise, timeoutPromise]);
      
      log.info('Connection established, waiting for handshake response...');
      await SyncService.requestHandshakeWithWait(15000);
      
      log.info('Token refresh successful, switching to encrypted connection...');
      
      connectionManager.disconnectConnection('sync');
      
      setIsConnectingSync(false);
      
      await connect();
    } catch (error: any) {
      log.error('Token refresh failed:', error);
      
      connectionManager.disconnectConnection('sync');
      setIsConnectingSync(false);
      setIsConnectedSync(false);
      
      const errorMessage = error?.message || 'Unknown error';
      setLastConnectionError(errorMessage);
      
      const currentSummary = ConnectionStateManager.getConnectionSummary();
      log.info('Handshake failed, isPaired:', currentSummary.isPaired);
      
      if (currentSummary.isPaired) {
        log.info('Scheduling reconnect after handshake failure');
        scheduleReconnect();
      }
    }
  };

  const initializeConnection = async () => {
    try {
      await ConnectionStateManager.initialize();
      const summary = ConnectionStateManager.getConnectionSummary();
      
      setIsPairedSync(summary.isPaired);
      setIsConnectedSync(summary.isConnected);
      
      log.info('Initialized:', summary);
      
      if (summary.isPaired && !summary.isTokenExpired) {
        log.info('Auto-connecting...');
        try {
          await connect();
        } catch (connectError: any) {
          log.info('Scheduling reconnect after initialization failure');
          scheduleReconnect();
        }
      } else if (summary.isPaired && summary.requiresRepair) {
        log.info('Token expired, attempting re-handshake...');
        await connectWithRefresh();
      }
    } catch (error) {
      log.error('Initialization error:', error);
    }
  };

  const reconnect = async (): Promise<void> => {
    log.info('Manual reconnect triggered');
    
    cancelReconnect();
    
    reconnectAttemptsRef.current = 0;
    setReconnectAttempts(0);
    setIsReconnectingSync(false);
    setNextReconnectIn(0);
    
    connectionManager.disconnectConnection('sync');
    await ConnectionStateManager.markDisconnected();
    setIsConnectedSync(false);
    
    await connect();
  };

  const disconnect = () => {
    log.info('Manual disconnect');
    
    cancelReconnect();
    
    setIsReconnectingSync(false);
    setReconnectAttempts(0);
    setNextReconnectIn(0);
    
    connectionManager.disconnectConnection('sync');
    ConnectionStateManager.markDisconnected();
    setIsConnectedSync(false);
  };

  const showToast = (message: string) => {
    log.info('Toast:', message);
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
