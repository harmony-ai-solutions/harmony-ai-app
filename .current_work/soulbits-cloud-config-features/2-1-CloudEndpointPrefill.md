# Phase 2-1: Cloud-Aware Endpoint (base_url) Prefill

## Objective

When the **Soulbits Cloud** provider is selected **and** the app is connected to
the cloud backend, prefill the endpoint (`base_url`) field with the correct
inference-gateway API URL — the **beta** URL in beta builds. Replace the
hardcoded prod default that currently ships even in beta builds.

## Background / References

- Screen: [`ModuleConfigEditScreen.tsx`](../../src/screens/config/ModuleConfigEditScreen.tsx).
  - Provider switch handler: `handleProviderSwitch(slot, providerType)` (~line 326)
    resets the slot's form values to `PROVIDER_DEFAULTS[providerType]`.
  - Create-mode init: `loadConfig()` create branch (~line 191) sets
    `providerForms[slot] = { providerConfigId: null, values: {} }`.
- Source of truth for the URL: [`CLOUD_HOSTS.inference`](../../src/config/cloud.ts)
  = `https://${SUFFIX}api.soulbits.app` where `SUFFIX = IS_BETA ? 'beta.' : ''`.
- Current (buggy) default: [`PROVIDER_DEFAULTS.soulbitscloud.base_url`](../../src/constants/moduleDefaults.ts)
  = `'https://api.soulbits.app'` (prod, even in beta).
- Cloud-connection state:
  [`useSyncConnection()`](../../src/contexts/SyncConnectionContext.tsx) →
  `isConnected` and `connectionStatus.mode` (`'cloud' | 'selfhosted'`).

## Design decision

- **Gate:** prefill only when `providerType === 'soulbitscloud'` **and**
  `connectionStatus.mode === 'cloud'` **and** `isConnected === true`.
- **Fill-if-empty only:** never overwrite a user-typed/loaded value (so editing
  an existing config that points at a custom gateway is safe).
- **Keep editable:** the user may still point at a different gateway.
- Apply in **both** the provider-switch path and the create-mode load path so the
  prefill appears regardless of how Soulbits Cloud becomes selected.

## Files to modify

- `src/screens/config/ModuleConfigEditScreen.tsx` — add a helper and call it from
  `handleProviderSwitch` and the create-mode branch of `loadConfig`.

## Implementation steps

1. **Impact analysis** on `handleProviderSwitch` and `loadConfig` before editing.
2. Add `useSyncConnection()` to the screen's hooks (alongside existing
   `useAppTheme`, `useAppAlert`):
   ```ts
   const { isConnected, connectionStatus } = useSyncConnection();
   const cloudConnected =
     connectionStatus?.mode === 'cloud' && isConnected === true;
   ```
3. Add a small pure helper:
   ```ts
   function soulbitsCloudBaseUrl(cloudConnected: boolean): string | undefined {
     return cloudConnected ? CLOUD_HOSTS.inference : undefined;
   }
   ```
   Import `CLOUD_HOSTS` from `../../config/cloud`.
4. In `handleProviderSwitch`, after building `defaults` from
   `PROVIDER_DEFAULTS[providerType]`, when `providerType === 'soulbitscloud'`:
   ```ts
   const prefillUrl = soulbitsCloudBaseUrl(cloudConnected);
   if (prefillUrl && !defaults.base_url) defaults.base_url = prefillUrl;
   ```
   (Always set here — switch is a fresh slot, so fill unconditionally when
   cloud-connected.)
5. In the create-mode branch of `loadConfig`, after seeding the slot with empty
   `values: {}`, if the module default provider is soulbitscloud OR if a
   pre-existing create flow expects it, merge the prefill into the initial
   `values`. Concretely, when seeding a soulbitscloud slot:
   ```ts
   const prefillUrl = soulbitsCloudBaseUrl(cloudConnected);
   values.base_url = prefillUrl ?? PROVIDER_DEFAULTS.soulbitscloud.base_url;
   ```
   (Create mode has no prior user value, so filling is safe.)
6. For **edit mode** (`loadConfig` existing-config branch), do **not** overwrite —
   the loaded `pConfig.base_url` already wins via `{ ...defaults, ...pConfig }`.
7. Manual verification matrix:
   - Beta build, cloud connected, select Soulbits Cloud → `base_url` shows
     `https://beta.api.soulbits.app`.
   - Prod build, cloud connected → `https://api.soulbits.app`.
   - Self-hosted mode (or disconnected) → falls back to
     `PROVIDER_DEFAULTS.soulbitscloud.base_url` (existing behavior), editable.

## Optional hardening (discuss before implementing)

- Update `PROVIDER_DEFAULTS.soulbitscloud.base_url` to derive from
  `CLOUD_HOSTS.inference` so even the non-gated default is beta-aware. (This
  changes static default behavior app-wide; confirm with user.)

## Progress checklist

- [ ] Impact analysis run on `handleProviderSwitch` + `loadConfig`
- [ ] `useSyncConnection()` wired into the screen
- [ ] Prefill helper added; called from switch + create-load paths
- [ ] Edit mode leaves existing `base_url` untouched
- [ ] Verified beta/prod/self-hosted matrix
