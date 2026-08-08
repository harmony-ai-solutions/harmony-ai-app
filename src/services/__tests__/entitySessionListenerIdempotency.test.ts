/**
 * Regression tests for EntitySessionService listener idempotency.
 *
 * Same background as syncListenerIdempotency.test.ts: EntitySessionService
 * default-exports a module-scope singleton and registers its ConnectionManager
 * listeners in the constructor. Under Metro Fast Refresh the module re-executes
 * and a NEW instance would register ANOTHER listener set on the RETAINED
 * ConnectionManager singleton. These tests pin the fix: exactly ONE entity
 * listener set per ConnectionManager lifetime, delegating to the CURRENT
 * instance.
 */

import { EntitySessionService } from '../EntitySessionService';
import { EventEmitter } from 'eventemitter3';

let mockConnectionManager: EventEmitter & { sendEvent: jest.Mock; isConnected: jest.Mock };

jest.mock('react-native-device-info', () => ({
  getUniqueId: jest.fn().mockResolvedValue('test-device'),
}));

jest.mock('react-native-track-player', () => ({
  default: {
    setupPlayer: jest.fn().mockResolvedValue(undefined),
    add: jest.fn().mockResolvedValue(undefined),
    play: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

jest.mock('../connection/ConnectionManager', () => {
  const { EventEmitter: EE } = require('eventemitter3');
  const cm: EventEmitter & { sendEvent: jest.Mock; isConnected: jest.Mock } = new EE();
  cm.sendEvent = jest.fn().mockResolvedValue(undefined);
  cm.isConnected = jest.fn().mockReturnValue(true);
  mockConnectionManager = cm;
  return { __esModule: true, default: cm };
});

jest.mock('../../database/connection', () => ({
  getDatabase: jest.fn(),
  getSyncDatabase: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../cloud/CloudSessionService', () => ({
  cloudSessionService: {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    getStatus: jest.fn().mockReturnValue('idle'),
  },
  default: {},
}));

function resetSingleton(): void {
  (EntitySessionService as any).instance = null;
}

describe('EntitySessionService listener idempotency', () => {
  beforeEach(() => {
    (mockConnectionManager as any).entitySessionListenersInstalled = false;
    (mockConnectionManager as any).entitySessionEventTarget = null;
    mockConnectionManager.removeAllListeners();
    mockConnectionManager.sendEvent.mockClear();
    resetSingleton();
  });

  it('registers exactly ONE entity listener set even when the singleton is re-created (simulated hot reload)', () => {
    const svc1 = EntitySessionService.getInstance(); // first bundle's instance
    resetSingleton();
    const svc2 = EntitySessionService.getInstance(); // current bundle's instance

    expect(svc1).not.toBe(svc2);
    expect(mockConnectionManager.listeners('event:entity').length).toBe(1);
    expect(mockConnectionManager.listeners('disconnected:entity').length).toBe(1);

    // The current target must be the newest instance
    expect((mockConnectionManager as any).entitySessionEventTarget).toBe(svc2);
  });

  it('delivers entity events to the CURRENT instance only, never the stale one', () => {
    const svc1 = EntitySessionService.getInstance();
    resetSingleton();
    const svc2 = EntitySessionService.getInstance();

    const handled1 = jest.fn();
    const handled2 = jest.fn();
    (svc1 as any).handleEntityEvent = handled1;
    (svc2 as any).handleEntityEvent = handled2;

    mockConnectionManager.emit('event:entity', 'entity-1', { event_type: 'SOME_EVENT' });

    expect(handled1).not.toHaveBeenCalled(); // stale instance must not react
    expect(handled2).toHaveBeenCalledTimes(1);
    expect(handled2).toHaveBeenCalledWith('entity-1', { event_type: 'SOME_EVENT' });
  });
});
