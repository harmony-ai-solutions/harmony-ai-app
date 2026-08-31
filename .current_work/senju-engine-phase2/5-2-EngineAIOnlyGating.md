# 5-2 — Engine AI-Only Automation Gating

> Phase 5 / repo: **harmony-link-private**. Contract: `21-Engine-Contract` Q9, §5.2 (full checklist).
> Prerequisites: 5-1 (type in cache). Shares gate sites with 4-3 (disabled) — one helper.

## Objective

Lifecycle / emotion / proactivity machinery processes **AI entities only**. The machinery is activation-based
(never scans the entities table), so the gate = activation sites + choke points + defense-in-depth.

## Gate helper

`shouldAutomate(cfg *config.EntityConfig) bool { return cfg.EntityType == "ai" && !cfg.IsDisabled }`
(lifecycle package or config package — beside the existing autonomy gate).

## A. Activation sites (MUST gate)

| # | Site | Change |
|---|---|---|
| 1 | `eventserver/eventprocessor.go:196-199` (fresh INIT) + `:726-728` (resume) | INIT_ENTITY for a USER entity stays **ALLOWED but chat-only** — do NOT reject (personas must chat!). Instead: skip automation wiring for non-AI (steps 2-5 become conditional). |
| 2 | `eventprocessor.go:207` (fresh) `EnsureEmotionEngine` | skip unless `shouldAutomate` |
| 3 | `eventprocessor.go:739` (resume) `EnsureEmotionEngine` | same |
| 4 | `eventprocessor.go:250-267` (fresh) beat runner (`AutonomyLevel > 0`) | skip unless `shouldAutomate` |
| 5 | `eventprocessor.go:781-798` (resume) beat runner | same |
| 6 | `lifecycle/service.go:87-157` `EnsureBeatRunnerStarted` (central, beside autonomy check :108-111) | early return unless `shouldAutomate` |
| 7 | `lifecycle/service.go:52-71` `EnsureEmotionEngine` (central) | same |

**Critical distinction from user entities chatting:** a user/persona entity INIT creates a session (needed for
persona chat + STT), but gets NO emotion engine, NO beat runner, NO RAG wiring beyond its configured modules (Q13:
RAG init is module-config-driven — symmetric), and the thought-processor must never generate "as" it (site B1).

## B. Defense-in-depth (SHOULD gate)

1. `modules/cognition/processor.go:509-519` — "other entity spoke → I respond": the responder is always the AI
   session owner; the structural protection = user entities never get backend/cognition mappings (enforce at INIT:
   **if a USER entity's mapping has cognition/backend set → log warning + treat as disabled for generation**).
   Keep `processor.go:580` (`emotionEngine != nil`) guard as-is.
2. `lifecycle/runner.go:255-258` `onTick` — autonomy gate += `shouldAutomate` (re-reads flags; stops runners whose
   entity was flipped mid-flight).
3. `lifecycle/runner.go:300-302` outreach weight gate — unchanged (behind the runner already).

## C. Enumeration/review sites (carry the column, stay type-agnostic)

`handleFetchConfiguredEntities` (5-1 adds the fields), cache rebuilds (`management/routes_entities.go:15-27`,
`config/db/handler.go:203`, `cmd/run.go:254-261`, post-sync refresh `synchronization.go:1514-1524`),
`management/simulator.go:246`, `management/routes_character_profiles.go:248` — verify they compile/operate
unchanged with the new column (no filtering unless a dev-tools list wants a type column — optional).

## D. Out-of-repo flag (document, do not implement)

Cloud lifecycle-worker (consumes `NewEntityBeatRunner` `lifecycle/runner.go:84` + `PersistOutreachMessage`
`lifecycle/outreach.go:23-40`) must apply the same gate — record in the record doc as a cloud-track dependency.

## Tests (TDD — red → green)

- **RED first** (fail against today's ungated INIT): INIT user entity → session created, NO runner/emotion engine
  registered (assert service maps empty for it), chat STT path functional.
- INIT AI entity: runner + engine created (regression — stays green).
- **RED first**: AI entity flipped to user/disabled mid-flight → onTick no-ops (existing runner).
- **RED first**: user entity with cognition mapping → generation suppressed + warning logged.

## Verification

- [ ] `go build ./...`; `go test ./...` green
- [ ] `gitnexus_impact` on `EnsureBeatRunnerStarted`, `EnsureEmotionEngine`, `handleInitEntity` before editing;
      `gitnexus_detect_changes()` before committing
