/**
 * Loopback-transport smoke (task 5-1 gate 4).
 *
 * Exercises the real {@link EngineApiClient} over a **loopback** base URL
 * (`http://127.0.0.1:<adminPort>`) against the in-memory mock management server,
 * with the mock's route table built **from {@link REQUIRED_ENGINE_ENDPOINTS}**
 * and its bodies taken from the shared fixtures. Because the server only answers
 * the paths the manifest declares, a client whose request path or verb drifts
 * from the contract (without a manifest update) gets a 404 and fails here — the
 * "no orphaned paths" half of the retooled gate. It also asserts the per-process
 * `X-Loopback-Token` is carried on every app-facing call.
 *
 * This stands in for the plan's "mock engine binary artifact where feasible": no
 * engine process, no network — just the transport contract.
 */

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { engineApiClient } from '../EngineApiClient';
import { resetEngineServiceForTests, setEngineConnection } from '../EngineService';
import {
  REQUIRED_ENGINE_ENDPOINTS,
  type ContractEndpoint,
} from '../engineContract';
import { CONTRACT_FIXTURES } from '../__fixtures__/managementContract.fixtures';
import { createMockManagementServer, type MockRoute } from '../__tests__/mockManagementServer';

const CONN = {
  wsPort: 1,
  wssPort: 0,
  adminPort: 28081,
  bind: '127.0.0.1',
  pid: 1,
  dataDir: '',
  token: 'loopback-token',
};

/** Compile a `/api/x/:id` template into the exact-path matcher the mock uses. */
function templateToRegExp(template: string): RegExp {
  const pattern = template.replace(/:[A-Za-z]+/g, '[^/]+');
  return new RegExp(`^${pattern}$`);
}

/**
 * One driver per manifest id — the concrete client call. Keyed by endpoint id so
 * a manifest entry with no driver (or a driver with no entry) is a test failure.
 */
const DRIVERS: Record<string, () => Promise<unknown>> = {
  'entities.list': () => engineApiClient.listEntities(),
  'entities.get': () => engineApiClient.getEntityConfig('ent-1'),
  'entities.chatList': () => engineApiClient.entityChatList('ent-1'),
  'entities.messages': () => engineApiClient.entityMessages('ent-1', 'ent-1+ent-2'),
  'entities.interactions': () => engineApiClient.entityInteractions('ent-1'),
  'entities.emojiActions': () => engineApiClient.entityEmojiActions('ent-1'),
  'entities.emotion': () => engineApiClient.entityEmotion('ent-1'),
  'entities.memories': () => engineApiClient.entityMemories('ent-1'),
  'messages.patch': () => engineApiClient.patchMessage('msg-1', { content: 'edited' }),
  'messages.delete': () => engineApiClient.deleteMessage('msg-1'),
  'characterProfiles.list': () => engineApiClient.listCharacterProfiles(),
  'characterProfiles.get': () => engineApiClient.getCharacterProfile('prof-1'),
  'characterProfiles.images': () => engineApiClient.listCharacterImages('prof-1'),
  'characterProfiles.favorite': () => engineApiClient.setCharacterProfileFavorite('prof-1', true),
  'moduleConfigs.list': () => engineApiClient.listModuleConfigs('tts'),
  'moduleConfigs.ttsEmbedSpeaker': () =>
    engineApiClient.embedSpeaker({ provider: 'soulbitscloud', input_audio: 'UklGRg==' }),
  'moduleConfigs.ttsTestSpeech': () =>
    engineApiClient.testTtsSpeech({ provider: 'soulbitscloud', text: 'Hello there' }),
  'moduleConfigs.get': () => engineApiClient.getModuleConfig('tts', 'mc-1'),
  'moduleConfigs.create': () =>
    engineApiClient.createModuleConfig('tts', { name: 'default', provider: 'soulbitscloud' }),
  'moduleConfigs.update': () =>
    engineApiClient.updateModuleConfig('tts', 'mc-1', { name: 'default' }),
  'moduleConfigs.delete': () => engineApiClient.deleteModuleConfig('tts', 'mc-1'),
  'providers.capabilities': () => engineApiClient.getProviderCapabilities(),
  'providers.list': () => engineApiClient.listProviders(),
  'providers.get': () => engineApiClient.getProvider('prov-1'),
  'providers.create': () => engineApiClient.createProvider('soulbitscloud', { name: 'Default' }),
  'providers.update': () => engineApiClient.updateProvider('prov-1', { name: 'Default' }),
  'providers.delete': () => engineApiClient.deleteProvider('prov-1'),
  'providers.refreshToken': () =>
    engineApiClient.refreshSoulbitsCloudProviderConfigs('paseto', 'https://inference.example'),
  'providers.verify': () => engineApiClient.verifyProvider({ type: 'openai', api_key: 'sk-x' }),
  'providers.models': () => engineApiClient.listProviderModels({ type: 'openai', api_key: 'sk-x' }),
  'providers.elevenlabsCloneVoice': () =>
    engineApiClient.cloneElevenLabsVoice({ name: 'Aria', audio_files: ['UklGRg=='] }),
  'providers.elevenlabsVoiceDesign': () =>
    engineApiClient.designElevenLabsVoice({ action: 'preview', voice_description: 'warm' }),
  'syncClient.status': () => engineApiClient.getSyncClientStatus(),
  'syncGroup.keyStatus': () => engineApiClient.getSyncGroupKeyStatus(),
  'syncGroup.init': () => engineApiClient.initSyncGroup(),
  'syncGroup.import': () => engineApiClient.importSyncGroup('Z3JvdXAta2V5'),
  'syncGroup.rotate': () => engineApiClient.rotateSyncGroup(),
  'syncGroup.rotationRequired': () => engineApiClient.setSyncGroupRotationRequired(true),
  'syncPairing.lan': () => engineApiClient.mintLanPairing(),
  'syncPairing.cloud': () => engineApiClient.mintCloudPairing(),
  'cloud.account': () => engineApiClient.cloudAccount(),
  'cloud.signInStart': () => engineApiClient.startCloudSignIn(),
  'cloud.signOut': () => engineApiClient.cloudSignOut(),
  'stats.characters': () => engineApiClient.characterStats(),
  'backup.dataVersion': () => engineApiClient.backupDataVersion(),
  'backup.targets': () => engineApiClient.listBackupTargets(),
  'engineLogs.list': () => engineApiClient.engineLogs({ component: 'chat', limit: 50 }),
  'engineLogs.count': () => engineApiClient.engineLogCount(),
  'engineLogs.components': () => engineApiClient.engineLogComponents(),
  'engineLogs.entities': () => engineApiClient.engineLogEntities(),
  'engineLogs.promptTypes': () => engineApiClient.engineLogPromptTypes(),
  'engineLogs.getLevels': () => engineApiClient.engineLogLevels(),
  'engineLogs.setLevels': () => engineApiClient.setEngineLogLevels({ defaultLevel: 'debug' }),
};

function routesFromManifest(): MockRoute[] {
  return REQUIRED_ENGINE_ENDPOINTS.map((endpoint: ContractEndpoint) => ({
    method: endpoint.method,
    path: templateToRegExp(endpoint.path),
    json: CONTRACT_FIXTURES[endpoint.fixture],
  }));
}

beforeEach(() => {
  resetEngineServiceForTests();
  setEngineConnection(CONN);
});

afterAll(() => {
  resetEngineServiceForTests();
});

describe('engine loopback transport smoke', () => {
  it('every required endpoint has a driver (manifest ↔ smoke stay in sync)', () => {
    const manifestIds = REQUIRED_ENGINE_ENDPOINTS.map(e => e.id).sort();
    const driverIds = Object.keys(DRIVERS).sort();
    expect(driverIds).toEqual(manifestIds);
  });

  it.each(REQUIRED_ENGINE_ENDPOINTS.map(e => [e.id, e] as const))(
    'drives %s over loopback and carries the X-Loopback-Token',
    async (id, endpoint) => {
      const server = createMockManagementServer(routesFromManifest());
      engineApiClient.setFetchImpl(server.fetch);

      await expect(DRIVERS[id]()).resolves.toBeDefined();

      const call = server.lastCall(endpoint.method, templateToRegExp(endpoint.path));
      expect(call).toBeDefined();
      expect(call!.headers['X-Loopback-Token']).toBe('loopback-token');
      expect(call!.url.startsWith(`http://127.0.0.1:28081`)).toBe(true);
    },
  );

  it('an undeclared path 404s (proving the mock only serves the contract surface)', async () => {
    const server = createMockManagementServer(routesFromManifest());
    engineApiClient.setFetchImpl(server.fetch);
    // `GET /api/presets` is not part of the required-endpoint manifest.
    await expect(engineApiClient.listPresets()).rejects.toMatchObject({
      status: 404,
    });
  });

  it('maps a 404 byte fetch to null (two-phase blob loader degrades gracefully)', async () => {
    const server = createMockManagementServer(routesFromManifest());
    engineApiClient.setFetchImpl(server.fetch);
    await expect(engineApiClient.fetchMessageBytes('missing', 'audio')).resolves.toBeNull();
  });
});
