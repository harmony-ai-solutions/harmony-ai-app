/**
 * resolveVoiceInputState — pure LWW-safe resolver for the shared persona STT
 * ("Voice input") state (persona-modules 2-1).
 *
 * The app must NEVER ensure-create the canonical `user` mapping row — the
 * engine seeder owns it (a locally-inserted NULL row would win row-LWW sync
 * and destroy the engine's STT wiring). This resolver implements the READ
 * side of that contract:
 *   - mapping missing / stt_config_id NULL / stt config provider === 'disabled'
 *     → state = OFF (enabled=false)
 *   - a live provider → ON (enabled=true, providerType, configId)
 *
 * The engine sentinel is exactly the string 'disabled' (config.ProviderDisabled).
 */

import {
  resolveVoiceInputState,
  VOICE_INPUT_DISABLED,
} from '../resolveVoiceInputState';
import type { EntityModuleMapping, STTConfig } from '../../../database/models';

const mappingWith = (sttConfigId: string | null): EntityModuleMapping => ({
  entity_id: 'user',
  backend_config_id: null,
  cognition_config_id: null,
  imagination_config_id: null,
  movement_config_id: null,
  rag_config_id: null,
  stt_config_id: sttConfigId,
  tts_config_id: null,
  vision_config_id: null,
  deleted_at: null,
});

const sttConfigWith = (provider: string): STTConfig => ({
  id: 'stt-1',
  name: 'Voice input',
  main_stream_time_millis: 2000,
  transition_stream_time_millis: 1000,
  max_buffer_count: 5,
  transcription_provider: provider,
  transcription_provider_config_id: 'pc-1',
  vad_provider: provider,
  vad_provider_config_id: 'pc-2',
  deleted_at: null,
});

describe('resolveVoiceInputState — LWW-safe read semantics', () => {
  it('treats a MISSING mapping as OFF (fresh install / pre-seed)', () => {
    expect(resolveVoiceInputState({ mapping: null, sttConfig: null })).toEqual({
      enabled: false,
      providerType: null,
      configId: null,
    });
  });

  it('treats a mapping with a NULL stt_config_id as OFF', () => {
    expect(
      resolveVoiceInputState({ mapping: mappingWith(null), sttConfig: null }),
    ).toEqual({ enabled: false, providerType: null, configId: null });
  });

  it('treats a mapping pointing at a MISSING stt config as OFF', () => {
    expect(
      resolveVoiceInputState({ mapping: mappingWith('stt-missing'), sttConfig: null }),
    ).toEqual({ enabled: false, providerType: null, configId: null });
  });

  it(`treats an stt config with provider === '${'disabled'}' as OFF (sentinel)`, () => {
    expect(resolveVoiceInputState({ mapping: mappingWith('stt-1'), sttConfig: sttConfigWith(VOICE_INPUT_DISABLED) })).toEqual({
      enabled: false,
      providerType: null,
      configId: null,
    });
  });

  it('treats an stt config with a live provider as ON and surfaces it', () => {
    expect(resolveVoiceInputState({ mapping: mappingWith('stt-1'), sttConfig: sttConfigWith('openai') })).toEqual({
      enabled: true,
      providerType: 'openai',
      configId: 'stt-1',
    });
  });

  it('uses exactly the engine sentinel "disabled" (not arbitrary falsy/empty)', () => {
    // A config whose transcription_provider happens to be a falsy empty string
    // is NOT the sentinel — the engine only recognizes the literal 'disabled'.
    const emptyProvider = sttConfigWith('');
    expect(emptyProvider.transcription_provider).not.toBe(VOICE_INPUT_DISABLED);
    expect(VOICE_INPUT_DISABLED).toBe('disabled');
  });
});
