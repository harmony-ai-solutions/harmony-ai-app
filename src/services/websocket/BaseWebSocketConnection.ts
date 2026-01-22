import EventEmitter from 'eventemitter3';
import { SyncService } from '../SyncService';
import {WebSocketConnection, WebSocketConnectionEvents} from './WebSocketConnection'

export abstract class BaseWebSocketConnection extends EventEmitter<WebSocketConnectionEvents> implements WebSocketConnection {
  protected listenersSetup: boolean = false;
  
  // Store listener function references so we can remove them specifically
  protected handshakeRequestedListener: ((event: any) => void) | null = null;
  protected syncRequestedListener: ((event: any) => void) | null = null;
  protected syncDataOutListener: ((event: any) => void) | null = null;
  protected syncConfirmOutListener: ((event: any) => void) | null = null;
  protected syncCompleteOutListener: ((event: any) => void) | null = null;
  protected syncFinalizeOutListener: ((event: any) => void) | null = null;

  constructor() {
    super();
  }

  abstract connect(url: string): Promise<void>;
  abstract disconnect(): void;
  abstract isConnected(): boolean;
  abstract sendEvent(event: any): Promise<void>;

  protected setupSyncListeners() {
    // Remove any existing listeners first to prevent duplicates
    this.cleanupSyncListeners();
    
    const syncService = SyncService.getInstance();
    
    // Create and store listener function references
    this.handshakeRequestedListener = (event) => {
      console.log('[BaseWebSocketConnection] Forwarding HANDSHAKE_REQUEST');
      this.sendEvent(event);
    };
    
    this.syncRequestedListener = (event) => {
      console.log('[BaseWebSocketConnection] Forwarding SYNC_REQUEST');
      this.sendEvent(event);
    };
    
    this.syncDataOutListener = (event) => {
      console.log('[BaseWebSocketConnection] Forwarding SYNC_DATA');
      this.sendEvent(event);
    };
    
    this.syncConfirmOutListener = (event) => {
      console.log('[BaseWebSocketConnection] Forwarding SYNC_DATA_CONFIRM');
      this.sendEvent(event);
    };
    
    this.syncCompleteOutListener = (event) => {
      console.log('[BaseWebSocketConnection] Forwarding SYNC_COMPLETE');
      this.sendEvent(event);
    };
    
    this.syncFinalizeOutListener = (event) => {
      console.log('[BaseWebSocketConnection] Forwarding SYNC_FINALIZE');
      this.sendEvent(event);
    };
    
    // Register listeners with SyncService
    syncService.on('handshake:requested', this.handshakeRequestedListener);
    syncService.on('sync:requested', this.syncRequestedListener);
    syncService.on('sync:data_out', this.syncDataOutListener);
    syncService.on('sync:confirm_out', this.syncConfirmOutListener);
    syncService.on('sync:complete_out', this.syncCompleteOutListener);
    syncService.on('sync:finalize_out', this.syncFinalizeOutListener);
    
    this.listenersSetup = true;
    console.log('[BaseWebSocketConnection] Sync listeners setup complete');
  }

  protected cleanupSyncListeners() {
    if (!this.listenersSetup) return;
    
    console.log('[BaseWebSocketConnection] Cleaning up sync listeners');
    const syncService = SyncService.getInstance();
    
    // Remove only OUR specific listeners, not all listeners
    if (this.handshakeRequestedListener) {
      syncService.off('handshake:requested', this.handshakeRequestedListener);
    }
    if (this.syncRequestedListener) {
      syncService.off('sync:requested', this.syncRequestedListener);
    }
    if (this.syncDataOutListener) {
      syncService.off('sync:data_out', this.syncDataOutListener);
    }
    if (this.syncConfirmOutListener) {
      syncService.off('sync:confirm_out', this.syncConfirmOutListener);
    }
    if (this.syncCompleteOutListener) {
      syncService.off('sync:complete_out', this.syncCompleteOutListener);
    }
    if (this.syncFinalizeOutListener) {
      syncService.off('sync:finalize_out', this.syncFinalizeOutListener);
    }
    
    // Clear references
    this.handshakeRequestedListener = null;
    this.syncRequestedListener = null;
    this.syncDataOutListener = null;
    this.syncConfirmOutListener = null;
    this.syncCompleteOutListener = null;
    this.syncFinalizeOutListener = null;
    
    this.listenersSetup = false;
  }

  protected handleMessage(event: any): void {
    try {
      const data = JSON.parse(event.data);
      console.log('[BaseWebSocketConnection] Received event:', data.event_type, 'status:', data.status);
      
      // Check if event has ERROR status
      if (data.status === 'ERROR') {
        console.error('[BaseWebSocketConnection] Received ERROR event:', data);
        const errorMsg = data.payload?.message || data.payload?.error || 'An error occurred';
        this.emit('error', { message: errorMsg, event: data });
      }
      
      // Route sync and handshake events to SyncService
      if (data.event_type?.startsWith('SYNC_') || data.event_type?.startsWith('HANDSHAKE_')) {
        this.routeSyncEvent(data);
        return;
      }
      
      // Emit other events for general handling
      this.emit('event', data);
    } catch (error) {
      console.error('[BaseWebSocketConnection] Error parsing message:', error);
    }
  }

  protected routeSyncEvent(event: any): void {
    const syncService = SyncService.getInstance();
    
    console.log('[BaseWebSocketConnection] Routing sync event:', event.event_type);
    
    switch (event.event_type) {
      case 'HANDSHAKE_PENDING':
        console.log('[BaseWebSocketConnection] Handshake pending approval');
        syncService.emit('handshake:pending', event.payload);
        break;
        
      case 'HANDSHAKE_ACCEPT':
        console.log('[BaseWebSocketConnection] Handshake accepted');
        syncService.handleHandshakeAccept(event.payload);
        break;
        
      case 'HANDSHAKE_REJECT':
        console.log('[BaseWebSocketConnection] Handshake rejected');
        syncService.emit('handshake:rejected', event.payload);
        break;
        
      case 'SYNC_REQUEST':
        console.log('[BaseWebSocketConnection] Sync request status update:', event.status);
        // Backend sends SYNC_REQUEST back with status SUCCESS/DONE containing SyncAcceptPayload
        if (event.status === 'SUCCESS' || event.status === 'DONE') {
          console.log('[BaseWebSocketConnection] Sync request accepted, handling as SYNC_ACCEPT');
          syncService.handleSyncAccept(event.payload);
        } else if (event.status === 'ERROR') {
          console.log('[BaseWebSocketConnection] Sync request failed');
          syncService.emit('sync:rejected', event.payload);
        }
        // PENDING status is just an acknowledgement - no action needed
        break;
        
      case 'SYNC_ACCEPT':
        console.log('[BaseWebSocketConnection] Sync accepted');
        syncService.handleSyncAccept(event.payload);
        break;
        
      case 'SYNC_REJECT':
        console.log('[BaseWebSocketConnection] Sync rejected');
        syncService.emit('sync:rejected', event.payload);
        break;
        
      case 'SYNC_DATA':
        console.log('[BaseWebSocketConnection] Received sync data');
        syncService.handleIncomingSyncData(event.payload);
        break;
        
      case 'SYNC_DATA_CONFIRM':
        console.log('[BaseWebSocketConnection] Received sync data confirmation');
        syncService.handleSyncDataConfirm(event.payload);
        break;
        
      case 'SYNC_COMPLETE':
        console.log('[BaseWebSocketConnection] Sync complete');
        syncService.handleSyncComplete(event);
        break;
        
      case 'SYNC_FINALIZE':
        console.log('[BaseWebSocketConnection] Sync finalize');
        syncService.handleSyncFinalize();
        break;
        
      default:
        console.warn(`[BaseWebSocketConnection] Unhandled sync event type: ${event.event_type}`);
        this.emit('sync:unknown_event', event);
    }
  }
}
