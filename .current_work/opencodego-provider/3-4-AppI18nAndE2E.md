# Phase 3-4 — i18n, store-variant sanity & manual E2E

**Repo:** `harmony-ai-app` · **Objective:** user-facing copy + end-to-end validation.

## Steps

1. i18n (`src/i18n/locales/en/…`): provider display copy — account help ("key from
   the OpenCode Console → Go subscription"), any module-config hints referencing
   provider behavior. Keep keys minimal; provider names in pickers come from
   `moduleConfiguration.ts` and need no i18n.
2. Store-variant sanity: store builds must show Soulbits Cloud only — no new work
   expected; add/extend the variant test asserting `opencodego` is filtered out
   (pattern: `src/config/__tests__/appVariant.test.ts` +
   ModuleConfigEditScreen store-path tests).
3. Manual E2E (full variant, local engine build with phases 1–2 merged):
   - [ ] Settings → Providers → Add account → OpenCode Go: enter console key →
     auto Test key → **valid** verdict (free-tier key would show scope-limited).
   - [ ] Module config (Backend) → provider OpenCode Go → account picker collapses
     (single account) → model picker shows catalog list (offline labels) →
     "Fetch from provider" refreshes live (32 models).
   - [ ] Chat with a character → replies stream from the chosen model.
   - [ ] Engine log shows `x-opencode-session` stable per entity across an engine
     restart (same conversation continues → same header value).
   - [ ] Cognition/Movement/Vision slots accept the provider; TTS/STT/RAG/Imagination
     do not offer it.
   - [ ] Region-gated model (e.g. deepseek without Global) fails with a classified
     error, not a crash.
4. CHANGELOG entries (app + engine repos, per their formats).

## Checklist

- [ ] i18n keys (en)
- [ ] Store-variant exclusion test
- [ ] Manual E2E checklist above
- [ ] CHANGELOG (both repos)
