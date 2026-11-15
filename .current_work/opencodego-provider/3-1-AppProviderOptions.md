# Phase 3-1 — App provider options, defaults & TS types

**Repo:** `harmony-ai-app` · **Objective:** offer OpenCode Go in the four LLM module
config editors with sane defaults.

## Steps

1. `src/constants/moduleConfiguration.ts` — shared option object (pattern:
   `MISTRAL_OPTION` et al. at the top of the file):
   ```ts
   const OPENCODEGO_OPTION: ProviderOption =
     { id: 'opencodego', name: 'OpenCode Go', icon: 'console-line' };
   ```
   Add to `providerOptions` of: Backend, Cognition, Movement, Vision. **Not** STT
   lists, TTS, RAG, Imagination.
2. `src/constants/moduleDefaults.ts` — `PROVIDER_DEFAULTS.opencodego`:
   `model: 'deepseek-v4.1-flash'` + researched sampling defaults (mirror the
   `openaicompatible` entry's keys; leave auth/fingerprint out).
3. `src/database/models.ts` — `OpenCodeGoProviderConfig` interface (capability half;
   snake_case wire keys matching the engine's ToSyncModel) + add to the provider
   config union.
4. `src/screens/config/ModuleConfigEditScreen.tsx` — no changes expected
   (`emptySlotFor` uses `PROVIDER_DEFAULTS` generically); store builds collapse to
   `STORE_PROVIDER_ID` already, so **OpenCode Go is full-variant only automatically** —
   verify via the variant tests.
5. Update `src/constants/__tests__/moduleConfiguration.test.ts` lists (the per-module
   provider-set assertions) and any defaults tests.

## Acceptance

- Unit tests green; picker shows "OpenCode Go" in the 4 modules (full variant only).

## Checklist

- [ ] Shared option + 4 module lists
- [ ] PROVIDER_DEFAULTS entry (deepseek-v4.1-flash)
- [ ] TS type + union member
- [ ] moduleConfiguration tests updated
- [ ] Store-variant exclusion verified
