/**
 * Seeding ensure-flow tests (provider-registry 6-4).
 *
 * Verifies the app-side half of seeding (plan §5 amended / §11 A8–A11):
 *  - token first, on every trigger, NEVER flag-gated (auth AND re-auth);
 *  - gap-fill per module type ×7 + per STT slot (transcription, VAD = silero-vad),
 *    reading the gateway metadata and falling back to SOULBITS_FALLBACK_MODELS;
 *  - the engine-seeded fresh-install no-op; never-overwrite semantics;
 *  - the per-account persisted guard (`seeding_done_v1:<accountId>`) gating the
 *    scan only, re-running when the account changed;
 *  - `startSeedingEnsure()` subscribing to `auth:changed` + the bootstrap path.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import AuthService from '../../auth/AuthService';
import { engineApiClient } from '../../engine/EngineApiClient';
import { getEngineConnection, onEngineConnectionChange } from '../../engine/EngineService';
import * as repo from '../../../database/repositories';
import { ensureSeededDefaults, startSeedingEnsure } from '../seeding';
import { ensureCloudEngineKey, getLastAppliedEngineKey } from '../../cloud/engineKeyEnsure';
import { CLOUD_HOSTS } from '../../../config/cloud';

// ── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('i18next', () => ({
  __esModule: true,
  default: {
    t: (key: string) =>
      key === 'providers:defaultConfigName'
        ? 'Soulbits Cloud (default)'
        : key === 'providers:soulbitsAccountName'
          ? 'Soulbits Cloud'
          : key,
  },
}));

jest.mock('../../auth/AuthService', () => ({
  __esModule: true,
  default: {
    on: jest.fn(),
    off: jest.fn(),
    getToken: jest.fn(),
    getTokenExpiresAt: jest.fn(),
    refreshDeduped: jest.fn(),
  },
}));

jest.mock('../../engine/EngineApiClient', () => ({
  __esModule: true,
  engineApiClient: { listProviderModels: jest.fn() },
}));

jest.mock('../../engine/EngineService', () => ({
  getEngineConnection: jest.fn(),
  onEngineConnectionChange: jest.fn(() => jest.fn()),
}));

jest.mock('../../cloud/engineKeyEnsure', () => ({
  __esModule: true,
  ensureCloudEngineKey: jest.fn(),
  getLastAppliedEngineKey: jest.fn(),
}));

jest.mock('../../../database/repositories', () => ({
  __esModule: true,
  listAccounts: jest.fn(),
  createAccount: jest.fn(),
  updateAccount: jest.fn(),
  getAllBackendConfigs: jest.fn(),
  createBackendConfig: jest.fn(),
  getAllCognitionConfigs: jest.fn(),
  createCognitionConfig: jest.fn(),
  getAllMovementConfigs: jest.fn(),
  createMovementConfig: jest.fn(),
  getAllRAGConfigs: jest.fn(),
  createRAGConfig: jest.fn(),
  getAllTTSConfigs: jest.fn(),
  createTTSConfig: jest.fn(),
  getAllVisionConfigs: jest.fn(),
  createVisionConfig: jest.fn(),
  getAllSTTConfigs: jest.fn(),
  createSTTConfig: jest.fn(),
}));

// ── Typed mock handles ──────────────────────────────────────────────────────

const auth = AuthService as unknown as {
  on: jest.Mock;
  off: jest.Mock;
  getToken: jest.Mock;
  getTokenExpiresAt: jest.Mock;
  refreshDeduped: jest.Mock;
};
const engine = engineApiClient as unknown as { listProviderModels: jest.Mock };
const ensureKey = ensureCloudEngineKey as jest.Mock;
const cachedEngineKey = getLastAppliedEngineKey as jest.Mock;
const engineConnection = {
  getEngineConnection: getEngineConnection as jest.Mock,
  onEngineConnectionChange: onEngineConnectionChange as jest.Mock,
};
const r = repo as unknown as {
  listAccounts: jest.Mock;
  createAccount: jest.Mock;
  updateAccount: jest.Mock;
  getAllBackendConfigs: jest.Mock;
  createBackendConfig: jest.Mock;
  getAllCognitionConfigs: jest.Mock;
  createCognitionConfig: jest.Mock;
  getAllMovementConfigs: jest.Mock;
  createMovementConfig: jest.Mock;
  getAllRAGConfigs: jest.Mock;
  createRAGConfig: jest.Mock;
  getAllTTSConfigs: jest.Mock;
  createTTSConfig: jest.Mock;
  getAllVisionConfigs: jest.Mock;
  createVisionConfig: jest.Mock;
  getAllSTTConfigs: jest.Mock;
  createSTTConfig: jest.Mock;
};

const mockedGetItem = AsyncStorage.getItem as jest.Mock;
const mockedSetItem = AsyncStorage.setItem as jest.Mock;

// ── Fixtures / helpers ──────────────────────────────────────────────────────

const account = (over: Record<string, unknown> = {}) => ({
  id: 'acct-1',
  type: 'soulbitscloud',
  name: 'Soulbits Cloud',
  api_key: '',
  base_url: '',
  extra: '{}',
  created_at: null,
  updated_at: null,
  deleted_at: null,
  ...over,
});

const liveConfig = (over: Record<string, unknown> = {}) => ({
  id: 'cfg-1',
  name: 'Default SoulbitsCloud',
  provider: 'soulbitscloud',
  provider_account_id: 'acct-1',
  capability_json: '{}',
  deleted_at: null,
  ...over,
});

const sttConfig = (over: Record<string, unknown> = {}) => ({
  id: 'stt-1',
  name: 'Default SoulbitsCloud',
  main_stream_time_millis: 500,
  transition_stream_time_millis: 250,
  max_buffer_count: 10,
  transcription_provider: 'soulbitscloud',
  transcription_provider_account_id: 'acct-1',
  transcription_capability_json: '{}',
  vad_provider: 'soulbitscloud',
  vad_provider_account_id: 'acct-1',
  vad_capability_json: '{}',
  deleted_at: null,
  ...over,
});

/** One live config for every module type + an STT config with both slots. */
function engineSeededInstall() {
  r.getAllBackendConfigs.mockResolvedValue([liveConfig()]);
  r.getAllCognitionConfigs.mockResolvedValue([liveConfig()]);
  r.getAllMovementConfigs.mockResolvedValue([liveConfig()]);
  r.getAllRAGConfigs.mockResolvedValue([liveConfig()]);
  r.getAllTTSConfigs.mockResolvedValue([liveConfig()]);
  r.getAllVisionConfigs.mockResolvedValue([liveConfig()]);
  r.getAllSTTConfigs.mockResolvedValue([sttConfig()]);
}

/** Route AsyncStorage.getItem by key. */
function mockStorage(values: Record<string, string | null>) {
  mockedGetItem.mockImplementation((key: string) =>
    Promise.resolve(key in values ? values[key] : null),
  );
}

const capModel = (json: string): string => JSON.parse(json).model;

const CONN = { adminBaseUrl: 'http://127.0.0.1:28081' };
const NOT_CONNECTED =
  'Engine is not connected — start the engine sidecar before using the management-API data layer';

/** Capture every engine-connection listener registered during a test. */
function captureEngineListeners() {
  const listeners: Array<(connection: unknown) => void> = [];
  engineConnection.onEngineConnectionChange.mockImplementation(
    (cb: (connection: unknown) => void) => {
      listeners.push(cb);
      return jest.fn();
    },
  );
  return listeners;
}

const flush = async () => {
  for (let i = 0; i < 12; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
};

beforeEach(() => {
  jest.clearAllMocks();

  // Default: the engine management API is up (no readiness deferral).
  engineConnection.getEngineConnection.mockReturnValue(CONN);
  engineConnection.onEngineConnectionChange.mockImplementation(() => jest.fn());

  auth.getToken.mockResolvedValue('paseto-current');
  // Default: a comfortably-fresh cached token (well outside any threshold).
  auth.getTokenExpiresAt.mockReturnValue(Date.now() + 60 * 60 * 1000);
  auth.refreshDeduped.mockResolvedValue(true);
  ensureKey.mockResolvedValue({ status: 'reused', key: 'sb_cloud_cachedkey' });
  cachedEngineKey.mockReturnValue('sb_cloud_cachedkey');
  r.listAccounts.mockResolvedValue([account()]);
  r.createAccount.mockResolvedValue('acct-created');
  r.updateAccount.mockResolvedValue(undefined);
  for (const create of [
    r.createBackendConfig,
    r.createCognitionConfig,
    r.createMovementConfig,
    r.createRAGConfig,
    r.createTTSConfig,
    r.createVisionConfig,
    r.createSTTConfig,
  ]) {
    create.mockResolvedValue('new-cfg');
  }
  for (const read of [
    r.getAllBackendConfigs,
    r.getAllCognitionConfigs,
    r.getAllMovementConfigs,
    r.getAllRAGConfigs,
    r.getAllTTSConfigs,
    r.getAllVisionConfigs,
    r.getAllSTTConfigs,
  ]) {
    read.mockResolvedValue([]);
  }
  engine.listProviderModels.mockResolvedValue({ models: [] });

  mockStorage({});
  mockedSetItem.mockResolvedValue(undefined);
});

// ── Credential first (never flag-gated) ─────────────────────────────────────

describe('ensureSeededDefaults — credential first', () => {
  it('runs the engine-key ensure and never writes the PASETO into the account', async () => {
    engineSeededInstall();

    await ensureSeededDefaults();

    expect(ensureKey).toHaveBeenCalledTimes(1);
    expect(r.updateAccount).toHaveBeenCalledWith('acct-1', {
      base_url: CLOUD_HOSTS.inference,
    });
    // The PASETO is only used for gateway discovery, never as the account key.
    expect(r.updateAccount).not.toHaveBeenCalledWith(
      'acct-1',
      expect.objectContaining({ api_key: expect.anything() }),
    );
  });

  it('runs the credential step even when the gap-fill guard is already set (NOT flag-gated)', async () => {
    engineSeededInstall();
    mockStorage({ 'seeding_done_v1:acct-1': '1' });

    await ensureSeededDefaults('paseto-renewed');

    expect(ensureKey).toHaveBeenCalledTimes(1);
    expect(r.updateAccount).toHaveBeenCalledWith('acct-1', {
      base_url: CLOUD_HOSTS.inference,
    });
    expect(r.createBackendConfig).not.toHaveBeenCalled();
    expect(engine.listProviderModels).not.toHaveBeenCalled();
  });

  it('is a no-op in standalone mode (no cached token)', async () => {
    auth.getToken.mockRejectedValue(new Error('AuthExpiredError'));

    await ensureSeededDefaults();

    expect(ensureKey).not.toHaveBeenCalled();
    expect(r.listAccounts).not.toHaveBeenCalled();
    expect(r.updateAccount).not.toHaveBeenCalled();
    expect(r.createBackendConfig).not.toHaveBeenCalled();
  });

  it('creates the soulbitscloud account with the last-applied engine key', async () => {
    r.listAccounts.mockResolvedValue([]);
    engineSeededInstall();

    await ensureSeededDefaults('paseto-fresh');

    expect(r.createAccount).toHaveBeenCalledWith('soulbitscloud', {
      name: 'Soulbits Cloud',
      api_key: 'sb_cloud_cachedkey',
      base_url: CLOUD_HOSTS.inference,
    });
    expect(r.updateAccount).not.toHaveBeenCalled();
  });

  it('never blocks on a token/account failure (logs only)', async () => {
    r.listAccounts.mockRejectedValue(new Error('engine offline'));

    await expect(ensureSeededDefaults('paseto-1')).resolves.toBeUndefined();
  });
});

// ── Stale-token guard (provider-registry follow-up) ─────────────────────────

describe('ensureSeededDefaults — stale-token guard', () => {
  it('runs the credential step with a fresh token, without refreshing', async () => {
    engineSeededInstall();

    await ensureSeededDefaults();

    expect(auth.refreshDeduped).not.toHaveBeenCalled();
    expect(ensureKey).toHaveBeenCalledTimes(1);
    expect(r.updateAccount).toHaveBeenCalledWith('acct-1', {
      base_url: CLOUD_HOSTS.inference,
    });
  });

  it('refreshes an expired cached token once, then runs the flow', async () => {
    engineSeededInstall();
    auth.getTokenExpiresAt
      .mockReturnValueOnce(Date.now() - 1000) // expired at the guard
      .mockReturnValueOnce(Date.now() + 60 * 60 * 1000); // fresh after refresh
    auth.getToken
      .mockResolvedValueOnce('paseto-stale') // initial read
      .mockResolvedValueOnce('paseto-fresh'); // post-refresh read
    auth.refreshDeduped.mockResolvedValue(true);

    await ensureSeededDefaults();

    expect(auth.refreshDeduped).toHaveBeenCalledTimes(1);
    expect(ensureKey).toHaveBeenCalledTimes(1);
    expect(r.updateAccount).toHaveBeenCalledWith('acct-1', {
      base_url: CLOUD_HOSTS.inference,
    });
  });

  it('skips the flow when an expired token is rejected (terminal)', async () => {
    engineSeededInstall();
    auth.getTokenExpiresAt.mockReturnValue(Date.now() - 1000);
    auth.refreshDeduped.mockResolvedValue(false);

    await ensureSeededDefaults();

    expect(auth.refreshDeduped).toHaveBeenCalledTimes(1);
    expect(ensureKey).not.toHaveBeenCalled();
    expect(r.updateAccount).not.toHaveBeenCalled();
    expect(r.createAccount).not.toHaveBeenCalled();
  });

  it('skips the flow on a transient refresh failure and never throws', async () => {
    engineSeededInstall();
    auth.getTokenExpiresAt.mockReturnValue(Date.now() - 1000);
    auth.refreshDeduped.mockRejectedValue(new Error('network'));

    await expect(ensureSeededDefaults()).resolves.toBeUndefined();

    expect(ensureKey).not.toHaveBeenCalled();
    expect(r.updateAccount).not.toHaveBeenCalled();
    expect(r.listAccounts).not.toHaveBeenCalled();
  });

  it('skips the flow when the refreshed token is itself expired', async () => {
    engineSeededInstall();
    auth.getTokenExpiresAt
      .mockReturnValueOnce(Date.now() - 1000) // expired at the guard
      .mockReturnValueOnce(Date.now() - 500); // still expired after refresh
    auth.refreshDeduped.mockResolvedValue(true);

    await ensureSeededDefaults();

    expect(ensureKey).not.toHaveBeenCalled();
    expect(r.updateAccount).not.toHaveBeenCalled();
  });

  it('does not run with an expired token even when carried by the auth:changed event', async () => {
    engineSeededInstall();
    auth.getTokenExpiresAt.mockReturnValue(Date.now() - 1000);
    auth.refreshDeduped.mockResolvedValue(false);

    await ensureSeededDefaults('paseto-event');

    expect(ensureKey).not.toHaveBeenCalled();
    expect(r.updateAccount).not.toHaveBeenCalled();
  });
});

// ── Fresh install (engine-seeded) no-op ─────────────────────────────────────

describe('ensureSeededDefaults — fresh install (engine-init configs present)', () => {
  it('ensures the credential, leaves configs untouched, and no-ops gap-fill', async () => {
    engineSeededInstall();

    await ensureSeededDefaults('paseto-1');

    expect(ensureKey).toHaveBeenCalledTimes(1);
    expect(r.updateAccount).toHaveBeenCalledTimes(1);
    expect(r.createBackendConfig).not.toHaveBeenCalled();
    expect(r.createCognitionConfig).not.toHaveBeenCalled();
    expect(r.createMovementConfig).not.toHaveBeenCalled();
    expect(r.createRAGConfig).not.toHaveBeenCalled();
    expect(r.createTTSConfig).not.toHaveBeenCalled();
    expect(r.createVisionConfig).not.toHaveBeenCalled();
    expect(r.createSTTConfig).not.toHaveBeenCalled();
    // Nothing missing → no gateway discovery call.
    expect(engine.listProviderModels).not.toHaveBeenCalled();
    // The scan completed → guard persisted.
    expect(mockedSetItem).toHaveBeenCalledWith('seeding_done_v1:acct-1', '1');
  });
});

// ── Gap-fill ────────────────────────────────────────────────────────────────

describe('ensureSeededDefaults — gap-fill', () => {
  it('recreates a deleted single-provider module config', async () => {
    engineSeededInstall();
    r.getAllBackendConfigs.mockResolvedValue([]);
    engine.listProviderModels.mockResolvedValue({
      models: [
        { id: 'pro-llm', meta: { model_type: 'llm', min_tier: 'core' } },
        { id: 'qwen-35-9b', meta: { model_type: 'llm', min_tier: 'free' } },
      ],
    });

    await ensureSeededDefaults('paseto-1');

    expect(r.createBackendConfig).toHaveBeenCalledTimes(1);
    const arg = r.createBackendConfig.mock.calls[0][0];
    expect(arg.name).toBe('Soulbits Cloud (default)');
    expect(arg.provider).toBe('soulbitscloud');
    expect(arg.provider_account_id).toBe('acct-1');
    expect(capModel(arg.capability_json)).toBe('qwen-35-9b');
    expect(r.createCognitionConfig).not.toHaveBeenCalled();
  });

  it('prefers the free-tier model from meta', async () => {
    engineSeededInstall();
    r.getAllBackendConfigs.mockResolvedValue([]);
    engine.listProviderModels.mockResolvedValue({
      models: [
        { id: 'paid-llm', meta: { model_type: 'llm', min_tier: 'core' } },
        { id: 'free-llm', meta: { model_type: 'llm', min_tier: 'free' } },
      ],
    });

    await ensureSeededDefaults('paseto-1');

    expect(capModel(r.createBackendConfig.mock.calls[0][0].capability_json)).toBe('free-llm');
  });

  it('falls back to SOULBITS_FALLBACK_MODELS when the gateway returns nothing', async () => {
    engineSeededInstall();
    r.getAllBackendConfigs.mockResolvedValue([]);
    engine.listProviderModels.mockResolvedValue({ models: [], error: 'unreachable' });

    await ensureSeededDefaults('paseto-1');

    expect(capModel(r.createBackendConfig.mock.calls[0][0].capability_json)).toBe('qwen-35-9b');
  });

  it('seeds VAD independently when only the VAD slot is missing', async () => {
    engineSeededInstall();
    r.getAllSTTConfigs.mockResolvedValue([
      sttConfig({ vad_provider: '', vad_provider_account_id: null, vad_capability_json: '{}' }),
    ]);
    engine.listProviderModels.mockResolvedValue({
      models: [
        { id: 'faster-whisper-tiny', meta: { model_type: 'stt', min_tier: 'free' } },
        { id: 'silero-vad', meta: { model_type: 'vad', min_tier: 'free' } },
      ],
    });

    await ensureSeededDefaults('paseto-1');

    expect(r.createSTTConfig).toHaveBeenCalledTimes(1);
    const arg = r.createSTTConfig.mock.calls[0][0];
    expect(arg.vad_provider).toBe('soulbitscloud');
    expect(arg.vad_provider_account_id).toBe('acct-1');
    expect(capModel(arg.vad_capability_json)).toBe('silero-vad');
    // The transcription slot is filled too (a whole config is created).
    expect(arg.transcription_provider).toBe('soulbitscloud');
    expect(capModel(arg.transcription_capability_json)).toBe('faster-whisper-tiny');
  });

  it('seeds transcription independently when only the transcription slot is missing', async () => {
    engineSeededInstall();
    r.getAllSTTConfigs.mockResolvedValue([
      sttConfig({ transcription_provider: '', transcription_provider_account_id: null }),
    ]);

    await ensureSeededDefaults('paseto-1');

    expect(r.createSTTConfig).toHaveBeenCalledTimes(1);
    expect(r.createSTTConfig.mock.calls[0][0].transcription_provider).toBe('soulbitscloud');
  });

  it('recreates a deleted STT config with both slots (VAD = silero-vad)', async () => {
    engineSeededInstall();
    r.getAllSTTConfigs.mockResolvedValue([]);

    await ensureSeededDefaults('paseto-1');

    expect(r.createSTTConfig).toHaveBeenCalledTimes(1);
    const arg = r.createSTTConfig.mock.calls[0][0];
    expect(capModel(arg.transcription_capability_json)).toBe('faster-whisper-tiny');
    expect(capModel(arg.vad_capability_json)).toBe('silero-vad');
  });

  it('never overwrites an existing config (no create for a covered type)', async () => {
    engineSeededInstall();

    await ensureSeededDefaults('paseto-1');

    expect(r.createBackendConfig).not.toHaveBeenCalled();
    expect(r.createSTTConfig).not.toHaveBeenCalled();
  });
});

// ── Guard / account change ──────────────────────────────────────────────────

describe('ensureSeededDefaults — persisted guard', () => {
  it('does not re-run the gap-fill scan when the guard is present', async () => {
    engineSeededInstall();
    r.getAllBackendConfigs.mockResolvedValue([]);
    mockStorage({ 'seeding_done_v1:acct-1': '1' });

    await ensureSeededDefaults('paseto-1');

    expect(r.createBackendConfig).not.toHaveBeenCalled();
    expect(engine.listProviderModels).not.toHaveBeenCalled();
  });

  it('re-runs the gap-fill for a changed account', async () => {
    r.listAccounts.mockResolvedValue([account({ id: 'acct-new' })]);
    engineSeededInstall();
    r.getAllBackendConfigs.mockResolvedValue([]);
    mockStorage({ 'seeding_done_v1:acct-old': '1' });

    await ensureSeededDefaults('paseto-1');

    expect(r.updateAccount).toHaveBeenCalledWith('acct-new', {
      base_url: CLOUD_HOSTS.inference,
    });
    expect(r.createBackendConfig).toHaveBeenCalledTimes(1);
    expect(mockedSetItem).toHaveBeenCalledWith('seeding_done_v1:acct-new', '1');
  });
});

// ── Engine readiness deferral (cold-start boot race) ────────────────────────

describe('ensureSeededDefaults — engine readiness deferral', () => {
  it('defers the bootstrap ensure until the engine connects, then re-runs the full flow', async () => {
    const listeners = captureEngineListeners();
    engineConnection.getEngineConnection.mockReturnValue(null);
    r.listAccounts.mockRejectedValueOnce(new Error(NOT_CONNECTED));

    const stop = startSeedingEnsure();
    await flush();

    // Attempted once, dropped nothing: the retry is armed on readiness.
    expect(r.listAccounts).toHaveBeenCalledTimes(1);
    expect(r.updateAccount).not.toHaveBeenCalled();
    expect(engineConnection.onEngineConnectionChange).toHaveBeenCalledTimes(1);

    // Engine management API is up → re-run the FULL flow (paseto-less).
    engineConnection.getEngineConnection.mockReturnValue(CONN);
    listeners.forEach(listener => listener(CONN));
    await flush();

    expect(r.listAccounts).toHaveBeenCalledTimes(2);
    expect(r.updateAccount).toHaveBeenCalledWith('acct-1', {
      base_url: CLOUD_HOSTS.inference,
    });
    stop();
  });

  it('absorbs a second failure during the same race (one armed retry)', async () => {
    const listeners = captureEngineListeners();
    engineConnection.getEngineConnection.mockReturnValue(null);
    r.listAccounts
      .mockRejectedValueOnce(new Error(NOT_CONNECTED))
      .mockRejectedValueOnce(new Error(NOT_CONNECTED));

    const stop = startSeedingEnsure();
    await flush();

    // A token renewal lands while the retry is armed → fails the same way.
    const handler = auth.on.mock.calls[0][1] as (paseto: string) => void;
    handler('paseto-renewed');
    await flush();

    expect(r.listAccounts).toHaveBeenCalledTimes(2);
    // Still ONE armed subscription — the newer failure replaced the task.
    expect(engineConnection.onEngineConnectionChange).toHaveBeenCalledTimes(1);

    engineConnection.getEngineConnection.mockReturnValue(CONN);
    listeners.forEach(listener => listener(CONN));
    await flush();

    expect(r.listAccounts).toHaveBeenCalledTimes(3);
    expect(r.updateAccount).toHaveBeenCalledWith('acct-1', {
      base_url: CLOUD_HOSTS.inference,
    });
    stop();
  });

  it('logs (never defers) a not-connected failure against a LIVE engine', async () => {
    const listeners = captureEngineListeners();
    engineConnection.getEngineConnection.mockReturnValue(CONN);
    r.listAccounts.mockRejectedValueOnce(new Error(NOT_CONNECTED));

    const stop = startSeedingEnsure();
    await flush();

    expect(r.listAccounts).toHaveBeenCalledTimes(1);
    expect(engineConnection.onEngineConnectionChange).not.toHaveBeenCalled();

    // A later connection event must not trigger a surprise retry.
    listeners.forEach(listener => listener(CONN));
    await flush();
    expect(r.listAccounts).toHaveBeenCalledTimes(1);
    stop();
  });
});

// ── Trigger wiring ──────────────────────────────────────────────────────────

describe('startSeedingEnsure', () => {
  it('subscribes to auth:changed, runs the bootstrap ensure, and stops', async () => {
    engineSeededInstall();
    auth.getToken.mockResolvedValue('paseto-boot');

    const stop = startSeedingEnsure();

    expect(auth.on).toHaveBeenCalledWith('auth:changed', expect.any(Function));

    // Bootstrap path — a cold start already signed in (no event).
    await flush();
    expect(ensureKey).toHaveBeenCalledTimes(1);
    expect(r.updateAccount).toHaveBeenCalledWith('acct-1', {
      base_url: CLOUD_HOSTS.inference,
    });

    // Re-auth / token renewal path.
    const handler = auth.on.mock.calls[0][1] as (paseto: string) => void;
    handler('paseto-refreshed');
    await flush();
    expect(ensureKey).toHaveBeenCalledTimes(2);
    expect(r.updateAccount).toHaveBeenCalledTimes(2);

    stop();
    expect(auth.off).toHaveBeenCalledWith('auth:changed', handler);
  });
});
