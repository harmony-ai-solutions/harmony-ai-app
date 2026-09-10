import {
  SIMPLE_FIELD_KEYS,
  isSimpleFieldKey,
  isManagedCloudField,
} from '../moduleConfigVisibility';

describe('moduleConfigVisibility', () => {
  describe('isSimpleFieldKey', () => {
    it('returns true for essential provider fields', () => {
      for (const key of ['name', 'api_key', 'api_token', 'base_url', 'endpoint', 'model', 'model_id', 'voice_id', 'voice', 'speed', 'format']) {
        expect(isSimpleFieldKey(key)).toBe(true);
      }
    });

    it('returns false for deep technical fields', () => {
      for (const key of [
        'max_tokens',
        'temperature',
        'top_p',
        'frequency_penalty',
        'presence_penalty',
        'max_completion_tokens',
        'seed',
        'response_format',
        'stop_tokens',
        'reasoning_effort',
        'sampling_preset_name',
        'extra_params',
        'image_aspect_ratio',
        'image_size',
        'stability',
        'similarity_boost',
      ]) {
        expect(isSimpleFieldKey(key)).toBe(false);
      }
    });

    it('exposes the essential keys set (consistency guard)', () => {
      expect(SIMPLE_FIELD_KEYS.has('api_key')).toBe(true);
      expect(SIMPLE_FIELD_KEYS.has('base_url')).toBe(true);
    });
  });

  describe('isManagedCloudField', () => {
    it('hides the endpoint and credential fields for managed cloud providers', () => {
      for (const key of ['base_url', 'endpoint', 'api_key', 'api_token']) {
        expect(isManagedCloudField(key)).toBe(true);
      }
    });

    it('does not hide other fields', () => {
      for (const key of ['model', 'voice', 'temperature', 'max_tokens']) {
        expect(isManagedCloudField(key)).toBe(false);
      }
    });
  });
});
