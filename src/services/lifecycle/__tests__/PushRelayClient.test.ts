/**
 * PushRelayClient — unit tests (task 4-3, step 4).
 *
 * Locks the 4-4 relay contract: the `{target_device_id?, payload?, alert?}`
 * body, PASETO auth, the `{delivered}` result, and the error taxonomy
 * (signed-out / oversized / 429 / 413 / network).
 */

import { PushRelayClient, PushRelayError, RELAY_MAX_PAYLOAD_BYTES } from '../PushRelayClient';

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

function errResponse(status: number, body: unknown): Response {
  return {
    ok: false,
    status,
    json: async () => body,
  } as unknown as Response;
}

function client(fetchImpl: jest.Mock, getToken: jest.Mock) {
  return new PushRelayClient({ baseUrl: 'https://cloud.example', getToken, fetchImpl });
}

describe('PushRelayClient', () => {
  it('POSTs the opaque payload + alert with the PASETO bearer', async () => {
    const fetchImpl = jest.fn(async (_url: string, _init: any) => okResponse({ delivered: 2 }));
    const getToken = jest.fn(async () => 'v4.local.token');
    const res = await client(fetchImpl, getToken).notify({
      payload: 'cipher',
      alert: { title: 'Hi', body: 'thinking of you' },
      targetDeviceId: 'dev-1',
    });

    expect(res).toEqual({ delivered: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://cloud.example/v1/lifecycle/notify');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer v4.local.token');
    expect(JSON.parse(init.body)).toEqual({
      target_device_id: 'dev-1',
      payload: 'cipher',
      alert: { title: 'Hi', body: 'thinking of you' },
    });
  });

  it('sends a data-only body when only a payload is given (no alert key)', async () => {
    const fetchImpl = jest.fn(async (_url: string, _init: any) => okResponse({ delivered: 1 }));
    await client(fetchImpl, jest.fn(async () => 't')).notify({ payload: 'x' });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ payload: 'x' });
  });

  it('defaults delivered to 0 on a malformed body', async () => {
    const fetchImpl = jest.fn(async (_url: string, _init: any) => ({ ok: true, status: 200, json: async () => { throw new Error('no body'); } }) as unknown as Response);
    await expect(client(fetchImpl, jest.fn(async () => 't')).notify({ payload: 'x' })).resolves.toEqual({
      delivered: 0,
    });
  });

  it('rejects an empty notification before hitting the network', async () => {
    const fetchImpl = jest.fn();
    await expect(client(fetchImpl, jest.fn(async () => 't')).notify({})).rejects.toThrow(PushRelayError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects an oversized payload before hitting the network', async () => {
    const fetchImpl = jest.fn();
    const big = 'a'.repeat(RELAY_MAX_PAYLOAD_BYTES + 1);
    await expect(client(fetchImpl, jest.fn(async () => 't')).notify({ payload: big })).rejects.toMatchObject({
      code: 'payload_too_large',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('counts UTF-8 bytes for the size check (multibyte)', async () => {
    const fetchImpl = jest.fn();
    // 1500 three-byte chars = 4500 bytes > 4096.
    const multibyte = '☃'.repeat(1500);
    await expect(client(fetchImpl, jest.fn(async () => 't')).notify({ payload: multibyte })).rejects.toMatchObject({
      code: 'payload_too_large',
    });
  });

  it('throws when signed out (no token)', async () => {
    const fetchImpl = jest.fn();
    await expect(client(fetchImpl, jest.fn(async () => null)).notify({ payload: 'x' })).rejects.toMatchObject({
      code: 'unauthorized',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps a 429 to a rate-limited error with the backend code', async () => {
    const fetchImpl = jest.fn(async () => errResponse(429, { error: 'rate_limited' }));
    await expect(client(fetchImpl, jest.fn(async () => 't')).notify({ payload: 'x' })).rejects.toMatchObject({
      status: 429,
      code: 'rate_limited',
    });
  });

  it('maps a 413 to payload_too_large', async () => {
    const fetchImpl = jest.fn(async () => errResponse(413, { error: 'payload_too_large' }));
    await expect(client(fetchImpl, jest.fn(async () => 't')).notify({ payload: 'x' })).rejects.toMatchObject({
      status: 413,
    });
  });

  it('wraps a transport failure as a network error', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('offline');
    });
    await expect(client(fetchImpl, jest.fn(async () => 't')).notify({ payload: 'x' })).rejects.toMatchObject({
      code: 'network',
    });
  });
});
