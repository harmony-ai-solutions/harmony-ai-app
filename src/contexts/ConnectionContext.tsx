import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
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

  useEffect(() => {
    // Listen to connection state changes
    const handleStateChange = (state: any) => {
      console.log('[ConnectionContext] State changed:', state);
      setIsPaired(state.isPaired || false);
      setIsConnected(state.isConnected || false);
    };

    const handleConnectedSecure = () => {
      console.log('[ConnectionContext] Connected securely');
      ConnectionStateManager.markConnected();
      setIsConnected(true);
      setIsConnecting(false);
      showToast('Connected to Harmony Link');
      
      // Auto-trigger sync after successful connection
      setTimeout(async () => {
        try {
          console.log('[ConnectionContext] Auto-triggering sync...');
          await SyncService.initiateSync();
        } catch (error) {
          console.error('[ConnectionContext] Auto-sync failed:', error);
        }
      }, 1000);
    };

    const handleDisconnectedSecure = () => {
      console.log('[ConnectionContext] Disconnected');
      ConnectionStateManager.markDisconnected();
      setIsConnected(false);
      setIsConnecting(false);
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
      const errorMessage = error?.message || 'Connection error occurred';
      showToast(`Connection error: ${errorMessage}`);
    };

    ConnectionStateManager.on('state:changed', handleStateChange);
    WebSocketService.on('connected:secure', handleConnectedSecure);
    WebSocketService.on('disconnected:secure', handleDisconnectedSecure);
    WebSocketService.on('error', handleWebSocketError);
    SyncService.on('sync:completed', handleSyncCompleted);
    SyncService.on('sync:error', handleSyncError);

    // Initialize connection state on mount
    initializeConnection();

    return () => {
      ConnectionStateManager.off('state:changed', handleStateChange);
      WebSocketService.off('connected:secure', handleConnectedSecure);
      WebSocketService.off('disconnected:secure', handleDisconnectedSecure);
      WebSocketService.off('error', handleWebSocketError);
      SyncService.off('sync:completed', handleSyncCompleted);
      SyncService.off('sync:error', handleSyncError);
    };
  }, []);

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
      
      if (savedMode === 'insecure_ssl') {
        await WebSocketService.connectSecureInsecure();
      } else if (savedMode === 'unencrypted') {
        const serverUrl = await ConnectionStateManager.getServerUrl();
        if (serverUrl) {
          await WebSocketService.connect(serverUrl);
        } else {
          throw new Error('No server URL saved for unencrypted connection');
        }
      } else {
        // Default: secure connection
        await WebSocketService.connectSecure();
      }
      
      console.log('[ConnectionContext] Auto-connect successful');
    } catch (error: any) {
      console.error('[ConnectionContext] Auto-connect failed:', error);
      setIsConnecting(false);
      setIsConnected(false);
      showToast('Failed to connect to Harmony Link');
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
      await WebSocketService.connect(wsUrl);
      
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
    console.log('[ConnectionContext] Disconnecting...');
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
