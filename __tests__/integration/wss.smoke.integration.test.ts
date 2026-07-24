/**
 * @jest-environment node
 *
 * Smoke test to verify the HarmonyLinkMockServer infrastructure works.
 * This tests the EventEmitter-based mock server, not real WebSocket.
 */

import EventEmitter from 'eventemitter3';
import {HarmonyLinkMockServer} from './helpers/HarmonyLinkMockServer';

test('mock server receives events and auto-responds', async () => {
  const server = new HarmonyLinkMockServer();
  server.startAutoResponder();

  // Collect server-to-client events
  const clientEvents: any[] = [];
  server.setEventHandler((event: any) => {
    clientEvents.push(event);
  });

  // Simulate a client sending HANDSHAKE_REQUEST
  server.handleClientEvent({
    event_type: 'HANDSHAKE_REQUEST',
    status: 'NEW',
    payload: {
      device_id: 'test-device',
      device_name: 'Test Device',
      device_type: 'phone',
      device_platform: 'ios',
    },
  });

  // Allow async delivery to settle
  await new Promise(r => setTimeout(r, 50));

  // Verify the server received the HANDSHAKE_REQUEST
  expect(server.receivedEvents.length).toBe(1);
  expect(server.receivedEvents[0].event_type).toBe('HANDSHAKE_REQUEST');

  // Verify the client received HANDSHAKE_ACCEPT
  expect(clientEvents.length).toBe(1);
  expect(clientEvents[0].event_type).toBe('HANDSHAKE_ACCEPT');
  expect(clientEvents[0].status).toBe('DONE');
  expect(clientEvents[0].payload.jwt_token).toBe('test-jwt-token');
});
