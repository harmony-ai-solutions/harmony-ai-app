# Phase 0 — Verification & Ground Truth (reference)

> **Not a code deliverable.** This document captures the result of 6 parallel code-expert verification passes against both repos and consolidates the **corrected file:line anchors** + **design refinements** that every phase file relies on. Read this before executing any subtask.
>
> **Verdict: the plan works as intended.** All tracks returned overwhelmingly VERIFIED. The items below are reference corrections and design refinements — **not architectural blockers** — folded in so executors hit ground truth instead of the concept docs' occasionally-drifted anchors.

Repo roots:
- Engine (Go): `harmony-link-private/`
- App (RN/TS): `harmony-ai-app/`

---

## A. Design refinements the concept under-specified (folded into phases)

These are the points where verification **changed or sharpened** a concept decision. Each is implemented in the cited phase.

| # | Refinement | Why | Implemented in |
|---|---|---|---|
| **A1** | **Macro engine is net-new on BOTH sides; do NOT assume `buildBasePromptSection` resolves `{{original}}`.** It emits `profile.BasePrompt` raw (`prompt_builder.go:999-1008`). No `{{char}}/{{user}}/{{original}}` resolution exists anywhere in Go (grep clean). | Verification (greeting track, claim 9/12). | 1-7 |
| **A2** | **RAG provider is NOT guaranteed at `INIT_ENTITY`.** `EntityModuleMapping.rag_config_id` may be NULL or the mapping row absent → `ProviderDisabled` → `NewVectorStoreFromRAGConfig` returns `(nil,nil)`. The concept's "always-connected ⇒ always available" reasoning is **contradicted**. Lore embed/retrieve must **tolerate a nil vector store by explicitly nil-checking the store pointer** — the existing RAG module does NOT degrade gracefully on a nil *store*: when `r.vectorStore == nil` it returns `errDBNotInitialized` (`rag.go:215-217`/`:245-247`/`:281-283`). The `rag.go:222-224` graceful-degrade applies only to a nil **collection** (when `GetOrCreateCollection` returns `(nil,nil)` from a nil chromem DB — a different code path). New `LoreService` methods must no-op + return empty on a nil store. | Verification (RAG track, claim 4). | 3-1, 3-2 |
| **A3** | **Lore retrieval follows the processor pre-fetch pattern, NOT "builder runs the query".** `BuildSystemPrompt` has no RAG handle; `PromptContext` carries pre-fetched `RecalledMemories`. The proven pattern is `processor.go:842` (`FetchRecalledMemoriesForContext`) feeding the context, then `BuildSystemPrompt`. Top-N + `constant` union + dedup precedent: `buildSystemPromptMemorySection` (`prompt_builder.go:220-272`). | Verification (RAG track, claim 7). | 3-3 |
| **A4** | **`DeliverOutreach` live-path does NOT persist.** For a live phone session it only calls `UpdateCognitionOnUtterance` (`session.go:317-331`); the message row is written only on the offline path (hardcoded `MessageType:"outreach"`, `:339-352`). The greeting hook MUST **explicitly persist** the `conversation_messages` row regardless of live/offline. Use a **separate `DeliverGreeting`** (parameterizing `DeliverOutreach` churns the `SessionManagerCallback` interface at `lifecycle/session.go:24` + impl + call site `runner.go:743`). | Verification (greeting track, claim 5). | 1-8 |
| **A5** | **Truly-new-chat gate: define the pair predicate precisely + add a wrapper.** `FindPriorInteractions` (`interactions.go:279`, private scope `:285`) returns **ALL** historical interactions for the pair (any status, no time filter, no message-count condition) and has **no `config/db/handler.go`-level wrapper** (only controller-level `conversation_controller.go:80`). The concept's E1 ("first-ever meeting") maps directly: greeting fires iff `FindPriorInteractions(...) == empty` AND `count(messages for resolved interaction) == 0`. **Edge case to handle:** an empty prior interaction (e.g. auto-created by a previous INIT_ENTITY that never got a message) would block the greeting under a naive pair-check — `CloseStaleEmptyInteractions` (`interactions.go:159`) reaps stale empties but not same-session ones; the predicate should therefore be *"no prior interaction **with messages**"* OR accept E1 strictly and document the edge. **Decision for this plan (E1-loose — overrides concept E1 per orchestrator direction): gate on "no prior interaction WITH MESSAGES exists for the pair" AND "resolved interaction has zero messages".** This means an empty/abandoned prior interaction does NOT block the greeting — only a prior interaction that actually had messages blocks it. The wrapper must count messages per prior interaction (not just check existence). Add the handler-level wrapper. | Verification (greeting track, claim 4). | 1-9 |
| **A6** | **Register new events or hit a hard-error default.** `routeIncomingEvent` raises "none of the active modules has a receiver" (`eventprocessor.go:1034-1038`) for unhandled types. `GENERATE_GREETING` / `START_NEW_SCENARIO` must be added as event constants in `events/events.go` (const block `:7-127`) **and** registered in `IsHandlerFor`/`HandleEvent` in **`eventserver/eventprocessor.go` (`:99-134`)** — NOT in `events.go` (the `events.go:99-133` range is SYNC constants + the `HarmonyLinkEvent` struct, not the handler registrations). | Verification (greeting track, claim 11). | 2-2, 2-3 |
| **A7** | **`has_first_mes` must populate BOTH init paths.** `initEntityResponse` (`eventprocessor.go:137-143`) is marshalled in the fresh-init path (`:263`) AND the resume path (`resumeEntitySession`, `:364-368`). Add the field once; set it in both (or `omitempty` on resume). | Verification (greeting track, claim 11). | 1-9 |
| **A8** | **Hard-coded RAG collection-name lists must be touched.** Adding `lore` requires edits to `ListCollections` (`rag.go:1074-1079`), `DropEntityCollections` (`rag.go:153-167`), and awareness of `ListCollectionGroups` (`rag.go:1117`). Also **fix the stale comment** at `vector_store.go:14-16` (claims `memory_<entityId>` suffixed names; code is flat). | Verification (RAG track, claim 3). | 3-1 |
| **A9** | **Schema parity is enforced by CI, not a `sync_utils` comment.** There is **no** `go-schema.json` lockstep warning near `sync_utils.go:17-18` (concept mis-attributed it). Parity = CI `schema-parity.yml` + `scripts/dump-schema.ts` + `cmd/dump_schema.go`. New migration ⇒ update snapshots, regen `schema/rn-schema.json`, regen `schema/go-schema.json` (via `soulbits-engine dump-schema`), or CI fails. | Verification (data-model track, claim 5; frontend track, claim 8). | 1-1, 1-4 |
| **A10** | **PNG `ccv3` fix is insufficient alone — V3 struct must land with it.** `ParseCharacterCard` (`png_parser.go:108-121`) unmarshals into the V2-only `TavernCardV2`, so V3-only fields are lost regardless of chunk preference. Parser fix + V3 struct are coupled. | Verification (importer track, claim 4). | 1-5 |
| **A11** | **TS `extensions` passthrough DOES exist (scoped to the `extensions` key).** The concept's "no raw passthrough" is true only for *unknown top-level* keys. Keep `extensions` round-tripping; add a catch-all (or the explicit V3 fields) for unknown top-level keys. | Verification (importer track, claim 3c; frontend track, claim 5). | 1-5 |
| **A12** | **App field names are snake_case** (`voice_characteristics`, `typing_speed_wpm`, `audio_response_chance_percent`, `base_prompt`, `example_dialogues`). The new columns follow snake_case too. | Verification (frontend track, claim 1). | 1-3 |
| **A13** | **App migrations are forward-only** (single SQL string export; no `down`). The concept's `000037_*.up/down.sql` is Go-side notation only. The app migration guard (`migrations.ts:298-351`) forbids `DROP/RENAME COLUMN`, forcing the `_new`-table rebuild pattern if a column must change type — but `000037` is purely additive `ADD COLUMN`, so the guard is satisfied trivially. | Verification (frontend track, claim 7). | 1-3 |
| **A14** | **App sync is column-agnostic — zero wire changes for new columns.** `applySyncRecord` (`sync.ts:384-436`) is dynamic; send uses `SELECT *` (`sync.ts:321/334/341`); `character_profiles` is in `TABLE_ORDER` (`SyncService.ts:876`). The real edit surface is `models.ts` + `characters.ts` (4 SQL) + migration + snapshot + parity. | Verification (frontend track, claim 9). | 1-3, 1-4 |
| **A15** | **App ChatDetailScreen anchors corrected:** `isReadyToShow` overlay `:1149-1153` (not `:1138`); FlatList `:1364-1439` (not `:1316`), **no `ListEmptyComponent`**; `ChatInput` `:1461-1475` (not `:1413`). Empty-state short-circuit `messagesWithDivider` `:1011-1013`. | Verification (frontend-UX track, claim 1). | 1-10 |
| **A16** | **App import is a FAB speed-dial item, NOT a header action** (`CharactersScreen.tsx:450-475`); FAB state `:91-92` (not `:79`); `handleImportCard` `:272-300`. There is **no success toast today** (only failure `showAlert` `:298`; `importSuccess` i18n key is dead). `ImportReviewSheet` is net-new. | Verification (frontend-UX track, claim 4). | 3-5 |
| **A17** | **App `EntitySessionService:1062` is the INIT_ENTITY *response* handler, not the dispatch site** (dispatch: `:479-500`, `:273-299`). It already does a DB write (`createInteraction` `:1124-1193`) + emits `session:started` (`:1214`) + auto-sync (`:1217`). "Render-only" applies to **greeting** specifically — it coexists with the existing interaction-creation logic. | Verification (frontend-UX track, claim 5). | 1-10 |
| **A18** | **No bottom-sheet library installed** (no `@gorhom/bottom-sheet`, no `reanimated`/`gesture-handler`). All sheets use **react-native-paper `Modal`+`Portal`** (precedent: `ImpersonationSelectorModal.tsx:212-217`, `SelectPicker.tsx:8/72`) or RN `Modal` bottom-anchored. **Do NOT install gorhom.** | Verification (frontend-UX track, claim 10). | 2-4, 3-4, 3-5 |
| **A19** | **No shared `useReducedMotion` hook exists** — only `StatusPulseDot.tsx:17/41-44/143` implements the `AccessibilityInfo` pattern ad-hoc. Create a shared hook. | Verification (frontend-UX track, claim 7). | 1-10 |
| **A20** | **App i18n registration is two-step.** New `scenario` namespace ⇒ create `src/i18n/locales/en/scenario.json` **and** edit `src/contexts/I18nContext.tsx` (NOT `src/i18n/I18nContext.tsx` — that path does not exist; the file lives under `src/contexts/`) (import + `resources` `:71-97` + `ns` `:106-130`). `locales/index.ts` is a stale parallel re-export and is **not** consumed. Extending `characters.json`/`chatDetail.json` is safe (files exist). | Verification (frontend-UX track, claim 8). | 1-10 |
| **A21** | **`message_type="greeting"` needs a consumer audit (no compile-time safety).** No Go enum / TS exhaustiveness exists; risk is silent behavioral. Go consumers to audit: `GetOldestUncompactedMessages` (`messages.go:365`, excludes `'dream'`), dream queries (`:399`,`:431`), `processor.go:1261-1265`, `cognition.go:783-787`. App: `ChatBubble.tsx:254` (only checks `'audio'`); a greeting carrying text renders fine via the `hasText` block (`:355-387`). | Verification (data-model track, claim 8; frontend-UX track, claim 9). | 1-8, 1-10 |

---

## B. Verified ground-truth anchors (use these, not the concept docs' drifted ones)

### B.1 Engine (Go) — `harmony-link-private/`

| Symbol | File:line (verified) | Notes |
|---|---|---|
| `CharacterProfile` struct | `database/models/character.go:9` | 17 fields (lines 10–27). All 14 new columns genuinely absent. |
| `CharacterProfileSync` DTO | `database/models/character.go:30` | Separate struct (31–48). |
| `ToSyncModel` / `ToDBModel` | `character.go:50` / `:77` | Field-by-field; nullable cols need pointer/null handling (see `VisionConfigID`/`DeletedAt` blocks `:68-73`,`:95-100`); `ToDBModel` forces `LifecycleConfig="{}"` (`:102-104`). |
| Repo INSERT / SELECT-id / SELECT-all / UPDATE | `database/repository/characters/character_profiles.go:13-18` / `:38-43` / `:67-72` / `:109-117` | 4 explicit-column statements. Soft-delete UPDATE `:194` (no column list). |
| `queryGetChangedCharacterProfiles` | `database/sync_utils.go:23-26` (SELECT) + Scan `:261-265` | `CountChangedRecords` at `:1285`. |
| Migration guard | `database/migrations.go:311-358` | Forbids `DROP/RENAME COLUMN` on **UpSQL only**; `ADD COLUMN` permitted. Down not guarded. |
| `message_type` column | free TEXT, default `'text'` (e.g. `migrations/000027:33`) | `'dream'` precedent `000016:37-38`. Model `conversation.go:16`. |
| Mapper entry | `utils/charactercard/mapper.go:12` `MapToCharacterProfile` | |
| `mapCharacterBook` | `mapper.go:44-62` (called `:22`) | Flattens to `"CHARACTER LORE:\n\n"` (`:50`); skips disabled (`:53`); writes `Keywords:…` + `content` only. |
| `mapExampleDialogues` | `mapper.go:65-85` (called `:26`) | Concatenates `first_mes`/`mes_example`/`alternate_greetings` into `"EXAMPLE DIALOGUES:\n\n"`. |
| Hardcoded defaults | `mapper.go:21` `Appearance:""`, `:23` `VoiceCharacteristics:""`, `:27` `TypingSpeedWPM:60`, `:28` `AudioResponseChancePercent:50`; `:24` `BasePrompt: SystemPrompt` | |
| Card types | `utils/charactercard/types.go` | `TavernCardV2:4`, `TavernCardV2Data:10-26` (has `Extensions map[string]any:25`), `CharacterBook:28-36` (`Extensions:34`), `CharacterBookEntry:38-44` (**only** keys/content/extensions/enabled/insertion_order — missing 10 V3 fields), `TavernCardV1:47`. Value types + `omitempty` (lossy): `ScanDepth:31`,`TokenBudget:32`,`RecursiveScanning:33`. |
| PNG reader | `utils/charactercard/png_parser.go:60` (`chara`\|\|`ccv3`), `break:83` | First-match; no `ccv3` preference. `ParseCharacterCard:108-121` unmarshals into V2 struct. |
| Exporter | **does not exist** | Net-new in P4. |
| `handleInitEntity` | `eventserver/eventprocessor.go:145` | `ResolveInteraction` called `:233` (60-min gap `:237`); injection point `~:241-246`. |
| `ResolveInteraction` | `config/db/handler.go:838` | Resume within gap window `:867-882` (`FindActiveInteraction`). |
| `CloseStaleEmptyInteractions` call | `config/db/handler.go:863` | Def `database/controllers/interaction_controller.go:111` → `repository/interaction/interactions.go:159`. |
| `FindPriorInteractions` | `repository/interaction/interactions.go:279` (private scope `:285`) | Returns ALL historical for pair; no handler wrapper. |
| `GetConversationMessagesByInteraction` | `database/repository/conversation/messages.go:175` | For the zero-message check. |
| `DeliverOutreach` | `eventserver/session.go:296` | Live path does NOT persist (`:317-331`); offline persists `MessageType:"outreach"` (`:339-352`); does NOT touch `lastOutreachTime`. On `SessionManagerCallback` `lifecycle/session.go:24`. |
| Reactive `len<=1` drop | `modules/cognition.go:727-730` (case `ENTITY_UTTERANCE` `:719`) | Greeting must bypass. |
| `fireOutreachBeat` | `lifecycle/runner.go:618` (cooldown `:630-636`) | build `:686` → `SendComplexPromptSync:702` → deliver `:743`. |
| `SendComplexPromptSync` | `modules/backend.go:185` (→ `client.go:35`) | |
| Beat runner autonomy gate | `eventprocessor.go:214` (`autonomy_level>0` → `EnsureBeatRunnerStarted:221`) | Runs before `ResolveInteraction`. |
| Event constants | `events/events.go:7-127` (`INIT_ENTITY:15`) | Dispatch `IsHandlerFor:99-115` + `HandleEvent:117-133` + `routeIncomingEvent:974-1040` (hard-error default `:1034-1038`); `SendEvent:78-97`. |
| `initEntityResponse` | `eventprocessor.go:137-143` | Marshalled fresh `:263` + resume `:364-368`. Add `has_first_mes` (mirror `Resumed:142`). |
| Prompt builder | `modules/cognition/prompt_builder.go` | `BuildSystemPrompt:1215`; `buildSystemPromptCharacterSection:178` reads Name/Description/Personality/Scenario/Appearance/Backstory/ExampleDialogues (`:180-205`); `buildBasePromptSection:999-1008` emits `BasePrompt` RAW (no `{{original}}`); existing modes `BuildBeatSystemPrompt:1148`, `BuildCompactionSummaryPrompt:2008`. |
| Memory section (top-N+constant+dedup) | `prompt_builder.go:220-272` (dedup `:244-259`) | Template for lore injection. |
| RAG `VectorStore` | `modules/rag/vector_store.go:17-22` | Lazy `GetOrCreateCollection:107-140`; `NewVectorStoreFromRAGConfig:38-54` (returns `nil,nil` if disabled); embedding via `initEmbeddingFuncFromRAGConfig:56-103`. **Fix stale comment `:14-16`.** |
| `RAGModule` | `modules/rag.go` | Per-entity folder `:76-79`; flat collection names `memories:47`,`messages:48`,`cached-actions:34`,`cached-animations:35`; add-pattern `GetOrCreateCollection:656`+`AddConcurrently:610`+`Query:692`; metadata `:226-233`, returned `:269-275`; nil-**store** ERRORS (`:215-217`/`:245-247`); nil-**collection** degrades (`:222-224`) — new `LoreService` must nil-check the store pointer explicitly (see §A2). |
| Hard-coded name lists | `ListCollections:1074-1079`, `DropEntityCollections:153-167`, `ListCollectionGroups:1117` | Must add `lore`. |
| `MovementService` interface | `modules/rag/base.go:76-88` | `QueryTextResultSet`/`Metadata map[string]string` at `base.go:145-153`. |
| `EntityModuleMapping.rag_config_id` | `database/models/entity.go:79` (`sql.NullString`) | Resolution `config/db/handler.go:1010-1019`; missing mapping → disabled `:955-963`. |
| Processor pre-fetch pattern | `modules/cognition/processor.go:824-871` (query `:835-840`, `FetchRecalledMemoriesForContext:842`, feed `ctx.RecalledMemories:855`, build `:871`) | helper `state.go:100-120`. |
| RAG service wiring | `eventserver/eventprocessor.go:686-700` (`RefreshRAGServices`/`RefreshMovementService`) | New `LoreService` wires here. |

### B.2 App (RN/TS) — `harmony-ai-app/`

| Symbol | File:line (verified) | Notes |
|---|---|---|
| `CharacterProfile` interface | `src/database/models.ts:13-31` | snake_case fields. All 14 new fields absent. |
| `ConversationMessage` | `src/database/models.ts:469-499`; `message_type` union `:476` = `'text'\|'audio'\|'combined'\|'image'` | Add `'greeting'`. Column free TEXT (`migrations/000005:44`,`000013:52`). |
| TS mapper | `src/utils/charactercard/mapper.ts` | `mapCharacterBook:24` (`CHARACTER LORE:\n\n:29`), `mapExampleDialogues:52` (`EXAMPLE DIALOGUES:\n\n:53`), `mapCardToProfile:85` (object `:98-113`; `backstory:104`,`base_prompt:106`,`example_dialogues:108`; defaults `appearance:103`,`voice:105`,`typing:109`,`audio:110`). |
| TS types | `src/utils/charactercard/types.ts` | `TavernCardV2Data:21-37` (parses creator_notes/tags/creator/character_version/extensions, mapper ignores), `CharacterBookEntry:49-55` (only 5 fields). No index signature. |
| TS JSON parser | `src/utils/charactercard/jsonParser.ts:33-51` `normalizeData` (applied `:86`) | Drops unknown top-level keys. |
| TS PNG reader | `src/utils/charactercard/pngParser.ts:271-293` (`break:292`) | First-match; no `ccv3` preference. |
| Characters repo | `src/database/repositories/characters.ts` | INSERT `:31-38`, SELECT-id `:76-89`, SELECT-all `:127-141`, UPDATE `:183-189`; row map `:98-116`/`:148-166`. |
| Migrations | `src/database/migrations/` max `000036` | `000034_add_unique_name_constraint_vision_imagination`, `000035_character_image_uuid_primary_key`, `000036_harmonyspeech_api_key`. Register in `src/database/migrations.ts:11-46` (imports) + `:58-239` (`MIGRATIONS` array). Forward-only. Guard `:298-351`. |
| Snapshot/parity | `scripts/dump-schema.ts`; `src/database/__tests__/migrations.snapshot.test.ts:34-38`; snapshots `__tests__/__snapshots__/`; `.github/workflows/schema-parity.yml:28-35` (trigger), `:81-92` (compare); baseline `schema/rn-schema.json` (committed). | Update via `--updateSnapshot`; regen `rn-schema.json`. |
| Sync (column-agnostic) | `src/database/sync.ts:384-436` `applySyncRecord`; send `SELECT *` `:321/334/341`; `TABLE_ORDER` `src/services/SyncService.ts:876` (NOT `src/database/` — file lives under `src/services/`) | Zero wire changes for new cols. |
| `ChatDetailScreen` | `src/screens/ChatDetailScreen.tsx` | `getRecentConversationMessages:253`; overlay `:1149-1153`; FlatList `:1364-1439` (no `ListEmptyComponent`); `ChatInput:1461-1475`; empty short-circuit `:1011-1013`. |
| Route params | `src/navigation/AppNavigator.tsx:42-48` | `{ interactionId, participantKey?, participantIds?, entityId(=own), entityName? }`. |
| `CharacterProfileEditScreen` | `src/screens/CharacterProfileEditScreen.tsx` | field state `:61-71`; composes `ThemedCard:14/302`,`SectionHeader:15/303`,`ScreenHeader:16/349`,`ThemedButton:29/608`,`useAppAlert:25/52`,`ProfileImagePicker:30/582`. |
| `CharactersScreen` | `src/screens/CharactersScreen.tsx` | FAB `expanded/expandAnim:91-92`; import is FAB speed-dial item `:450-475`; `handleImportCard:272-300` (`pick:278`,`importCharacterCardFromFile:286`); failure `showAlert:298`; **no success toast**; `ScreenHeader:341-372` (search only). |
| `EntitySessionService` | `src/services/EntitySessionService.ts` | `:1062` = `handleInitEntityResponse` (handler `:1069-1250`); dispatch `:479-500`,`:273-299`; `createInteraction:1124-1193`; `session:started:1214`; sync `:1217`. No greeting logic today. |
| Themed primitives | all exist | `src/components/themed/{ThemedCard,ThemedText,ThemedButton,SectionHeader,ScreenHeader,ThemedView,ThemedFab,ThemedAppbar,ThemedGradient}.tsx`; `src/components/chat/{ChatBubble,ChatInput,TypingIndicator,NewMessagesDivider,EmojiActionInput}.tsx`; `src/components/characters/{ProfileImagePicker,CharacterProfileCard,ProfilePickerCard}.tsx`; `src/components/background/DynamicAtmosphericBackground.tsx`; `src/components/config/SelectPicker.tsx`; `src/contexts/AppAlertContext.tsx` (`useAppAlert:108`). |
| Reduced motion | `src/components/cloud/StatusPulseDot.tsx:17/41-44/143` | Only ad-hoc consumer. Create shared hook. |
| i18n | `src/i18n/locales/en/*.json` (24 files); `src/contexts/I18nContext.tsx` (NOT `src/i18n/` — file lives under `src/contexts/`) (imports `:19-41`,`resources:71-97`,`ns:106-130`) | `characters.json`,`chatDetail.json` exist. `locales/index.ts` stale. |
| `ChatBubble` | `src/components/chat/ChatBubble.tsx` | Only `message_type` check `:254` (`'audio'`); content-driven `:244-478`; greeting w/ text renders via `hasText:355-387` + partner gradient `:512-522`. |
| Bottom sheets | none installed | Use paper `Modal`+`Portal`. |

---

## C. Migration numbering (confirmed free)

- **Both repos: next free = `000037`.** Max on each = `000036_harmonyspeech_api_key`.
- `000034` = `add_unique_name_constraint_vision_imagination`; `000035` = `character_image_uuid_primary_key`.
- **P1 ships exactly one migration per repo:** `000037_add_character_card_standard_fields` (the `character_book` JSON column is included here — it is NOT a separate migration; P3 lorebook adds no new migration).

---

## D. GitNexus impact-analysis reminders (per AGENTS.md)

Before editing any existing symbol listed in section B, run `gitnexus_impact({target, direction:"upstream"})` and report blast radius. Symbols with the widest likely blast radius in this plan: `CharacterProfile`/`CharacterProfileSync`, `MapToCharacterProfile`, `mapCardToProfile`, `handleInitEntity`, `DeliverOutreach`, `BuildSystemPrompt`, `RAGModule`, `applySyncRecord`. Run `gitnexus_detect_changes()` before each commit.
