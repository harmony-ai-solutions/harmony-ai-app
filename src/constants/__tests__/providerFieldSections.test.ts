import {
  CREDENTIAL_FIELD_KEYS,
  classifyProviderField,
} from '../providerFieldSections';

describe('providerFieldSections', () => {
  describe('classifyProviderField', () => {
    it('classifies account/endpoint fields as credentials', () => {
      for (const key of ['api_key', 'api_token', 'base_url', 'endpoint', 'username', 'password']) {
        expect(classifyProviderField(key)).toBe('credentials');
      }
    });

    it('classifies model/sampling/provider params as capability', () => {
      for (const key of [
        'model',
        'model_id',
        'sampling_preset_name',
        'temperature',
        'top_p',
        'max_tokens',
        'reasoning_effort',
        'voice',
        'voice_config_file',
        'workflow_profiles',
      ]) {
        expect(classifyProviderField(key)).toBe('capability');
      }
    });
  });

  it('exposes the credential key set (consistency guard)', () => {
    expect(CREDENTIAL_FIELD_KEYS.has('api_key')).toBe(true);
    expect(CREDENTIAL_FIELD_KEYS.has('model')).toBe(false);
  });
});
