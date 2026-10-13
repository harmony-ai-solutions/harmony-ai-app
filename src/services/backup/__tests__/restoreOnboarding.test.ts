/**
 * restoreOnboarding — the fresh-install restore-offer gate (5-3 wiring of the
 * 2-6 restore design). Pure logic tests: manifest discovery per source, the
 * once-per-install seen flag, and the null (no interstitial) cases.
 */

import {
  probeRestoreOffer,
  probeRestoreOfferOnce,
  isRestoreOfferSeen,
  markRestoreOfferSeen,
  RESTORE_OFFER_SEEN_KEY,
} from '../restoreOnboarding';
import type { RestoreProbeDeps, OfferSeenStore } from '../restoreOnboarding';
import { DEFAULT_BACKUP_SETTINGS } from '../backupTypes';
import type { BackupSettings } from '../backupTypes';

class MemoryStore implements OfferSeenStore {
  map = new Map<string, string>();
  async getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  async setItem(k: string, v: string) {
    this.map.set(k, v);
  }
}

function deps(over: Partial<RestoreProbeDeps> = {}): RestoreProbeDeps {
  return {
    isIOS: false,
    settings: async () => ({ ...DEFAULT_BACKUP_SETTINGS }),
    hasEscrowedKey: async () => false,
    listICloud: async () => [],
    ...over,
  };
}

describe('probeRestoreOffer', () => {
  it('returns null when no target holds a backup', async () => {
    expect(await probeRestoreOffer(deps())).toBeNull();
  });

  it('offers from the iCloud container manifest on iOS', async () => {
    const offer = await probeRestoreOffer(
      deps({
        isIOS: true,
        listICloud: async () => [
          { name: 'objects/abc', size: 10, modified: '' },
          { name: 'manifest.json', size: 2048, modified: '2026-10-01T00:00:00Z' },
        ],
      }),
    );
    expect(offer).toMatchObject({
      source: 'icloud-container',
      labelKey: 'targetICloud',
      totalBytes: 2048,
      createdAt: '2026-10-01T00:00:00Z',
    });
  });

  it('offers from persisted settings + account W1 presence (integrated target)', async () => {
    const settings: BackupSettings = {
      ...DEFAULT_BACKUP_SETTINGS,
      targetType: 'webdav',
      webdav: { baseUrl: 'https://dav.example.com', username: 'me' },
      lastBackupAt: '2026-10-05T00:00:00Z',
      lastTotalBytes: 5 * 1024 * 1024,
    };
    const offer = await probeRestoreOffer(
      deps({ settings: async () => settings, hasEscrowedKey: async () => true }),
    );
    expect(offer).toMatchObject({
      source: 'webdav',
      labelKey: 'targetWebDAV',
      account: 'me',
      createdAt: '2026-10-05T00:00:00Z',
      totalBytes: 5 * 1024 * 1024,
    });
  });

  it('does not offer when signed out (no W1) and no iCloud manifest', async () => {
    const offer = await probeRestoreOffer(
      deps({
        settings: async () => ({ ...DEFAULT_BACKUP_SETTINGS, lastBackupAt: '2026-10-05T00:00:00Z' }),
        hasEscrowedKey: async () => false,
      }),
    );
    expect(offer).toBeNull();
  });

  it('survives a failing probe (never throws)', async () => {
    const offer = await probeRestoreOffer(
      deps({
        settings: async () => {
          throw new Error('storage down');
        },
        hasEscrowedKey: async () => {
          throw new Error('escrow down');
        },
      }),
    );
    expect(offer).toBeNull();
  });
});

describe('restore-offer seen flag', () => {
  it('records and reads the flag', async () => {
    const store = new MemoryStore();
    expect(await isRestoreOfferSeen(store)).toBe(false);
    await markRestoreOfferSeen(store);
    expect(await isRestoreOfferSeen(store)).toBe(true);
    expect(store.map.get(RESTORE_OFFER_SEEN_KEY)).toBe('1');
  });

  it('probeRestoreOfferOnce skips once seen', async () => {
    const store = new MemoryStore();
    await markRestoreOfferSeen(store);
    const d = deps({
      isIOS: true,
      listICloud: async () => [{ name: 'manifest.json', size: 1, modified: '' }],
    });
    expect(await probeRestoreOfferOnce(d, store)).toBeNull();
  });

  it('probeRestoreOfferOnce probes when unseen', async () => {
    const store = new MemoryStore();
    const d = deps({
      isIOS: true,
      listICloud: async () => [{ name: 'manifest.json', size: 1, modified: '' }],
    });
    expect(await probeRestoreOfferOnce(d, store)).toMatchObject({ source: 'icloud-container' });
  });
});
