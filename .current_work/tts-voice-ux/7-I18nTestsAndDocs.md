# Phase 7: i18n, Tests & Docs

## Objective

Localization, the cross-cutting test matrix, and documentation for all phases.
Executed incrementally alongside each phase (not a big-bang at the end) — this
file is the checklist that keeps the plan honest.

## Context (verified)

- i18n: exactly ONE locale exists, `src/i18n/locales/en/moduleConfig.json`
  (+ `chat`/`chatList`/`scenario` namespaces under `src/i18n/locales/en/`).
  Verify namespace file names before adding keys — the config UI uses
  `useTranslation('moduleConfig')`, chat surfaces use `chat` / `chatList`.
- Test framework: `docs/TESTING.md`; `npm test` runs unit + integration.
  App jest exits 1 with teardown noise — judge by `Test Suites: N passed`.
  RNTL v14 `render` / `fireEvent` return Promises (`await` them).
- Existing test locations: `src/**/__tests__/`, colocated component tests.
- Engine tests need
  `$env:CGO_CFLAGS='-DSQLITE_ENABLE_SESSION -DSQLITE_ENABLE_PREUPDATE_HOOK'`;
  `go test ./...` (47 packages) + catalog `-check` green.
- GitNexus repo rules (AGENTS.md): impact analysis before editing symbols,
  `detect_changes` before committing. Implementation commits are NOT part of
  this plan unless the owner explicitly asks (the plan docs themselves were
  committed on an explicit owner request, 2026-11-17).

## i18n keys (by phase)

- Phase 2 (`moduleConfig`): `voiceExpressionTitle`, `tagKindCues`,
  `tagKindTones`, `tagKindBreaks`, `tagModeOpen`, `tagModeClosed`,
  `tagModeNone`, `audioTagsNoneHint`, `audioTagsLegacyHint`,
  `audioTagsBoundaryHint`.
- Phase 3 (`moduleConfig`): `tagKindAll`, `tagSearchPlaceholderAll`,
  `sentToTts`, `inputEcho`, `voiceActions`, `voiceActionsHint`,
  `cueBudgetDemo`, `sampleScriptCue`, `sampleScriptAction`,
  `sampleScriptMixed`.
- Phase 4 (`moduleConfig`): `accent`, `accentLocked`, `accentNoneHint`,
  `accentBoundaryHint`.
- Phase 5 (`chat`): `chatSettings`, `showEmotionState`,
  `showEmotionStateHint`, `characterState`, `emotionAsOf`, `dominantEmotion`,
  `emotionCrystallized`, `voiceExpressionLevel`, `voiceExpressionDerivedHint`,
  `emotionEmpty`, `tabState`, `tabMemories`, `tabKnowledge`.
- Phase 6 (`chat`): `memoryLevelCore`, `memoryLevelSummary`, `memoryLevelRaw`,
  `memoryEmpty`, `knowledgeEmpty`, `collections`, `documentsCount`,
  `filterArchetype`, `filterCategory`, `testKnowledge`, `runQuery`,
  `similarity`, `documentDetails`.
- All new labels need `accessibilityLabel`s where the component uses icons or
  chips (existing convention: `accessibilityRole="button"` + label).

## Test matrix

| Phase | Tests |
|---|---|
| 1 | hook normalization (`audio_tags` → `meta.audio_tags`), typed accessor (catalog lookup, kind folding, unknown mode), legacy fallback, stale-fallback removal |
| 2 | EL v3 = 3 OPEN cards 12/48/3; turbo = CLOSED 9/10; tag-free = none-state; live descriptor still resolves; old engine = legacy row |
| 3 | grouped picker sections + search; asterisk insertion; `res.text` → "Sent to TTS"; `vocalize_nonverbal`/`audio_tag_budget` posted; fingerprint invalidation; tag-free → no pickers; player/download/keep-awake regression |
| 4 | language preserved for Chatterbox Multilingual; accent row EL v3/v4 only; saved unknown value shown as-is; engine: start tag once, budgets unaffected, unknown accent ignored, test-route parity, catalog `-check`, `go test ./...` |
| 5 | chip hidden by default / visible when on; toggle persists per participantKey; 8 bars + dominance + crystallization; "as of" timestamp; empty state; expressiveness read-only; API failure degrades |
| 6 | DTO conformance vs engine camelCase shapes; client URLs; repositories; memories timeline compaction/expand; collections/documents filters; test-query results; detail sheet hides embedding; 404/503 graceful |
| All | `npm test` full suite ("Test Suites: N passed"); `npx tsc --noEmit` if part of the repo's checks; no snapshot churn without review |

## Docs / plan maintenance

- Update this `summary.md` Implementation Status checklist (`- [x]`) as each
  phase lands, and note deviations in the phase file (rules
  `.roo/rules/implementation-plans.md`).
- `docs/TESTING.md` / `docs/future-work.md`: add the new test surfaces and note
  deferred items (emotion live event, RAG write paths, accent Option B).
- Engine `6-AppCatalogSurface.md`: owner asked to keep this plan in the app
  repo; leave the engine doc untouched unless explicitly requested (avoids a
  new uncommitted engine diff while the audio-tags commit is under review).
- Engine `summary.md` Phase 6 line: unchanged; it is "optional, not scheduled"
  there — this app plan supersedes it in practice; update only on request.

## Checklist

- [ ] All i18n keys added to `en` (correct namespaces)
- [ ] Accessibility labels on all new interactive elements
- [ ] Full test matrix above green (app + engine for Phase 4)
- [ ] `summary.md` status + deviations updated per completed phase
- [ ] Deferred items recorded in `docs/future-work.md`
- [x] Plan docs committed on explicit owner request (2026-11-17); implementation still uncommitted
