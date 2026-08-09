# 1-10 — App Greeting Render-Only UX

> **Phase 1** (frontend capstone). Depends on [1-3](1-3-AppMigration000037AndModels.md), [1-7](1-7-MacroEngine.md), [1-9](1-9-GoInitEntityGreetingHook.md). Read [`00-VerificationAndGroundTruth.md`](00-VerificationAndGroundTruth.md) first.
> **Repo:** `harmony-ai-app/`.

## Objective

Render the engine-delivered greeting as a normal partner message. The app is **render-only**: no local `first_mes`, no optimistic placeholder, no reconciliation. Three P1 deliverables: (1) `EntitySessionService` reads `has_first_mes` from the INIT_ENTITY SUCCESS payload and renders the arriving `message_type="greeting"` message (or shows empty + hint when `false`); (2) `ChatDetailScreen` shows a `GreetingBubble` + authored `AlternateGreetingSwiper` (no generation in P1) + `EmptyChatCTA` hint; (3) shared infra: `useReducedMotion` hook + `GreetingShimmer` + the `scenario` i18n namespace + macro-resolved preview. The composer ✨ scenario icon is present but **disabled** in P1 (generation lands in P2).

## Ground truth (verified — [00 §B.2](00-VerificationAndGroundTruth.md), [§A15–A20](00-VerificationAndGroundTruth.md))

- `ChatDetailScreen.tsx`: `getRecentConversationMessages:253`; `isReadyToShow` overlay `:1149-1153`; FlatList `:1364-1439` (**no `ListEmptyComponent`**); `ChatInput:1461-1475`; `messagesWithDivider` empty short-circuit `:1011-1013`. Route params `AppNavigator.tsx:42-48`.
- `EntitySessionService.ts`: `:1062` = `handleInitEntityResponse` (handler `:1069-1250`); dispatch `:479-500`,`:273-299`; already does `createInteraction` (`:1124-1193`) + `session:started` (`:1214`) + auto-sync (`:1217`). **No greeting logic today.** ([00 §A17](00-VerificationAndGroundTruth.md))
- `ChatBubble.tsx`: only `message_type` check `:254` (`'audio'`); content-driven `:244-478`; a greeting carrying text renders fine via `hasText:355-387` + partner gradient `:512-522`. **No new ChatBubble code needed** for text greetings — just ensure `isOwn`/partner derivation treats `greeting` as a partner message.
- No `@gorhom/bottom-sheet`; use paper `Modal`+`Portal` ([00 §A18](00-VerificationAndGroundTruth.md)).
- No shared `useReducedMotion` — only `StatusPulseDot.tsx:17/41-44/143` ad-hoc ([00 §A19](00-VerificationAndGroundTruth.md)).
- i18n: one JSON per namespace; new `scenario` namespace ⇒ create file + edit `src/contexts/I18nContext.tsx` (NOT `src/i18n/` — file lives under `src/contexts/`) (`resources:71-97`, `ns:106-130`); `locales/index.ts` is stale ([00 §A20](00-VerificationAndGroundTruth.md)).
- Macro engine: `resolveMacros` from [1-7](1-7-MacroEngine.md).

## Components to create (compose existing Obsidian Glass primitives — [00 §B.2](00-VerificationAndGroundTruth.md))

> All under `src/components/chat/` (or `src/components/character-card/` for editor pieces that land in P3). Build on `ThemedCard`/`ThemedText`/`ThemedButton`/`TypingIndicator`.

| Component | Purpose (P1 scope) | Composes |
|---|---|---|
| `GreetingBubble` | Render the greeting as a partner glass message. 2 states: `preparing` (shimmer + `TypingIndicator`) / `arrived` (resolved text). In P1 only `arrived` is exercised (authored delivery is instant); `preparing` ships for P2. | `ThemedCard`,`ThemedText`,`TypingIndicator`,`GreetingShimmer` |
| `GreetingShimmer` | Skeleton for in-flight greeting; reduced-motion → static skeleton. | `ThemedCard` skeleton |
| `AlternateGreetingSwiper` | Horizontal pager over `[first_mes, …alternate_greetings]` + chevrons + `2/4` indicator. **Authored only in P1** (JSON column); regenerate-swipe slot disabled until P2. Reduced-motion → chevrons only. | `GreetingBubble`,`ThemedButton` |
| `EmptyChatCTA` | The scenario trigger. **P1: present but disabled** (generation is P2). Rendered (1) as an icon on the right of `ChatInput` shown when input empty, vanishing on typing; (2) as a ✨ Scenario pill beside the swiper (discoverability). Both open `ScenarioGeneratorSheet` (P2). In P1, tapping shows a "coming soon"/disabled state. | `ThemedButton` |

Plus a shared hook `src/hooks/useReducedMotion.ts` (extract the `StatusPulseDot` pattern: `AccessibilityInfo.isReduceMotionEnabled()` + `reduceMotionChanged` listener).

## Files to create

- `src/components/chat/GreetingBubble.tsx`
- `src/components/chat/GreetingShimmer.tsx`
- `src/components/chat/AlternateGreetingSwiper.tsx`
- `src/components/chat/EmptyChatCTA.tsx`
- `src/hooks/useReducedMotion.ts`
- `src/i18n/locales/en/scenario.json` (new namespace — keys: `title`, `ctaScenario`, `preparingOpening`, `noGreetingHint`, `swipeIndicator` (use `chatDetail`?), `scenarioRestart`, `generate`, `generating`, `generateAnother`, `generateFailedBackend`, `mood`, `setting`, `relationship`, `timeOfDay`, `whoStarts`, `premise`, `surpriseMe` — define all now, P2/P3 consume them).
- Extend `src/i18n/locales/en/characters.json` + `chatDetail.json` with the keys listed in concept 02 §5.14 (`greeting`, `greetingHint`, `alternateGreetings`, …; `swipeIndicator` `"{{n}}/{{total}}"`, `scenarioSheetTitle`).

## Files to modify

### `src/contexts/I18nContext.tsx` (NOT `src/i18n/` — file lives under `src/contexts/`) ([00 §A20](00-VerificationAndGroundTruth.md))

- Import `scenario` JSON (near `:19-41`).
- Add to `resources` (`:71-97`): `en.scenario = scenario`.
- Add `'scenario'` to the `ns` array (`:106-130`).

### `src/services/EntitySessionService.ts` ([00 §A17](00-VerificationAndGroundTruth.md))

In `handleInitEntityResponse` (`:1062`, handler `:1069-1250`):
- Read `has_first_mes` from the SUCCESS payload.
- Do **not** fabricate a greeting. The greeting arrives as a normal `message_type="greeting"` message via the existing message-load/sync path; `handleInitEntityResponse` only needs to expose `has_first_mes` (e.g. emit it on `session:started` or store it on the session) so `ChatDetailScreen` can branch synchronously (show `GreetingBubble`/`EmptyChatCTA` immediately instead of racing the async message).
- Coexist with existing `createInteraction` (`:1124-1193`), `session:started` (`:1214`), auto-sync (`:1217`) — those are unchanged; greeting rendering is additive.

### `src/screens/ChatDetailScreen.tsx` ([00 §A15](00-VerificationAndGroundTruth.md))

- Detect truly-new chat (zero messages + new interaction — mirror the engine gate for display purposes).
- When truly-new:
  - If `has_first_mes` → render the `message_type="greeting"` message (arrives via `getRecentConversationMessages:253`) wrapped in `AlternateGreetingSwiper` (authored swipes from `profile.alternate_greetings`).
  - Else → `EmptyChatCTA` hint (disabled in P1).
- `ChatInput` (`:1461-1475`): add the `EmptyChatCTA` icon on the right (shown when input empty, disabled in P1).
- FlatList (`:1364`): optionally add a `ListEmptyComponent` for the no-`first_mes` empty state (the `EmptyChatCTA` hint). (Today there is none — [00 §A15](00-VerificationAndGroundTruth.md).)
- Resolve macros in the rendered greeting via `resolveMacros(text, charName, userName)` ([1-7](1-7-MacroEngine.md)) for display.

### `src/components/chat/ChatBubble.tsx`

- Ensure `isOwn`/partner derivation treats `message_type="greeting"` as a **partner** message (it is `sender_entity_id`=character). Likely no change needed (content-driven, [00 §A21](00-VerificationAndGroundTruth.md)) — verify with a test.

## Implementation steps

1. Create `useReducedMotion` (extract from `StatusPulseDot`).
2. Create `GreetingShimmer` → `GreetingBubble` (states preparing/arrived) → `AlternateGreetingSwiper` (authored) → `EmptyChatCTA` (disabled P1).
3. Create `scenario.json` + extend `characters.json`/`chatDetail.json`; register `scenario` in `src/contexts/I18nContext.tsx`.
4. Wire `EntitySessionService` to surface `has_first_mes`.
5. Wire `ChatDetailScreen` (truly-new detection, GreetingBubble, swiper, empty hint, composer icon).
6. Tests: render a `message_type="greeting"` → partner bubble; `has_first_mes=false` → empty hint; reduced-motion → chevrons only.

## Verification

- [ ] `useReducedMotion` hook created (and optionally refactor `StatusPulseDot` to use it).
- [ ] `GreetingBubble` / `GreetingShimmer` / `AlternateGreetingSwiper` (authored) / `EmptyChatCTA` (disabled P1) created.
- [ ] `scenario.json` created + registered in `src/contexts/I18nContext.tsx`; `characters`/`chatDetail` extended.
- [ ] `EntitySessionService` surfaces `has_first_mes` (no fabrication, no reconciliation).
- [ ] `ChatDetailScreen`: truly-new + `has_first_mes` → GreetingBubble + swiper; `has_first_mes=false` → empty hint.
- [ ] Composer ✨ icon present, disabled in P1.
- [ ] Macros resolved in the rendered greeting.
- [ ] `npx tsc --noEmit` + relevant jest tests pass.
- [ ] `gitnexus_detect_changes()` — expected scope.

## Notes / deviations

- **[00 §A17](00-VerificationAndGroundTruth.md):** `:1062` is the response handler; "render-only" applies to greeting specifically (coexists with existing `createInteraction`).
- **[00 §A18](00-VerificationAndGroundTruth.md):** no bottom-sheet lib — but P1 ships no sheet (`ScenarioGeneratorSheet` is P2). When it lands, use paper `Modal`+`Portal`.
- **[00 §A20](00-VerificationAndGroundTruth.md):** i18n registration is two-step.
- The composer ✨ icon availability rule (shown whenever input empty) is unchanged from the concept; only the *action* gates on P2 ([concept 02 §6.1](../character-data-chat-start-concept/02-frontend-and-ux-concept.md)).
