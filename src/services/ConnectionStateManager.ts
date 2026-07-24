import EventEmitter from 'eventemitter3';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DeviceInfo from 'react-native-device-info';
import Config from 'react-native-config';
import { createLogger } from '../utils/logger';

const log = createLogger('[ConnectionStateManager]');

export type SyncSource = 'selfhosted' | 'cloud';

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
    WS_URL: 'harmony_ws_url', // Original unencrypted URL (e.g., ws://server:8080/events)
    WSS_URL: 'harmony_wss_url', // Secure URL (e.g., wss://server:8081/events)
    SERVER_CERT: 'harmony_server_cert',
    TOKEN_EXPIRES_AT: 'harmony_token_expires_at',
    DEVICE_ID: 'harmony_device_id',
    LAST_SYNC_TIMESTAMP: 'last_sync_timestamp',
    CONNECTED: 'harmony_connected',
    PAIRED: 'harmony_paired',
    SECURITY_MODE: 'harmony_security_mode', // Per-device security preference
  };
  
  public static readonly SYNC_SOURCES = ['selfhosted', 'cloud'] as const;

  // Security mode types
  public static readonly SECURITY_MODES = {
    SECURE: 'secure',
    INSECURE_SSL: 'insecure-ssl',
    UNENCRYPTED: 'unencrypted',
    CLOUD: 'cloud',
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
      // Apply E2E override first — if HARMONY_LINK_WSS_URL is set via
      // react-native-config (build-time env var from .env.e2e), pre-seed
      // AsyncStorage so the app boots already paired. This completes the
      // Phase 4-1 deferred work documented in tls-current-state.md.
      await this.applyE2EOverride();

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

      // IMPORTANT: isConnected is runtime-only state, always starts as false
      // It will be set to true only after successful WebSocket connection
      this.isConnected = false;
      
      // Clean up any stale connected state from previous sessions
      await AsyncStorage.removeItem(ConnectionStateManager.STORAGE_KEYS.CONNECTED);

      // Check JWT token validity
      if (jwtToken && tokenExpiresAtStr) {
        this.tokenExpiresAt = parseInt(tokenExpiresAtStr);
        const now = Math.floor(Date.now() / 1000);

        if (now < this.tokenExpiresAt) {
          // Token is still valid
          this.jwtToken = jwtToken;
          this.emit('state:changed', {
            isPaired: this.isPaired,
            isConnected: false, // Always false on init, will be set by WebSocket events
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
      } else {
        // Not paired
        this.emit('state:changed', {
          isPaired: false,
          isConnected: false,
        });
      }
    } catch (error) {
      log.error('Error initializing connection state:', error);
      this.emit('error', error);
    }
  }

  /**
   * Apply E2E override from build-time env vars.
   *
   * When `HARMONY_LINK_WSS_URL` and `HARMONY_LINK_WS_URL` are set (via
   * react-native-config from e2e/.env.e2e), pre-seed AsyncStorage so the
   * app boots already "paired" against the harmony-link container —
   * skipping the manual pairing UI for E2E runs.
   *
   * Strategy: cloud-mode auto-pairing via expired-token repair path.
   *
   * The harmony-link server (when CLOUD_MODE=true) auto-approves new
   * devices during the handshake protocol — see harmony-link-private's
   * eventserver/synchronization.go:260. To trigger the handshake on app
   * boot, we pre-seed:
   *   - harmony_paired = 'true'            (so isPaired check passes)
   *   - harmony_jwt    = 'e2e-pending'     (any non-null value)
   *   - harmony_token_expires_at = '0'     (forces requiresRepair=true)
   *
   * SyncConnectionContext.initializeConnection() then takes the
   * `requiresRepair` branch and calls connectWithRefresh(), which:
   *   1. Connects via plain WS (no JWT validation in cloud mode)
   *   2. Sends HANDSHAKE_REQUEST → server auto-approves + registers device
   *   3. Receives HANDSHAKE_ACCEPT (empty JWT in cloud mode — that's fine)
   *   4. Disconnects WS, reconnects via WSS using insecure-ssl mode
   *
   * After the first boot, the device is registered in the server's
   * sync_devices table. Subsequent boots repeat the handshake because
   * the token is always "expired" — that's intentional and harmless
   * for E2E.
   *
   * Behavior:
   * 1. If env vars are unset → no-op (production behavior unchanged).
   * 2. If env vars are set AND AsyncStorage already has real pairing data
   *    (jwt != 'e2e-pending') → no-op (don't clobber existing state).
   * 3. If env vars are set AND AsyncStorage is empty OR contains a prior
   *    'e2e-pending' placeholder → (re-)seed.
   */
  private async applyE2EOverride(): Promise<void> {
    const e2eWssUrl = Config.HARMONY_LINK_WSS_URL;
    const e2eWsUrl = Config.HARMONY_LINK_WS_URL;
    if (!e2eWssUrl || !e2eWsUrl) {
      return; // Production path — no override.
    }

    log.info('E2E override: HARMONY_LINK_WSS_URL + WS_URL detected, pre-seeding pairing state');

    // Don't clobber real pairing state from a non-E2E session.
    const existingPaired = await AsyncStorage.getItem(
      ConnectionStateManager.STORAGE_KEYS.PAIRED,
    );
    const existingJwt = await AsyncStorage.getItem(
      ConnectionStateManager.STORAGE_KEYS.JWT_TOKEN,
    );
    if (existingPaired === 'true' && existingJwt && existingJwt !== 'e2e-pending') {
      log.info('E2E override: skipping — device has real pairing state');
      return;
    }

    // Pre-seed all keys required for SyncConnectionContext to take the
    // connectWithRefresh() path on init.
    await Promise.all([
      AsyncStorage.setItem(ConnectionStateManager.STORAGE_KEYS.WSS_URL, e2eWssUrl),
      AsyncStorage.setItem(ConnectionStateManager.STORAGE_KEYS.WS_URL, e2eWsUrl),
      AsyncStorage.setItem(ConnectionStateManager.STORAGE_KEYS.SECURITY_MODE, 'insecure-ssl'),
      AsyncStorage.setItem(ConnectionStateManager.STORAGE_KEYS.PAIRED, 'true'),
      // Placeholder JWT — non-null so isPaired=true, but expired so
      // requiresRepair=true triggers the handshake path.
      AsyncStorage.setItem(ConnectionStateManager.STORAGE_KEYS.JWT_TOKEN, 'e2e-pending'),
      // 0 = always expired = always triggers re-handshake on boot.
      AsyncStorage.setItem(
        ConnectionStateManager.STORAGE_KEYS.TOKEN_EXPIRES_AT,
        '0',
      ),
    ]);

    log.info(`E2E override: pre-seeded WSS=${e2eWssUrl}, WS=${e2eWsUrl}`);
    log.info('E2E override: connectWithRefresh() will run on boot to register device');
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

      // Also get and save the original WS URL for unencrypted mode
      const wsUrl = await AsyncStorage.getItem('harmony_server_url');

      const storageOps = [
        AsyncStorage.setItem(ConnectionStateManager.STORAGE_KEYS.JWT_TOKEN, jwtToken),
        AsyncStorage.setItem(ConnectionStateManager.STORAGE_KEYS.WSS_URL, wssUrl),
        AsyncStorage.setItem(ConnectionStateManager.STORAGE_KEYS.SERVER_CERT, serverCert),
        AsyncStorage.setItem(ConnectionStateManager.STORAGE_KEYS.TOKEN_EXPIRES_AT, expiresAt.toString()),
        AsyncStorage.setItem(ConnectionStateManager.STORAGE_KEYS.PAIRED, 'true'),
      ];

      // Save WS URL if available (for unencrypted fallback)
      if (wsUrl) {
        storageOps.push(AsyncStorage.setItem(ConnectionStateManager.STORAGE_KEYS.WS_URL, wsUrl));
      }

      await Promise.all(storageOps);

      this.emit('credentials:saved', { isPaired: this.isPaired });
    } catch (error) {
      log.error('Error saving connection credentials:', error);
      this.emit('error', error);
    }
  }

  /**
   * Mark device as connected (after WSS connection succeeds)
   * Note: Connection state is runtime-only and not persisted
   */
  async markConnected(): Promise<void> {
    log.info('Marking as connected');
    this.isConnected = true;
    this.emit('state:changed', { isConnected: true, isPaired: this.isPaired });
  }

  /**
   * Mark device as disconnected
   * Note: Connection state is runtime-only and not persisted
   */
  async markDisconnected(): Promise<void> {
    log.info('Marking as disconnected');
    this.isConnected = false;
    this.emit('state:changed', { isConnected: false, isPaired: this.isPaired });
  }

  /**
   * Clear all connection credentials (user initiated unpairing)
   */
  async clearAllCredentials(): Promise<void> {
    try {
      log.info('Clearing all credentials');
      this.jwtToken = null;
      this.isConnected = false;
      this.isPaired = false;
      this.tokenExpiresAt = 0;

      await Promise.all([
        AsyncStorage.removeItem(ConnectionStateManager.STORAGE_KEYS.JWT_TOKEN),
        AsyncStorage.removeItem(ConnectionStateManager.STORAGE_KEYS.WS_URL),
        AsyncStorage.removeItem(ConnectionStateManager.STORAGE_KEYS.WSS_URL),
        AsyncStorage.removeItem(ConnectionStateManager.STORAGE_KEYS.SERVER_CERT),
        AsyncStorage.removeItem(ConnectionStateManager.STORAGE_KEYS.TOKEN_EXPIRES_AT),
        AsyncStorage.removeItem(ConnectionStateManager.STORAGE_KEYS.PAIRED),
        AsyncStorage.removeItem(ConnectionStateManager.STORAGE_KEYS.SECURITY_MODE),
      ]);

      // Emit both events to ensure all listeners are notified
      this.emit('credentials:cleared', { isPaired: false });
      this.emit('state:changed', { 
        isPaired: false, 
        isConnected: false,
        jwtValid: false,
      });
    } catch (error) {
      log.error('Error clearing connection credentials:', error);
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
   * Get stored WS URL (for unencrypted connections)
   */
  async getWSUrl(): Promise<string | null> {
    return AsyncStorage.getItem(ConnectionStateManager.STORAGE_KEYS.WS_URL);
  }

  /**
   * Get stored WSS URL (for secure connections)
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
   * Get the current sync source based on persisted connection mode
   */
  async getCurrentSource(): Promise<SyncSource> {
    const m = await AsyncStorage.getItem('connection_mode');
    return m === 'cloud' ? 'cloud' : 'selfhosted';
  }

  /**
   * Build the per-source AsyncStorage key for last_sync_timestamp
   */
  static lastSyncKey(source: SyncSource): string {
    return `last_sync_timestamp:${source}`;
  }

  /**
   * Get the last sync timestamp for a given source.
   * Falls back to the legacy global key for backward-compat (migrated once).
   */
  async getLastSync(source: SyncSource): Promise<number> {
    const stored = await AsyncStorage.getItem(ConnectionStateManager.lastSyncKey(source));
    if (stored) return parseInt(stored, 10);
    // backward-compat: fall back to the legacy global key, migrated once
    const legacy = await AsyncStorage.getItem(ConnectionStateManager.STORAGE_KEYS.LAST_SYNC_TIMESTAMP);
    return legacy ? parseInt(legacy, 10) : 0;
  }

  /**
   * Set the last sync timestamp for a given source.
   * Also writes the global alias for backward-compat so legacy readers still work.
   */
  async setLastSync(source: SyncSource, ts: number): Promise<void> {
    await Promise.all([
      AsyncStorage.setItem(ConnectionStateManager.lastSyncKey(source), String(ts)),
      AsyncStorage.setItem(ConnectionStateManager.STORAGE_KEYS.LAST_SYNC_TIMESTAMP, String(ts)),
    ]);
  }

  /**
   * Save security mode preference for this device
   */
  async saveSecurityMode(mode: string): Promise<void> {
    try {
      await AsyncStorage.setItem(ConnectionStateManager.STORAGE_KEYS.SECURITY_MODE, mode);
      log.info(`Security mode saved: ${mode}`);
    } catch (error) {
      log.error('Failed to save security mode:', error);
      throw error;
    }
  }

  /**
   * Clear security mode preference (will prompt again on next connection)
   */
  async clearSecurityMode(): Promise<void> {
    try {
      await AsyncStorage.removeItem(ConnectionStateManager.STORAGE_KEYS.SECURITY_MODE);
      log.info('Security mode cleared');
    } catch (error) {
      log.error('Failed to clear security mode:', error);
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
