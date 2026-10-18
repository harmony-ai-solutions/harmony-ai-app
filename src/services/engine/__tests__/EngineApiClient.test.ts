/**
 * EngineApiClient — unit tests (task 3-2).
 */

import {
  buildQuery,
  EngineApiClient,
  EngineApiError,
} from '../EngineApiClient';
import type { EngineConnection } from '../EngineService';
import { createMockManagementServer } from './mockManagementServer';
import { CLOUD_HOSTS } from '../../../config/cloud';

const connection: EngineConnection = {
  adminBaseUrl: 'http://127.0.0.1:28081',
  wsBaseUrl: 'ws://127.0.0.1:28080',
  wssBaseUrl: '',
  token: 'loop-token',
  bind: '127.0.0.1',
  wsPort: 28080,
  wssPort: 0,
  adminPort: 28081,
  pid: 1,
  dataDir: '',
};

function clientWith(server: ReturnType<typeof createMockManagementServer>) {
  return new EngineApiClient(() => connection, server.fetch);
}

describe('buildQuery', () => {
  it('omits empty values and encodes', () => {
    expect(buildQuery({ a: 1, b: '', c: undefined, d: null, e: 'x y' })).toBe('?a=1&e=x%20y');
    expect(buildQuery({})).toBe('');
  });
});

describe('EngineApiClient', () => {
  it('sends the loopback token header', async () => {
    const server = createMockManagementServer([
      { method: 'GET', path: '/api/entities', json: {} },
    ]);
    await clientWith(server).listEntities();
    const call = server.lastCall('GET', '/api/entities')!;
    expect(call.headers['X-Loopback-Token']).toBe('loop-token');
    expect(call.headers['X-Admin-API-Key']).toBeUndefined();
  });

  it('falls back to X-Admin-API-Key when no loopback token is present', async () => {
    const server = createMockManagementServer([
      { method: 'GET', path: '/api/entities', json: {} },
    ]);
    const client = new EngineApiClient(
      () => ({ ...connection, token: '' }),
      server.fetch,
    );
    client.setAdminApiKey('admin-key');
    await client.listEntities();
    const call = server.lastCall('GET', '/api/entities')!;
    expect(call.headers['X-Admin-API-Key']).toBe('admin-key');
    expect(call.headers['X-Loopback-Token']).toBeUndefined();
  });

  it('maps chat-list params + parses the response', async () => {
    const server = createMockManagementServer([
      {
        method: 'GET',
        path: /\/api\/entities\/e1\/chat-list/,
        json: {
          conversations: [
            {
              interaction_id: 'i1',
              participant_key: 'e1+e2',
              interaction_scope: 'private',
              participant_ids: '["e1","e2"]',
              last_message: null,
              last_message_at: null,
              unread_count: 2,
              pinned: true,
              archived: false,
              reply_mode: 'realistic',
            },
          ],
          has_more: false,
          next_offset: null,
        },
      },
    ]);
    const res = await clientWith(server).entityChatList('e1', { limit: 50, offset: 0 });
    expect(res.conversations[0].unread_count).toBe(2);
    const call = server.lastCall('GET', /chat-list/)!;
    expect(call.query.limit).toBe('50');
    expect(call.query.offset).toBe('0');
  });

  it('sends the participant key as a path segment (encoded +) and passes the opaque before cursor verbatim', async () => {
    const server = createMockManagementServer([
      {
        method: 'GET',
        path: /\/api\/entities\/e1\/conversations\/.*\/messages/,
        json: { messages: [], has_more: false, next_cursor: null },
      },
    ]);
    await clientWith(server).entityMessages('e1', 'e1+e2', {
      limit: 20,
      before: '2026-10-11 10:00:00.123+00:00',
    });
    const call = server.lastCall('GET', /messages/)!;
    // participant key is a PATH SEGMENT with `+` encoded as `%2B`
    expect(call.path).toContain('/conversations/e1%2Be2/messages');
    expect(call.query.participant_key).toBeUndefined();
    expect(call.query.before).toBe('2026-10-11 10:00:00.123+00:00');
  });

  it('throws EngineApiError with status on a non-2xx response', async () => {
    const server = createMockManagementServer([
      { method: 'GET', path: '/api/entities', status: 401, json: { error: 'unauthorized' } },
    ]);
    await expect(clientWith(server).listEntities()).rejects.toMatchObject({
      name: 'EngineApiError',
      status: 401,
      message: 'unauthorized',
    });
  });

  it('returns raw bytes and base64 for a message blob', async () => {
    const bytes = new Uint8Array([104, 105]); // "hi"
    const server = createMockManagementServer([
      { method: 'GET', path: '/api/messages/m1/audio', bytes },
    ]);
    const client = clientWith(server);
    const raw = await client.fetchMessageBytes('m1', 'audio');
    expect(raw).toEqual(bytes);
    const b64 = await client.fetchMessageAudioBase64('m1');
    expect(b64).toBe('aGk=');
  });

  it('returns null when a message has no such blob (404)', async () => {
    const server = createMockManagementServer([
      { method: 'GET', path: '/api/messages/m1/image', status: 404, json: { error: 'none' } },
    ]);
    await expect(clientWith(server).fetchMessageBytes('m1', 'image')).resolves.toBeNull();
  });

  it('wraps a transport failure in EngineApiError', async () => {
    const client = new EngineApiClient(
      () => connection,
      async () => {
        throw new Error('network down');
      },
    );
    await expect(client.listEntities()).rejects.toBeInstanceOf(EngineApiError);
  });

  it('throws requireEngineConnection error when the engine is down', async () => {
    const client = new EngineApiClient(() => {
      throw new Error('Engine is not connected');
    }, async () => ({ ok: true, status: 200, json: async () => ({}) } as unknown as Response));
    await expect(client.listEntities()).rejects.toThrow(/not connected/);
  });
});

// ── Cloud-mode provider-config injection (task 2-5) ──────────────────────
describe('refreshSoulbitsCloudProviderConfigs', () => {
  it('POSTs the token + base_url to the engine contract route', async () => {
    const server = createMockManagementServer([
      {
        method: 'POST',
        path: '/api/providers/soulbitscloud/refresh-token',
        json: { updated: 7 },
      },
    ]);

    const result = await clientWith(server).refreshSoulbitsCloudProviderConfigs(
      'v4.local.token',
      CLOUD_HOSTS.inference,
    );

    expect(result).toEqual({ updated: 7 });
    const call = server.lastCall('POST', '/api/providers/soulbitscloud/refresh-token')!;
    expect(call.body).toEqual({ api_key: 'v4.local.token', base_url: CLOUD_HOSTS.inference });
  });

  it('surfaces a 404 as EngineApiError (the route is an engine-side prerequisite)', async () => {
    const server = createMockManagementServer([]); // no route → 404
    await expect(
      clientWith(server).refreshSoulbitsCloudProviderConfigs('v4.local.token'),
    ).rejects.toBeInstanceOf(EngineApiError);
  });
});

// ── Sync client runtime control (task 3-5) ───────────────────────────────
describe('sync client control', () => {
  const statusJson = {
    enabled: true,
    state: 'pending_approval',
    last_error: null,
    local_authoritative: false,
    baseline_path: null,
    dataset_id: 'ds-1',
    pending_writes: 3,
    sync_group: 'uninitialized',
    rotation_required: false,
    relay: null,
    config: {
      enabled: true,
      transport: 'lan',
      peer_address: '192.168.1.10:28080',
      peer_wss_address: '',
      security_mode: 'secure',
      relay_url: '',
      relay_token: '',
      device_id: '',
      dataset_id: '',
      group_join_pending: false,
      device_name: 'Pixel',
      device_type: 'embedded_engine',
      device_platform: 'android',
    },
  };

  it('GETs the status object', async () => {
    const server = createMockManagementServer([
      { method: 'GET', path: '/api/sync/client/status', json: statusJson },
    ]);
    const res = await clientWith(server).getSyncClientStatus();
    expect(res.state).toBe('pending_approval');
    expect(res.pending_writes).toBe(3);
    expect(res.config.peer_address).toBe('192.168.1.10:28080');
  });

  it('PUTs a partial config and returns the post-apply status', async () => {
    const server = createMockManagementServer([
      { method: 'PUT', path: '/api/sync/client', json: statusJson },
    ]);
    const res = await clientWith(server).updateSyncClientConfig({
      enabled: true,
      peer_address: '192.168.1.10:28080',
    });
    expect(res.enabled).toBe(true);
    const call = server.lastCall('PUT', '/api/sync/client')!;
    expect(call.body).toEqual({ enabled: true, peer_address: '192.168.1.10:28080' });
  });

  it('POSTs yield and surfaces the state', async () => {
    const server = createMockManagementServer([
      { method: 'POST', path: '/api/sync/client/yield', json: { status: 'ok', state: 'syncing' } },
    ]);
    const res = await clientWith(server).yieldSyncClient();
    expect(res).toEqual({ status: 'ok', state: 'syncing' });
  });

  it('POSTs disconnect and returns the status', async () => {
    const server = createMockManagementServer([
      { method: 'POST', path: '/api/sync/client/disconnect', json: { ...statusJson, state: 'stopped' } },
    ]);
    const res = await clientWith(server).disconnectSyncClient();
    expect(res.state).toBe('stopped');
    expect(res.enabled).toBe(true);
  });

  it('surfaces a 409 yield conflict as EngineApiError', async () => {
    const server = createMockManagementServer([
      { method: 'POST', path: '/api/sync/client/yield', status: 409, json: { error: 'not connected' } },
    ]);
    await expect(clientWith(server).yieldSyncClient()).rejects.toMatchObject({
      name: 'EngineApiError',
      status: 409,
    });
  });

  // ── Sync-group key lifecycle (7-2/7-3) ─────────────────────────────────
  const keyStatusJson = {
    state: 'member',
    has_key: true,
    fingerprint: 'abc123',
    rotation_required: false,
  };

  it('GETs the sync-group key status', async () => {
    const server = createMockManagementServer([
      { method: 'GET', path: '/api/sync/group/key-status', json: keyStatusJson },
    ]);
    const res = await clientWith(server).getSyncGroupKeyStatus();
    expect(res.state).toBe('member');
    expect(res.has_key).toBe(true);
  });

  it('POSTs init and returns the raw group key', async () => {
    const server = createMockManagementServer([
      {
        method: 'POST',
        path: '/api/sync/group/init',
        json: { ...keyStatusJson, group_key_base64: 'R0tFWQ==', created: true },
      },
    ]);
    const res = await clientWith(server).initSyncGroup();
    expect(res.group_key_base64).toBe('R0tFWQ==');
    expect(res.created).toBe(true);
  });

  it('POSTs import with the raw group key body', async () => {
    const server = createMockManagementServer([
      {
        method: 'POST',
        path: '/api/sync/group/import',
        json: { ...keyStatusJson, imported: true },
      },
    ]);
    await clientWith(server).importSyncGroup('R0tFWQ==');
    const call = server.lastCall('POST', '/api/sync/group/import')!;
    expect(call.body).toEqual({ group_key_base64: 'R0tFWQ==' });
  });

  it('POSTs rotate and surfaces baseline_required', async () => {
    const server = createMockManagementServer([
      {
        method: 'POST',
        path: '/api/sync/group/rotate',
        json: { ...keyStatusJson, group_key_base64: 'TkVX', rotated: true, baseline_required: true },
      },
    ]);
    const res = await clientWith(server).rotateSyncGroup();
    expect(res.rotated).toBe(true);
    expect(res.baseline_required).toBe(true);
  });

  it('POSTs the rotation-required flag', async () => {
    const server = createMockManagementServer([
      { method: 'POST', path: '/api/sync/group/rotation-required', json: keyStatusJson },
    ]);
    await clientWith(server).setSyncGroupRotationRequired(true);
    const call = server.lastCall('POST', '/api/sync/group/rotation-required')!;
    expect(call.body).toEqual({ required: true });
  });

  it('surfaces a 409 init conflict (group already initialized)', async () => {
    const server = createMockManagementServer([
      { method: 'POST', path: '/api/sync/group/init', status: 409, json: { error: 'already initialized' } },
    ]);
    await expect(clientWith(server).initSyncGroup()).rejects.toMatchObject({
      name: 'EngineApiError',
      status: 409,
    });
  });
});

// ── Engine logs (plan 7-11) ──────────────────────────────────────────────
describe('engine logs', () => {
  it('GETs the log page with the full filter set as query params', async () => {
    const server = createMockManagementServer([
      {
        method: 'GET',
        path: '/api/development/logs',
        json: { entries: [{ id: 1, message: 'hi', component: 'chat' }], count: 1, offset: 0, limit: 50 },
      },
    ]);
    const res = await clientWith(server).engineLogs({
      component: 'chat',
      entityId: 'ent-1',
      minLevel: 'warn',
      search: 'boom',
      isPrompt: true,
      promptType: 'system',
      limit: 50,
      offset: 0,
    });
    expect(res.entries).toHaveLength(1);
    const call = server.lastCall('GET', '/api/development/logs')!;
    expect(call.query.component).toBe('chat');
    expect(call.query.entityId).toBe('ent-1');
    expect(call.query.minLevel).toBe('warn');
    expect(call.query.search).toBe('boom');
    expect(call.query.isPrompt).toBe('true');
    expect(call.query.promptType).toBe('system');
    expect(call.query.limit).toBe('50');
  });

  it('passes promptType through and omits isPrompt when unset', async () => {
    const server = createMockManagementServer([
      { method: 'GET', path: '/api/development/logs', json: { entries: [], count: 0, offset: 0, limit: 200 } },
    ]);
    await clientWith(server).engineLogs({ promptType: 'system' });
    const call = server.lastCall('GET', '/api/development/logs')!;
    expect(call.query.isPrompt).toBeUndefined();
    expect(call.query.promptType).toBe('system');
  });

  it('GETs the count/components/entities/prompt-types facets', async () => {
    const server = createMockManagementServer([
      { method: 'GET', path: '/api/development/logs/count', json: { count: 9 } },
      { method: 'GET', path: '/api/development/logs/components', json: { components: ['chat'] } },
      { method: 'GET', path: '/api/development/logs/entities', json: { entities: ['ent-1'] } },
      { method: 'GET', path: '/api/development/logs/prompt-types', json: { promptTypes: ['system'] } },
    ]);
    const client = clientWith(server);
    await expect(client.engineLogCount()).resolves.toEqual({ count: 9 });
    await expect(client.engineLogComponents()).resolves.toEqual({ components: ['chat'] });
    await expect(client.engineLogEntities()).resolves.toEqual({ entities: ['ent-1'] });
    await expect(client.engineLogPromptTypes()).resolves.toEqual({ promptTypes: ['system'] });
  });

  it('GETs and PUTs the runtime level config', async () => {
    const server = createMockManagementServer([
      {
        method: 'GET',
        path: '/api/development/logs/level',
        json: { defaultLevel: 'info', componentLevels: { chat: 'debug' }, promptVerbosity: 'summary' },
      },
      { method: 'PUT', path: '/api/development/logs/level', json: { status: 'ok' } },
    ]);
    const client = clientWith(server);
    const cfg = await client.engineLogLevels();
    expect(cfg.defaultLevel).toBe('info');
    expect(cfg.componentLevels.chat).toBe('debug');

    await expect(client.setEngineLogLevels({ defaultLevel: 'trace' })).resolves.toEqual({ status: 'ok' });
    const put = server.lastCall('PUT', '/api/development/logs/level')!;
    expect(put.body).toEqual({ defaultLevel: 'trace' });
  });
});

// ── Sampling presets (provider-registry 2-2) ─────────────────────────────
describe('sampling presets', () => {
  it('GETs the preset list (name/source/param_count, description omitempty)', async () => {
    const server = createMockManagementServer([
      {
        method: 'GET',
        path: '/api/presets',
        json: {
          presets: [
            { name: 'creative', source: 'bundled', param_count: 3, description: 'High temperature' },
            { name: 'precise', source: 'user', param_count: 2 },
          ],
        },
      },
    ]);

    const res = await clientWith(server).listPresets();

    expect(res.presets).toHaveLength(2);
    expect(res.presets[0]).toEqual({
      name: 'creative',
      source: 'bundled',
      param_count: 3,
      description: 'High temperature',
    });
    // description is omitempty — absent on the second row.
    expect(res.presets[1].description).toBeUndefined();
    expect(res.presets[1].param_count).toBe(2);
    const call = server.lastCall('GET', '/api/presets')!;
    expect(call.path).toBe('/api/presets');
  });

  it('GETs a preset detail including the params override map', async () => {
    const server = createMockManagementServer([
      {
        method: 'GET',
        path: '/api/presets/creative',
        json: {
          name: 'creative',
          source: 'bundled',
          description: 'High temperature',
          params: { temperature: 0.9, top_p: 0.95, max_tokens: 4096 },
        },
      },
    ]);

    const res = await clientWith(server).getPreset('creative');

    expect(res.name).toBe('creative');
    expect(res.params).toEqual({ temperature: 0.9, top_p: 0.95, max_tokens: 4096 });
    expect(server.lastCall('GET', '/api/presets/creative')).toBeTruthy();
  });

  it('URL-encodes the preset name path segment', async () => {
    const server = createMockManagementServer([
      {
        method: 'GET',
        path: /\/api\/presets\//,
        json: { name: 'a b', source: 'user', params: {} },
      },
    ]);

    await clientWith(server).getPreset('a b');

    const call = server.lastCall('GET', /\/api\/presets\//)!;
    expect(call.path).toBe('/api/presets/a%20b');
  });

  it('surfaces a 404 for an unknown preset as EngineApiError', async () => {
    const server = createMockManagementServer([]); // no route → 404
    await expect(clientWith(server).getPreset('missing')).rejects.toMatchObject({
      name: 'EngineApiError',
      status: 404,
    });
  });
});

// ── Provider accounts + verify/models/capabilities (provider-registry 6-1) ─
describe('provider accounts transport', () => {
  it('POSTs {type, account} on create and returns the write envelope', async () => {
    const server = createMockManagementServer([
      {
        method: 'POST',
        path: '/api/providers',
        status: 201,
        json: { provider: 'openai', config: { id: 'acc1' } },
      },
    ]);
    const res = await clientWith(server).createProvider('openai', { name: 'default', api_key: 'sk' });
    expect((res.config as { id: string }).id).toBe('acc1');
    expect(server.lastCall('POST', '/api/providers')!.body).toEqual({
      type: 'openai',
      account: { name: 'default', api_key: 'sk' },
    });
  });

  it('PUTs {account} on update', async () => {
    const server = createMockManagementServer([
      { method: 'PUT', path: '/api/providers/acc1', json: { provider: 'openai', config: { id: 'acc1' } } },
    ]);
    await clientWith(server).updateProvider('acc1', { name: 'renamed' });
    expect(server.lastCall('PUT', '/api/providers/acc1')!.body).toEqual({
      account: { name: 'renamed' },
    });
  });

  it('surfaces the DELETE 409 body (referencing_configs)', async () => {
    const server = createMockManagementServer([
      {
        method: 'DELETE',
        path: '/api/providers/acc1',
        status: 409,
        json: {
          error: 'provider_in_use',
          referencing_configs: [{ module: 'backend', name: 'b', id: 'mc1' }],
        },
      },
    ]);
    await expect(clientWith(server).deleteProvider('acc1')).rejects.toMatchObject({
      status: 409,
      body: { error: 'provider_in_use' },
    });
  });

  it('GETs the account-shaped provider list', async () => {
    const server = createMockManagementServer([
      {
        method: 'GET',
        path: '/api/providers',
        json: {
          providers: {
            openai: [
              { id: 'acc1', type: 'openai', name: 'd', api_key: 'sk', base_url: '', extra: '{}' },
            ],
          },
        },
      },
    ]);
    const res = await clientWith(server).listProviders('openai');
    expect(res.providers.openai[0].id).toBe('acc1');
    expect(server.lastCall('GET', '/api/providers')!.query.type).toBe('openai');
  });

  it('POSTs the probe body to /verify and returns the state', async () => {
    const server = createMockManagementServer([
      {
        method: 'POST',
        path: '/api/providers/verify',
        json: { state: 'throttled', detail: '429' },
      },
    ]);
    const res = await clientWith(server).verifyProvider({ type: 'openai', api_key: 'sk' });
    expect(res.state).toBe('throttled');
    expect(server.lastCall('POST', '/api/providers/verify')!.body).toEqual({
      type: 'openai',
      api_key: 'sk',
    });
  });

  it('POSTs the probe body to /models and returns models + voices', async () => {
    const server = createMockManagementServer([
      {
        method: 'POST',
        path: '/api/providers/models',
        json: {
          models: [{ id: 'gpt-4o', source: 'catalog', provenance: 'known' }],
          voices: [{ voice_id: 'v1', name: 'Rachel' }],
        },
      },
    ]);
    const res = await clientWith(server).listProviderModels({
      type: 'elevenlabs',
      api_key: 'k',
      module: 'tts',
    });
    expect(res.models[0].id).toBe('gpt-4o');
    expect(res.voices?.[0].voice_id).toBe('v1');
    expect(server.lastCall('POST', '/api/providers/models')!.body).toEqual({
      type: 'elevenlabs',
      api_key: 'k',
      module: 'tts',
    });
  });

  it('GETs the capability catalog', async () => {
    const server = createMockManagementServer([
      {
        method: 'GET',
        path: '/api/providers/capabilities',
        json: { catalog: { openai: [{ id: 'gpt-4o' }] }, param_mapping: { mistral: { seed: 'random_seed' } } },
      },
    ]);
    const res = await clientWith(server).getProviderCapabilities();
    expect(res.param_mapping?.mistral.seed).toBe('random_seed');
  });
});

describe('module-config writes are flat', () => {
  it('POSTs the flat body verbatim', async () => {
    const server = createMockManagementServer([
      {
        method: 'POST',
        path: '/api/module-configs/backend',
        status: 201,
        json: { id: 'mc1', status: 'ok' },
      },
    ]);
    const res = await clientWith(server).createModuleConfig('backend', {
      name: 'cfg',
      provider: 'openai',
      provider_account_id: 'acc1',
      capability_json: { model: 'gpt-4o' },
    });
    expect(res.id).toBe('mc1');
    expect(server.lastCall('POST', '/api/module-configs/backend')!.body).toEqual({
      name: 'cfg',
      provider: 'openai',
      provider_account_id: 'acc1',
      capability_json: { model: 'gpt-4o' },
    });
  });
});
