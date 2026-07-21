/**
 * HarmonyLinkMockServer
 *
 * An EventEmitter-based mock server that speaks the Harmony Link sync protocol.
 * It DOES NOT use real WebSocket or mock-socket — events are routed directly
 * through a callback interface.
 *
 * This avoids the fragile global.WebSocket patching that jest-websocket-mock
 * requires (broken in Jest 30 + jsdom).  Tests inject the mock server into
 * a lightweight ConnectionManager mock, which calls the server's
 * `handleClientEvent()` method instead of sending over the wire.
 *
 * ## Protocol Flow (happy path)
 *
 * | Step | Client sends                | Server responds                | Status    |
 * |------|----------------------------|--------------------------------|-----------|
 * | 1    | HANDSHAKE_REQUEST           |                                | NEW       |
 * | 2    |                             | HANDSHAKE_ACCEPT               | DONE      |
 * | 3    | SYNC_REQUEST                |                                | NEW       |
 * | 4    |                             | SYNC_ACCEPT                    | NEW       |
 * | 5    | SYNC_START                  |                                | NEW       |
 * | 6    |                             | SYNC_DATA × N                  | NEW       |
 * | 7    |                             | SYNC_COMPLETE                  | NEW       |
 * | 8    | SYNC_DATA × N (client)     |                                | NEW       |
 * | 9    |                             | SYNC_DATA_CONFIRM              | NEW       |
 * | 10   | SYNC_COMPLETE               |                                | NEW       |
 * | 11   |                             | SYNC_COMPLETE                  | SUCCESS   |
 * | 12   | SYNC_FINALIZE               |                                | NEW       |
 * | 13   |                             | SYNC_FINALIZE                  | SUCCESS   |
 *
 * ## Usage
 *
 * ```ts
 * const server = new HarmonyLinkMockServer();
 * server.setServerData('character_profiles', [ ... ]);
 * server.setEventHandler((event) => {
 *   // event is sent to the client (i.e., SyncService.routeSyncEvent)
 * });
 * server.startAutoResponder();
 * // ... trigger sync ...
 * expect(server.receivedEvents).toContainEqual(
 *   expect.objectContaining({ event_type: 'SYNC_REQUEST' })
 * );
 * ```
 */

import EventEmitter from 'eventemitter3';

export type SyncPhase =
  | 'IDLE'
  | 'HANDSHAKE'
  | 'SYNC_REQUEST'
  | 'SYNC_ACCEPT'
  | 'SYNC_START'
  | 'SYNC_DATA'
  | 'SYNC_COMPLETE'
  | 'SYNC_FINALIZE';

export interface ServerRecord {
  id: string;
  [key: string]: any;
}

export class HarmonyLinkMockServer extends EventEmitter {
  public receivedEvents: any[] = [];
  private _serverData: Map<string, ServerRecord[]> = new Map();
  private _autoResponder: boolean = false;
  private _sessionId: string = '';
  private _phase: SyncPhase = 'IDLE';
  private _serverLastSync: number = 0;
  private _manualMode: boolean = false;
  private _nextResponseDelay: number = 0;

  // Callback set by the test harness to deliver events to the SyncService
  private _eventHandler: ((event: any) => void) | null = null;

  constructor() {
    super();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Register the callback that delivers server events to the client.
   * In the real flow this is `SyncService.routeSyncEvent`.
   */
  setEventHandler(handler: (event: any) => void): void {
    this._eventHandler = handler;
  }

  /** Pre-populate the data the server will send during SYNC_DATA. */
  setServerData(table: string, records: ServerRecord[]): void {
    this._serverData.set(table, records);
  }

  /** Set the last_sync_timestamp the server reports to the client. */
  setServerLastSync(timestamp: number): void {
    this._serverLastSync = timestamp;
  }

  /** Start the auto-responder that drives the protocol automatically. */
  startAutoResponder(): void {
    this._autoResponder = true;
  }

  /** Stop the auto-responder for manual step-by-step driving. */
  stopAutoResponder(): void {
    this._autoResponder = false;
  }

  /**
   * If manual mode is on, the auto-responder will NOT reply to protocol events.
   * Use `send()` to drive the server manually.
   */
  setManualMode(manual: boolean): void {
    this._manualMode = manual;
  }

  /** Send an event from the server to the client via the event handler. */
  send(event: any): void {
    // Emit the event for test listeners (e.g., mockServer.on('SYNC_DATA', cb))
    this.emit(event.event_type, event);
    if (this._eventHandler) {
      // Simulate async delivery (next tick)
      setImmediate(() => {
        this._eventHandler!(event);
      });
    }
  }

  /**
   * Convenience: register a listener for server-sent events.
   * Alias for `on(eventType, callback)` since this class extends EventEmitter.
   * Use this to capture server-originated events for assertions:
   *
   * ```ts
   * const sentEvents: any[] = [];
   * mockServer.onEvent('SYNC_DATA', e => sentEvents.push(e));
   * ```
   */
  onEvent(eventType: string, callback: (event: any) => void): void {
    this.on(eventType, callback);
  }

  /**
   * Process an event received from the client.
   * This is called by the mock ConnectionManager when SyncService sends an event.
   */
  handleClientEvent(event: any): void {
    this.receivedEvents.push(event);

    if (this._autoResponder && !this._manualMode) {
      const delay = this._nextResponseDelay;
      if (delay > 0) {
        this._nextResponseDelay = 0;
        setTimeout(() => this._autoRespond(event), delay);
      } else {
        // Use setImmediate to let the client's sendEvent return first
        setImmediate(() => this._autoRespond(event));
      }
    }
  }

  /**
   * Close the connection abruptly — simulates a network drop.
   * (In this EventEmitter-based mock, "dropping" just stops responding.)
   */
  dropConnection(): void {
    this._autoResponder = false;
    this._eventHandler = null;
    this._phase = 'IDLE';
    this.emit('disconnected');
  }

  /**
   * Send an ERROR status for a specific event type.
   */
  sendError(eventType: string, errorMessage: string): void {
    this.send({
      event_type: eventType,
      status: 'ERROR',
      payload: {
        message: errorMessage,
        error_message: errorMessage,
      },
    });
  }

  /** Delay the next auto-response by `ms` milliseconds. */
  delayNextResponse(ms: number): void {
    this._nextResponseDelay = ms;
  }

  /** Reset state for a new test. */
  reset(): void {
    this.receivedEvents = [];
    this._serverData.clear();
    this._sessionId = '';
    this._phase = 'IDLE';
    this._serverLastSync = 0;
    this._autoResponder = false;
    this._manualMode = false;
    this._eventHandler = null;
    this._nextResponseDelay = 0;
  }

  /** Current protocol phase. */
  get currentPhase(): SyncPhase {
    return this._phase;
  }

  /** All events received from the client so far. */
  get sentEvents(): any[] {
    return this.receivedEvents;
  }

  /** Get the server data for a table (useful for assertions). */
  getServerData(table: string): ServerRecord[] {
    return this._serverData.get(table) || [];
  }

  /** Convenience: check server data for a record by ID. */
  hasServerRecord(table: string, id: string): boolean {
    const records = this._serverData.get(table) || [];
    return records.some(r => r.id === id);
  }

  // ---------------------------------------------------------------------------
  // Internal — protocol responder
  // ---------------------------------------------------------------------------

  private _autoRespond(event: any): void {
    switch (event.event_type) {
      case 'HANDSHAKE_REQUEST':
        this._phase = 'HANDSHAKE';
        this.send({
          event_type: 'HANDSHAKE_ACCEPT',
          status: 'DONE',
          payload: {
            jwt_token: 'test-jwt-token',
            token_expires_at: Math.floor(Date.now() / 1000) + 86400,
            server_cert: 'test-cert',
            wss_port: 0,
          },
        });
        break;

      case 'SYNC_REQUEST':
        this._phase = 'SYNC_REQUEST';
        this._sessionId = `sync_test_${Date.now()}`;
        this.send({
          event_type: 'SYNC_ACCEPT',
          status: 'NEW',
          payload: {
            device_id: 'harmony_link',
            device_name: 'Harmony Link',
            device_type: 'harmony_link',
            device_platform: 'server',
            current_utc_timestamp: Math.floor(Date.now() / 1000),
            clock_drift_seconds: 0,
            sync_session_id: this._sessionId,
            last_sync_timestamp: this._serverLastSync,
          },
        });
        break;

      case 'SYNC_START':
        this._phase = 'SYNC_START';
        // Send server data records
        for (const [table, records] of this._serverData.entries()) {
          for (const record of records) {
            const createdAtSeconds = Math.floor(
              new Date(record.created_at).getTime() / 1000,
            );
            const operation =
              record.deleted_at
                ? 'delete'
                : createdAtSeconds > this._serverLastSync
                  ? 'insert'
                  : 'update';

            this.send({
              event_type: 'SYNC_DATA',
              status: 'NEW',
              payload: {
                sync_session_id: this._sessionId,
                event_id: `server_data_${record.id}`,
                table,
                operation,
                record,
              },
            });
          }
        }
        // Then send SYNC_COMPLETE
        this.send({
          event_type: 'SYNC_COMPLETE',
          status: 'NEW',
          payload: {
            sync_session_id: this._sessionId,
          },
        });
        this._phase = 'SYNC_DATA';
        break;

      case 'SYNC_DATA':
        this._phase = 'SYNC_DATA';
        // Store the received record
        this._storeReceivedData(event.payload.table, event.payload.record);
        // Send confirmation
        this.send({
          event_type: 'SYNC_DATA_CONFIRM',
          status: 'NEW',
          payload: {
            sync_session_id: event.payload.sync_session_id,
            event_id: event.payload.event_id,
            status: 'SUCCESS',
          },
        });
        break;

      case 'SYNC_COMPLETE':
        // Client is done sending — acknowledge
        this._phase = 'SYNC_COMPLETE';
        this.send({
          event_type: 'SYNC_COMPLETE',
          status: 'SUCCESS',
          payload: {
            sync_session_id: this._sessionId,
          },
        });
        break;

      case 'SYNC_FINALIZE':
        this._phase = 'SYNC_FINALIZE';
        this.send({
          event_type: 'SYNC_FINALIZE',
          status: 'SUCCESS',
          payload: {
            sync_session_id: this._sessionId,
          },
        });
        break;

      default:
        // Unknown event types are silently ignored by the auto-responder
        break;
    }
  }

  private _storeReceivedData(table: string, record: ServerRecord): void {
    const existing = this._serverData.get(table) || [];
    const idx = existing.findIndex(r => r.id === record.id);
    if (idx >= 0) {
      existing[idx] = record;
    } else {
      existing.push(record);
    }
    this._serverData.set(table, existing);
  }
}
