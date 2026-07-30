import {
  SOULBITS_MODEL_QUERY,
  SOULBITS_FALLBACK_MODELS,
  getModelsQueryForModule,
  getFallbackModelsForModule,
} from '../soulbitsModels';

describe('SOULBITS_MODEL_QUERY', () => {
  it('maps text-LLM modules to model_type llm', () => {
    for (const m of ['backend', 'cognition', 'movement']) {
      expect(SOULBITS_MODEL_QUERY[m]).toEqual({ model_type: 'llm' });
    }
  });

  it('maps rag to embeddings', () => {
    expect(SOULBITS_MODEL_QUERY.rag).toEqual({ model_type: 'embeddings' });
  });

  it('maps tts and stt to their model types', () => {
    expect(SOULBITS_MODEL_QUERY.tts).toEqual({ model_type: 'tts' });
    expect(SOULBITS_MODEL_QUERY.stt).toEqual({ model_type: 'stt' });
  });

  it('maps vision by input modality and imagination by output modality', () => {
    expect(SOULBITS_MODEL_QUERY.vision).toEqual({ input_modalities: ['image'] });
    expect(SOULBITS_MODEL_QUERY.imagination).toEqual({
      output_modalities: ['image'],
    });
  });

  it('covers every app module type', () => {
    const moduleIds = [
      'backend',
      'cognition',
      'movement',
      'rag',
      'tts',
      'stt',
      'vision',
      'imagination',
    ];
    for (const id of moduleIds) {
      expect(SOULBITS_MODEL_QUERY[id]).toBeDefined();
    }
  });
});

describe('SOULBITS_FALLBACK_MODELS', () => {
  it('provides a fallback array for every module type', () => {
    const moduleIds = [
      'backend',
      'cognition',
      'movement',
      'rag',
      'tts',
      'stt',
      'vision',
      'imagination',
    ];
    for (const id of moduleIds) {
      expect(Array.isArray(SOULBITS_FALLBACK_MODELS[id])).toBe(true);
    }
  });

  it('seeds the LLM fallback with soulchat-v1', () => {
    expect(SOULBITS_FALLBACK_MODELS.backend).toContain('soulchat-v1');
  });
});

describe('getModelsQueryForModule', () => {
  it('returns the query for a known module type', () => {
    expect(getModelsQueryForModule('backend')).toEqual({ model_type: 'llm' });
  });

  it('returns undefined for an unknown module type', () => {
    expect(getModelsQueryForModule('does-not-exist')).toBeUndefined();
  });
});

describe('getFallbackModelsForModule', () => {
  it('returns the fallback list for a known module type', () => {
    expect(getFallbackModelsForModule('stt')).toEqual(['whisper']);
  });

  it('returns an empty array for an unknown module type', () => {
    expect(getFallbackModelsForModule('nope')).toEqual([]);
  });
});
