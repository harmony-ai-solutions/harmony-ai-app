/**
 * moduleTestClient — STT/VAD engine module-test HTTP client (persona-modules 2-2).
 *
 * The engine HTTP access pattern: the app reaches Harmony Link (the engine)
 * only over WebSocket today (WSS `/events`, URL + JWT in AsyncStorage via
 * ConnectionStateManager). There is no pre-existing engine HTTP client for the
 * new management test endpoints, so this module introduces a minimal one that
 * derives the HTTP base URL from the stored WSS/WS URL (scheme swap + `/events`
 * strip) and authenticates with the stored JWT bearer.
 *
 * All HTTP is mocked here with contract-shaped fixtures — NO live engine.
 */

import {
  testStt,
  testTts,
  resolveEngineHttpBaseUrl,
  ModuleTestError,
} from '../moduleTestClient';

jest.mock('../../ConnectionStateManager', () => ({
  __esModule: true,
  default: {
    getWSSUrl: jest.fn(),
    getWSUrl: jest.fn(),
    getJWTToken: jest.fn(),
  },
}));

import ConnectionStateManager from '../../ConnectionStateManager';

const mockGetWSSUrl = (ConnectionStateManager.getWSSUrl as unknown) as jest.Mock;
const mockGetWSUrl = (ConnectionStateManager.getWSUrl as unknown) as jest.Mock;
const mockGetJWTToken = (ConnectionStateManager.getJWTToken as unknown) as jest.Mock;

const draftConfig = {
  provider_type: 'openai',
  provider_config_id: 42,
  module_config: {
    transcription_provider: 'openai',
    vad_provider: 'openai',
    main_stream_time_millis: 2000,
  },
};

let fetchMock: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockGetWSSUrl.mockResolvedValue('wss://engine.local:8081/events');
  mockGetJWTToken.mockReturnValue('jwt-token');
  fetchMock = jest.fn();
  (global as any).fetch = fetchMock;
});

afterEach(() => {
  delete (global as any).fetch;
});

describe('resolveEngineHttpBaseUrl', () => {
  it('derives https:// from a wss:// url and strips the /events path', async () => {
    mockGetWSSUrl.mockResolvedValue('wss://engine.local:8081/events');
    await expect(resolveEngineHttpBaseUrl()).resolves.toBe('https://engine.local:8081');
  });

  it('derives http:// from a ws:// url and strips the /events path', async () => {
    mockGetWSSUrl.mockResolvedValue(null);
    mockGetWSUrl.mockResolvedValue('ws://engine.local:8080/events');
    await expect(resolveEngineHttpBaseUrl()).resolves.toBe('http://engine.local:8080');
  });

  it('returns null when no engine url is configured', async () => {
    mockGetWSSUrl.mockResolvedValue(null);
    mockGetWSUrl.mockResolvedValue(null);
    await expect(resolveEngineHttpBaseUrl()).resolves.toBeNull();
  });
});

describe('testStt — contract-shaped HTTP', () => {
  it('POSTs to /modules/test/stt and returns the typed transcript + VAD segments', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        transcript: 'hello world',
        vad_segments: [{ start_ms: 0, end_ms: 1200 }],
        duration_ms: 2100,
      }),
    });

    const result = await testStt(draftConfig, 'QUJDRA==', 'audio/wav');

    expect(result).toEqual({
      transcript: 'hello world',
      vad_segments: [{ start_ms: 0, end_ms: 1200 }],
      duration_ms: 2100,
    });

    // Correct URL, method, headers + body.
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://engine.local:8081/modules/test/stt');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer jwt-token');
    const body = JSON.parse(init.body);
    expect(body.provider_type).toBe('openai');
    expect(body.provider_config_id).toBe(42);
    expect(body.audio_base64).toBe('QUJDRA==');
    expect(body.mime_type).toBe('audio/wav');
  });

  it('passes an empty vad_segments array through (provider does not report segments)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ transcript: 'hi', vad_segments: [], duration_ms: 500 }),
    });

    const result = await testStt(draftConfig, 'QUJDRA==', 'audio/wav');
    expect(result.vad_segments).toEqual([]);
    expect(result.transcript).toBe('hi');
  });

  it('throws the engine error message on a 4xx { error } response', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'undecodable audio' }),
    });

    await expect(testStt(draftConfig, 'QUJDRA==', 'audio/wav')).rejects.toThrow(
      /undecodable audio/,
    );
  });

  it('throws a ModuleTestError when the engine is unreachable (no base url)', async () => {
    mockGetWSSUrl.mockResolvedValue(null);
    mockGetWSUrl.mockResolvedValue(null);

    await expect(testStt(draftConfig, 'QUJDRA==', 'audio/wav')).rejects.toBeInstanceOf(
      ModuleTestError,
    );
  });
});

describe('testTts — contract-shaped HTTP', () => {
  it('POSTs to /modules/test/tts and returns the synthesized audio', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ audio_base64: 'QUJDRA==', mime_type: 'audio/mpeg' }),
    });

    const result = await testTts(draftConfig, 'Hello, this is a test.');

    expect(result).toEqual({ audio_base64: 'QUJDRA==', mime_type: 'audio/mpeg' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://engine.local:8081/modules/test/tts');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer jwt-token');
    const body = JSON.parse(init.body);
    expect(body.provider_type).toBe('openai');
    expect(body.provider_config_id).toBe(42);
    expect(body.text).toBe('Hello, this is a test.');
  });

  it('throws the engine error message on a 4xx { error } response', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'unknown provider_type' }),
    });

    await expect(testTts(draftConfig, 'Hello')).rejects.toThrow(/unknown provider_type/);
  });

  it('throws a ModuleTestError when the engine is unreachable (no base url)', async () => {
    mockGetWSSUrl.mockResolvedValue(null);
    mockGetWSUrl.mockResolvedValue(null);

    await expect(testTts(draftConfig, 'Hello')).rejects.toBeInstanceOf(ModuleTestError);
  });
});
