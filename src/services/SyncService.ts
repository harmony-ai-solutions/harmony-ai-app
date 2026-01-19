import EventEmitter from 'eventemitter3';
import DeviceInfo from 'react-native-device-info';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SyncHelpers from '../database/sync';

// Define event types for type safety
interface SyncServiceEvents {
  'handshake:requested': (event: any) => void;
  'handshake:pending': (payload: any) => void;
  'handshake:accepted': (payload: any) => void;
  'handshake:rejected': (payload: any) => void;
  'sync:requested': (event: any) => void;
  'sync:started': (session: SyncSession) => void;
  'sync:progress': (session: SyncSession) => void;
  'sync:data_out': (event: any) => void;
  'sync:confirm_out': (event: any) => void;
  'sync:complete_out': (event: any) => void;
  'sync:finalize_out': (event: any) => void;
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
  private currentSession: SyncSession | null = null;
  private pendingConfirmations: Map<string, (success: boolean) => void> = new Map();

  static getInstance(): SyncService {
    if (!SyncService.instance) {
      SyncService.instance = new SyncService();
    }
    return SyncService.instance;
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
    
    console.log('[SyncService] Requesting handshake:', event);
    this.emit('handshake:requested', event);
  }

  async handleHandshakeAccept(payload: any): Promise<void> {
    console.log('[SyncService] Handshake accepted:', payload);
    await AsyncStorage.setItem('harmony_jwt', payload.jwt_token);    

    // Get the server URL from the current WebSocket connection
    const currentWsUrl = await AsyncStorage.getItem('harmony_server_url');
    if (currentWsUrl) {
      // Replace ws:// with wss:// and update port
      const wssUrl = currentWsUrl.replace(/^ws:\/\//, 'wss://').replace(/:\d+/, `:${payload.wss_port}`);
      await AsyncStorage.setItem('harmony_wss_url', wssUrl);
      console.log('[SyncService] Constructed WSS URL:', wssUrl);
    }
    
    await AsyncStorage.setItem('harmony_server_cert', payload.server_cert);
    await AsyncStorage.setItem('harmony_token_expires_at', payload.token_expires_at.toString());
    
    this.emit('handshake:accepted', payload);
  }

  async initiateSync(): Promise<void> {
    const lastSync = await this.getLastSyncTimestamp();
    const deviceId = await DeviceInfo.getUniqueId();
    const deviceName = await DeviceInfo.getDeviceName();
    
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
    
    console.log('[SyncService] Initiating sync:', event);
    this.emit('sync:requested', event);
  }

  async handleSyncAccept(payload: any): Promise<void> {
    if (!this.currentSession) {
      console.warn('[SyncService] Received SYNC_ACCEPT but no current session');
      return;
    }
    
    console.log('[SyncService] Sync accepted:', payload);
    this.currentSession.status = 'in_progress';
    this.currentSession.sessionId = payload.sync_session_id;
    
    this.emit('sync:started', this.currentSession);
    
    // Trigger sending local changes
    try {
      await this.sendLocalChanges(payload.last_sync_timestamp);
    } catch (error: any) {
      console.error('[SyncService] Error sending local changes:', error);
      this.emit('sync:error', error.message);
    }
  }

  private async sendLocalChanges(lastSync: number): Promise<void> {
    console.log('[SyncService] Sending local changes since:', lastSync);
    
    const tables = [
      'character_profiles',
      'character_image',
      'entities',
      'entity_module_mappings',
      'chat_messages',
      'provider_config_openai',
      'provider_config_openrouter',
      'provider_config_openaicompatible',
      'provider_config_harmonyspeech',
      'provider_config_elevenlabs',
      'provider_config_kindroid',
      'provider_config_kajiwoto',
      'provider_config_characterai',
      'provider_config_localai',
      'provider_config_mistral',
      'provider_config_ollama',
      'backend_configs',
      'cognition_configs',
      'movement_configs',
      'rag_configs',
      'stt_configs',
      'tts_configs'
    ];
    
    for (const table of tables) {
      try {
        const changes = await SyncHelpers.getChangedRecords(table, lastSync);
        console.log(`[SyncService] Found ${changes.length} changes in ${table}`);
        
        for (const record of changes) {
          const operation = record.deleted_at ? 'delete' : 
                           (SyncHelpers.toUnixTimestamp(record.created_at) > lastSync ? 'insert' : 'update');
          
          await this.sendSyncData(table, operation, record);
        }
      } catch (error: any) {
        console.error(`[SyncService] Error syncing table ${table}:`, error);
        // Continue with other tables
      }
    }
    
    await this.sendSyncComplete();
  }

  private async sendSyncData(table: string, operation: string, record: any): Promise<void> {
    if (!this.currentSession) return;

    const eventId = this.generateEventId();
    const event = {
      event_id: eventId,
      event_type: 'SYNC_DATA',
      status: 'NEW',
      payload: {
        sync_session_id: this.currentSession.sessionId,
        event_id: eventId,  // Include in payload for confirmation
        table: table,
        operation: operation,
        record: record
      }
    };
    
    console.log(`[SyncService] Sending sync data for ${table}:${record.id}`);
    this.emit('sync:data_out', event);
    
    const confirmed = await this.waitForConfirmation(eventId);
    if (confirmed) {
      this.currentSession.recordsSent++;
      this.emit('sync:progress', this.currentSession);
    } else {
      console.warn(`[SyncService] Failed to confirm ${table}:${record.id}`);
    }
  }

  async handleIncomingSyncData(payload: any): Promise<void> {
    try {
      console.log(`[SyncService] Receiving sync data for ${payload.table}:${payload.record?.id}`);
      
      await SyncHelpers.applySyncRecord(
        payload.table,
        payload.operation,
        payload.record
      );
      
      const confirmEvent = {
        event_id: this.generateEventId(),
        event_type: 'SYNC_DATA_CONFIRM',
        status: 'SUCCESS',
        payload: {
          event_id: payload.event_id,
          status: 'SUCCESS'
        }
      };
      
      this.emit('sync:confirm_out', confirmEvent);
      
      if (this.currentSession) {
        this.currentSession.recordsReceived++;
        this.emit('sync:progress', this.currentSession);
      }
    } catch (error: any) {
      console.error('[SyncService] Error applying sync record:', error);
      
      const errorEvent = {
        event_id: this.generateEventId(),
        event_type: 'SYNC_DATA_CONFIRM',
        status: 'ERROR',
        payload: {
          event_id: payload.event_id,
          status: 'ERROR',
          error_message: error.message
        }
      };
      this.emit('sync:confirm_out', errorEvent);
    }
  }

  handleSyncDataConfirm(payload: any): void {
    const callback = this.pendingConfirmations.get(payload.event_id);
    if (callback) {
      callback(payload.status === 'SUCCESS');
      this.pendingConfirmations.delete(payload.event_id);
    }
  }

  async handleSyncComplete(): Promise<void> {
    if (!this.currentSession) {
      console.warn('[SyncService] Received SYNC_COMPLETE but no current session');
      return;
    }
    
    console.log('[SyncService] Sync complete, sending finalize');
    
    const finalizeEvent = {
      event_id: this.generateEventId(),
      event_type: 'SYNC_FINALIZE',
      status: 'SUCCESS',
      payload: {
        sync_session_id: this.currentSession.sessionId
      }
    };
    
    this.emit('sync:finalize_out', finalizeEvent);
  }

  async handleSyncFinalize(): Promise<void> {
    if (!this.currentSession) {
      console.warn('[SyncService] Received SYNC_FINALIZE but no current session');
      return;
    }
    
    console.log('[SyncService] Finalizing sync session');
    
    await this.updateLastSyncTimestamp(this.currentSession.startTime);
    
    this.currentSession.status = 'completed';
    this.emit('sync:completed', this.currentSession);
    this.currentSession = null;
  }

  private waitForConfirmation(eventId: string): Promise<boolean> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingConfirmations.delete(eventId);
        console.warn(`[SyncService] Timeout waiting for confirmation: ${eventId}`);
        resolve(false);
      }, 30000); // 30 second timeout
      
      this.pendingConfirmations.set(eventId, (success) => {
        clearTimeout(timeout);
        resolve(success);
      });
    });
  }

  private async getLastSyncTimestamp(): Promise<number> {
    const stored = await AsyncStorage.getItem('last_sync_timestamp');
    return stored ? parseInt(stored) : 0;
  }

  private async updateLastSyncTimestamp(timestamp: number): Promise<void> {
    await AsyncStorage.setItem('last_sync_timestamp', timestamp.toString());
    console.log('[SyncService] Updated last sync timestamp:', timestamp);
  }

  private async sendSyncComplete(): Promise<void> {
    if (!this.currentSession) return;
    
    const event = {
      event_id: this.generateEventId(),
      event_type: 'SYNC_COMPLETE',
      status: 'SUCCESS',
      payload: {
        sync_session_id: this.currentSession.sessionId
      }
    };
    
    console.log('[SyncService] Sending SYNC_COMPLETE');
    this.emit('sync:complete_out', event);
  }
}

export default SyncService.getInstance();
