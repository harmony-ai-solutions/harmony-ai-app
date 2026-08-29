# 4-3 — Engine Muted/Disabled Gates (Entity-Level, Global)

> Phase 4 / repo: **harmony-link-private**. Contract: `21-Engine-Contract` Q8 (final ruling), §5.3.
> Prerequisites: 1-3 (flags in schema) + 5-1 (flags in `EntityConfig`/cache — if 5-1 hasn't landed, do the cache
> plumbing part of 5-1 first: `LoadAllEntities` + `config.EntityConfig` must carry `IsMuted`/`IsDisabled`).

## Objective (Q8 final)

- `is_disabled` = the entity is **completely off**: no chat, no outreach, automations skip it.
- `is_muted` = everything normal except notifications.

## Gate sites

1. **INIT_ENTITY rejection** — `eventserver/eventprocessor.go` `handleInitEntity` fresh (:196-199 area) + resume
   (:726-728 area): after entity lookup, `if cfg.IsDisabled → error "entity_disabled"` (new constant
   `ErrEntityDisabled = "entity_disabled"` beside `ErrEntityNotDefined`, `handler_websocket.go:29`). This rejects
   sessions where the disabled entity is the INIT'd participant (the AI partner). Note: the POV/user entity being
   muted/disabled is irrelevant engine-side (flags are only meaningful for AI entities; do not gate on the
   participant that isn't the session entity).
2. **Automation skip (disabled)** — `lifecycle/service.go`: `EnsureBeatRunnerStarted` (:87-157, beside the autonomy
   check :108-111) and `EnsureEmotionEngine` (:52-71) return early for disabled entities. This shares the exact
   sites with the 5-2 entity_type gate — implement both checks together (one helper: `shouldAutomate(cfg) = type ==
   'ai' && !is_disabled`).
3. **Outreach delivery** — `eventserver/session.go` `DeliverOutreach` (:366-451): if the TARGET (partner) entity is
   disabled → drop the outreach entirely (no WS inject, no persist, no push). Muted target → deliver (WS/offline
   persist) but **skip the push branch** (:417-449).
4. **Push path** — the `NotifyOutreach` call site: suppressed when target `is_muted` OR `is_disabled` (belt-and-braces;
   disabled already returned earlier).
5. **Beat-runner defense-in-depth** — `lifecycle/runner.go` `onTick` (:255-258): add disabled check beside the
   autonomy gate (a runner started before the flag flipped stops acting).

## Config/source of truth

- Flags live on the `entities` row → sync applies them (LWW upsert, `synchronization.go:1306-1324`) → cache refresh
  (`RefreshEntityCache` post-sync, :1514-1524) makes them effective without restart. `config.EntityConfig`
  gains `EntityType`, `IsMuted`, `IsDisabled` (if not already from 5-1).
- Engine never writes the flags (UI-driven, app→sync→engine read-only). Document in the model docblock.

## Tests

- INIT with disabled entity → ERROR `entity_disabled`; enabled → proceeds. Muted → INIT proceeds.
- Disabled entity: no runner/emotion engine created; existing runner's onTick no-ops; DeliverOutreach drops.
- Muted: outreach persists + WS-delivers, push skipped.
- Flag flip via sync apply → cache refresh → next INIT honors new state (integration-style test along existing
  synchronization test patterns).

## Verification

- [ ] `go build ./...`; `go test ./...` green
- [ ] `gitnexus_impact` on `handleInitEntity`, `DeliverOutreach`, `EnsureBeatRunnerStarted` before editing;
      `gitnexus_detect_changes()` before committing
