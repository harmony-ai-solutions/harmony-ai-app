/**
 * accountFieldSchemas — the ACCOUNT-side provider form schema (provider-registry
 * 6-2, plan §3.2).
 *
 * This module OWNS the account-vs-capability schema split. It holds, per
 * provider type, the fields that belong to a shared **provider account**
 * (plan §3.1): `name`, `api_key` (required-ness per type), `base_url`
 * (required / optional / managed) and the typed account **extras** (`extra`
 * blob) — OpenAI `org`/`project`, xAI `team`, ComfyUI `auth` + `comfyui_mode`,
 * OpenRouter/OpenAI-compatible attribution/auth hints, and the managed
 * soulbitscloud `auth_mode`.
 *
 * The companion `providerFieldSchemas.ts` is CAPABILITY-only (model + sampling
 * + provider params, i.e. the module config's `capability_json` overlay).
 *
 * `AccountForm` (shared with 6-3's "Add account…" flow) renders
 * {@link ACCOUNT_SCHEMAS} and validates through {@link validateAccount}.
 * `ModuleConfigEditScreen`'s interim Credentials section reads the credential
 * subset of these fields (extras stay account-only).
 *
 * §3.1 matrix recap:
 *   api_key required — openai, anthropic, google, xai, mistral, openrouter,
 *     elevenlabs; optional — openaicompatible, ollama, localai, comfyui,
 *     soulvoice; system-managed — soulbitscloud.
 *   base_url required — openaicompatible, ollama, localai, comfyui, soulvoice;
 *     optional — openai, xai, mistral, openrouter, elevenlabs; absent —
 *     anthropic, google; managed — soulbitscloud.
 */

import type { FieldDefinition } from './providerFieldSchemas';
import type { ProviderAccountWriteDto } from '../services/engine/EngineApiClient';

export interface AccountSchema {
  fields: FieldDefinition[];
}

/** Core account COLUMN keys (everything else in a schema is an `extra` key). */
export const ACCOUNT_CORE_FIELD_KEYS: ReadonlySet<string> = new Set([
  'name',
  'api_key',
  'base_url',
  'endpoint',
]);

/** Provider types whose account is system-managed (never user-editable). */
export const MANAGED_ACCOUNT_TYPES: ReadonlySet<string> = new Set(['soulbitscloud']);

/** True when this provider type's account is system-managed (read-only). */
export function isAccountManaged(type: string): boolean {
  return MANAGED_ACCOUNT_TYPES.has(type);
}

/** The account schema for a provider type, or `undefined` for unknown types. */
export function getAccountSchema(type: string): AccountSchema | undefined {
  return ACCOUNT_SCHEMAS[type];
}

/** Common account-name field. */
const nameField: FieldDefinition = {
  key: 'name',
  label: 'Account Name',
  type: 'text',
  required: true,
  placeholder: 'e.g. Personal key',
};

/**
 * Per-type account field schemas (plan §3.1 matrix). Account extras carry a
 * distinct key that the account write routes into the `extra` blob.
 */
export const ACCOUNT_SCHEMAS: Record<string, AccountSchema> = {
  openai: {
    fields: [
      nameField,
      { key: 'api_key', label: 'API Key', type: 'password', required: true },
      { key: 'base_url', label: 'Base URL', type: 'text', placeholder: 'Default endpoint (leave empty)' },
      { key: 'org', label: 'Organization', type: 'text', placeholder: 'org-…', tooltip: 'Sent as the OpenAI-Organization header.' },
      { key: 'project', label: 'Project', type: 'text', placeholder: 'proj_…', tooltip: 'Sent as the OpenAI-Project header.' },
    ],
  },
  anthropic: {
    fields: [
      nameField,
      { key: 'api_key', label: 'API Key', type: 'password', required: true },
    ],
  },
  google: {
    fields: [
      nameField,
      { key: 'api_key', label: 'API Key', type: 'password', required: true, tooltip: 'AQ.… (new) or AIzaSy… (legacy).' },
    ],
  },
  xai: {
    fields: [
      nameField,
      { key: 'api_key', label: 'API Key', type: 'password', required: true },
      { key: 'base_url', label: 'Base URL', type: 'text', placeholder: 'Default endpoint (leave empty)' },
      { key: 'team', label: 'Team', type: 'text', placeholder: 'team id', tooltip: 'Team scoping, where the API exposes it.' },
    ],
  },
  mistral: {
    fields: [
      nameField,
      { key: 'api_key', label: 'API Key', type: 'password', required: true },
      { key: 'base_url', label: 'Base URL', type: 'text', placeholder: 'https://api.mistral.ai', tooltip: 'Regional endpoints: api. / api.eu. / us.mistral.ai.' },
    ],
  },
  openrouter: {
    fields: [
      nameField,
      { key: 'api_key', label: 'API Key', type: 'password', required: true },
      { key: 'base_url', label: 'Base URL', type: 'text', placeholder: 'Default endpoint (leave empty)' },
    ],
  },
  elevenlabs: {
    fields: [
      nameField,
      { key: 'api_key', label: 'API Key', type: 'password', required: true },
      { key: 'base_url', label: 'Base URL', type: 'text', placeholder: 'Default endpoint (leave empty)' },
    ],
  },
  openaicompatible: {
    fields: [
      nameField,
      { key: 'base_url', label: 'Base URL', type: 'text', required: true, placeholder: 'http://localhost:8080/v1' },
      { key: 'api_key', label: 'API Key', type: 'password', tooltip: 'Bearer/basic, per server — optional for keyless servers.' },
      { key: 'auth', label: 'Auth Style', type: 'select', options: [
        { id: '', name: 'Auto-detect' },
        { id: 'bearer', name: 'Bearer' },
        { id: 'basic', name: 'Basic' },
      ], tooltip: 'Left blank, the auth style is fingerprinted at verify time.' },
    ],
  },
  ollama: {
    fields: [
      nameField,
      { key: 'base_url', label: 'Base URL', type: 'text', required: true, placeholder: 'http://localhost:11434' },
      { key: 'api_key', label: 'API Key', type: 'password', tooltip: 'Proxy auth only — the Ollama server itself is keyless.' },
    ],
  },
  localai: {
    fields: [
      nameField,
      { key: 'base_url', label: 'Base URL', type: 'text', required: true, placeholder: 'http://localhost:8080' },
      { key: 'api_key', label: 'API Key', type: 'password', tooltip: 'LOCALAI_API_KEY — optional for keyless servers.' },
    ],
  },
  comfyui: {
    fields: [
      nameField,
      { key: 'base_url', label: 'Base URL', type: 'text', required: true, placeholder: 'http://localhost:8188' },
      { key: 'api_key', label: 'API Key', type: 'password', tooltip: 'Proxy token — stock ComfyUI has no auth.' },
      { key: 'auth', label: 'Auth Style', type: 'select', options: [
        { id: '', name: 'Auto-detect' },
        { id: 'bearer', name: 'Bearer' },
        { id: 'basic', name: 'Basic' },
      ] },
      { key: 'comfyui_mode', label: 'ComfyUI Mode', type: 'text', readOnly: true, tooltip: 'Engine-detected (native vs wrapper). Persisted at first generation.' },
    ],
  },
  soulvoice: {
    fields: [
      nameField,
      { key: 'base_url', label: 'Base URL', type: 'text', required: true, placeholder: 'http://localhost:5000' },
      { key: 'api_key', label: 'API Key', type: 'password', tooltip: 'HARMONYSPEECH_API_KEY — optional for self-hosted.' },
    ],
  },
  soulbitscloud: {
    fields: [
      { ...nameField, readOnly: true },
      { key: 'base_url', label: 'Base URL', type: 'text', readOnly: true, tooltip: 'Managed — flavor inference host.' },
      { key: 'api_key', label: 'API Key', type: 'password', readOnly: true, tooltip: 'Managed PASETO — written by cloud auth / token rotation.' },
      { key: 'auth_mode', label: 'Auth Mode', type: 'text', readOnly: true, tooltip: 'Managed — PASETO v4.local.' },
    ],
  },
};

/**
 * Inline validation per the §3.1 matrix: every `required` account field must be
 * present. System-managed accounts (soulbitscloud) never validate — they are
 * read-only. Returns a map of `field key → message` (empty = valid).
 */
export function validateAccount(
  type: string,
  values: Record<string, unknown>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const schema = ACCOUNT_SCHEMAS[type];
  if (!schema) {
    errors.name = 'Unknown provider type';
    return errors;
  }
  if (isAccountManaged(type)) return errors;
  for (const field of schema.fields) {
    if (!field.required) continue;
    const value = values[field.key];
    if (value === undefined || value === null || String(value).trim() === '') {
      errors[field.key] = `${field.label} is required`;
    }
  }
  return errors;
}

/** Parse an account `extra` value (object or JSON string) into an object. */
export function parseAccountExtra(extra: unknown): Record<string, unknown> {
  if (extra && typeof extra === 'object') return { ...(extra as Record<string, unknown>) };
  if (typeof extra === 'string' && extra.trim() !== '') {
    try {
      const parsed = JSON.parse(extra);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Build the account write body (`{name, api_key, base_url?, extra?}`) from raw
 * form values. Core column keys map to top-level fields; every other non-empty
 * schema key routes into the `extra` blob (engine stores it opaquely, §3.1).
 */
export function accountValuesToWriteDto(
  type: string,
  values: Record<string, unknown>,
): ProviderAccountWriteDto {
  const account: ProviderAccountWriteDto = {
    name: String(values.name ?? ''),
    api_key: String(values.api_key ?? ''),
  };
  const baseUrl = values.base_url ?? values.endpoint;
  if (baseUrl !== undefined && baseUrl !== null && String(baseUrl) !== '') {
    account.base_url = String(baseUrl);
  }

  const schema = ACCOUNT_SCHEMAS[type];
  if (schema) {
    const extra: Record<string, unknown> = {};
    for (const field of schema.fields) {
      if (ACCOUNT_CORE_FIELD_KEYS.has(field.key)) continue;
      const value = values[field.key];
      if (value !== undefined && value !== null && String(value) !== '') {
        extra[field.key] = value;
      }
    }
    if (Object.keys(extra).length > 0) account.extra = extra;
  }
  return account;
}

/**
 * Seed form values from an existing account (edit mode): the account columns
 * plus the parsed `extra` keys, so an extra-bearing account round-trips.
 */
export function accountToFormValues(
  type: string,
  account: { name: string; api_key: string; base_url: string; extra: unknown },
): Record<string, unknown> {
  const values: Record<string, unknown> = {
    name: account.name,
    api_key: account.api_key,
    base_url: account.base_url,
  };
  const extra = parseAccountExtra(account.extra);
  for (const key of Object.keys(extra)) {
    if (!ACCOUNT_CORE_FIELD_KEYS.has(key)) values[key] = extra[key];
  }
  void type;
  return values;
}

/**
 * Mask a stored api_key for display (`sk-…1234`). Empty keys (keyless
 * self-hosted servers) render as an empty string — the screen substitutes a
 * "keyless" label.
 */
export function maskApiKey(key: string | null | undefined): string {
  const trimmed = (key ?? '').trim();
  if (trimmed === '') return '';
  if (trimmed.length <= 7) return '•'.repeat(Math.max(4, trimmed.length));
  return `${trimmed.slice(0, 3)}…${trimmed.slice(-4)}`;
}
