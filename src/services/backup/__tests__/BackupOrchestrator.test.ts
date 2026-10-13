/**
 * BackupOrchestrator + BackupKeyEscrow + native-constraint unit tests (plan 2-6).
 */

import {
  BackupOrchestrator,
  BACKUP_SETTINGS_KEY,
  BACKUP_CLOUD_SLOT,
} from '../BackupOrchestrator';
import type { SettingsStorage } from '../BackupOrchestrator';
import type { CredentialStore } from '../backupCredentials';
import { BACKUP_CRED_SERVICES } from '../backupCredentials';
import { BackupKeyEscrow, BACKUP_KEY_PATH } from '../BackupKeyEscrow';
import { buildWorkConstraints } from '../backupNative';
import { DEFAULT_BACKUP_SETTINGS } from '../backupTypes';
import { EngineApiError } from '../../engine/EngineApiClient';
import type { BackupTargetDescriptor } from '../../engine/EngineApiClient';
import { SYNC_RELAY } from '../../../config/cloud';

// ── fakes ─────────────────────────────────────────────────────────────────

class MemoryStorage implements SettingsStorage {
  map = new Map<string, string>();
  async getItem(k: string) { return this.map.get(k) ?? null; }
  async setItem(k: string, v: string) { this.map.set(k, v); }
  async removeItem(k: string) { this.map.delete(k); }
}

class MemoryCredentials implements CredentialStore {
  map = new Map<string, string>();
  async set(s: string, v: string) { this.map.set(s, v); }
  async get(s: string) { return this.map.get(s) ?? null; }
  async remove(s: string) { this.map.delete(s); }
}

function fakeClient(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    createBackupArtifact: jest.fn(async (_t: BackupTargetDescriptor, opts: any) => ({
      skipped: false,
      recoveryCode: 'a'.repeat(64),
      recoveryCodeIsNew: true,
      dataVersion: opts?.dryRun ? 'dv' : 'dv2',
      uploadedObjects: 2,
      dedupedObjects: 0,
      totalBytes: opts?.dryRun ? 1234 : 2048,
      manifest: {},
    })),
    restoreBackupArtifact: jest.fn(async () => ({
      unwrapKind: 'w3_recovery_code',
      dataVersion: 'dv',
      schemaVersion: 48,
      sideObjects: 1,
      dbRows: 10,
      dataDir: '/restored',
      dbPath: '/restored/data.sqlite',
      manifest: {},
    })),
    probeBackupTarget: jest.fn(async () => ({ available: true, account: 'me' })),
    backupKey: jest.fn(async () => ({ recoveryCode: 'b'.repeat(64), dekBase64: 'ZGVr' })),
    resetBackupKey: jest.fn(async () => ({ recoveryCode: 'c'.repeat(64), dekBase64: 'bmV3' })),
    ...overrides,
  } as any;
}

function makeOrch(deps: any = {}) {
  const storage = deps.storage ?? new MemoryStorage();
  const credentials = deps.credentials ?? new MemoryCredentials();
  const client = deps.client ?? fakeClient();
  const escrow = { put: jest.fn(async () => {}), get: jest.fn(async () => 'RUtF') };
  const orch = new BackupOrchestrator({
    client,
    storage,
    credentials,
    getPaseto: deps.getPaseto ?? (async () => 'paseto'),
    escrowFactory: () => escrow as any,
  });
  return { orch, storage, credentials, client, escrow };
}

// ── tests ─────────────────────────────────────────────────────────────────

describe('BackupOrchestrator settings', () => {
  it('returns defaults when unset', async () => {
    const { orch } = makeOrch();
    expect(await orch.getSettings()).toEqual(DEFAULT_BACKUP_SETTINGS);
  });

  it('merges and persists a patch', async () => {
    const { orch, storage } = makeOrch();
    const next = await orch.updateSettings({ enabled: true, targetType: 'webdav' });
    expect(next.enabled).toBe(true);
    expect(next.targetType).toBe('webdav');
    expect(next.cadence).toBe('daily');
    expect(storage.map.has(BACKUP_SETTINGS_KEY)).toBe(true);
    expect((await orch.getSettings()).enabled).toBe(true);
  });
});

describe('BackupOrchestrator target descriptor', () => {
  it('returns null for an unconfigured local folder', async () => {
    const { orch } = makeOrch();
    expect(await orch.buildTargetDescriptor({ ...DEFAULT_BACKUP_SETTINGS })).toBeNull();
  });

  it('resolves the WebDAV password from the keychain', async () => {
    const credentials = new MemoryCredentials();
    await credentials.set(BACKUP_CRED_SERVICES.webdavPassword, 'secret');
    const { orch } = makeOrch({ credentials });
    const desc = await orch.buildTargetDescriptor({
      ...DEFAULT_BACKUP_SETTINGS,
      targetType: 'webdav',
      webdav: { baseUrl: 'https://dav.example.com', username: 'u' },
    });
    expect(desc).toMatchObject({ type: 'webdav', username: 'u', password: 'secret' });
  });

  it('requires a stored OAuth token for Dropbox', async () => {
    const { orch, credentials } = makeOrch();
    expect(
      await orch.buildTargetDescriptor({ ...DEFAULT_BACKUP_SETTINGS, targetType: 'dropbox' }),
    ).toBeNull();
    await credentials.set(BACKUP_CRED_SERVICES.dropboxToken, 'tok');
    expect(
      await orch.buildTargetDescriptor({ ...DEFAULT_BACKUP_SETTINGS, targetType: 'dropbox' }),
    ).toMatchObject({ type: 'dropbox', accessToken: 'tok' });
  });
});

describe('BackupOrchestrator runs', () => {
  it('estimates size via a dry run', async () => {
    const { orch, client } = makeOrch();
    const size = await orch.estimateBackupSize();
    expect(size).toBe(1234);
    expect(client.createBackupArtifact).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ dryRun: true, force: true }),
    );
  });

  it('runs a backup, escrows the DEK, and records the result', async () => {
    const { orch, escrow, storage } = makeOrch();
    await orch.updateSettings({ localFolderUri: 'content://tree/x' });
    const res = await orch.backUpNow();
    expect(res.totalBytes).toBe(2048);
    expect(escrow.put).toHaveBeenCalledWith('ZGVr');
    const persisted = JSON.parse(storage.map.get(BACKUP_SETTINGS_KEY)!);
    expect(persisted.lastDataVersion).toBe('dv2');
  });

  it('throws when the target is not configured', async () => {
    const { orch } = makeOrch();
    await expect(orch.backUpNow()).rejects.toThrow(/not configured/);
  });

  it('resolves W3 + W1 unlock material for restore', async () => {
    const credentials = new MemoryCredentials();
    await credentials.set(BACKUP_CRED_SERVICES.recoveryCode, 'r'.repeat(64));
    const { orch, escrow } = makeOrch({ credentials });
    const material = await orch.recoverUnlockMaterial();
    expect(material.recoveryCode).toBe('r'.repeat(64));
    expect(material.dekBase64).toBe('RUtF');
    expect(escrow.get).toHaveBeenCalled();
  });

  it('restores through the engine and maps the result', async () => {
    const { orch } = makeOrch();
    const res = await orch.restore({ ...DEFAULT_BACKUP_SETTINGS, localFolderUri: 'content://tree/x' });
    expect(res.unwrapKind).toBe('w3_recovery_code');
    expect(res.schemaVersion).toBe(48);
  });

  it('resets the recovery code and re-escrows the new DEK', async () => {
    const { orch, escrow, credentials } = makeOrch();
    const code = await orch.resetRecoveryCode();
    expect(code).toBe('c'.repeat(64));
    expect(await credentials.get(BACKUP_CRED_SERVICES.recoveryCode)).toBe('c'.repeat(64));
    expect(escrow.put).toHaveBeenCalledWith('bmV3');
  });
});

describe('BackupOrchestrator W1 presence', () => {
  it('reports true when the account has an escrowed backup key', async () => {
    const { orch, escrow } = makeOrch();
    expect(await orch.hasEscrowedKey()).toBe(true);
    expect(escrow.get).toHaveBeenCalled();
  });

  it('reports false when signed out (no PASETO)', async () => {
    const { orch, escrow } = makeOrch({ getPaseto: async () => null });
    expect(await orch.hasEscrowedKey()).toBe(false);
    expect(escrow.get).not.toHaveBeenCalled();
  });
});

describe('BackupKeyEscrow (W1)', () => {
  it('PUTs the DEK as wrapped_key', async () => {
    const calls: any[] = [];
    const fetchImpl = jest.fn(async (url: string, init: any) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({}) } as any;
    });
    const escrow = new BackupKeyEscrow({ paseto: 'P', baseUrl: 'https://cloud.test', fetchImpl });
    await escrow.put('ZGVr');
    expect(calls[0].url).toBe(`https://cloud.test${BACKUP_KEY_PATH}`);
    expect(calls[0].init.method).toBe('PUT');
    expect(calls[0].init.headers.Authorization).toBe('Bearer P');
    expect(JSON.parse(calls[0].init.body)).toEqual({ wrapped_key: 'ZGVr' });
  });

  it('GET returns null on 404', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: false, status: 404, json: async () => ({}) } as any));
    const escrow = new BackupKeyEscrow({ paseto: 'P', fetchImpl });
    expect(await escrow.get()).toBeNull();
  });

  it('GET returns the wrapped key', async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ wrapped_key: 'ABC' }),
    } as any));
    const escrow = new BackupKeyEscrow({ paseto: 'P', fetchImpl });
    expect(await escrow.get()).toBe('ABC');
  });
});

describe('backupNative constraints', () => {
  it('maps Wi-Fi-only + charging + idle', () => {
    expect(buildWorkConstraints({ ...DEFAULT_BACKUP_SETTINGS, wifiOnly: true, chargingOnly: true })).toEqual({
      requiresUnmeteredNetwork: true,
      requiresCharging: true,
      requiresIdle: true,
    });
  });
  it('honours the cellular opt-in', () => {
    expect(
      buildWorkConstraints({ ...DEFAULT_BACKUP_SETTINGS, wifiOnly: false, chargingOnly: false }),
    ).toEqual({ requiresUnmeteredNetwork: false, requiresCharging: false, requiresIdle: true });
  });
});

// ── Hosted target (plan 7-5) ──────────────────────────────────────────────

describe('BackupOrchestrator hosted target', () => {
  it('builds the soulbits-cloud descriptor from the injected PASETO + config base', async () => {
    const { orch } = makeOrch();
    const desc = await orch.buildTargetDescriptor({
      ...DEFAULT_BACKUP_SETTINGS,
      targetType: 'soulbits-cloud',
    });
    expect(desc).toMatchObject({
      type: 'soulbits-cloud',
      baseUrl: SYNC_RELAY.backupBaseUrl,
      accessToken: 'paseto',
      device: BACKUP_CLOUD_SLOT,
    });
  });

  it('returns null for soulbits-cloud when signed out', async () => {
    const { orch } = makeOrch({ getPaseto: async () => null });
    expect(
      await orch.buildTargetDescriptor({ ...DEFAULT_BACKUP_SETTINGS, targetType: 'soulbits-cloud' }),
    ).toBeNull();
    expect(await orch.isSignedIn()).toBe(false);
  });

  it('reads the hosted quota from /v1/sync/status', async () => {
    const calls: string[] = [];
    const fetchImpl = jest.fn(async (url: string) => {
      calls.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({ backup_bytes: 5 * 1024 * 1024, quotas: { backup_storage_mb: 10240 } }),
      } as any;
    });
    const orch = new BackupOrchestrator({
      client: fakeClient({ getSyncClientStatus: jest.fn(async () => ({ dataset_id: 'ds-1' })) }),
      storage: new MemoryStorage(),
      credentials: new MemoryCredentials(),
      getPaseto: async () => 'paseto',
      fetchImpl: fetchImpl as any,
    });
    const q = await orch.getCloudQuota();
    expect(q).toEqual({ usedBytes: 5 * 1024 * 1024, quotaMb: 10240 });
    expect(calls[0]).toContain('/v1/sync/status?dataset_id=ds-1');
    expect(calls[0]).toContain(SYNC_RELAY.backupBaseUrl);
  });

  it('returns null for the quota when signed out', async () => {
    const orch = new BackupOrchestrator({
      client: fakeClient(),
      storage: new MemoryStorage(),
      credentials: new MemoryCredentials(),
      getPaseto: async () => null,
      fetchImpl: jest.fn() as any,
    });
    expect(await orch.getCloudQuota()).toBeNull();
  });

  it('refreshes the PASETO and retries once on a hosted 401', async () => {
    const create = jest
      .fn()
      .mockRejectedValueOnce(new EngineApiError('auth needed', 401, '/api/backup/artifact'))
      .mockResolvedValueOnce({
        skipped: false,
        recoveryCode: 'a'.repeat(64),
        recoveryCodeIsNew: false,
        dataVersion: 'dv',
        uploadedObjects: 1,
        dedupedObjects: 0,
        totalBytes: 10,
        manifest: {},
      });
    const refresh = jest.fn(async () => true);
    const orch = new BackupOrchestrator({
      client: fakeClient({ createBackupArtifact: create }),
      storage: new MemoryStorage(),
      credentials: new MemoryCredentials(),
      getPaseto: async () => 'paseto',
      refreshPaseto: refresh,
    });
    await orch.updateSettings({ targetType: 'soulbits-cloud' });
    const res = await orch.backUpNow();
    expect(res.totalBytes).toBe(10);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(2);
  });
});
