/**
 * Provider field → form-section classification (provider-registry 2-2).
 *
 * The module-config form is restructured into explicit sections
 * (Provider → Credentials → Capability → Module). This module holds the
 * INTERIM field-classification list that splits a provider's
 * `PROVIDER_SCHEMAS[type].fields` into:
 *
 *  - **Credentials** — the account/endpoint-ish fields (keys, tokens, base
 *    URLs, endpoints) that plan §3.1 will move onto the shared
 *    `provider_accounts` row; and
 *  - **Capability** — everything else the provider form exposes (model +
 *    sampling params + provider-specific params), which plan §3.2 moves onto
 *    the module config's capability overlay.
 *
 * This is deliberately a small, explicit list (not derived from field names)
 * so the split is auditable now; Phase 6-2's `accountFieldSchemas.ts` becomes
 * the permanent owner of the account/capability split and retires this module.
 *
 * The module-config `name` field is neither — it is the module config's own
 * label and lives in the screen's General section.
 */

/** Field keys that belong to the Credentials section (account-scoped). */
export const CREDENTIAL_FIELD_KEYS: ReadonlySet<string> = new Set([
  'api_key',
  'api_token',
  'base_url',
  'endpoint',
  'username',
  'password',
]);

export type ProviderFieldSection = 'credentials' | 'capability';

/**
 * Classify a provider field key into its form section. Anything not listed as
 * a credential field is a capability field (model, sampling, provider params).
 */
export function classifyProviderField(key: string): ProviderFieldSection {
  return CREDENTIAL_FIELD_KEYS.has(key) ? 'credentials' : 'capability';
}
