/**
 * EngineApiClient — preset CRUD + voice config / direct TTS endpoints
 * (Phase 2-1 / 3-5).
 */

import { EngineApiClient } from '../EngineApiClient';
import type { EngineConnection } from '../EngineService';
import { createMockManagementServer } from './mockManagementServer';

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

describe('sampling-preset CRUD', () => {
  it('savePreset POSTs {name, content} to /api/presets', async () => {
    const server = createMockManagementServer([
      { method: 'POST', path: '/api/presets', status: 201, json: { name: 'creative', status: 'created' } },
    ]);

    const res = await clientWith(server).savePreset('creative', 'temperature: 0.7\n');

    expect(res).toEqual({ name: 'creative', status: 'created' });
    const call = server.lastCall('POST', '/api/presets')!;
    expect(call.body).toEqual({ name: 'creative', content: 'temperature: 0.7\n' });
  });

  it('deletePreset DELETEs the encoded name', async () => {
    const server = createMockManagementServer([
      {
        method: 'DELETE',
        path: /\/api\/presets\/.*/,
        json: { name: 'my preset', status: 'deleted' },
      },
    ]);

    const res = await clientWith(server).deletePreset('my preset');

    expect(res).toEqual({ name: 'my preset', status: 'deleted' });
    expect(server.lastCall('DELETE', '/api/presets/my%20preset')).toBeTruthy();
  });
});

describe('voice configuration CRUD', () => {
  it('listVoiceConfigs normalizes an array response to {voices}', async () => {
    const server = createMockManagementServer([
      { method: 'GET', path: '/api/voices', json: [{ name: 'Narrator' }] },
    ]);

    const res = await clientWith(server).listVoiceConfigs();
    expect(res.voices).toEqual([{ name: 'Narrator' }]);
  });

  it('listVoiceConfigs passes through a {voices} envelope', async () => {
    const server = createMockManagementServer([
      { method: 'GET', path: '/api/voices', json: { voices: [{ name: 'Bella' }] } },
    ]);

    const res = await clientWith(server).listVoiceConfigs();
    expect(res.voices[0].name).toBe('Bella');
  });

  it('getVoiceConfig encodes the name', async () => {
    const server = createMockManagementServer([
      { method: 'GET', path: /\/api\/voices\/.*/, json: { name: 'My Voice', config: { pitch: 1.1 } } },
    ]);

    const res = await clientWith(server).getVoiceConfig('My Voice');
    expect(res.config).toEqual({ pitch: 1.1 });
    expect(server.lastCall('GET', '/api/voices/My%20Voice')).toBeTruthy();
  });

  it('createVoiceConfig POSTs {name, config}', async () => {
    const server = createMockManagementServer([
      { method: 'POST', path: '/api/voices', status: 201, json: { name: 'Narrator' } },
    ]);

    await clientWith(server).createVoiceConfig('Narrator', { pitch: 1.2 });
    const call = server.lastCall('POST', '/api/voices')!;
    expect(call.body).toEqual({ name: 'Narrator', config: { pitch: 1.2 } });
  });

  it('updateVoiceConfig PUTs {name, config} to the encoded name', async () => {
    const server = createMockManagementServer([
      { method: 'PUT', path: /\/api\/voices\/.*/, json: { name: 'Narrator' } },
    ]);

    await clientWith(server).updateVoiceConfig('Narrator', { speed: 1.1 });
    const call = server.lastCall('PUT', '/api/voices/Narrator')!;
    expect(call.body).toEqual({ name: 'Narrator', config: { speed: 1.1 } });
  });

  it('deleteVoiceConfig DELETEs the encoded name', async () => {
    const server = createMockManagementServer([
      { method: 'DELETE', path: /\/api\/voices\/.*/, json: { name: 'Narrator', status: 'deleted' } },
    ]);

    const res = await clientWith(server).deleteVoiceConfig('Narrator');
    expect(res.status).toBe('deleted');
    expect(server.lastCall('DELETE', '/api/voices/Narrator')).toBeTruthy();
  });
});

describe('direct TTS + ElevenLabs voice cloning/design', () => {
  it('embedSpeaker POSTs the payload', async () => {
    const server = createMockManagementServer([
      {
        method: 'POST',
        path: '/api/module-configs/tts/embed-speaker',
        json: { data: 'AAA=' },
      },
    ]);

    const res = await clientWith(server).embedSpeaker({
      provider: 'soulvoice',
      audio: 'AAAA',
    });
    expect(res.data).toBe('AAA=');
    expect(server.lastCall('POST', '/api/module-configs/tts/embed-speaker')?.body).toEqual({
      provider: 'soulvoice',
      audio: 'AAAA',
    });
  });

  it('testTtsSpeech POSTs the payload', async () => {
    const server = createMockManagementServer([
      {
        method: 'POST',
        path: '/api/module-configs/tts/test-speech',
        json: { audio: 'BBBB', format: 'mp3' },
      },
    ]);

    const res = await clientWith(server).testTtsSpeech({ text: 'hello' });
    expect(res.audio).toBe('BBBB');
    expect(server.lastCall('POST', '/api/module-configs/tts/test-speech')?.body).toEqual({
      text: 'hello',
    });
  });

  it('cloneElevenLabsVoice POSTs the payload', async () => {
    const server = createMockManagementServer([
      {
        method: 'POST',
        path: '/api/providers/elevenlabs/voices/clone',
        status: 201,
        json: { voice_id: 'voice-1' },
      },
    ]);

    const res = await clientWith(server).cloneElevenLabsVoice({
      name: 'Clone',
      audio_files: ['AAAA'],
      remove_background_noise: true,
    });
    expect(res.voice_id).toBe('voice-1');
    expect(
      server.lastCall('POST', '/api/providers/elevenlabs/voices/clone')?.body,
    ).toEqual({ name: 'Clone', audio_files: ['AAAA'], remove_background_noise: true });
  });

  it('designElevenLabsVoice POSTs the payload', async () => {
    const server = createMockManagementServer([
      {
        method: 'POST',
        path: '/api/providers/elevenlabs/voices/design',
        json: { voice_id: 'designed-1', previews: [] },
      },
    ]);

    const res = await clientWith(server).designElevenLabsVoice({
      voice_name: 'Warm Narrator',
      text: 'Speak warmly',
    });
    expect(res.voice_id).toBe('designed-1');
    expect(
      server.lastCall('POST', '/api/providers/elevenlabs/voices/design')?.body,
    ).toEqual({ voice_name: 'Warm Narrator', text: 'Speak warmly' });
  });
});
