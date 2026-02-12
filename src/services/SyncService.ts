import EventEmitter from 'eventemitter3';
import DeviceInfo from 'react-native-device-info';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Transaction } from 'react-native-sqlite-storage';
import * as SyncHelpers from '../database/sync';
import ConnectionStateManager from './ConnectionStateManager';
import connectionManagerInstance from './connection/ConnectionManager';
import type { ConnectionManager } from './connection/ConnectionManager';
import { getDatabase } from '../database/connection';
import { createLogger } from '../utils/logger';

const log = createLogger('[SyncService]');

// Define event types for type safety
interface SyncServiceEvents {
  'handshake:pending': (payload: any) => void;
  'handshake:accepted': (payload: any) => void;
  'handshake:rejected': (payload: any) => void;
  'sync:started': (session: SyncSession) => void;
  'sync:progress': (session: SyncSession) => void;
  'sync:completed': (session: SyncSession) => void;
  'sync:rejected': (payload: any) => void;
  'sync:error': (error: string) => void;
}

export interface SyncSession {
  sessionId: string;
  deviceId: string;
  deviceName: string;
  startTime: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  recordsSent: number;
  recordsReceived: number;
  error?: string;
}

export class SyncService extends EventEmitter<SyncServiceEvents> {
  private static instance: SyncService;
  private connectionManager: ConnectionManager;
  private currentSession: SyncSession | null = null;
  private pendingConfirmations: Map<string, (success: boolean) => void> = new Map();
  // Track completion states to ensure SYNC_FINALIZE is sent only once
  private localChangesSent: boolean = false;
  private remoteCompleteReceived: boolean = false;
  private finalizeSent: boolean = false;

  private syncPhase: 'IDLE' | 'SERVER_SENDING' | 'CLIENT_SENDING' | 'FINALIZING' = 'IDLE';
  private pendingSyncConfirmation: {
    eventId: string;
    resolve: (value: any) => void;
    reject: (reason: any) => void;
  } | null = null;

  // Handshake promise tracking
  private pendingHandshake: {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
    timeoutId: ReturnType<typeof setTimeout>;
  } | null = null;
  
  // Buffer for incoming server data (applied atomically when SYNC_COMPLETE received)
  private incomingDataBuffer: Array<{
    table: string;
    operation: 'insert' | 'update' | 'delete';
    record: any;
  }> = [];

  private constructor() {
    super();
    this.connectionManager = connectionManagerInstance;
    this.setupConnectionListeners();
  }

  static getInstance(): SyncService {
    if (!SyncService.instance) {
      SyncService.instance = new SyncService();
    }
    return SyncService.instance;
  }

  private setupConnectionListeners() {
    // Listen ONLY to sync connection events from ConnectionManager
    this.connectionManager.on('event:sync', this.routeSyncEvent.bind(this));
  }

  private routeSyncEvent(data: any) {
    log.info(`Received sync event: ${data.event_type} status: ${data.status}`);
    
    // IGNORE acknowledgment statuses - these are transport/processing confirmations, not actionable events
    // Only process NEW and ERROR status events which contain actionable data
    // EXCEPTION: Allow SYNC_COMPLETE and SYNC_FINALIZE with SUCCESS status through (it's a protocol signal when finishing the sync process)
    if (data.status === 'PENDING' || (data.status === 'SUCCESS' && (data.event_type !== 'SYNC_COMPLETE') && data.event_type !== 'SYNC_FINALIZE')) {
      log.debug(`Ignoring ${data.status} status event: ${data.event_type}`);
      return;
    }
    
    switch (data.event_type) {
      case 'HANDSHAKE_PENDING':
        this.emit('handshake:pending', data.payload);
        break;
        
      case 'HANDSHAKE_ACCEPT':
        this.handleHandshakeAccept(data.payload);
        break;
        
      case 'HANDSHAKE_REJECT':
        this.handleHandshakeReject(data.payload);
        break;
        
      case 'SYNC_REQUEST':
        if (data.status === 'ERROR') {
          this.emit('sync:rejected', data.payload);
        }
        break;
        
      case 'SYNC_ACCEPT':
        this.handleSyncAccept(data.payload);
        break;
        
      case 'SYNC_REJECT':
        this.emit('sync:rejected', data.payload);
        break;
        
      case 'SYNC_DATA':
        this.handleIncomingSyncData(data.payload);
        break;
        
      case 'SYNC_DATA_CONFIRM':
        this.handleSyncDataConfirm(data.payload);
        break;
        
      case 'SYNC_COMPLETE':
        this.handleSyncComplete(data);
        break;
        
      case 'SYNC_FINALIZE':
        this.handleSyncFinalize();
        break;
        
      default:
        log.warn(`Unhandled sync event type: ${data.event_type}`);
    }
  }

  private generateEventId(): string {
    return `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async requestHandshake(): Promise<void> {
    const deviceId = await DeviceInfo.getUniqueId();
    const deviceName = await DeviceInfo.getDeviceName();
    
    const event = {
      event_id: this.generateEventId(),
      event_type: 'HANDSHAKE_REQUEST',
      status: 'NEW',
      payload: {
        device_id: deviceId,
        device_name: deviceName,
        device_type: 'harmony_app',
        device_platform: Platform.OS
      }
    };
    
    log.info('Requesting handshake:', event);
    await this.connectionManager.sendEvent('sync', event);
  }

  /**
   * Request handshake and wait for the response.
   * Returns a Promise that resolves when HANDSHAKE_ACCEPT is received.
   * Rejects on timeout or if HANDSHAKE_REJECT is received.
   */
  async requestHandshakeWithWait(timeoutMs: number = 30000): Promise<any> {
    // Check if there's already a pending handshake
    if (this.pendingHandshake) {
      log.warn('Handshake already in progress, rejecting previous one');
      this.pendingHandshake.reject(new Error('New handshake requested'));
      clearTimeout(this.pendingHandshake.timeoutId);
      this.pendingHandshake = null;
    }

    return new Promise(async (resolve, reject) => {
      // Set up timeout
      const timeoutId = setTimeout(() => {
        log.error(`Handshake timed out after ${timeoutMs}ms`);
        this.pendingHandshake = null;
        reject(new Error('Handshake timeout'));
      }, timeoutMs);

      // Store pending handshake
      this.pendingHandshake = { resolve, reject, timeoutId };

      try {
        // Send the handshake request
        await this.requestHandshake();
        log.info('Handshake request sent, waiting for response...');
      } catch (error) {
        // If sending fails, clear timeout and reject immediately
        clearTimeout(timeoutId);
        this.pendingHandshake = null;
        reject(error);
      }
    });
  }

  private async handleHandshakeAccept(payload: any): Promise<void> {
    log.info('Handshake accepted:', payload);
    
    // Resolve pending handshake if exists
    if (this.pendingHandshake) {
      clearTimeout(this.pendingHandshake.timeoutId);
      this.pendingHandshake.resolve(payload);
      this.pendingHandshake = null;
    }
    
    await AsyncStorage.setItem('harmony_jwt', payload.jwt_token);    

    // Get the server URL from the current WebSocket connection
    const currentWsUrl = await AsyncStorage.getItem('harmony_server_url');
    if (currentWsUrl) {
      // Replace ws:// with wss:// and update port
      const wssUrl = currentWsUrl.replace(/^ws:\/\//, 'wss://').replace(/:\d+/, `:${payload.wss_port}`);
      await AsyncStorage.setItem('harmony_wss_url', wssUrl);
      log.info(`Constructed WSS URL: ${wssUrl}`);
    }
    
    await AsyncStorage.setItem('harmony_server_cert', payload.server_cert);
    await AsyncStorage.setItem('harmony_token_expires_at', payload.token_expires_at.toString());
    
    // Only set default security mode if user hasn't chosen one yet
    // Default mode is required to "upgrade" the handler on first handshake,
    // but on Token refresh, we already have one set, so we can keep it as it is.
    const currentMode = await ConnectionStateManager.getSecurityMode();
    if (!currentMode) {
      await ConnectionStateManager.saveSecurityMode('secure');
    }
    
    this.emit('handshake:accepted', payload);
  };

  private handleHandshakeReject(payload: any): void {
    log.warn('Handshake rejected:', payload);
    
    // Reject pending handshake if exists
    if (this.pendingHandshake) {
      clearTimeout(this.pendingHandshake.timeoutId);
      this.pendingHandshake.reject(new Error(payload.message || 'Device rejected'));
      this.pendingHandshake = null;
    }
    
    this.emit('handshake:rejected', payload);
  }

  async initiateSync(): Promise<void> {
    const lastSync = await this.getLastSyncTimestamp();
    const deviceId = await DeviceInfo.getUniqueId();
    const deviceName = await DeviceInfo.getDeviceName();
    
    // Reset completion flags for new sync session
    this.localChangesSent = false;
    this.remoteCompleteReceived = false;
    this.finalizeSent = false;
    
    this.currentSession = {
      sessionId: this.generateEventId(),
      deviceId: deviceId,
      deviceName: deviceName,
      startTime: Math.floor(Date.now() / 1000),
      status: 'pending',
      recordsSent: 0,
      recordsReceived: 0
    };
    
    const event = {
      event_id: this.generateEventId(),
      event_type: 'SYNC_REQUEST',
      status: 'NEW',
      payload: {
        device_id: deviceId,
        device_name: deviceName,
        device_type: 'harmony_app',
        device_platform: Platform.OS,
        current_utc_timestamp: this.currentSession.startTime,
        last_sync_timestamp: lastSync
      }
    };
    
    try {
      log.info('Initiating sync:', event);
      await this.connectionManager.sendEvent('sync', event);
    } catch (sendError) {
      log.error('Failed to send SYNC_REQUEST:', sendError);

      // Clear session since sync failed to initiate
      this.currentSession = null;

      // Emit error event so UI can show appropriate message
      this.emit('sync:error', 'Failed to initiate sync - connection may be lost');

      // Re-throw so caller knows it failed
      throw sendError;
    }
  }

  private async handleSyncAccept(payload: any): Promise<void> {
    if (!this.currentSession) {
      log.warn('Received SYNC_ACCEPT but no current session');
      return;
    }
    
    log.info('Sync accepted:', payload);
    this.currentSession.status = 'in_progress';
    this.currentSession.sessionId = payload.sync_session_id;
    
    // Set phase to SERVER_SENDING and clear buffer
    this.syncPhase = 'SERVER_SENDING';
    this.incomingDataBuffer = [];

    this.emit('sync:started', this.currentSession);
    
    // Send SYNC_START to trigger server to send its changes
    const startEvent = {
      event_id: this.generateEventId(),
      event_type: 'SYNC_START',
      status: 'NEW',
      payload: {
        sync_session_id: this.currentSession.sessionId
      }
    };
    
    log.info('Sending SYNC_START to trigger server data transmission');
    await this.connectionManager.sendEvent('sync', startEvent);
    
    // DO NOT send local changes yet - wait for server SYNC_COMPLETE
  }
  
  /**
   * Apply buffered sync records in a single atomic transaction
   */
  private async applyBufferedSyncData(): Promise<void> {
    if (this.incomingDataBuffer.length === 0) {
      log.info('No buffered data to apply');
      return;
    }
    
    const db = getDatabase();
    const recordCount = this.incomingDataBuffer.length;
    
    // Debug: Log the buffer contents
    log.info(`Applying ${recordCount} buffered sync records in transaction`);
    log.info('Buffer contents:');
    this.incomingDataBuffer.forEach((item, index) => {
      const pkField = item.table === 'entity_module_mappings' ? 'entity_id' : 'id';
      const pkValue = item.record[pkField];
      log.info(`  [${index + 1}/${recordCount}] ${item.table}.${item.operation} (${pkField}=${pkValue})`);
    });
    
    return new Promise<void>((resolve, reject) => {
      db.transaction(
        (tx) => {
          // Apply all buffered records synchronously within transaction
          for (const item of this.incomingDataBuffer) {
            const pkField = item.table === 'entity_module_mappings' ? 'entity_id' : 'id';
            const pkValue = item.record[pkField];

            if (item.operation === 'delete') {
              // Soft delete
              log.debug(`  Executing DELETE for ${item.table}:${pkValue}`);
              tx.executeSql(
                `UPDATE ${item.table} SET deleted_at = ?, updated_at = ? WHERE ${pkField} = ?`,
                [item.record.deleted_at, item.record.updated_at, pkValue],
                () => {
                  log.debug(`  ✓ DELETE successful for ${item.table}:${pkValue}`);
                },
                (_, error) => {
                  log.error(`  ❌ DELETE FAILED for ${item.table}:${pkValue}`);
                  log.error(`  Error: ${error.message} (code: ${(error as any).code || 'unknown'})`);
                  log.error(`  Record:`, JSON.stringify(item.record, null, 2));
                  return false; // Rollback
                }
              );
            } else {
              // Check if record exists, then insert or update
              tx.executeSql(
                `SELECT updated_at FROM ${item.table} WHERE ${pkField} = ?`,
                [pkValue],
                (_, result) => {
                  if (result.rows.length === 0) {
                    // Insert new record
                    log.debug(`  Executing INSERT for ${item.table}:${pkValue}`);
                    log.debug(`  Record data:`, JSON.stringify(item.record, null, 2));
                    const columns = Object.keys(item.record).join(', ');
                    const placeholders = Object.keys(item.record).map(() => '?').join(', ');
                    const values = Object.values(item.record);
                    
                    tx.executeSql(
                      `INSERT INTO ${item.table} (${columns}) VALUES (${placeholders})`,
                      values,
                      () => {
                        log.debug(`  ✓ INSERT successful for ${item.table}:${pkValue}`);
                      },
                      (_, error) => {
                        log.error(`  ❌ INSERT FAILED for ${item.table}:${pkValue}`);
                        log.error(`  Error: ${error.message} (code: ${(error as any).code || 'unknown'})`);
                        log.error(`  SQL: INSERT INTO ${item.table} (${columns}) VALUES (...)`);
                        
                        // Log FK field values to identify constraint violations
                        const fkFields = this.getForeignKeyFields(item.table);
                        if (fkFields.length > 0) {
                          log.error(`  Foreign Key Fields:`);
                          fkFields.forEach(fk => {
                            const value = item.record[fk];
                            log.error(`    - ${fk}: ${value === null ? 'NULL' : value === undefined ? 'UNDEFINED' : `"${value}"`}`);
                          });
                        }
                        
                        log.error(`  Full Record:`, JSON.stringify(item.record, null, 2));
                        return false; // Rollback
                      }
                    );
                  } else {
                    // Last-Write-Wins: Compare timestamps
                    const existingUpdated = SyncHelpers.toUnixTimestamp(result.rows.item(0).updated_at);
                    const incomingUpdated = SyncHelpers.toUnixTimestamp(item.record.updated_at);
                    
                    if (incomingUpdated >= existingUpdated) {
                      // Incoming wins - update
                      log.debug(`  Executing UPDATE for ${item.table}:${pkValue}`);
                      log.debug(`  Record data:`, JSON.stringify(item.record, null, 2));
                      const updates = Object.keys(item.record)
                        .filter(k => k !== pkField)
                        .map(k => `${k} = ?`)
                        .join(', ');
                      const values = Object.keys(item.record)
                        .filter(k => k !== pkField)
                        .map(k => item.record[k]);
                      values.push(pkValue);
                      
                      tx.executeSql(
                        `UPDATE ${item.table} SET ${updates} WHERE ${pkField} = ?`,
                        values,
                        () => {
                          log.debug(`  ✓ UPDATE successful for ${item.table}:${pkValue}`);
                        },
                        (_, error) => {
                          log.error(`  ❌ UPDATE FAILED for ${item.table}:${pkValue}`);
                          log.error(`  Error: ${error.message} (code: ${(error as any).code || 'unknown'})`);
                          log.error(`  Record:`, JSON.stringify(item.record, null, 2));
                          return false; // Rollback
                        }
                      );
                    } else {
                      log.debug(`  Skipping UPDATE for ${item.table}:${pkValue} (local is newer)`);
                    }
                  }
                },
                (_, error) => {
                  log.error(`Error checking existing record: ${error.message}`);
                  return false; // Rollback
                }
              );
            }
          }
        },
        (error) => {
          log.error('❌ Transaction failed/rolled back:', error);
          log.error(`  Error message: ${error.message}`);
          log.error(`  Error code: ${(error as any).code || 'unknown'}`);
          
          // Critical cleanup on failure
          log.warn('Cleaning up after transaction failure');
          this.incomingDataBuffer = []; // Clear buffer
          this.syncPhase = 'IDLE'; // Reset sync phase
          
          // Clear current session
          if (this.currentSession) {
            log.warn(`Clearing failed sync session: ${this.currentSession.sessionId}`);
            this.currentSession.status = 'failed';
            this.currentSession = null;
          }
          
          // Reset completion flags
          this.localChangesSent = false;
          this.remoteCompleteReceived = false;
          this.finalizeSent = false;
          
          reject(error);
        },
        () => {
          log.info(`✅ Transaction committed successfully - applied ${recordCount} records`);
          this.incomingDataBuffer = []; // Clear buffer after successful commit
          resolve();
        }
      );
    });
  }

  private async sendLocalChangesSequentially(lastSync: number): Promise<void> {
    if (!this.currentSession) {
      log.error('No active sync session');
      return;
    }

    log.info(`Sending local changes since: ${lastSync}`);

    try {
      // Define table order respecting FK dependencies
      const tables = [
        'character_profiles',
        'character_image',
        'provider_config_openai',
        'provider_config_ollama',
        'provider_config_openaicompatible',
        'provider_config_openrouter',
        'provider_config_harmonyspeech',
        'provider_config_elevenlabs',
        'provider_config_kindroid',
        'provider_config_kajiwoto',
        'provider_config_characterai',
        'provider_config_localai',
        'provider_config_mistral',
        'backend_configs',
        'cognition_configs',
        'movement_configs',
        'rag_configs',
        'stt_configs',
        'tts_configs',
        'entities',
        'entity_module_mappings',
        'conversation_messages',
      ];

      // Send each table's records sequentially
      for (const table of tables) {
        const records = await SyncHelpers.getChangedRecords(table, lastSync);
        log.info(`Found ${records.length} changes in ${table}`);

        for (const record of records) {
          const operation = record.deleted_at ? 'delete' : 
                           (SyncHelpers.toUnixTimestamp(record.created_at) > lastSync ? 'insert' : 'update');
          
          // Send record and wait for confirmation
          await this.sendSyncDataWithConfirmation(table, operation, record);
        }
      }

      // All local changes sent and confirmed
      log.info('Local changes sent, sending SYNC_COMPLETE');
      
      const event = {
        event_id: this.generateEventId(),
        event_type: 'SYNC_COMPLETE',
        status: 'NEW',
        payload: {
          sync_session_id: this.currentSession.sessionId
        }
      };
      
      await this.connectionManager.sendEvent('sync', event);

    } catch (error) {
      log.error('Error sending local changes:', error);
      this.emit('sync:error', error instanceof Error ? error.message : String(error));
    }
  }

  private async sendSyncDataWithConfirmation(
    table: string,
    operation: 'insert' | 'update' | 'delete',
    record: any
  ): Promise<void> {
    if (!this.currentSession) {
      throw new Error('No active sync session');
    }

    const eventId = `data_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    return new Promise((resolve, reject) => {
      // Store confirmation callback
      this.pendingSyncConfirmation = { eventId, resolve, reject };

      // Send the data
      const event = {
        event_id: eventId,
        event_type: 'SYNC_DATA',
        status: 'NEW',
        payload: {
          sync_session_id: this.currentSession!.sessionId,
          event_id: eventId,
          table,
          operation,
          record,
        },
      };

      // Measure payload size for diagnostics (like server-side logging)
      const payloadJSON = JSON.stringify(event.payload);
      const byteSize = new Blob([payloadJSON]).size;
      const mbSize = byteSize / (1024 * 1024);
      log.debug(`📊 SYNC_DATA payload size: ${table} ${operation} - ${mbSize.toFixed(2)} MB (${byteSize} bytes)`);

      log.info(`Sending sync data for ${table}:${record.id || 'undefined'}, eventId: ${eventId}`);
      this.connectionManager.sendEvent('sync', event).catch(reject);

      // Set timeout
      setTimeout(() => {
        if (this.pendingSyncConfirmation?.eventId === eventId) {
          this.pendingSyncConfirmation = null;
          reject(new Error(`Timeout waiting for confirmation of ${eventId}`));
        }
      }, 30000); // 30 second timeout
    });
  }

  private async handleIncomingSyncData(payload: any): Promise<void> {
    try {
      // Better logging for primary key (handle both 'id' and 'entity_id')
      const pkField = payload.table === 'entity_module_mappings' ? 'entity_id' : 'id';
      const pkValue = payload.record?.[pkField] || 'undefined';
      log.info(`Buffering sync data for ${payload.table}:${pkValue}`);
      
      if (!this.currentSession) {
        log.error('No active sync session');
        return;
      }
      
      // Buffer the incoming data for atomic application later
      this.incomingDataBuffer.push({
        table: payload.table,
        operation: payload.operation,
        record: payload.record
      });
      
      this.currentSession.recordsReceived++;
      this.emit('sync:progress', this.currentSession);

      // Send confirmation
      const confirmPayload = {
        sync_session_id: payload.sync_session_id,
        event_id: payload.event_id,
        status: 'SUCCESS'
      };
      
      // DIAGNOSTIC: Validate payload before sending
      if (!confirmPayload.sync_session_id || !confirmPayload.event_id) {
        log.error('⚠️ DIAGNOSTIC: Attempting to send SYNC_DATA_CONFIRM with empty fields!');
        log.error(`  sync_session_id: ${confirmPayload.sync_session_id || 'EMPTY'}`);
        log.error(`  event_id: ${confirmPayload.event_id || 'EMPTY'}`);
        log.error(`  Original payload received:`, JSON.stringify(payload, null, 2));
      }
      
      const confirmEvent = {
        event_id: this.generateEventId(),
        event_type: 'SYNC_DATA_CONFIRM',
        status: 'NEW',
        payload: confirmPayload
      };
      
      log.debug(`Sending SYNC_DATA_CONFIRM for event ${confirmPayload.event_id} in session ${confirmPayload.sync_session_id}`);
      
      await this.connectionManager.sendEvent('sync', confirmEvent);
      
    } catch (error: any) {
      log.error('Error buffering sync record:', error);
      
      const errorEvent = {
        event_id: this.generateEventId(),
        event_type: 'SYNC_DATA_CONFIRM',
        status: 'NEW',
        payload: {
          sync_session_id: payload.sync_session_id,
          event_id: payload.event_id,
          status: 'ERROR',
          error_message: error.message || 'Unknown error'
        }
      };
      await this.connectionManager.sendEvent('sync', errorEvent);
      
      // Emit sync error to notify UI
      this.emit('sync:error', error.message || 'Unknown error');
    }
  }

  private handleSyncDataConfirm(payload: any): void {
    if (!payload) {
      log.error('SYNC_DATA_CONFIRM received with null payload');
      return;
    }

    log.debug(`Received confirmation for ${payload.event_id}: ${payload.status}`);

    // Check if we're waiting for this confirmation
    if (this.pendingSyncConfirmation?.eventId === payload.event_id) {
      if (payload.status === 'SUCCESS') {
        // Increment records sent counter and emit progress when confirmed
        if (this.currentSession) {
          this.currentSession.recordsSent++;
          this.emit('sync:progress', this.currentSession);
        }
        this.pendingSyncConfirmation?.resolve(true);
      } else {
        this.pendingSyncConfirmation?.reject(
          new Error(payload.error_message || 'Sync failed')
        );
      }
      this.pendingSyncConfirmation = null;
    }
  }

  private async handleSyncComplete(event: any): Promise<void> {
    if (!this.currentSession) {
      log.warn('Received SYNC_COMPLETE but no current session');
      return;
    }
    
    const status = event.status;
    log.info(`Received sync event: SYNC_COMPLETE status: ${status} phase: ${this.syncPhase}`);

    // Handle SYNC_COMPLETE from server (can be NEW or SUCCESS status)
    if (this.syncPhase === 'SERVER_SENDING') {
      // Server finished sending - apply buffered data atomically and move to next phase
      try {
        await this.applyBufferedSyncData();
        log.info('Server data applied successfully');
      } catch (error) {
        log.error('Failed to apply server data:', error);
        this.incomingDataBuffer = []; // Clear buffer on error
        this.emit('sync:error', 'Failed to apply server data');
        return;
      }
      
      log.info('Starting client data transmission');
      this.syncPhase = 'CLIENT_SENDING';
      
      // Trigger local changes sequentially
      const lastSync = await this.getLastSyncTimestamp();
      this.sendLocalChangesSequentially(lastSync);
      
    } else if (this.syncPhase === 'CLIENT_SENDING' && status === 'SUCCESS' ) {
      // Server acknowledged our SYNC_COMPLETE
      log.info('Server acknowledged our data transmission complete');
      this.localChangesSent = true;
      this.remoteCompleteReceived = true;
      
      // Both sides complete - send SYNC_FINALIZE
      log.info('Both sides complete, sending SYNC_FINALIZE');
      this.syncPhase = 'FINALIZING';
      
      const finalizeEvent = {
        event_id: this.generateEventId(),
        event_type: 'SYNC_FINALIZE',
        status: 'NEW',
        payload: {
          sync_session_id: this.currentSession!.sessionId
        }
      };
      
      this.connectionManager.sendEvent('sync', finalizeEvent);
    }
  }

  private async handleSyncFinalize(): Promise<void> {
    if (!this.currentSession) {
      log.warn('Received SYNC_FINALIZE but no current session');
      return;
    }
    
    log.info('Finalizing sync session');
    
    await this.updateLastSyncTimestamp(this.currentSession.startTime);
    
    this.currentSession.status = 'completed';
    this.emit('sync:completed', this.currentSession);
    this.currentSession = null;
  }

  private async getLastSyncTimestamp(): Promise<number> {
    const stored = await AsyncStorage.getItem('last_sync_timestamp');
    return stored ? parseInt(stored) : 0;
  }

  private async updateLastSyncTimestamp(timestamp: number): Promise<void> {
    await AsyncStorage.setItem('last_sync_timestamp', timestamp.toString());
    log.info(`Updated last sync timestamp: ${timestamp}`);
  }

  /**
   * Returns the list of foreign key field names for a given table
   */
  private getForeignKeyFields(table: string): string[] {
    const fkMap: Record<string, string[]> = {
      'entities': ['character_profile_id'],
      'entity_module_mappings': [
        'entity_id',
        'backend_config_id',
        'cognition_config_id',
        'movement_config_id',
        'rag_config_id',
        'stt_config_id',
        'tts_config_id'
      ],
      'backend_configs': ['provider_config_id'],
      'cognition_configs': ['provider_config_id'],
      'movement_configs': ['provider_config_id'],
      'rag_configs': ['provider_config_id'],
      'stt_configs': ['transcription_provider_config_id', 'vad_provider_config_id'],
      'tts_configs': ['provider_config_id'],
    };
    
    return fkMap[table] || [];
  }
}

export default SyncService.getInstance();
