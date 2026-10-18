# Phase 1-2 — App: Competitor Removal (Kindroid, Character.AI, Kajiwoto)

**Repo:** harmony-ai-app · **Parallel with:** 1-1 (engine side, disjoint repo)
**Refs:** plan.md R9, §11 audit decisions · research/SYNTHESIS.md §5 item 11

## Objective

Remove every app-side trace of the three competitor provider types so the
app compiles and tests green without them.

## Implementation steps

1. `src/constants/moduleConfiguration.ts` — remove the three providerOptions
   entries (backend-module-only, L25-27). `moduleConfiguration.test.ts` does
   NOT pin them (asserts soulbitscloud presence, per-module id uniqueness,
   name+icon) — no change needed there.
2. `src/constants/providerFieldSchemas.ts` — delete the three field-schema
   blocks (L127-149)
3. `src/constants/moduleDefaults.ts` — delete the three default blocks
   (L94-109)
4. `src/constants/moduleConfigVisibility.ts` — remove the `'kindroid_id'`
   reference (L36, the only one)
5. `src/database/models.ts` — delete the three interfaces (L202-225) **and
   their entries in the `ProviderConfig` union (L520-536)** — the union is
   the compile cascade anchor
6. `src/services/engine/repositories/providers.ts` — remove the three
   `makeProviderApi` blocks + exports (L196-257 region — note the keeper
   blocks interleaved there: comfyui/elevenlabs/google/soulvoice at 205-239
   must be preserved); update the L11 "16-repo" comment → 13
7. `src/screens/config/ModuleConfigEditScreen.tsx` — remove the three import
   groups (L79-87) and the `PROVIDER_REPOSITORIES` map entries (L177-179)
8. Fixtures/tests: `managementContract.fixtures.ts` and
   `engineRepositories.test.ts` reference **none** of the three (verified) —
   treat as a verification step (grep), not an edit
9. i18n + docs: grep locale files for provider-name strings; remove.
   Extend the trace-cleanup to `reports/architecture-report.md` (L715-717),
   `design/00 Design Document.md` (L109), `design/01 Theming Implementation
   Plan.md` (L50) — R9 is "remove every app-side trace"
10. Post-removal picker count check: exactly 10 picker-offered types remain
    (openai, openaicompatible, openrouter, soulbitscloud, google, xai,
    anthropic, elevenlabs, soulvoice, comfyui)

## Test gates

- `npx.cmd tsc --noEmit` — zero errors (type deletions cascade; chase all)
- `npm.cmd run test` — full unit suite green
- grep gate: `Select-String -Pattern '(?i)kindroid|kajiwoto|characterai'`
  over `src/`, `docs/`, `README.md`, `reports/`, `design/` — only historical
  changelog hits allowed

## Checklist

- [ ] Constants (4 files) cleaned
- [ ] models.ts interfaces + ProviderConfig union entries deleted
- [ ] providers.ts adapters removed (keepers preserved); comment 16→13
- [ ] ModuleConfigEditScreen cleaned (PROVIDER_REPOSITORIES)
- [ ] Fixtures/tests verified reference-free
- [ ] i18n + docs + reports/design greps clean
- [ ] 10 picker types confirmed
- [ ] tsc + jest gates green
