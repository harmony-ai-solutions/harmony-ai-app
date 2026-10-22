/**
 * providerAvailability — variant-aware provider availability (plan 7-14 V3).
 *
 * The distribution variant narrows which PROVIDER TYPES a build may offer:
 *
 *   - `full`  — every provider the module table lists (today's behavior).
 *   - `store` — ONLY `soulbitscloud` (the Soulbits Cloud provider); every other
 *               provider (including the full-only self-hosted `soulvoice`) is
 *               unavailable.
 *
 * This is the single source the provider pickers read (filter-only ruling 7):
 * the config screen renders {@link getAvailableProviders} instead of the raw
 * `MODULE_TYPES[].providerOptions`, so a store build shows exactly one provider
 * per module and cannot wire a non-cloud provider.
 *
 * DISAMBIGUATION (binding, plan 7-14 rule 7): `soulbitscloud` ≠ `soulvoice`.
 *   - `soulbitscloud` — the Soulbits Cloud provider (the ONLY one store offers).
 *   - `soulvoice`     — the external self-hosted speech engine provider (FULL
 *                       only; must never appear in a store build).
 *
 * The FULL variant is byte-for-byte unchanged: every selector short-circuits to
 * the raw table / input list with no filtering.
 */

import {
  MODULE_TYPES,
  ModuleTypeConfig,
  ProviderOption,
} from '../../constants/moduleConfiguration';
import { isStoreVariant } from '../../config/appVariant';

/** The ONLY provider a store build may offer (design rule 7). */
export const STORE_PROVIDER_ID = 'soulbitscloud';

/**
 * True when this build's variant offers the given provider type. Full builds
 * offer everything; store builds offer only {@link STORE_PROVIDER_ID}.
 */
export function isProviderAvailable(providerId: string): boolean {
  if (!isStoreVariant()) return true;
  return providerId === STORE_PROVIDER_ID;
}

/**
 * Variant-filter an arbitrary provider-option list. Full: unchanged; store: the
 * soulbitscloud option only. Shared by {@link getAvailableProviders} and the STT
 * per-slot lists (provider-registry 6-5 — the transcription/VAD slots carry
 * their own option lists, which still respect the store lock).
 */
export function filterAvailableProviders(options: ProviderOption[]): ProviderOption[] {
  if (!isStoreVariant()) return options;
  return options.filter(p => p.id === STORE_PROVIDER_ID);
}

/**
 * The provider options a picker should render for one module type. Store: the
 * soulbitscloud option only (or `[]` when the module has no cloud option — the
 * caller then hides the module's config surface). Full: the raw table list.
 */
export function getAvailableProviders(moduleType: string): ProviderOption[] {
  const module: ModuleTypeConfig | undefined = MODULE_TYPES.find(
    m => m.id === moduleType,
  );
  if (!module) return [];
  return filterAvailableProviders(module.providerOptions);
}

/**
 * True when the module has at least one provider available in this variant.
 * A store-only module with no soulbitscloud option → false (hide its UI).
 */
export function isModuleAvailable(moduleType: string): boolean {
  return getAvailableProviders(moduleType).length > 0;
}

/**
 * The provider TYPE keys a module-config row uses. Most modules carry a single
 * `provider`; STT carries two slots (`transcription_provider`/`vad_provider`).
 * The engine's `disabled` sentinel and empty strings are omitted (an
 * intentionally-off slot is not a "provider").
 */
export function moduleConfigProviderTypes(
  moduleType: string,
  config: Record<string, unknown> | null | undefined,
): string[] {
  if (!config) return [];
  const pick = (v: unknown): string | null =>
    typeof v === 'string' && v !== '' && v !== 'disabled' ? v : null;
  if (moduleType === 'stt') {
    return [pick(config.transcription_provider), pick(config.vad_provider)].filter(
      (p): p is string => p !== null,
    );
  }
  const single = pick(config.provider);
  return single ? [single] : [];
}

/**
 * Filter a list of module-config rows to those whose providers are ALL
 * available in this variant. Store: keeps only rows wired exclusively to
 * soulbitscloud (rows with no resolvable provider are dropped so a store build
 * never offers a locked config in the entity editor's pickers). Full: unchanged.
 */
export function filterModuleConfigsForVariant<
  T extends Record<string, unknown>,
>(moduleType: string, configs: T[]): T[] {
  if (!isStoreVariant()) return configs;
  return configs.filter(config => {
    const providers = moduleConfigProviderTypes(moduleType, config);
    if (providers.length === 0) return false;
    return providers.every(p => p === STORE_PROVIDER_ID);
  });
}
