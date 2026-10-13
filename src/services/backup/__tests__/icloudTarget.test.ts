/**
 * iCloud-container target integration (plan 2-6 iOS half, task 4-2).
 *
 * Exercises BackupOrchestrator's iCloud flow with a fake ICloudTargetDeps:
 * inbox staging, app-side probe, backup upload (inbox → container), restore
 * pull (container → inbox), and the W2 key wrap.
 */

import { BackupOrchestrator } from '../BackupOrchestrator';
import type { ICloudTargetDeps } from '../icloudTarget';
import { ICLOUD_INBOX_SUBDIR, icloudInboxDir } from '../icloudTarget';
import { DEFAULT_BACKUP_SETTINGS } from '../backupTypes';
import type { BackupSettings } from '../backupTypes';

class MemoryStorage {
  map = new Map<string, string>();
  async getItem(k: string) { return this.map.get(k) ?? null; }
  async setItem(k: string, v: string) { this.map.set(k, v); }
  async removeItem(k: string) { this.map.delete(k); }
}

class MemoryCredentials {
  map = new Map<string, string>();
  async set(s: string, v: string) { this.map.set(s, v); }
  async get(s: string) { return this.map.get(s) ?? null; }
  async remove(s: string) { this.map.delete(s); }
}

function fakeICloud(overrides: Partial<ICloudTargetDeps> = {}): ICloudTargetDeps {
  return {
    probe: jest.fn(async () => ({ available: true, account: 'iCloud', detail: '/container' })),
    inboxDir: () => '/mock/documents/backup-icloud-inbox',
    syncInboxToContainer: jest.fn(async () => ({ moved: 3 })),
    syncContainerToInbox: jest.fn(async () => ({ copied: 3 })),
    list: jest.fn(async () => []),
    uploadProgress: jest.fn(async () => ({ total: 0, uploaded: 0, percent: 100 })),
    putWrap: jest.fn(async () => ({ nonce: 'n', wrapped: 'w', hint: 'iCloud Keychain (W2)' })),
    getWrap: jest.fn(async () => null),
    clearWrap: jest.fn(async () => undefined),
    ...overrides,
  };
}

function fakeClient() {
  return {
    createBackupArtifact: jest.fn(async () => ({
      skipped: false,
      recoveryCode: 'a'.repeat(64),
      recoveryCodeIsNew: true,
      dataVersion: 'dv',
      uploadedObjects: 2,
      dedupedObjects: 0,
      totalBytes: 2048,
      manifest: {},
    })),
    restoreBackupArtifact: jest.fn(async () => ({
      unwrapKind: 'w1_account',
      dataVersion: 'dv',
      schemaVersion: 48,
      sideObjects: 1,
      dbRows: 10,
      dataDir: '/restored',
      dbPath: '/restored/data.sqlite',
      manifest: {},
    })),
    probeBackupTarget: jest.fn(async () => ({ available: true, account: 'engine' })),
    backupKey: jest.fn(async () => ({ recoveryCode: 'b'.repeat(64), dekBase64: 'ZGVr' })),
    resetBackupKey: jest.fn(async () => ({ recoveryCode: 'c'.repeat(64), dekBase64: 'bmV3' })),
  } as any;
}

const ICLOUD_SETTINGS: BackupSettings = {
  ...DEFAULT_BACKUP_SETTINGS,
  targetType: 'icloud-container',
};

function makeOrch(icloud = fakeICloud(), client = fakeClient()) {
  const orch = new BackupOrchestrator({
    client,
    storage: new MemoryStorage() as any,
    credentials: new MemoryCredentials() as any,
    getPaseto: async () => 'paseto',
    escrowFactory: () => ({ put: jest.fn(async () => {}), get: jest.fn(async () => null) }) as any,
    icloud,
  });
  return { orch, icloud, client };
}

describe('icloudInboxDir', () => {
  it('is a stable sub-directory of the app Documents dir', () => {
    expect(icloudInboxDir()).toBe(`/mock/documents/${ICLOUD_INBOX_SUBDIR}`);
  });
});

describe('BackupOrchestrator iCloud flow', () => {
  it('builds an iCloud descriptor carrying the local inbox dir', async () => {
    const { orch, icloud } = makeOrch();
    const desc = await orch.buildTargetDescriptor(ICLOUD_SETTINGS);
    expect(desc).toEqual({ type: 'icloud-container', inboxDir: icloud.inboxDir() });
  });

  it('probes iCloud app-side (not through the engine)', async () => {
    const { orch, icloud, client } = makeOrch();
    const probe = await orch.probeTarget(ICLOUD_SETTINGS);
    expect(probe).toEqual({ available: true, account: 'iCloud', detail: '/container' });
    expect(icloud.probe).toHaveBeenCalled();
    expect(client.probeBackupTarget).not.toHaveBeenCalled();
  });

  it('uploads the staged inbox into the container and stores the W2 wrap on backup', async () => {
    const { orch, icloud } = makeOrch();
    await orch.updateSettings(ICLOUD_SETTINGS);
    const res = await orch.backUpNow({ force: true });
    expect(res.totalBytes).toBe(2048);
    expect(icloud.syncInboxToContainer).toHaveBeenCalledWith(icloud.inboxDir());
    expect(icloud.putWrap).toHaveBeenCalledWith('ZGVr');
  });

  it('pulls the container into the inbox before a restore', async () => {
    const { orch, icloud } = makeOrch();
    await orch.restore(ICLOUD_SETTINGS);
    expect(icloud.syncContainerToInbox).toHaveBeenCalledWith(icloud.inboxDir());
  });

  it('prefers the W2 iCloud-Keychain wrap for restore unlock material', async () => {
    const icloud = fakeICloud({ getWrap: jest.fn(async () => 'VzJERUs=') });
    const { orch } = makeOrch(icloud);
    const material = await orch.recoverUnlockMaterial();
    expect(material.dekBase64).toBe('VzJERUs=');
  });
});
