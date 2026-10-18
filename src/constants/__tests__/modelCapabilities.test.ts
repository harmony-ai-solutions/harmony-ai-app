/**
 * modelCapabilities — pure helpers over the engine's ModelInfo (provider-registry
 * 6-3): offline catalog module filtering + the R12 param-support warnings.
 */

import {
  MODULE_CAPABILITY_TAGS,
  catalogModelsForModule,
  isSamplingParamKey,
  isParamSupported,
  supportedParams,
  findModel,
} from '../modelCapabilities';
import type { ModelInfoDto } from '../../services/engine/EngineApiClient';

const chat: ModelInfoDto = { id: 'chat-1', capabilities: ['chat'] };
const embed: ModelInfoDto = { id: 'embed-1', capabilities: ['embedding'] };
const unknown: ModelInfoDto = { id: 'unknown-1' };
const noTemp: ModelInfoDto = { id: 'notemp-1', capabilities: ['chat'], param_support: ['top_p'] };

describe('catalogModelsForModule', () => {
  const models = [chat, embed, unknown];

  it('keeps models carrying the module tag and models with no declared tags', () => {
    const ids = catalogModelsForModule(models, 'backend').map((m) => m.id);
    expect(ids).toContain('chat-1');
    expect(ids).toContain('unknown-1');
    expect(ids).not.toContain('embed-1');
  });

  it('maps rag → embedding', () => {
    expect(MODULE_CAPABILITY_TAGS.rag).toBe('embedding');
    expect(catalogModelsForModule(models, 'rag').map((m) => m.id)).toContain('embed-1');
  });

  it('returns [] for an unknown module (the STT VAD slot is live-only)', () => {
    expect(catalogModelsForModule(models, 'vad')).toEqual([]);
  });

  it('handles a null/undefined list', () => {
    expect(catalogModelsForModule(null, 'backend')).toEqual([]);
    expect(catalogModelsForModule(undefined, 'backend')).toEqual([]);
  });
});

describe('param support (R12 warnings)', () => {
  it('classifies the sampling-param keys', () => {
    expect(isSamplingParamKey('temperature')).toBe(true);
    expect(isSamplingParamKey('top_p')).toBe(true);
    expect(isSamplingParamKey('model')).toBe(false);
    expect(isSamplingParamKey('voice_id')).toBe(false);
  });

  it('returns null (no warning) when the model declares no param set', () => {
    expect(supportedParams(unknown)).toBeNull();
    expect(isParamSupported(unknown, 'temperature')).toBeNull();
    expect(isParamSupported(undefined, 'temperature')).toBeNull();
  });

  it('warns only when a declared set omits the param', () => {
    expect(isParamSupported(noTemp, 'top_p')).toBe(true);
    expect(isParamSupported(noTemp, 'temperature')).toBe(false);
  });
});

describe('findModel', () => {
  it('finds by id and tolerates a null id', () => {
    expect(findModel([chat, embed], 'embed-1')?.id).toBe('embed-1');
    expect(findModel([chat], null)).toBeUndefined();
    expect(findModel(null, 'chat-1')).toBeUndefined();
  });
});
