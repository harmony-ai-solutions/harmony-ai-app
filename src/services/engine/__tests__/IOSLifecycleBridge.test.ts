/**
 * IOSLifecycleBridge — unit tests (task 4-3 wiring).
 *
 * Verifies the wake routing (keepalive/relay → wake pass; maintenance → sweep),
 * the `finishWake` callback, push-token registration, and the pending-wake drain.
 */

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

// Controllable stand-ins for the native module surface (mock-prefixed so the
// jest.mock factory may close over them).
const mockWakeListeners = new Set<(e: any) => void>();
const mockTokenListeners = new Set<(e: any) => void>();
const mockPendingWakes: any[] = [];
const mockPendingTokens: string[] = [];

jest.mock('../EngineEmbeddedModule', () => ({
  onEngineWake: (l: any) => {
    mockWakeListeners.add(l);
    return () => mockWakeListeners.delete(l);
  },
  onPushToken: (l: any) => {
    mockTokenListeners.add(l);
    return () => mockTokenListeners.delete(l);
  },
  consumePendingEngineWake: jest.fn(async () => mockPendingWakes.shift() ?? null),
  consumePendingPushToken: jest.fn(async () => mockPendingTokens.shift() ?? null),
  finishEngineWake: jest.fn(async () => undefined),
}));

jest.mock('../../social/NotificationService', () => ({
  __esModule: true,
  default: { registerPushToken: jest.fn(async () => undefined) },
}));
jest.mock('../../cloud/DeviceAuthService', () => ({
  __esModule: true,
  default: { registerDevice: jest.fn(async () => undefined) },
}));

// Keep the bridge test light: stub the orchestrators (their real modules pull
// the whole engine-service chain).
jest.mock('../IOSLifecycleWakeHandler', () => ({ handleIOSLifecycleWake: jest.fn() }));
jest.mock('../IOSMaintenanceScheduler', () => ({ handleIOSMaintenance: jest.fn() }));

import { Platform } from 'react-native';
import {
  detachIOSLifecycleBridgeForTests,
  registerIOSLifecycleBridge,
  routeEngineWake,
} from '../IOSLifecycleBridge';

beforeEach(() => {
  mockWakeListeners.clear();
  mockTokenListeners.clear();
  mockPendingWakes.length = 0;
  mockPendingTokens.length = 0;
  detachIOSLifecycleBridgeForTests();
});

describe('routeEngineWake', () => {
  it('routes keepalive → the wake pass and completes the task', async () => {
    const wake = jest.fn(async () => ({ honored: true }));
    const finish = jest.fn(async () => undefined);
    await routeEngineWake({ taskId: 't1', kind: 'keepalive' }, { wake: wake as any, finish });
    expect(wake).toHaveBeenCalledWith({ kind: 'keepalive' });
    expect(finish).toHaveBeenCalledWith('t1', JSON.stringify({ honored: true }));
  });

  it('routes relay → the wake pass (bounded batch converges)', async () => {
    const wake = jest.fn(async () => ({ honored: true }));
    await routeEngineWake({ taskId: 't2', kind: 'relay' }, { wake: wake as any, finish: jest.fn() });
    expect(wake).toHaveBeenCalledWith({ kind: 'relay' });
  });

  it('routes maintenance → the overnight sweep', async () => {
    const maintenance = jest.fn(async () => ({ honored: true, compacted: 3 }));
    const finish = jest.fn(async () => undefined);
    await routeEngineWake({ taskId: 't3', kind: 'maintenance' }, { maintenance: maintenance as any, finish });
    expect(maintenance).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledWith('t3', JSON.stringify({ honored: true, compacted: 3 }));
  });

  it('still completes the task when the pass throws', async () => {
    const wake = jest.fn(async () => {
      throw new Error('boom');
    });
    const finish = jest.fn(async () => undefined);
    await routeEngineWake({ taskId: 't4', kind: 'keepalive' }, { wake: wake as any, finish });
    expect(finish).toHaveBeenCalledWith('t4', JSON.stringify({ error: 'boom' }));
  });
});

describe('registerIOSLifecycleBridge', () => {
  it('subscribes, routes a live wake, and registers the push token', async () => {
    const wake = jest.fn(async () => ({ honored: true }));
    const registerPushToken = jest.fn(async () => undefined);
    registerIOSLifecycleBridge({ wake: wake as any, registerPushToken });

    // Live wake.
    mockWakeListeners.forEach(l => l({ taskId: 'live-1', kind: 'keepalive' }));
    await Promise.resolve();
    await Promise.resolve();
    expect(wake).toHaveBeenCalled();

    // Live token.
    mockTokenListeners.forEach(l => l({ token: 'abc' }));
    await Promise.resolve();
    expect(registerPushToken).toHaveBeenCalledWith('abc');
  });

  it('drains a pending wake queued before the bridge booted', async () => {
    mockPendingWakes.push({ taskId: 'queued-1', kind: 'keepalive' });
    const wake = jest.fn(async () => ({ honored: true }));
    registerIOSLifecycleBridge({ wake: wake as any, registerPushToken: jest.fn() });
    await Promise.resolve();
    await Promise.resolve();
    expect(wake).toHaveBeenCalledWith({ kind: 'keepalive' });
  });

  it('is a no-op off iOS', () => {
    const original = (Platform as any).OS;
    (Platform as any).OS = 'android';
    const unsub = registerIOSLifecycleBridge({});
    expect(mockWakeListeners.size).toBe(0);
    unsub();
    (Platform as any).OS = original;
  });
});
