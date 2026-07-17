import { WebSocketConnection } from './WebSocketConnection';
import { UnencryptedWebSocketConnection } from './UnencryptedWebSocketConnection';
import { SecureWebSocketConnection } from './SecureWebSocketConnection';
import { InsecureSSLWebSocketConnection } from './InsecureSSLWebSocketConnection';
import { CloudWebSocketConnection } from './CloudWebSocketConnection';

export class WebSocketConnectionFactory {
  static createConnection(mode: 'unencrypted' | 'secure' | 'insecure-ssl' | 'cloud'): WebSocketConnection {
    switch (mode) {
      case 'unencrypted':
        return new UnencryptedWebSocketConnection();
      case 'secure':
        return new SecureWebSocketConnection();
      case 'insecure-ssl':
        return new InsecureSSLWebSocketConnection();
      case 'cloud':
        return new CloudWebSocketConnection();
      default:
        throw new Error(`Unsupported WebSocket connection mode: ${mode}`);
    }
  }
}
