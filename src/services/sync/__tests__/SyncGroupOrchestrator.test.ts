/**
 * SyncGroupOrchestrator — the app-side driver of the sync-group key lifecycle
 * (plan 7-3). Engine + escrow + rotation are all mocked (per 2-5/2-6 patterns).
 */

import {
  SyncGroupOrchestrator,
  SyncGroupAuthError,
  type SyncGroupEngine,
} from '../SyncGroupOrchestrator';
import type { SyncGroupKeyStatusDto } from '../../engine/EngineApiClient';

function keyStatus(over: Partial<SyncGroupKeyStatusDto> = {}): SyncGroupKeyStatusDto {
  return { state: 'member', has_key: true, rotation_required: false, ...over };
}

function makeEngine(over: Partial<SyncGroupEngine> = {}): SyncGroupEngine {
  return {
    getSyncGroupKeyStatus: jest.fn(async () => keyStatus({ state: 'uninitialized', has_key: false })),
    initSyncGroup: jest.fn(async () => keyStatus({ group_key_base64: 'R0tFWQ==', created: true })),
    importSyncGroup: jest.fn(async () => keyStatus({ imported: true })),
    rotateSyncGroup: jest.fn(async () => keyStatus({ group_key_base64: 'TkVX', rotated: true, baseline_required: true })),
    setSyncGroupRotationRequired: jest.fn(async () => keyStatus({ rotation_required: true })),
    updateSyncClientConfig: jest.fn(async () => ({}) as any),
    ...over,
  };
}

function makeOrch(opts: {
  engine?: SyncGroupEngine;
  paseto?: string | null;
  escrow?: { put: jest.Mock; get: jest.Mock; remove: jest.Mock };
  rotation?: { getRequired: jest.Mock; clear: jest.Mock };
} = {}) {
  const escrow = opts.escrow ?? { put: jest.fn(), get: jest.fn(async () => null), remove: jest.fn() };
  const rotation = opts.rotation ?? { getRequired: jest.fn(async () => false), clear: jest.fn(async () => {}) };
  const engine = opts.engine ?? makeEngine();
  const paseto = opts.paseto === undefined ? 'PASETO' : opts.paseto;
  const orch = new SyncGroupOrchestrator({
    engine,
    getPaseto: async () => paseto,
    escrowFactory: () => escrow as any,
    rotationFactory: () => rotation as any,
  });
  return { orch, engine, escrow, rotation };
}

describe('SyncGroupOrchestrator.startCloudSync', () => {
  it('mints the key, escrows it, and clears the join flag on the first device', async () => {
    const { orch, engine, escrow } = makeOrch();
    const res = await orch.startCloudSync();
    expect(res.action).toBe('created');
    expect(engine.initSyncGroup).toHaveBeenCalled();
    expect(escrow.put).toHaveBeenCalledWith('R0tFWQ==');
    expect(engine.updateSyncClientConfig).toHaveBeenCalledWith({ group_join_pending: false });
  });

  it('is a no-op when the engine already holds a key', async () => {
    const engine = makeEngine({
      getSyncGroupKeyStatus: jest.fn(async () => keyStatus({ state: 'member', has_key: true })),
    });
    const { orch, escrow } = makeOrch({ engine });
    const res = await orch.startCloudSync();
    expect(res.action).toBe('already_member');
    expect(engine.initSyncGroup).not.toHaveBeenCalled();
    expect(escrow.put).not.toHaveBeenCalled();
  });

  it('requires a signed-in account', async () => {
    const { orch } = makeOrch({ paseto: null });
    await expect(orch.startCloudSync()).rejects.toBeInstanceOf(SyncGroupAuthError);
  });
});

describe('SyncGroupOrchestrator.joinCloudSync', () => {
  it('marks join-pending, recovers the escrowed key and imports it', async () => {
    const escrow = { put: jest.fn(), get: jest.fn(async () => 'R0tFWQ=='), remove: jest.fn() };
    const { orch, engine } = makeOrch({ escrow });
    const res = await orch.joinCloudSync();
    expect(res.action).toBe('joined');
    expect(engine.updateSyncClientConfig).toHaveBeenCalledWith({ group_join_pending: true });
    expect(engine.importSyncGroup).toHaveBeenCalledWith('R0tFWQ==');
  });

  it('fails clearly when the escrow has no key yet', async () => {
    const escrow = { put: jest.fn(), get: jest.fn(async () => null), remove: jest.fn() };
    const { orch, engine } = makeOrch({ escrow });
    await expect(orch.joinCloudSync()).rejects.toThrow(/no escrowed sync key/);
    expect(engine.importSyncGroup).not.toHaveBeenCalled();
  });
});

describe('SyncGroupOrchestrator.resetSyncKey', () => {
  it('rotates, re-escrows, and clears the account rotation flag', async () => {
    const escrow = { put: jest.fn(), get: jest.fn(async () => null), remove: jest.fn() };
    const rotation = { getRequired: jest.fn(async () => true), clear: jest.fn(async () => {}) };
    const { orch, engine } = makeOrch({ escrow, rotation });
    const res = await orch.resetSyncKey();
    expect(engine.rotateSyncGroup).toHaveBeenCalled();
    expect(escrow.put).toHaveBeenCalledWith('TkVX');
    expect(rotation.clear).toHaveBeenCalled();
    expect(res.baseline_required).toBe(true);
  });
});

describe('SyncGroupOrchestrator rotation flag', () => {
  it('reads the account flag and relays it to the engine', async () => {
    const rotation = { getRequired: jest.fn(async () => true), clear: jest.fn(async () => {}) };
    const { orch, engine } = makeOrch({ rotation });
    expect(await orch.readRotationRequired()).toBe(true);
    await orch.relayRotationRequired(true);
    expect(engine.setSyncGroupRotationRequired).toHaveBeenCalledWith(true);
  });

  it('returns false when signed out', async () => {
    const { orch } = makeOrch({ paseto: null });
    expect(await orch.readRotationRequired()).toBe(false);
  });
});
