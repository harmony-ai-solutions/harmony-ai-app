/**
 * accountFieldSchemas — account form schema + validation (provider-registry 6-2).
 *
 * Guards the plan §3.1 matrix: api_key required-ness per type, base_url
 * required/optional, the account extra set (org/project, team, auth,
 * comfyui_mode, auth_mode), managed soulbitscloud read-only, plus the
 * write-body split and the display mask.
 */

import {
  ACCOUNT_SCHEMAS,
  accountToFormValues,
  accountValuesToWriteDto,
  canonicalProviderKeys,
  capabilityOverlayOf,
  isAccountManaged,
  maskApiKey,
  validateAccount,
} from '../accountFieldSchemas';

const keysOf = (type: string) => ACCOUNT_SCHEMAS[type].fields.map(f => f.key);

describe('accountFieldSchemas — §3.1 matrix', () => {
  it('requires api_key for the key-based providers', () => {
    for (const type of [
      'openai',
      'anthropic',
      'google',
      'xai',
      'mistral',
      'openrouter',
      'elevenlabs',
      'opencodego',
    ]) {
      expect(validateAccount(type, { name: 'k' }).api_key).toBeTruthy();
    }
  });

  it('treats api_key as optional for self-hosted / compatible providers', () => {
    for (const type of ['openaicompatible', 'ollama', 'localai', 'comfyui', 'soulvoice']) {
      const errors = validateAccount(type, { name: 'k', base_url: 'http://x' });
      expect(errors.api_key).toBeUndefined();
    }
  });

  it('requires base_url where the matrix says so', () => {
    for (const type of ['openaicompatible', 'ollama', 'localai', 'comfyui', 'soulvoice']) {
      expect(validateAccount(type, { name: 'k' }).base_url).toBeTruthy();
    }
  });

  it('leaves base_url optional for the cloud/HTTP types that default it', () => {
    for (const type of ['openai', 'xai', 'mistral', 'openrouter', 'elevenlabs', 'opencodego']) {
      expect(validateAccount(type, { name: 'k', api_key: 'sk' }).base_url).toBeUndefined();
    }
  });

  it('requires a name for every non-managed type', () => {
    for (const type of Object.keys(ACCOUNT_SCHEMAS)) {
      if (isAccountManaged(type)) continue;
      expect(validateAccount(type, {}).name).toBeTruthy();
    }
  });

  it('never validates the system-managed soulbitscloud account', () => {
    expect(isAccountManaged('soulbitscloud')).toBe(true);
    expect(validateAccount('soulbitscloud', {})).toEqual({});
  });

  it('passes a complete account', () => {
    expect(validateAccount('openai', { name: 'Work', api_key: 'sk-123' })).toEqual({});
    expect(
      validateAccount('openaicompatible', { name: 'local', base_url: 'http://h:8080/v1' }),
    ).toEqual({});
  });

  it('flags an unknown provider type', () => {
    expect(validateAccount('does-not-exist', {}).name).toBeTruthy();
  });
});

describe('accountFieldSchemas — extras coverage (audit)', () => {
  it('carries the full account extra set', () => {
    expect(keysOf('openai')).toEqual(expect.arrayContaining(['org', 'project']));
    expect(keysOf('xai')).toContain('team');
    expect(keysOf('comfyui')).toEqual(expect.arrayContaining(['auth', 'comfyui_mode']));
    expect(keysOf('openaicompatible')).toContain('auth');
    expect(keysOf('soulbitscloud')).toContain('auth_mode');
  });

  it('carries no account extras for OpenCode Go (key + endpoint only)', () => {
    expect(keysOf('opencodego')).toEqual(['name', 'api_key', 'base_url']);
  });

  it('marks the engine-persisted / managed fields read-only', () => {
    const comfyMode = ACCOUNT_SCHEMAS.comfyui.fields.find(f => f.key === 'comfyui_mode');
    expect(comfyMode?.readOnly).toBe(true);
    for (const field of ACCOUNT_SCHEMAS.soulbitscloud.fields) {
      expect(field.readOnly).toBe(true);
    }
  });
});

describe('accountValuesToWriteDto', () => {
  it('splits core columns from the extra blob', () => {
    expect(
      accountValuesToWriteDto('openai', {
        name: 'Work',
        api_key: 'sk',
        org: 'org-1',
        project: 'proj-1',
      }),
    ).toEqual({ name: 'Work', api_key: 'sk', extra: { org: 'org-1', project: 'proj-1' } });
  });

  it('omits an empty base_url and empty extras', () => {
    expect(accountValuesToWriteDto('openai', { name: 'k', api_key: 'sk' })).toEqual({
      name: 'k',
      api_key: 'sk',
    });
  });

  it('carries base_url for self-hosted types', () => {
    expect(
      accountValuesToWriteDto('ollama', { name: 'local', base_url: 'http://h:11434' }),
    ).toEqual({ name: 'local', api_key: '', base_url: 'http://h:11434' });
  });

  it('round-trips an OpenCode Go account (name + key + optional base_url)', () => {
    const account = {
      name: 'Go',
      api_key: 'oc-go-key',
      base_url: 'https://opencode.ai/inference/go/openai/v1',
      extra: '{}',
    };
    const values = accountToFormValues('opencodego', account);
    expect(values).toEqual({
      name: 'Go',
      api_key: 'oc-go-key',
      base_url: 'https://opencode.ai/inference/go/openai/v1',
    });
    expect(accountValuesToWriteDto('opencodego', values)).toEqual({
      name: 'Go',
      api_key: 'oc-go-key',
      base_url: 'https://opencode.ai/inference/go/openai/v1',
    });
  });

  it('omits the OpenCode Go base_url when left empty (engine default endpoint)', () => {
    expect(
      accountValuesToWriteDto('opencodego', { name: 'Go', api_key: 'oc-go-key', base_url: '' }),
    ).toEqual({ name: 'Go', api_key: 'oc-go-key' });
  });
});

describe('accountToFormValues', () => {
  it('round-trips columns + extras', () => {
    expect(
      accountToFormValues('openai', {
        name: 'n',
        api_key: 'sk',
        base_url: '',
        extra: '{"org":"o"}',
      }),
    ).toEqual({ name: 'n', api_key: 'sk', base_url: '', org: 'o' });
  });

  it('tolerates a malformed extra blob', () => {
    expect(
      accountToFormValues('openai', { name: 'n', api_key: 'sk', base_url: '', extra: 'not json' }),
    ).toEqual({ name: 'n', api_key: 'sk', base_url: '' });
  });
});

describe('capabilityOverlayOf — engine squashed-key projection', () => {
  it('restores the ElevenLabs snake_case keys and strips the account half', () => {
    // The engine's composite read inlines its config struct: squashed legacy
    // tags (`voiceid`, `similarityboost`, `apikey`, `baseurl`, …).
    const merged = {
      id: 'acct-1',
      apikey: 'el-secret',
      baseurl: '',
      voiceid: '21m00Tcm4TlvDq8ikWAM',
      modelid: 'eleven_multilingual_v2',
      stability: 0.5,
      similarityboost: 0.75,
      style: 0.2,
      speakerboost: 1,
      speed: 1.1,
      output_format: 'mp3_44100_128',
      language_code: 'en',
      apply_text_normalization: 'auto',
      seed: 42,
      stt_model_id: 'scribe_v2',
    };

    const overlay = capabilityOverlayOf('elevenlabs', merged);

    expect(overlay).toEqual({
      voice_id: '21m00Tcm4TlvDq8ikWAM',
      model_id: 'eleven_multilingual_v2',
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0.2,
      speaker_boost: 1,
      speed: 1.1,
      output_format: 'mp3_44100_128',
      language_code: 'en',
      apply_text_normalization: 'auto',
      seed: 42,
      stt_model_id: 'scribe_v2',
    });
    // The API key / base URL are ACCOUNT fields — never copied into the
    // capability overlay (they would otherwise be re-saved into it).
    expect(overlay).not.toHaveProperty('apikey');
    expect(overlay).not.toHaveProperty('api_key');
    expect(overlay).not.toHaveProperty('baseurl');
    expect(overlay).not.toHaveProperty('base_url');
  });

  it('projects the OpenAI-family sampling keys', () => {
    const overlay = capabilityOverlayOf('openai', {
      id: 'acct',
      apikey: 'sk',
      model: 'gpt-4o',
      maxcompletiontokens: 512,
      topp: 0.9,
      frequencypenalty: 0.1,
      presencepenalty: 0.2,
      stoptokens: ['STOP'],
      responseformat: 'json_object',
      samplingpresetname: 'Balanced',
      extraparams: '{}',
      seed: 7,
    });

    expect(overlay).toEqual({
      model: 'gpt-4o',
      max_completion_tokens: 512,
      top_p: 0.9,
      frequency_penalty: 0.1,
      presence_penalty: 0.2,
      stop_tokens: ['STOP'],
      response_format: 'json_object',
      sampling_preset_name: 'Balanced',
      extra_params: '{}',
      seed: 7,
    });
  });

  it('keeps already-canonical and unknown keys untouched', () => {
    const merged = {
      model: 'eleven_v3',
      similarity_boost: 0.6,
      future_param: true,
    };
    const overlay = capabilityOverlayOf('elevenlabs', merged);
    expect(overlay).toEqual({
      model: 'eleven_v3',
      similarity_boost: 0.6,
      future_param: true,
    });
  });

  it('canonicalizes an OpenAI-compatible / soulvoice account endpoint', () => {
    const merged = {
      id: 'acct',
      endpoint: 'http://localhost:8765',
      model: 'harmony',
      voiceconfigfile: 'Claire.voice.json',
      operation_mode: 'single_speaker_tts',
      cfg_weight: 0.5,
      norm_loudness: 1,
      samplerate: 24000,
    };
    expect(capabilityOverlayOf('soulvoice', merged)).toEqual({
      model: 'harmony',
      voice_config_file: 'Claire.voice.json',
      operation_mode: 'single_speaker_tts',
      cfg_weight: 0.5,
      norm_loudness: 1,
      sample_rate: 24000,
    });
    // `endpoint` is the soulvoice ACCOUNT base URL.
    expect(capabilityOverlayOf('soulvoice', merged)).not.toHaveProperty('endpoint');
  });

  it('exposes the canonical projection for direct callers', () => {
    expect(canonicalProviderKeys('elevenlabs', { voiceid: 'v' })).toEqual({
      voice_id: 'v',
    });
    expect(canonicalProviderKeys('elevenlabs', null)).toEqual({});
  });
});

describe('maskApiKey', () => {
  it('masks to first-3 + last-4', () => {
    expect(maskApiKey('sk-abcdefgh1234')).toBe('sk-…1234');
  });

  it('renders nothing for a keyless account', () => {
    expect(maskApiKey('')).toBe('');
    expect(maskApiKey(null)).toBe('');
    expect(maskApiKey(undefined)).toBe('');
  });

  it('fully masks short keys', () => {
    expect(maskApiKey('abc')).toBe('••••');
  });
});
