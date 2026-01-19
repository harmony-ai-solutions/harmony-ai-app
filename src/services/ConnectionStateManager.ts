import EventEmitter from 'eventemitter3';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DeviceInfo from 'react-native-device-info';

interface ConnectionStateEvents {
  'state:changed': (state: ConnectionState) => void;
  'credentials:saved': (info: { isPaired: boolean }) => void;
  'credentials:cleared': (info: { isPaired: boolean }) => void;
  'error': (error: any) => void;
}

interface ConnectionState {
  isPaired: boolean;
  isConnected: boolean;
  jwtValid?: boolean;
  requiresRepair?: boolean;
  secondsUntilExpiry?: number;
  deviceId?: string;
}

/**
 * ConnectionStateManager - Manages connection state persistence and JWT token lifecycle
 * 
 * Responsibilities:
 * - Check JWT token validity on app startup
 * - Store connection status in AsyncStorage
 * - Provide convenient connection state checks
 * - Handle token expiry gracefully
 */
export class ConnectionStateManager extends EventEmitter<ConnectionStateEvents> {
  private static instance: ConnectionStateManager;
  
  // Storage keys
  private static readonly STORAGE_KEYS = {
    JWT_TOKEN: 'harmony_jwt',
    WSS_URL: 'harmony_wss_url',
    SERVER_CERT: 'harmony_server_cert',
    TOKEN_EXPIRES_AT: 'harmony_token_expires_at',
    DEVICE_ID: 'harmony_device_id',
    LAST_SYNC_TIMESTAMP: 'last_sync_timestamp',
    CONNECTED: 'harmony_connected',
    PAIRED: 'harmony_paired',
    SECURITY_MODE: 'harmony_security_mode', // Per-device security preference
  };
  
  // Security mode types
  public static readonly SECURITY_MODES = {
    SECURE: 'secure',
    INSECURE_SSL: 'insecure_ssl',
    UNENCRYPTED: 'unencrypted',
  } as const;

  private isConnected = false;
  private isPaired = false;
  private jwtToken: string | null = null;
  private tokenExpiresAt: number = 0;
  private deviceId: string = '';

  static getInstance(): ConnectionStateManager {
    if (!ConnectionStateManager.instance) {
      ConnectionStateManager.instance = new ConnectionStateManager();
    }
    return ConnectionStateManager.instance;
  }

  /**
   * Initialize connection state from storage on app startup
   */
  async initialize(): Promise<void> {
    try {
      // Get device ID
      this.deviceId = await DeviceInfo.getUniqueId();
      
      // Get stored connection credentials
      const [jwtToken, wssUrl, serverCert, tokenExpiresAtStr, pairedStr] = await Promise.all([
        AsyncStorage.getItem(ConnectionStateManager.STORAGE_KEYS.JWT_TOKEN),
        AsyncStorage.getItem(ConnectionStateManager.STORAGE_KEYS.WSS_URL),
        AsyncStorage.getItem(ConnectionStateManager.STORAGE_KEYS.SERVER_CERT),
        AsyncStorage.getItem(ConnectionStateManager.STORAGE_KEYS.TOKEN_EXPIRES_AT),
        AsyncStorage.getItem(ConnectionStateManager.STORAGE_KEYS.PAIRED),
      ]);

      // Determine if device was previously paired
      this.isPaired = pairedStr === 'true' && jwtToken !== null;

      // Check JWT token validity
      if (jwtToken && tokenExpiresAtStr) {
        this.tokenExpiresAt = parseInt(tokenExpiresAtStr);
        const now = Math.floor(Date.now() / 1000);

        if (now < this.tokenExpiresAt) {
          // Token is still valid
          this.jwtToken = jwtToken;
          this.isConnected = false; // Connected is only true after handshake succeeds
          this.emit('state:changed', {
            isPaired: this.isPaired,
            isConnected: this.isConnected,
            jwtValid: true,
          });
        } else {
          // Token expired - user needs to re-pair
          this.emit('state:changed', {
            isPaired: true,
            isConnected: false,
            jwtValid: false,
            requiresRepair: true,
          });
        }
      }
    } catch (error) {
      console.error('Error initializing connection state:', error);
      this.emit('error', error);
    }
  }

  /**
   * Save connection credentials after successful handshake
   */
  async saveConnectionCredentials(
    jwtToken: string,
    wssUrl: string,
    serverCert: string,
    expiresAt: number
  ): Promise<void> {
    try {
      this.jwtToken = jwtToken;
      this.tokenExpiresAt = expiresAt;
      this.isPaired = true;

      await Promise.all([
        AsyncStorage.setItem(ConnectionStateManager.STORAGE_KEYS.JWT_TOKEN, jwtToken),
        AsyncStorage.setItem(ConnectionStateManager.STORAGE_KEYS.WSS_URL, wssUrl),
        AsyncStorage.setItem(ConnectionStateManager.STORAGE_KEYS.SERVER_CERT, serverCert),
        AsyncStorage.setItem(ConnectionStateManager.STORAGE_KEYS.TOKEN_EXPIRES_AT, expiresAt.toString()),
        AsyncStorage.setItem(ConnectionStateManager.STORAGE_KEYS.PAIRED, 'true'),
      ]);

      this.emit('credentials:saved', { isPaired: this.isPaired });
    } catch (error) {
      console.error('Error saving connection credentials:', error);
      this.emit('error', error);
    }
  }

  /**
   * Mark device as connected (after WSS connection succeeds)
   */
  async markConnected(): Promise<void> {
    this.isConnected = true;
    await AsyncStorage.setItem(ConnectionStateManager.STORAGE_KEYS.CONNECTED, 'true');
    this.emit('state:changed', { isConnected: true, isPaired: this.isPaired });
  }

  /**
   * Mark device as disconnected
   */
  async markDisconnected(): Promise<void> {
    this.isConnected = false;
    await AsyncStorage.setItem(ConnectionStateManager.STORAGE_KEYS.CONNECTED, 'false');
    this.emit('state:changed', { isConnected: false, isPaired: this.isPaired });
  }

  /**
   * Clear all connection credentials (user initiated unpairing)
   */
  async clearAllCredentials(): Promise<void> {
    try {
      this.jwtToken = null;
      this.isConnected = false;
      this.isPaired = false;
      this.tokenExpiresAt = 0;

      await Promise.all([
        AsyncStorage.removeItem(ConnectionStateManager.STORAGE_KEYS.JWT_TOKEN),
        AsyncStorage.removeItem(ConnectionStateManager.STORAGE_KEYS.WSS_URL),
        AsyncStorage.removeItem(ConnectionStateManager.STORAGE_KEYS.SERVER_CERT),
        AsyncStorage.removeItem(ConnectionStateManager.STORAGE_KEYS.TOKEN_EXPIRES_AT),
        AsyncStorage.removeItem(ConnectionStateManager.STORAGE_KEYS.PAIRED),
        AsyncStorage.removeItem(ConnectionStateManager.STORAGE_KEYS.CONNECTED),
      ]);

      this.emit('credentials:cleared', { isPaired: false });
    } catch (error) {
      console.error('Error clearing connection credentials:', error);
      this.emit('error', error);
    }
  }

  /**
   * Check if device is currently connected to Harmony Link (WSS active)
   */
  getIsConnected(): boolean {
    return this.isConnected;
  }

  /**
   * Check if device has been paired (credentials exist)
   */
  getIsPaired(): boolean {
    return this.isPaired;
  }

  /**
   * Check if JWT token needs renewal (expired)
   */
  getIsTokenExpired(): boolean {
    if (!this.tokenExpiresAt) return true;
    const now = Math.floor(Date.now() / 1000);
    return now >= this.tokenExpiresAt;
  }

  /**
   * Get seconds until JWT token expires (-1 if expired or not set)
   */
  getSecondsUntilTokenExpiry(): number {
    if (!this.tokenExpiresAt) return -1;
    const now = Math.floor(Date.now() / 1000);
    const secondsLeft = this.tokenExpiresAt - now;
    return secondsLeft > 0 ? secondsLeft : -1;
  }

  /**
   * Check if device needs re-pairing (was paired but token expired)
   */
  getNeedsRepairing(): boolean {
    return this.isPaired && this.getIsTokenExpired();
  }

  /**
   * Get current JWT token (if valid)
   */
  getJWTToken(): string | null {
    if (this.getIsTokenExpired()) {
      return null;
    }
    return this.jwtToken;
  }

  /**
   * Get device ID
   */
  getDeviceId(): string {
    return this.deviceId;
  }

  /**
   * Get stored WSS URL
   */
  async getWSSUrl(): Promise<string | null> {
    return AsyncStorage.getItem(ConnectionStateManager.STORAGE_KEYS.WSS_URL);
  }

  /**
   * Get stored server certificate
   */
  async getServerCert(): Promise<string | null> {
    return AsyncStorage.getItem(ConnectionStateManager.STORAGE_KEYS.SERVER_CERT);
  }

  /**
   * Get stored security mode for this device
   */
  async getSecurityMode(): Promise<string | null> {
    return AsyncStorage.getItem(ConnectionStateManager.STORAGE_KEYS.SECURITY_MODE);
  }

  /**
   * Save security mode preference for this device
   */
  async saveSecurityMode(mode: string): Promise<void> {
    try {
      await AsyncStorage.setItem(ConnectionStateManager.STORAGE_KEYS.SECURITY_MODE, mode);
      console.log(`[ConnectionStateManager] Security mode saved: ${mode}`);
    } catch (error) {
      console.error('[ConnectionStateManager] Failed to save security mode:', error);
      throw error;
    }
  }

  /**
   * Clear security mode preference (will prompt again on next connection)
   */
  async clearSecurityMode(): Promise<void> {
    try {
      await AsyncStorage.removeItem(ConnectionStateManager.STORAGE_KEYS.SECURITY_MODE);
      console.log('[ConnectionStateManager] Security mode cleared');
    } catch (error) {
      console.error('[ConnectionStateManager] Failed to clear security mode:', error);
      throw error;
    }
  }

  /**
   * Get connection summary for UI display
   */
  getConnectionSummary() {
    return {
      isPaired: this.isPaired,
      isConnected: this.isConnected,
      isTokenExpired: this.getIsTokenExpired(),
      requiresRepair: this.getNeedsRepairing(),
      secondsUntilExpiry: this.getSecondsUntilTokenExpiry(),
      deviceId: this.deviceId,
    };
  }
}

export default ConnectionStateManager.getInstance();
