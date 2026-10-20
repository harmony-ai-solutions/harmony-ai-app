/**
 * personaVoice — LWW-safe voice-input helper contract.
 *
 * Pins the CRITICAL rule from the retired VoiceInputSettingsScreen: the app
 * NEVER ensure-creates a NULL/empty `user` mapping row. OFF is a read state
 * (missing mapping / NULL id / 'disabled'); writes happen only on the explicit
 * ensure call and always link a REAL stt_config_id.
 */

import {
  createOrUpdateEntityModuleMapping,
  createSTTConfig,
  getEntity,
  getEntityModuleMapping,
  getSTTConfig,
  getSTTConfigByName,
  updateSTTConfig,
} from '../../../database/repositories';
import {
  disablePersonaVoice,
  ensurePersonaVoiceConfig,
  PersonaVoiceUnavailableError,
  resolvePersonaVoice,
} from '../personaVoice';

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('../../../database/repositories', () => ({
  getEntity: jest.fn(),
  getEntityModuleMapping: jest.fn(),
  createOrUpdateEntityModuleMapping: jest.fn(),
  createSTTConfig: jest.fn(),
  getSTTConfig: jest.fn(),
  getSTTConfigByName: jest.fn(),
  updateSTTConfig: jest.fn(),
}));

const mockGetEntity = getEntity as jest.Mock;
const mockGetMapping = getEntityModuleMapping as jest.Mock;
const mockCreateOrUpdateMapping = createOrUpdateEntityModuleMapping as jest.Mock;
const mockCreateSttConfig = createSTTConfig as jest.Mock;
const mockGetSttConfig = getSTTConfig as jest.Mock;
const mockGetSttConfigByName = getSTTConfigByName as jest.Mock;
const mockUpdateSttConfig = updateSTTConfig as jest.Mock;

const USER = {
  id: 'user',
  alias: 'You',
  character_profile_id: null,
  lifecycle_config: null,
  rag_reindex_required: 0,
  entity_type: 'user',
  created_at: new Date(),
  updated_at: new Date(),
  deleted_at: null,
};

const mapping = (over: Record<string, unknown> = {}) => ({
  entity_id: 'user',
  backend_config_id: null,
  cognition_config_id: null,
  imagination_config_id: null,
  movement_config_id: null,
  rag_config_id: null,
  stt_config_id: 'stt-1',
  tts_config_id: null,
  vision_config_id: null,
  deleted_at: null,
  ...over,
});

const sttConfig = (over: Record<string, unknown> = {}) => ({
  id: 'stt-1',
  name: 'Voice input',
  main_stream_time_millis: 2000,
  transition_stream_time_millis: 1000,
  max_buffer_count: 5,
  transcription_provider: 'openai',
  transcription_provider_account_id: 'pc-1',
  transcription_capability_json: JSON.stringify({ model: 'faster-whisper-tiny' }),
  vad_provider: 'openai',
  vad_provider_account_id: 'pc-2',
  vad_capability_json: '{}',
  deleted_at: null,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGetEntity.mockResolvedValue(USER);
  mockGetMapping.mockResolvedValue(mapping());
  mockGetSttConfig.mockResolvedValue(sttConfig());
  mockGetSttConfigByName.mockResolvedValue(null);
  mockCreateSttConfig.mockResolvedValue('stt-new');
  mockCreateOrUpdateMapping.mockResolvedValue(undefined);
  mockUpdateSttConfig.mockResolvedValue(undefined);
});

describe('resolvePersonaVoice — READ-only OFF semantics', () => {
  it('is OFF when the user mapping row is missing, and never writes', async () => {
    mockGetMapping.mockResolvedValue(null);

    await expect(resolvePersonaVoice()).resolves.toEqual({ status: 'off' });

    expect(mockCreateOrUpdateMapping).not.toHaveBeenCalled();
    expect(mockCreateSttConfig).not.toHaveBeenCalled();
    expect(mockUpdateSttConfig).not.toHaveBeenCalled();
  });

  it('is OFF when stt_config_id is NULL', async () => {
    mockGetMapping.mockResolvedValue(mapping({ stt_config_id: null }));

    await expect(resolvePersonaVoice()).resolves.toEqual({ status: 'off' });
    expect(mockGetSttConfig).not.toHaveBeenCalled();
  });

  it('is OFF when the config carries the engine "disabled" sentinel', async () => {
    mockGetSttConfig.mockResolvedValue(
      sttConfig({ transcription_provider: 'disabled', vad_provider: 'disabled' }),
    );

    await expect(resolvePersonaVoice()).resolves.toEqual({
      status: 'off',
      configId: 'stt-1',
    });
  });

  it('is OFF when the linked config id is dangling', async () => {
    mockGetSttConfig.mockResolvedValue(null);

    await expect(resolvePersonaVoice()).resolves.toEqual({ status: 'off' });
  });

  it('is ON with a compact model label for a live provider', async () => {
    await expect(resolvePersonaVoice()).resolves.toEqual({
      status: 'ok',
      configId: 'stt-1',
      providerType: 'openai',
      modelLabel: 'FasterWhisper',
    });
  });

  it('degrades to OFF when the data layer throws (engine unavailable)', async () => {
    mockGetEntity.mockRejectedValue(new Error('offline'));

    await expect(resolvePersonaVoice()).resolves.toEqual({ status: 'off' });
  });
});

describe('ensurePersonaVoiceConfig — deliberate ensure/link only', () => {
  it('creates the fixed config + links a REAL id when no mapping exists', async () => {
    mockGetMapping.mockResolvedValue(null);

    const result = await ensurePersonaVoiceConfig();

    expect(result).toEqual({ configId: 'stt-new', created: true });
    expect(mockCreateSttConfig).toHaveBeenCalledTimes(1);
    const created = mockCreateSttConfig.mock.calls[0][0];
    expect(created.name).toBe('Persona voice input');
    expect(created.transcription_provider).toBe('disabled');
    expect(created.vad_provider).toBe('disabled');

    expect(mockCreateOrUpdateMapping).toHaveBeenCalledTimes(1);
    const written = mockCreateOrUpdateMapping.mock.calls[0][0];
    expect(written.entity_id).toBe('user');
    expect(written.stt_config_id).toBe('stt-new');
    // The LWW hazard: a NULL link is never written.
    expect(written.stt_config_id).not.toBeNull();
    expect(written.backend_config_id).toBeNull();
  });

  it('reuses a live linked config without any write', async () => {
    const result = await ensurePersonaVoiceConfig();

    expect(result).toEqual({ configId: 'stt-1', created: false });
    expect(mockCreateSttConfig).not.toHaveBeenCalled();
    expect(mockCreateOrUpdateMapping).not.toHaveBeenCalled();
  });

  it('reuses a disabled-sentinel config (switching back on needs no new row)', async () => {
    mockGetSttConfig.mockResolvedValue(
      sttConfig({ transcription_provider: 'disabled', vad_provider: 'disabled' }),
    );

    const result = await ensurePersonaVoiceConfig();

    expect(result).toEqual({ configId: 'stt-1', created: false });
    expect(mockCreateSttConfig).not.toHaveBeenCalled();
    expect(mockCreateOrUpdateMapping).not.toHaveBeenCalled();
  });

  it('repairs a dangling link, preserving every other mapping slot', async () => {
    mockGetMapping.mockResolvedValue(
      mapping({ stt_config_id: 'gone', backend_config_id: 'b-1', tts_config_id: 't-1' }),
    );
    mockGetSttConfig.mockResolvedValue(null);

    const result = await ensurePersonaVoiceConfig();

    expect(result).toEqual({ configId: 'stt-new', created: true });
    expect(mockCreateSttConfig).toHaveBeenCalledTimes(1);

    const written = mockCreateOrUpdateMapping.mock.calls[0][0];
    expect(written.stt_config_id).toBe('stt-new');
    expect(written.backend_config_id).toBe('b-1');
    expect(written.tts_config_id).toBe('t-1');
    expect(written.stt_config_id).not.toBeNull();
  });

  it('reuses an orphaned fixed config instead of creating a duplicate', async () => {
    mockGetMapping.mockResolvedValue(null);
    mockGetSttConfigByName.mockResolvedValue(
      sttConfig({ id: 'stt-fixed', name: 'Persona voice input', transcription_provider: 'disabled' }),
    );

    const result = await ensurePersonaVoiceConfig();

    expect(result).toEqual({ configId: 'stt-fixed', created: false });
    expect(mockCreateSttConfig).not.toHaveBeenCalled();
    expect(mockCreateOrUpdateMapping).toHaveBeenCalledTimes(1);
    expect(mockCreateOrUpdateMapping.mock.calls[0][0].stt_config_id).toBe('stt-fixed');
  });

  it('refuses to write anything before the canonical user entity exists', async () => {
    mockGetEntity.mockResolvedValue(null);

    await expect(ensurePersonaVoiceConfig()).rejects.toBeInstanceOf(
      PersonaVoiceUnavailableError,
    );

    expect(mockCreateOrUpdateMapping).not.toHaveBeenCalled();
    expect(mockCreateSttConfig).not.toHaveBeenCalled();
  });
});

describe('disablePersonaVoice — deliberate OFF write', () => {
  it('writes the engine disabled sentinel into both STT slots', async () => {
    await disablePersonaVoice('stt-1');

    expect(mockUpdateSttConfig).toHaveBeenCalledTimes(1);
    const updated = mockUpdateSttConfig.mock.calls[0][0];
    expect(updated.id).toBe('stt-1');
    expect(updated.transcription_provider).toBe('disabled');
    expect(updated.vad_provider).toBe('disabled');
  });

  it('does nothing when the config vanished', async () => {
    mockGetSttConfig.mockResolvedValue(null);

    await disablePersonaVoice('gone');

    expect(mockUpdateSttConfig).not.toHaveBeenCalled();
  });
});
