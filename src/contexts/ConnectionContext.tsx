import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import ConnectionStateManager from '../services/ConnectionStateManager';
import WebSocketService from '../services/WebSocketService';
import SyncService from '../services/SyncService';
import { ToastAndroid, Platform, Alert } from 'react-native';

interface ConnectionContextType {
  isPaired: boolean;
  isConnected: boolean;
  isConnecting: boolean;
  autoConnect: () => Promise<void>;
  disconnect: () => void;
  reconnect: () => Promise<void>;
  showToast: (message: string) => void;
}

const ConnectionContext = createContext<ConnectionContextType | undefined>(undefined);

interface ConnectionProviderProps {
  children: ReactNode;
}

export const ConnectionProvider: React.FC<ConnectionProviderProps> = ({ children }) => {
  const [isPaired, setIsPaired] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [reconnectTimeoutId, setReconnectTimeoutId] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [lastConnectionError, setLastConnectionError] = useState<string>('');
  
  // Track if we've already initialized to prevent re-initialization on state changes
  const hasInitialized = useRef(false);
  
  // Auto-reconnect configuration
  const MAX_RECONNECT_ATTEMPTS = 5;
  const RECONNECT_INTERVALS = [2000, 5000, 10000, 20000, 30000]; // Progressive backoff

  useEffect(() => {
    // Listen to connection state changes
    const handleStateChange = (state: any) => {
      console.log('[ConnectionContext] State changed:', state);
      setIsPaired(state.isPaired || false);
      setIsConnected(state.isConnected || false);
    };

    const handleConnected = () => {
      console.log('[ConnectionContext] Connected (insecure)');
      ConnectionStateManager.markConnected();
      setIsConnected(true);
      setIsConnecting(false);
      setReconnectAttempts(0); // Reset on successful connection
      setLastConnectionError(''); // Clear error
      showToast('Connected to Harmony Link');
      
      // Auto-trigger sync after successful connection
      // setTimeout(async () => {
      //   try {
      //     console.log('[ConnectionContext] Auto-triggering sync...');
      //     await SyncService.initiateSync();
      //   } catch (error) {
      //     console.error('[ConnectionContext] Auto-sync failed:', error);
      //   }
      // }, 1000);
    };

    const handleConnectedSecure = () => {
      console.log('[ConnectionContext] Connected securely');
      ConnectionStateManager.markConnected();
      setIsConnected(true);
      setIsConnecting(false);
      setReconnectAttempts(0); // Reset on successful connection
      setLastConnectionError(''); // Clear error
      showToast('Connected to Harmony Link');
      
      // Auto-trigger sync after successful connection
      // setTimeout(async () => {
      //   try {
      //     console.log('[ConnectionContext] Auto-triggering sync...');
      //     await SyncService.initiateSync();
      //   } catch (error) {
      //     console.error('[ConnectionContext] Auto-sync failed:', error);
      //   }
      // }, 1000);
    };

    const handleDisconnected = () => {
      console.log('[ConnectionContext] Disconnected (insecure)');
      ConnectionStateManager.markDisconnected();
      setIsConnected(false);
      setIsConnecting(false);
      
      // Only trigger auto-reconnect if no fatal error and paired
      if (isPaired && !isFatalConnectionError(lastConnectionError)) {
        console.log('[ConnectionContext] Connection lost. Attempting auto-reconnect...');
        scheduleReconnect();
      } else if (isFatalConnectionError(lastConnectionError)) {
        console.log('[ConnectionContext] Fatal connection error detected, disabling auto-reconnect');
        showToast('Connection failed. Please check settings and reconnect manually.');
      }
    };

    const handleDisconnectedSecure = () => {
      console.log('[ConnectionContext] Disconnected (secure)');
      ConnectionStateManager.markDisconnected();
      setIsConnected(false);
      setIsConnecting(false);
      
      // Only trigger auto-reconnect if no fatal error and paired
      if (isPaired && !isFatalConnectionError(lastConnectionError)) {
        console.log('[ConnectionContext] Connection lost. Attempting auto-reconnect...');
        scheduleReconnect();
      } else if (isFatalConnectionError(lastConnectionError)) {
        console.log('[ConnectionContext] Fatal connection error detected, disabling auto-reconnect');
        showToast('Connection failed. Please check settings and reconnect manually.');
      }
    };

    const handleSyncCompleted = (session: any) => {
      console.log('[ConnectionContext] Sync completed:', session);
      showToast(`Sync complete! Sent: ${session.recordsSent}, Received: ${session.recordsReceived}`);
    };

    const handleSyncError = (error: string) => {
      console.error('[ConnectionContext] Sync error:', error);
      showToast(`Sync failed: ${error}`);
    };

    const handleWebSocketError = (error: any) => {
      console.error('[ConnectionContext] WebSocket error:', error);
      const errorMessage = error?.message || error?.toString?.() || 'Connection error occurred';
      setLastConnectionError(errorMessage);
      
      // Don't show toast for every error if we're in a reconnect loop
      if (reconnectAttempts === 0) {
        showToast(`Connection error: ${errorMessage}`);
      }
    };

    const handleCertVerificationFailed = (error: any) => {
      console.log('[ConnectionContext] Certificate verification failed - stopping auto-reconnect loop');
      // Clear any pending reconnect timeout to prevent spamming
      if (reconnectTimeoutId) {
        clearTimeout(reconnectTimeoutId);
        setReconnectTimeoutId(null);
      }
      // Reset reconnect attempts to prevent auto-reconnect while modal is open
      setReconnectAttempts(MAX_RECONNECT_ATTEMPTS + 1); // Set to a value that prevents reconnecting
    };

    ConnectionStateManager.on('state:changed', handleStateChange);
    WebSocketService.on('connected', handleConnected);
    WebSocketService.on('connected:secure', handleConnectedSecure);
    WebSocketService.on('disconnected', handleDisconnected);
    WebSocketService.on('disconnected:secure', handleDisconnectedSecure);
    WebSocketService.on('error', handleWebSocketError);
    WebSocketService.on('cert:verification_failed', handleCertVerificationFailed);
    SyncService.on('sync:completed', handleSyncCompleted);
    SyncService.on('sync:error', handleSyncError);

    // Initialize connection state on mount only once
    if (!hasInitialized.current) {
      hasInitialized.current = true;
      initializeConnection();
    }

    return () => {
      ConnectionStateManager.off('state:changed', handleStateChange);
      WebSocketService.off('connected', handleConnected);
      WebSocketService.off('connected:secure', handleConnectedSecure);
      WebSocketService.off('disconnected', handleDisconnected);
      WebSocketService.off('disconnected:secure', handleDisconnectedSecure);
      WebSocketService.off('error', handleWebSocketError);
      SyncService.off('sync:completed', handleSyncCompleted);
      SyncService.off('sync:error', handleSyncError);
      
      // Clear any pending reconnect timeout on cleanup
      if (reconnectTimeoutId) {
        clearTimeout(reconnectTimeoutId);
      }
    };
  }, [isPaired, reconnectTimeoutId, lastConnectionError, reconnectAttempts]);

  /**
   * Check if an error is fatal and should prevent auto-reconnect
   */
  const isFatalConnectionError = (errorMessage: string): boolean => {
    const fatalErrorPatterns = [
      'client sent an HTTP request to an HTTPS server',
      'protocol',
      'ECONNREFUSED',
      'network unreachable',
      'certificate',
      'ssl',
      'tls',
      'cert_',
      'trust anchor',
      'self signed',
      'unable to verify',
      'verification failed',
      'handshake',
    ];
    
    return fatalErrorPatterns.some(pattern => 
      errorMessage.toLowerCase().includes(pattern.toLowerCase())
    );
  };

  /**
   * Schedule an auto-reconnect attempt with exponential backoff
   */
  const scheduleReconnect = () => {
    // Clear any existing timeout
    if (reconnectTimeoutId) {
      clearTimeout(reconnectTimeoutId);
      setReconnectTimeoutId(null);
    }
    
    // If we're waiting for certificate verification, don't reconnect
    if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      console.log('[ConnectionContext] Certificate verification in progress - skipping auto-reconnect');
      return;
    }
    
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.log('[ConnectionContext] Max reconnect attempts reached. Manual reconnection required.');
      showToast('Connection lost. Please reconnect manually.');
      setReconnectAttempts(0);
      return;
    }
    
    const delay = RECONNECT_INTERVALS[Math.min(reconnectAttempts, RECONNECT_INTERVALS.length - 1)];
    console.log(`[ConnectionContext] Scheduling reconnect attempt ${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms`);
    
    const timeoutId = setTimeout(async () => {
      setReconnectAttempts(prev => prev + 1);
      try {
        await autoConnect();
        // Reset attempts on successful connection
        setReconnectAttempts(0);
      } catch (error) {
        console.error('[ConnectionContext] Auto-reconnect failed:', error);
        // Will schedule another attempt via the disconnected handler
      }
    }, delay);
    
    setReconnectTimeoutId(timeoutId);
  };

  /**
   * Manual reconnect - resets attempt counter and immediately tries to connect
   */
  const reconnect = async (): Promise<void> => {
    console.log('[ConnectionContext] Manual reconnect triggered');
    
    // Clear any pending auto-reconnect
    if (reconnectTimeoutId) {
      clearTimeout(reconnectTimeoutId);
      setReconnectTimeoutId(null);
    }
    
    // Reset reconnect attempts
    setReconnectAttempts(0);
    
    // Disconnect existing connections
    WebSocketService.disconnect();
    await ConnectionStateManager.markDisconnected();
    setIsConnected(false);
    
    // Attempt to reconnect
    await autoConnect();
  };

  const initializeConnection = async () => {
    try {
      await ConnectionStateManager.initialize();
      const summary = ConnectionStateManager.getConnectionSummary();
      
      setIsPaired(summary.isPaired);
      setIsConnected(summary.isConnected);
      
      console.log('[ConnectionContext] Initialized:', summary);
      
      // Auto-connect if paired and credentials available
      if (summary.isPaired && !summary.isTokenExpired) {
        console.log('[ConnectionContext] Auto-connecting with saved security mode...');
        await autoConnect();
      } else if (summary.isPaired && summary.requiresRepair) {
        console.log('[ConnectionContext] Token expired, attempting re-handshake...');
        // Token expired - try to get a new one via handshake
        await autoConnectWithRefresh();
      }

    } catch (error) {
      console.error('[ConnectionContext] Initialization error:', error);
    }
  };

  const autoConnect = async (): Promise<void> => {
    if (isConnecting) {
      console.log('[ConnectionContext] Already connecting, skipping');
      return;
    }

    try {
      setIsConnecting(true);
      console.log('[ConnectionContext] Attempting auto-connect...');
      
      // Check saved security mode and connect accordingly
      const savedMode = await ConnectionStateManager.getSecurityMode();
      console.log('[ConnectionContext] Using security mode:', savedMode || 'secure (default)');
      
      if (savedMode === 'insecure-ssl' || savedMode === 'secure') {
        const wssUrl = await ConnectionStateManager.getWSSUrl();
        if (wssUrl) {
          await WebSocketService.connect(wssUrl, savedMode);
        } else {
          throw new Error('No server URL saved for encrypted connection');
        }        
      } else  {
        // Default: unencrypted connection
        const wsUrl = await ConnectionStateManager.getWSUrl();
        if (wsUrl) {
          await WebSocketService.connect(wsUrl, 'unencrypted');
        } else {
          throw new Error('No server URL saved for unencrypted connection');
        }
      }
      
      console.log('[ConnectionContext] Auto-connect successful');
    } catch (error: any) {
      console.error('[ConnectionContext] Auto-connect failed:', error);
      const errorMessage = error?.message || error?.toString?.() || 'Unknown error';
      setLastConnectionError(errorMessage);
      setIsConnecting(false);
      setIsConnected(false);
      
      // Only show toast on first attempt, not during auto-reconnect
      if (reconnectAttempts === 0) {
        showToast('Failed to connect to Harmony Link');
      }
      
      // Rethrow to let caller handle
      throw error;
    }
  };


  const autoConnectWithRefresh = async (): Promise<void> => {
    if (isConnecting) {
      console.log('[ConnectionContext] Already connecting, skipping');
      return;
    }

    try {
      setIsConnecting(true);
      console.log('[ConnectionContext] Attempting to refresh token via handshake...');
      
      // Get stored connection info
      const wssUrl = await ConnectionStateManager.getWSSUrl();
      if (!wssUrl) {
        throw new Error('No WSS URL available');
      }
      
      // Extract hostname and port for WS connection
      const wsUrl = wssUrl.replace('wss://', 'ws://').replace('/events', '/events');
      
      // Connect with WS first
      await WebSocketService.connect(wsUrl, 'unencrypted');
      
      // Request new handshake
      await SyncService.requestHandshake();
      
      // The handshake accept handler will save the new JWT and connect securely
      console.log('[ConnectionContext] Token refresh initiated');
    } catch (error: any) {
      console.error('[ConnectionContext] Token refresh failed:', error);
      setIsConnecting(false);
      showToast('Connection expired. Please reconnect from Settings.');
    }
  };

  const disconnect = () => {
    console.log('[ConnectionContext] Manual disconnect');
    
    // Clear any pending reconnect timeout
    if (reconnectTimeoutId) {
      clearTimeout(reconnectTimeoutId);
      setReconnectTimeoutId(null);
    }
    
    // Reset reconnect attempts to prevent auto-reconnect after manual disconnect
    setReconnectAttempts(MAX_RECONNECT_ATTEMPTS);
    
    WebSocketService.disconnect();
    ConnectionStateManager.markDisconnected();
    setIsConnected(false);
  };

  const showToast = (message: string) => {
    console.log('[ConnectionContext] Toast:', message);
    if (Platform.OS === 'android') {
      ToastAndroid.show(message, ToastAndroid.SHORT);
    } else {
      // For iOS, use Alert as fallback
      Alert.alert('Harmony Link', message);
    }
  };

  const value: ConnectionContextType = {
    isPaired,
    isConnected,
    isConnecting,
    autoConnect,
    disconnect,
    reconnect,
    showToast,
  };

  return (
    <ConnectionContext.Provider value={value}>
      {children}
    </ConnectionContext.Provider>
  );
};

export const useConnection = (): ConnectionContextType => {
  const context = useContext(ConnectionContext);
  if (!context) {
    throw new Error('useConnection must be used within a ConnectionProvider');
  }
  return context;
};
