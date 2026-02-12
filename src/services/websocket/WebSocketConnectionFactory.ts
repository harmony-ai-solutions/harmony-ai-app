import { WebSocketConnection } from './WebSocketConnection';
import { UnencryptedWebSocketConnection } from './UnencryptedWebSocketConnection';
import { SecureWebSocketConnection } from './SecureWebSocketConnection';
import { InsecureSSLWebSocketConnection } from './InsecureSSLWebSocketConnection';

export class WebSocketConnectionFactory {
  static createConnection(mode: 'unencrypted' | 'secure' | 'insecure-ssl'): WebSocketConnection {
    switch (mode) {
      case 'unencrypted':
        return new UnencryptedWebSocketConnection();
      case 'secure':
        return new SecureWebSocketConnection();
      case 'insecure-ssl':
        return new InsecureSSLWebSocketConnection();
      default:
        throw new Error(`Unsupported WebSocket connection mode: ${mode}`);
    }
  }
}
