/**
 * SyncService Test Suite
 * 
 * Mirrors the synchronization_test.go test suite from Harmony Link
 * Tests the complete bidirectional sync protocol flow using mocks
 */

import { SyncService } from '../../src/services/SyncService';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Mock modules
jest.mock('react-native-device-info', () => ({
  getUniqueId: jest.fn(() => Promise.resolve('test-device-001')),
  getDeviceName: jest.fn(() => Promise.resolve('Test Device')),
}));

jest.mock('react-native', () => ({
  Platform: {
    OS: 'test',
  },
}));

// Mock SyncHelpers
jest.mock('../../src/database/sync');

// Import to get access to mocked functions
import * as SyncHelpers from '../../src/database/sync';

// Get the mocked functions
const mockGetChangedRecords = SyncHelpers.getChangedRecords as jest.MockedFunction<typeof SyncHelpers.getChangedRecords>;
const mockApplySyncRecord = SyncHelpers.applySyncRecord as jest.MockedFunction<typeof SyncHelpers.applySyncRecord>;
const mockToUnixTimestamp = SyncHelpers.toUnixTimestamp as jest.MockedFunction<typeof SyncHelpers.toUnixTimestamp>;

// Mock ConnectionManager to simulate server
class MockConnectionManager {
  private eventHandlers: Map<string, Function> = new Map();
  private sentEvents: any[] = [];
  public serverDatabase: Map<string, any[]> = new Map(); // Simulated server DB
  public serverLastSync: number = 0;
  public sessionId: string = '';

  on(event: string, handler: Function) {
    this.eventHandlers.set(event, handler);
  }

  async sendEvent(connectionType: string, event: any) {
    this.sentEvents.push(event);
    
    // Simulate server responses based on event type
    setTimeout(() => {
      this.handleClientEvent(event);
    }, 10);
  }

  private handleClientEvent(event: any) {
    const handler = this.eventHandlers.get('event:sync');
    if (!handler) return;

    switch (event.event_type) {
      case 'HANDSHAKE_REQUEST':
        this.handleHandshakeRequest(handler);
        break;
      case 'SYNC_REQUEST':
        this.handleSyncRequest(handler, event);
        break;
      case 'SYNC_START':
        this.handleSyncStart(handler, event);
        break;
      case 'SYNC_DATA':
        this.handleSyncData(handler, event);
        break;
      case 'SYNC_DATA_CONFIRM':
        this.handleSyncDataConfirm(handler, event);
        break;
      case 'SYNC_COMPLETE':
        this.handleSyncComplete(handler, event);
        break;
      case 'SYNC_FINALIZE':
        this.handleSyncFinalize(handler, event);
        break;
    }
  }

  private handleHandshakeRequest(handler: Function) {
    handler({
      event_type: 'HANDSHAKE_ACCEPT',
      status: 'DONE',
      payload: {
        jwt_token: 'test-jwt-token',
        token_expires_at: Date.now() + 86400000,
        server_cert: 'test-cert',
        wss_port: 8443,
      },
    });
  }

  private handleSyncRequest(handler: Function, event: any) {
    this.sessionId = `sync_test_${Date.now()}`;
    handler({
      event_type: 'SYNC_REQUEST',
      status: 'SUCCESS',
      payload: {
        device_id: 'harmony_link',
        device_name: 'Harmony Link',
        device_type: 'harmony_link',
        device_platform: 'server',
        current_utc_timestamp: Math.floor(Date.now() / 1000),
        clock_drift_seconds: 0,
        sync_session_id: this.sessionId,
        last_sync_timestamp: this.serverLastSync,
      },
    });
  }

  private handleSyncStart(handler: Function, event: any) {
    // Server sends its data
    const serverData = this.serverDatabase.get('character_profiles') || [];
    
    for (const record of serverData) {
      const createdAtSeconds = Math.floor(record.created_at / 1000);
      const operation = record.deleted_at ? 'delete' : 
                       (createdAtSeconds > this.serverLastSync ? 'insert' : 'update');
      
      setTimeout(() => {
        handler({
          event_type: 'SYNC_DATA',
          status: 'NEW',
          payload: {
            sync_session_id: this.sessionId,
            event_id: `server_data_${record.id}`,
            table: 'character_profiles',
            operation,
            record,
          },
        });
      }, 20);
    }

    // Server completes after sending data
    setTimeout(() => {
      handler({
        event_type: 'SYNC_COMPLETE',
        status: 'SUCCESS',
        payload: {
          sync_session_id: this.sessionId,
        },
      });
    }, 50);
  }

  private handleSyncData(handler: Function, event: any) {
    // Store received data in server DB simulation
    const { table, record } = event.payload;
    const tableData = this.serverDatabase.get(table) || [];
    const existingIndex = tableData.findIndex((r: any) => r.id === record.id);
    
    if (existingIndex >= 0) {
      tableData[existingIndex] = record;
    } else {
      tableData.push(record);
    }
    this.serverDatabase.set(table, tableData);

    // Send confirmation
    handler({
      event_type: 'SYNC_DATA_CONFIRM',
      status: 'NEW',
      payload: {
        sync_session_id: this.sessionId,
        event_id: event.payload.event_id,
        status: 'SUCCESS',
      },
    });
  }

  private handleSyncDataConfirm(handler: Function, event: any) {
    // Client confirmation received - no response needed
  }

  private handleSyncComplete(handler: Function, event: any) {
    // Acknowledge client complete
    handler({
      event_type: 'SYNC_COMPLETE',
      status: 'PENDING',
      payload: {
        sync_session_id: this.sessionId,
      },
    });
  }

  private handleSyncFinalize(handler: Function, event: any) {
    // Acknowledge finalize
    handler({
      event_type: 'SYNC_FINALIZE',
      status: 'SUCCESS',
      payload: {
        sync_session_id: this.sessionId,
      },
    });
  }

  getSentEvents() {
    return this.sentEvents;
  }

  getSentEventsByType(type: string) {
    return this.sentEvents.filter(e => e.event_type === type);
  }

  clearSentEvents() {
    this.sentEvents = [];
  }

  setServerData(table: string, data: any[]) {
    this.serverDatabase.set(table, data);
  }

  getServerData(table: string): any[] {
    return this.serverDatabase.get(table) || [];
  }
}

describe('SyncService', () => {
  let syncService: SyncService;
  let mockConnectionManager: MockConnectionManager;
  let clientDatabase: Map<string, any[]>; // Simulated client DB

  beforeEach(async () => {
    // Clear AsyncStorage
    jest.clearAllMocks();
    (AsyncStorage.clear as jest.Mock).mockResolvedValue(undefined);
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
    
    // Initialize client database simulation
    clientDatabase = new Map();

    // Setup mock database helpers
    mockGetChangedRecords.mockImplementation((table: string, sinceTimestamp: number) => {
      const records = clientDatabase.get(table) || [];
      const sinceMs = sinceTimestamp * 1000;
      return Promise.resolve(
        records.filter((r: any) => 
          r.created_at > sinceMs || 
          r.updated_at > sinceMs || 
          (r.deleted_at && r.deleted_at > sinceMs)
        )
      );
    });

    mockApplySyncRecord.mockImplementation((table: string, operation: string, record: any) => {
      const tableData = clientDatabase.get(table) || [];
      const existingIndex = tableData.findIndex((r: any) => r.id === record.id);
      
      if (operation === 'delete') {
        if (existingIndex >= 0) {
          tableData[existingIndex] = { ...tableData[existingIndex], deleted_at: Date.now() };
        } else {
          // Add the deleted record even if it doesn't exist locally
          tableData.push({ ...record, deleted_at: record.deleted_at || Date.now() });
        }
      } else if (existingIndex >= 0) {
        tableData[existingIndex] = record;
      } else {
        tableData.push(record);
      }
      
      clientDatabase.set(table, tableData);
      return Promise.resolve();
    });

    // Create mock connection manager
    mockConnectionManager = new MockConnectionManager();
    
    // Create new SyncService instance with mocked ConnectionManager
    (SyncService as any).instance = null;
    syncService = SyncService.getInstance();
    
    // Replace the connection manager
    (syncService as any).connectionManager = mockConnectionManager;
    (syncService as any).setupConnectionListeners();
  });

  afterEach(() => {
    mockConnectionManager.clearSentEvents();
    clientDatabase.clear();
  });

  describe('New Device - Empty DB', () => {
    it('should pull all data from server when syncing for the first time', async () => {
      // Setup: Server has data
      mockConnectionManager.setServerData('character_profiles', [
        {
          id: 'char-1',
          name: 'Character One',
          description: 'Test character 1',
          personality: 'Friendly',
          created_at: Date.now() - 10000,
          updated_at: Date.now() - 10000,
          deleted_at: null,
        },
        {
          id: 'char-2',
          name: 'Character Two',
          description: 'Test character 2',
          personality: 'Serious',
          created_at: Date.now() - 10000,
          updated_at: Date.now() - 10000,
          deleted_at: null,
        },
      ]);

      // Setup: Empty client DB
      clientDatabase.set('character_profiles', []);

      // Setup event listeners
      const syncStarted = new Promise(resolve => syncService.on('sync:started', resolve));
      const syncCompleted = new Promise(resolve => syncService.on('sync:completed', resolve));

      // Execute: Initiate sync
      await syncService.initiateSync();

      // Wait for sync to complete
      await syncStarted;
      await syncCompleted;

      // Verify: Check that data was received and stored
      const characters = clientDatabase.get('character_profiles') || [];
      expect(characters.length).toBe(2);
      expect(characters.find((c: any) => c.id === 'char-1')).toBeDefined();
      expect(characters.find((c: any) => c.id === 'char-2')).toBeDefined();

      // Verify sync events sent
      const syncRequests = mockConnectionManager.getSentEventsByType('SYNC_REQUEST');
      expect(syncRequests.length).toBe(1);
      expect(syncRequests[0].payload.last_sync_timestamp).toBe(0);

      const syncStarts = mockConnectionManager.getSentEventsByType('SYNC_START');
      expect(syncStarts.length).toBe(1);
    }, 10000);
  });

  describe('New Device - With Existing Content', () => {
    it('should send local data and receive server data on first sync', async () => {
      // Setup: Client has local data
      const localChar = {
        id: 'char-local-1',
        name: 'Local Character',
        description: 'Created on device',
        personality: 'Curious',
        created_at: Date.now() - 5000,
        updated_at: Date.now() - 5000,
        deleted_at: null,
      };
      
      clientDatabase.set('character_profiles', [localChar]);

      // Setup: Server has different data
      mockConnectionManager.setServerData('character_profiles', [
        {
          id: 'char-server-1',
          name: 'Server Character',
          description: 'Created on server',
          personality: 'Wise',
          created_at: Date.now() - 10000,
          updated_at: Date.now() - 10000,
          deleted_at: null,
        },
      ]);

      // Setup event listeners
      const syncCompleted = new Promise(resolve => syncService.on('sync:completed', resolve));

      // Execute: Initiate sync
      await syncService.initiateSync();
      await syncCompleted;

      // Verify: Client should have both characters
      const characters = clientDatabase.get('character_profiles') || [];
      expect(characters.length).toBe(2);
      expect(characters.find((c: any) => c.id === 'char-local-1')).toBeDefined();
      expect(characters.find((c: any) => c.id === 'char-server-1')).toBeDefined();

      // Verify: Server should have received client's character
      const serverChars = mockConnectionManager.getServerData('character_profiles');
      expect(serverChars.find((c: any) => c.id === 'char-local-1')).toBeDefined();
    }, 10000);
  });

  describe('Existing Device - Server Updates Only', () => {
    it('should receive only updated records from server', async () => {
      // Setup: Simulate previous sync
      const lastSyncTime = Math.floor((Date.now() - 10000) / 1000);
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(lastSyncTime.toString());
      mockConnectionManager.serverLastSync = lastSyncTime;

      // Setup: Create character that existed before last sync
      const oldChar = {
        id: 'char-sync-1',
        name: 'Original Name',
        description: 'Original description',
        personality: 'Original',
        created_at: Date.now() - 20000,
        updated_at: Date.now() - 20000,
        deleted_at: null,
      };
      clientDatabase.set('character_profiles', [oldChar]);

      // Setup: Server has updated version
      mockConnectionManager.setServerData('character_profiles', [
        {
          id: 'char-sync-1',
          name: 'Updated Name',
          description: 'Updated description',
          personality: 'Updated',
          created_at: Date.now() - 20000,
          updated_at: Date.now() - 5000, // Updated after last sync
          deleted_at: null,
        },
      ]);

      // Execute: Initiate sync
      const syncCompleted = new Promise(resolve => syncService.on('sync:completed', resolve));
      await syncService.initiateSync();
      await syncCompleted;

      // Verify: Client should have updated character
      const characters = clientDatabase.get('character_profiles') || [];
      const updatedChar = characters.find((c: any) => c.id === 'char-sync-1');
      expect(updatedChar).toBeDefined();
      expect(updatedChar.name).toBe('Updated Name');
      expect(updatedChar.description).toBe('Updated description');
    }, 10000);
  });

  describe('Existing Device - Client Updates Only', () => {
    it('should send local updates to server', async () => {
      // Setup: Simulate previous sync
      const lastSyncTime = Math.floor((Date.now() - 10000) / 1000);
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(lastSyncTime.toString());
      mockConnectionManager.serverLastSync = lastSyncTime;

      // Setup: Create and then update a character locally
      const updatedChar = {
        id: 'char-client-1',
        name: 'Device Updated Name',
        description: 'Updated on device',
        personality: 'Updated',
        created_at: Date.now() - 20000,
        updated_at: Date.now() - 5000, // Updated after last sync
        deleted_at: null,
      };
      clientDatabase.set('character_profiles', [updatedChar]);

      // Execute: Initiate sync
      const syncCompleted = new Promise(resolve => syncService.on('sync:completed', resolve));
      await syncService.initiateSync();
      await syncCompleted;

      // Verify: Server should have received update
      const serverChars = mockConnectionManager.getServerData('character_profiles');
      const serverChar = serverChars.find((c: any) => c.id === 'char-client-1');
      expect(serverChar).toBeDefined();
      expect(serverChar.name).toBe('Device Updated Name');
      expect(serverChar.description).toBe('Updated on device');

      // Verify: SYNC_DATA events were sent
      const syncDataEvents = mockConnectionManager.getSentEventsByType('SYNC_DATA');
      expect(syncDataEvents.length).toBeGreaterThan(0);
    }, 10000);
  });

  describe('Existing Device - With Deletes', () => {
    it('should sync soft-deleted records from server', async () => {
      // Setup: Simulate previous sync
      const lastSyncTime = Math.floor((Date.now() - 10000) / 1000);
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(lastSyncTime.toString());
      mockConnectionManager.serverLastSync = lastSyncTime;

      // Setup: Server has a deleted character
      mockConnectionManager.setServerData('character_profiles', [
        {
          id: 'char-del-1',
          name: 'Character To Delete',
          description: 'Will be deleted',
          personality: 'Temporary',
          created_at: Date.now() - 20000,
          updated_at: Date.now() - 20000,
          deleted_at: Date.now() - 3000, // Deleted after last sync
        },
        {
          id: 'char-keep-1',
          name: 'Character To Keep',
          description: 'Should stay',
          personality: 'Permanent',
          created_at: Date.now() - 20000,
          updated_at: Date.now() - 20000,
          deleted_at: null,
        },
      ]);

      // Execute: Initiate sync
      const syncCompleted = new Promise(resolve => syncService.on('sync:completed', resolve));
      await syncService.initiateSync();
      await syncCompleted;

      // Verify: Deleted character should be marked as deleted
      const allRecords = clientDatabase.get('character_profiles') || [];
      const deletedChar = allRecords.find((c: any) => c.id === 'char-del-1');
      
      // Should have the record but marked as deleted
      expect(deletedChar).toBeDefined();
      if (deletedChar) {
        expect(deletedChar.deleted_at).toBeTruthy();
      }

      // Verify: Non-deleted character should be present
      const keptChar = allRecords.find((c: any) => c.id === 'char-keep-1');
      expect(keptChar).toBeDefined();
      expect(keptChar?.deleted_at).toBeFalsy();
    }, 10000);

    it('should send local deletes to server', async () => {
      // Setup: Simulate previous sync
      const lastSyncTime = Math.floor((Date.now() - 10000) / 1000);
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(lastSyncTime.toString());

      // Setup: Create deleted character locally
      const deletedChar = {
        id: 'char-to-delete',
        name: 'Character To Delete',
        description: 'Will be deleted',
        personality: 'Temporary',
        created_at: Date.now() - 20000,
        updated_at: Date.now() - 20000,
        deleted_at: Date.now() - 3000, // Deleted after last sync
      };
      clientDatabase.set('character_profiles', [deletedChar]);

      // Execute: Initiate sync
      const syncCompleted = new Promise(resolve => syncService.on('sync:completed', resolve));
      await syncService.initiateSync();
      await syncCompleted;

      // Verify: Server should have received delete operation
      const syncDataEvents = mockConnectionManager.getSentEventsByType('SYNC_DATA');
      const deleteEvent = syncDataEvents.find((e: any) => 
        e.payload.table === 'character_profiles' && 
        e.payload.record.id === 'char-to-delete' &&
        e.payload.operation === 'delete'
      );
      expect(deleteEvent).toBeDefined();
    }, 10000);
  });

  describe('Sync Protocol Flow', () => {
    it('should follow the complete sync protocol', async () => {
      // Setup minimal data
      clientDatabase.set('character_profiles', []);
      mockConnectionManager.setServerData('character_profiles', []);

      // Execute sync
      const syncCompleted = new Promise(resolve => syncService.on('sync:completed', resolve));
      await syncService.initiateSync();
      await syncCompleted;

      // Verify complete protocol flow
      const sentEvents = mockConnectionManager.getSentEvents();
      const eventTypes = sentEvents.map((e: any) => e.event_type);

      expect(eventTypes).toContain('SYNC_REQUEST');
      expect(eventTypes).toContain('SYNC_START');
      expect(eventTypes).toContain('SYNC_COMPLETE');
      expect(eventTypes).toContain('SYNC_FINALIZE');

      // Verify order: SYNC_REQUEST -> SYNC_START -> SYNC_COMPLETE -> SYNC_FINALIZE
      const requestIndex = eventTypes.indexOf('SYNC_REQUEST');
      const startIndex = eventTypes.indexOf('SYNC_START');
      const completeIndex = eventTypes.indexOf('SYNC_COMPLETE');
      const finalizeIndex = eventTypes.indexOf('SYNC_FINALIZE');

      expect(startIndex).toBeGreaterThan(requestIndex);
      expect(completeIndex).toBeGreaterThan(startIndex);
      expect(finalizeIndex).toBeGreaterThan(completeIndex);
    }, 10000);

    it('should update last sync timestamp on completion', async () => {
      // Setup
      clientDatabase.set('character_profiles', []);

      // Execute sync
      const syncCompleted = new Promise(resolve => syncService.on('sync:completed', resolve));
      await syncService.initiateSync();
      await syncCompleted;

      // Verify timestamp was updated
      const setItemCalls = (AsyncStorage.setItem as jest.Mock).mock.calls;
      const timestampCall = setItemCalls.find((call: any[]) => call[0] === 'last_sync_timestamp');
      expect(timestampCall).toBeDefined();
      expect(parseInt(timestampCall![1])).toBeGreaterThan(0);
    }, 10000);
  });

  describe('Error Handling', () => {
    it('should handle sync data errors gracefully', async () => {
      // Setup: Mock applySyncRecord to throw error
      mockApplySyncRecord.mockRejectedValueOnce(new Error('Database error'));

      // Setup: Server sends data
      mockConnectionManager.setServerData('character_profiles', [
        {
          id: 'char-1',
          name: 'Test',
          created_at: Date.now(),
          updated_at: Date.now(),
          deleted_at: null,
        },
      ]);

      // Execute sync - should not crash
      const syncCompleted = new Promise(resolve => syncService.on('sync:completed', resolve));
      await syncService.initiateSync();
      await syncCompleted;

      // Verify error was sent to server
      const confirmEvents = mockConnectionManager.getSentEventsByType('SYNC_DATA_CONFIRM');
      const errorConfirm = confirmEvents.find((e: any) => e.payload.status === 'ERROR');
      expect(errorConfirm).toBeDefined();
    }, 10000);
  });
});
