/**
 * SyncKeyEscrow + SyncRotationClient — the account sync-key escrow slot and the
 * rotation-required flag (plan 7-3). Mirrors the 2-6 BackupKeyEscrow tests.
 */

import { SyncKeyEscrow, SYNC_KEY_PATH } from '../SyncKeyEscrow';
import { SyncRotationClient, SYNC_ROTATION_REQUIRED_PATH } from '../SyncRotationClient';

describe('SyncKeyEscrow (sibling W1 slot)', () => {
  it('PUTs the group key as wrapped_key', async () => {
    const calls: any[] = [];
    const fetchImpl = jest.fn(async (url: string, init: any) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({}) } as any;
    });
    const escrow = new SyncKeyEscrow({ paseto: 'P', baseUrl: 'https://cloud.test', fetchImpl });
    await escrow.put('R0tFWQ==');
    expect(calls[0].url).toBe(`https://cloud.test${SYNC_KEY_PATH}`);
    expect(calls[0].init.method).toBe('PUT');
    expect(calls[0].init.headers.Authorization).toBe('Bearer P');
    expect(JSON.parse(calls[0].init.body)).toEqual({ wrapped_key: 'R0tFWQ==' });
  });

  it('GET returns null on 404 (no escrow blob yet)', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: false, status: 404, json: async () => ({}) } as any));
    const escrow = new SyncKeyEscrow({ paseto: 'P', fetchImpl });
    expect(await escrow.get()).toBeNull();
  });

  it('GET returns the wrapped key', async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ wrapped_key: 'ABC' }),
    } as any));
    const escrow = new SyncKeyEscrow({ paseto: 'P', fetchImpl });
    expect(await escrow.get()).toBe('ABC');
  });

  it('DELETE is idempotent (404 tolerated)', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: false, status: 404, json: async () => ({}) } as any));
    const escrow = new SyncKeyEscrow({ paseto: 'P', fetchImpl });
    await expect(escrow.remove()).resolves.toBeUndefined();
  });
});

describe('SyncRotationClient', () => {
  it('GET returns the required flag', async () => {
    const calls: any[] = [];
    const fetchImpl = jest.fn(async (url: string, init: any) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ required: true }) } as any;
    });
    const client = new SyncRotationClient({ paseto: 'P', baseUrl: 'https://cloud.test', fetchImpl });
    expect(await client.getRequired()).toBe(true);
    expect(calls[0].url).toBe(`https://cloud.test${SYNC_ROTATION_REQUIRED_PATH}`);
    expect(calls[0].init.headers.Authorization).toBe('Bearer P');
  });

  it('GET returns false on 404', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: false, status: 404, json: async () => ({}) } as any));
    const client = new SyncRotationClient({ paseto: 'P', fetchImpl });
    expect(await client.getRequired()).toBe(false);
  });

  it('DELETE clears the flag', async () => {
    const calls: any[] = [];
    const fetchImpl = jest.fn(async (url: string, init: any) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({}) } as any;
    });
    const client = new SyncRotationClient({ paseto: 'P', baseUrl: 'https://cloud.test', fetchImpl });
    await client.clear();
    expect(calls[0].init.method).toBe('DELETE');
  });
});
