import EventEmitter from 'eventemitter3';

export interface WebSocketConnectionEvents {
  'connected': () => void;
  'disconnected': () => void;
  'error': (error: any) => void;
  'cert:verification_failed': (error: any) => void;
  'event': (data: any) => void;
  'sync:unknown_event': (event: any) => void;
}

export interface WebSocketConnection extends EventEmitter<WebSocketConnectionEvents> {
  connect(url: string): Promise<void>;
  disconnect(): void;
  isConnected(): boolean;
  sendEvent(event: any): Promise<void>;
}
