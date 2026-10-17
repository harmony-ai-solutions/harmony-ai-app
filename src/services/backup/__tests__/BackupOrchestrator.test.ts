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
import { encodeAccountKeyPayload } from '../accountKeyPayload';
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
    adoptBackupKey: jest.fn(async () => ({ adopted: true, reEscrowNeeded: false, codeGenerated: false })),
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

  it('runs a backup, escrows the DEK+code payload, and records the result', async () => {
    const { orch, escrow, storage } = makeOrch();
    await orch.updateSettings({ localFolderUri: 'content://tree/x' });
    const res = await orch.backUpNow();
    expect(res.totalBytes).toBe(2048);
    // v1 shared-account payload (owner ruling 2026-10-17): DEK + recovery code.
    expect(escrow.put).toHaveBeenCalledWith(encodeAccountKeyPayload('ZGVr', 'b'.repeat(64)));
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
    expect(escrow.put).toHaveBeenCalledWith(encodeAccountKeyPayload('bmV3', 'c'.repeat(64)));
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

// ── Shared-account DEK adoption (owner ruling 2026-10-17) ─────────────────

describe('BackupOrchestrator shared-account key', () => {
  it('adopts the account key BEFORE the hosted backup, re-escrows AFTER', async () => {
    const order: string[] = [];
    const blob = encodeAccountKeyPayload('RUtF', 'd'.repeat(64));
    const escrow = {
      get: jest.fn(async () => {
        order.push('escrow.get');
        return blob;
      }),
      put: jest.fn(async () => {
        order.push('escrow.put');
      }),
    };
    const client = fakeClient({
      adoptBackupKey: jest.fn(async () => {
        order.push('adopt');
        return { adopted: true, reEscrowNeeded: false, codeGenerated: false };
      }),
      createBackupArtifact: jest.fn(async () => {
        order.push('create');
        return {
          skipped: false,
          recoveryCode: 'b'.repeat(64),
          recoveryCodeIsNew: false,
          dataVersion: 'dv',
          uploadedObjects: 1,
          dedupedObjects: 0,
          totalBytes: 42,
          manifest: {},
        };
      }),
    });
    const orch = new BackupOrchestrator({
      client,
      storage: new MemoryStorage(),
      credentials: new MemoryCredentials(),
      getPaseto: async () => 'paseto',
      escrowFactory: () => escrow as any,
    });
    await orch.updateSettings({ targetType: 'soulbits-cloud' });

    await orch.backUpNow();

    // The adopt call happens strictly before the engine backup, and the
    // re-escrow strictly after.
    expect(order).toEqual(['escrow.get', 'adopt', 'create', 'escrow.put']);
    expect(client.adoptBackupKey).toHaveBeenCalledWith(blob);
  });

  it('does NOT adopt for a non-hosted target', async () => {
    const { orch, client } = makeOrch();
    await orch.updateSettings({ localFolderUri: 'content://tree/x' });
    await orch.backUpNow();
    expect(client.adoptBackupKey).not.toHaveBeenCalled();
  });

  it('skips adoption when the account holds no escrow blob', async () => {
    const escrow = { get: jest.fn(async () => null), put: jest.fn(async () => {}) };
    const client = fakeClient();
    const orch = new BackupOrchestrator({
      client,
      storage: new MemoryStorage(),
      credentials: new MemoryCredentials(),
      getPaseto: async () => 'paseto',
      escrowFactory: () => escrow as any,
    });
    await orch.updateSettings({ targetType: 'soulbits-cloud' });
    await orch.backUpNow();
    expect(client.adoptBackupKey).not.toHaveBeenCalled();
  });

  it('decodes a v1 escrow payload for restore (W1)', async () => {
    const escrow = {
      put: jest.fn(async () => {}),
      get: jest.fn(async () => encodeAccountKeyPayload('VzFERUs=', 'e'.repeat(64))),
    };
    const orch = new BackupOrchestrator({
      client: fakeClient(),
      storage: new MemoryStorage(),
      credentials: new MemoryCredentials(),
      getPaseto: async () => 'paseto',
      escrowFactory: () => escrow as any,
    });
    const material = await orch.recoverUnlockMaterial();
    expect(material.dekBase64).toBe('VzFERUs=');
  });

  it('decodes a legacy raw-DEK escrow payload for restore (W1)', async () => {
    const escrow = { put: jest.fn(async () => {}), get: jest.fn(async () => 'RUtF') };
    const orch = new BackupOrchestrator({
      client: fakeClient(),
      storage: new MemoryStorage(),
      credentials: new MemoryCredentials(),
      getPaseto: async () => 'paseto',
      escrowFactory: () => escrow as any,
    });
    const material = await orch.recoverUnlockMaterial();
    expect(material.dekBase64).toBe('RUtF');
  });
});

// ── Generation guard: held conflicts (owner ruling 2026-10-17) ────────────

describe('BackupOrchestrator conflict handling', () => {
  const HELD = {
    remoteGeneration: 7,
    remoteDataVersion: 'remote-dv',
    remoteDeviceLabel: 'Other Phone',
    remoteSyncedAt: '2026-10-01T00:00:00Z',
    remoteSyncGroupFingerprint: 'fp-1',
  };

  it('persists a pending conflict and does NOT record success on a held run', async () => {
    const create = jest.fn(async () => ({
      skipped: false,
      recoveryCode: '',
      recoveryCodeIsNew: false,
      dataVersion: 'dv-local',
      uploadedObjects: 0,
      dedupedObjects: 0,
      totalBytes: 0,
      manifest: {},
      held: HELD,
    }));
    const { orch, storage, escrow } = makeOrch({
      client: fakeClient({ createBackupArtifact: create }),
    });
    await orch.updateSettings({ targetType: 'soulbits-cloud' });

    const res = await orch.backUpNow();

    // Held info is returned to the caller.
    expect(res.held).toMatchObject({
      remoteGeneration: 7,
      remoteDataVersion: 'remote-dv',
      remoteDeviceLabel: 'Other Phone',
      remoteSyncGroupFingerprint: 'fp-1',
    });
    expect(res.held?.detectedAt).toEqual(expect.any(String));

    // Persisted as a pending conflict…
    const persisted = JSON.parse(storage.map.get(BACKUP_SETTINGS_KEY)!);
    expect(persisted.pendingConflict.remoteGeneration).toBe(7);
    expect(persisted.pendingConflict.remoteDataVersion).toBe('remote-dv');

    // …and NO success fields were written.
    expect(persisted.lastBackupAt).toBeUndefined();
    expect(persisted.lastDataVersion).toBeUndefined();
    expect(persisted.lastTotalBytes).toBeUndefined();
    expect(persisted.lastError).toBeUndefined();

    // Nothing uploaded → no escrow / iCloud side effects.
    expect(escrow.put).not.toHaveBeenCalled();
  });

  it('clears a pending conflict on a later successful (non-held) run', async () => {
    const { orch, storage } = makeOrch();
    await orch.updateSettings({
      localFolderUri: 'content://tree/x',
      pendingConflict: { remoteGeneration: 3, remoteDataVersion: 'x', detectedAt: 'now' },
    });

    await orch.backUpNow();

    const persisted = JSON.parse(storage.map.get(BACKUP_SETTINGS_KEY)!);
    expect(persisted.pendingConflict).toBeUndefined();
    expect(persisted.lastDataVersion).toBe('dv2');
    expect(await orch.getPendingConflict()).toBeNull();
  });

  it('forwards the conflict policy to the engine', async () => {
    const { orch, client } = makeOrch();
    await orch.updateSettings({ localFolderUri: 'content://tree/x' });
    await orch.backUpNow({ onConflict: 'overwrite' });
    expect(client.createBackupArtifact).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ onConflict: 'overwrite' }),
    );
  });

  it('exposes and clears the pending conflict', async () => {
    const { orch } = makeOrch();
    expect(await orch.getPendingConflict()).toBeNull();
    await orch.updateSettings({
      pendingConflict: { remoteGeneration: 1, remoteDataVersion: 'dv', detectedAt: 'now' },
    });
    expect((await orch.getPendingConflict())?.remoteGeneration).toBe(1);
    await orch.clearPendingConflict();
    expect(await orch.getPendingConflict()).toBeNull();
  });
});

// ── Escrow-clobber guard (owner ruling 2026-10-17) ────────────────────────

describe('BackupOrchestrator escrow-clobber guard', () => {
  it('suppresses the post-backup escrow when the pre-backup adopt FAILED', async () => {
    const escrow = { get: jest.fn(async () => 'RUtF'), put: jest.fn(async () => {}) };
    const client = fakeClient({
      adoptBackupKey: jest.fn(async () => {
        throw new Error('adopt boom');
      }),
    });
    const orch = new BackupOrchestrator({
      client,
      storage: new MemoryStorage(),
      credentials: new MemoryCredentials(),
      getPaseto: async () => 'paseto',
      escrowFactory: () => escrow as any,
    });
    await orch.updateSettings({ targetType: 'soulbits-cloud' });

    const res = await orch.backUpNow();

    expect(res.held).toBeUndefined();
    // The artifact was created, but the account escrow was NOT clobbered.
    expect(client.createBackupArtifact).toHaveBeenCalled();
    expect(escrow.put).not.toHaveBeenCalled();
  });

  it('still escrows when the account holds NO escrow blob (founder)', async () => {
    const escrow = { get: jest.fn(async () => null), put: jest.fn(async () => {}) };
    const client = fakeClient();
    const orch = new BackupOrchestrator({
      client,
      storage: new MemoryStorage(),
      credentials: new MemoryCredentials(),
      getPaseto: async () => 'paseto',
      escrowFactory: () => escrow as any,
    });
    await orch.updateSettings({ targetType: 'soulbits-cloud' });

    await orch.backUpNow();

    expect(client.adoptBackupKey).not.toHaveBeenCalled();
    expect(escrow.put).toHaveBeenCalled();
  });

  it('still escrows when the adopt SUCCEEDED', async () => {
    const escrow = { get: jest.fn(async () => 'RUtF'), put: jest.fn(async () => {}) };
    const orch = new BackupOrchestrator({
      client: fakeClient(),
      storage: new MemoryStorage(),
      credentials: new MemoryCredentials(),
      getPaseto: async () => 'paseto',
      escrowFactory: () => escrow as any,
    });
    await orch.updateSettings({ targetType: 'soulbits-cloud' });

    await orch.backUpNow();

    expect(escrow.put).toHaveBeenCalled();
  });

  it('suppresses escrow when the escrow FETCH itself fails', async () => {
    const escrow = {
      get: jest.fn(async () => {
        throw new Error('fetch boom');
      }),
      put: jest.fn(async () => {}),
    };
    const orch = new BackupOrchestrator({
      client: fakeClient(),
      storage: new MemoryStorage(),
      credentials: new MemoryCredentials(),
      getPaseto: async () => 'paseto',
      escrowFactory: () => escrow as any,
    });
    await orch.updateSettings({ targetType: 'soulbits-cloud' });

    await orch.backUpNow();

    expect(escrow.put).not.toHaveBeenCalled();
  });
});
