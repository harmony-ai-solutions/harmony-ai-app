# Phase 6-2 — App: Providers Settings Screen + Account Schemas

**Repo:** harmony-ai-app · **Depends on:** 6-1 (incl. 5-1 endpoints) · **Blocks:** 6-3 (shared form) · Serial app chain
**Refs:** plan.md §7, §3.1/§3.2, §11 · SYNTHESIS §1

## Objective

The central account management surface: list/add/edit/delete accounts with
in-use badges and the "Test key" flow — plus the account-vs-capability
schema split plan §3.2 mandates (owned HERE).

## Implementation steps

1. Navigation: top-level Settings entry "Providers" (owner default §10.2)
   → `src/screens/settings/ProvidersScreen.tsx`; register in
   AppNavigator + SettingsScreen section; **row label in the `settings`
   i18n namespace, screen strings in a new `providers.json`** (audit)
2. **`src/constants/accountFieldSchemas.ts` (NEW — plan §3.2 split owned
   here):** per-type account form fields from the §3.1 matrix — name,
   api_key (required-ness per type), base_url
   (required/optional/managed), extra fields: **openai org/project, xai
   team, comfyui auth (basic/bearer) + comfyui_mode (read-only, engine-
   persisted), soulbitscloud auth-mode, openaicompatible auth hint**
   (audit: extras were under-enumerated). `providerFieldSchemas.ts`
   becomes capability-only (feeds 6-3)
3. **Shared `AccountForm` component (exported for 6-3's "Add account…" —
   audit: 6-3 is soft-dependent on it):** inline validation per matrix;
   soulbitscloud account read-only (system-managed, 6-4 owns writes)
4. Screen: accounts grouped by provider type (variant-filtered via
   `providerAvailability` — type-level `isProviderAvailable`): name,
   masked key (`sk-…1234`), base_url when set, in-use badge. **api_key is
   returned unmasked by the engine (single-user local engine — noted
   decision)** so saved accounts can re-verify client-side
5. **"Test key"** → `verifyProvider` → state chip per the state machine
   (valid/invalid/throttled/blocked/scope_limited/unreachable + detail);
   payload extras rendered (elevenlabs tier + character bar, openrouter
   budgets, comfyui VRAM, versions). Auto-runs once after save
6. Delete: 409 → alert **listing referencing_configs from the 409 body**
   (3-2 provides them — audit resolution)
7. Component tests: grouping/masking, verify states, 409 list, form
   validation per matrix

## Test gates

- `npx.cmd tsc --noEmit` + `npm.cmd run test` green incl. ProvidersScreen
  component tests

## Checklist

- [ ] Settings entry + navigation (i18n namespaces correct)
- [ ] accountFieldSchemas.ts (full extras set) + providerFieldSchemas split
- [ ] Shared AccountForm export
- [ ] Grouped list + masking + in-use badges
- [ ] Test-key flow + payload rendering + auto-after-save
- [ ] Delete with referencing-configs alert
- [ ] Component tests + gates green
