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
    for (const type of ['openai', 'xai', 'mistral', 'openrouter', 'elevenlabs']) {
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
