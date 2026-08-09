# Character Data & Chat-Start — Frontend & UX Concept

> **Scope owner:** Frontend & UX architect (this doc).
> **Aligns to:** [`01-data-and-engine-concept.md`](01-data-and-engine-concept.md) (data/backend backbone — decisions there are treated as fixed; conflicts are *flagged*, never silently overridden). Tracks the backbone's greeting ownership (§3.1 / §3.6: engine-authoritative, app render-only, authored `first_mes` at init for new chats only) and lorebook mechanism (§1.4: RAG semantic).
> **Mode:** Brainstorming/planning — flows + component sketches + trade-offs + a **recommended** path. No implementation code.
> **Repo (where the UI lives):** `harmony-ai-app` — React Native 0.86 + TypeScript, React Native Paper MD3, React Navigation. Obsidian Glass aesthetic (see [`systemPatterns.toon`](memory-bank/systemPatterns.toon) @Glassmorphism).

---

## 0. Executive summary — headline UX recommendations

| Area | Recommendation |
|---|---|
| **Empty-state strategy (the core fix)** | A new chat **never opens to a bare list + input**. If the card has an authored `first_mes`, the engine delivers it at `INIT_ENTITY` and the app renders a [`GreetingBubble`](#51-greetingbubble) instantly (render-only). If there is **no** `first_mes`, the chat opens **empty** with a composer ✨ **scenario icon** ([`EmptyChatCTA`](#54-emptychatcta)) pointing to the greeting generator. While the user **generates** a custom greeting (random/directed/scenario-restart), show a **"preparing"** [`GreetingShimmer`](#513-greetingshimmer) + [`TypingIndicator`](src/components/chat/TypingIndicator.tsx) until the `message_type="greeting"` message arrives. No local fabrication, no reconciliation. |
| **Opening & greeting behaviour (no policy)** | The engine **always** delivers the authored `first_mes` at init (zero friction). There is **no greeting policy** and nothing to persist. Three start options are available: (1) **authored `first_mes`** (default, zero taps); (2) **dynamic scenario** — a composer ✨ icon (right side of the input; shown at open whether or not a `first_mes` exists; vanishes on typing) opens the generator; (3) **authored alternate greeting** — swipe + first send (engine swaps the greeting). |
| **Guided-input transport (UX view)** | **Single `GENERATE_GREETING` event.** `INIT_ENTITY` always fires immediately (authored `first_mes` synchronous); every custom / regenerate / scenario-restart greeting is a follow-up `GENERATE_GREETING` (decoupled from session lifecycle). See §2.3. |
| **Swipe model** | Authored `first_mes` + `alternate_greetings[]` as horizontal **swipes** with chevrons + `2 / 4` indicator (a11y-safe; reduced-motion = chevrons only). **Authored swipes ship in P1** (JSON column, no generation); **regenerate-swipe** is gated on P2 generation. |
| **Lorebook editor** | Summary section in the profile editor → **`LorebookViewerSheet`** (bottom sheet) → per-entry **`LorebookEntryEditor`**. Matching is **semantic** (backbone §1.4): keyword/position/budget fields are shown as "preserved for export", and the per-entry hint reads "retrieved when the conversation is semantically related to this entry". An optional **"Test match"** runs a semantic query (type a phrase → top-matching entries). |
| **Profile editor additions** | New sections: **Greeting** (live-preview bubble), **Alternate Greetings** (manager), **Attribution & Provenance** (creator/notes/version/source), **Tags**, **Lorebook**, and an **Advanced** group (`post_history_instructions`, `mes_example`). Plus a **"Preview opening / Test scenario"** affordance. |
| **Import** | Post-import **`ImportReviewSheet`**: shows what was detected (greeting? alt-greetings count? lorebook entries? tags? provenance), review/edit before save, and a "no greeting → generate/write one" CTA. |
| **New components** | `GreetingBubble`, `AlternateGreetingSwiper`, `ScenarioGeneratorSheet`, `EmptyChatCTA`, `GreetingEditor`, `AlternateGreetingsManager`, `LorebookViewerSheet`, `LorebookEntryEditor`, `CreatorAttributionBadge`, `TagChips`, `ImportReviewSheet`, `GreetingShimmer`. All compose existing Obsidian Glass primitives. |
| **Reduced motion** | Shimmer → static skeleton; swipe gesture → chevrons only; streaming typing dots → single static ellipsis. |

---

## 1. Chat-start onboarding flow (the "stop struggling to start" fix)

### 1.1 Today's gap (grounded)

[`ChatDetailScreen.tsx`](src/screens/ChatDetailScreen.tsx) opens a new chat with `messages = []` (loaded via `getRecentConversationMessages` at [`:253`](src/screens/ChatDetailScreen.tsx:253)), gates the view behind an `ActivityIndicator` overlay until `isReadyToShow` ([`:1138`](src/screens/ChatDetailScreen.tsx:1138)), then renders a [`FlatList`](src/screens/ChatDetailScreen.tsx:1316) with **no `ListEmptyComponent`** and a [`ChatInput`](src/screens/ChatDetailScreen.tsx:1413). Result: a brand-new chat is an **empty list + an input bar**. There is no greeting, no empty-state CTA, no "the character is here" signal. Route params come from [`AppNavigator.tsx:43`](src/navigation/AppNavigator.tsx:43): `{ interactionId, participantKey?, participantIds?, entityId(=own), entityName? }`.

### 1.2 The new opening state (recommended)

The instant a **new** chat is detected (truly new — no prior interaction and zero messages, mirroring the backbone's greeting-hook gate §3.4), the screen renders a **partner-side [`GreetingBubble`](#51-greetingbubble)** with the engine-delivered authored `first_mes`, or — if the card has none — an empty state with a "generate a greeting" hint. The app does **not** resolve authored-vs-generated and holds **no local copy**; it only renders what the engine delivers (engine-authoritative, backbone §3.1/§3.6). Two render states for the bubble:

```mermaid
flowchart TD
    Open([New chat opens]) --> New{truly new chat?}
    New -->|no - resume| Normal([normal conversation view])
    New -->|yes| HasFM{authored first_mes delivered at INIT?}
    HasFM -->|yes| Arrived[Render message_type=greeting as normal partner message]
    HasFM -->|no| Empty[Empty state + EmptyChatCTA hint to generate]
    Empty --> WantGen
    Arrived --> WantGen{user triggers generate custom or scenario restart?}
    WantGen -->|no| Done([chat ready])
    WantGen -->|yes| Preparing[Show GreetingShimmer + preparing indicator]
    Preparing --> OK{generation ok?}
    OK -->|yes| Arrived
    OK -->|no - fail| Err[Inform user - backend issue, retry]
    Err --> Done
```

**Concrete states for the opening [`GreetingBubble`](#51-greetingbubble):**

| State | Trigger | What the user sees | Data source |
|---|---|---|---|
| **Preparing (shimmer)** | user triggered a generation (random/directed/scenario-restart); greeting not yet arrived | A partner bubble skeleton + [`TypingIndicator`](src/components/chat/TypingIndicator.tsx) ("preparing an opening…") with a [`GreetingShimmer`](#513-greetingshimmer). No streaming — the greeting arrives whole on completion. | engine (in flight) |
| **Arrived** | the `message_type="greeting"` message arrives — authored from `INIT_ENTITY` (instant) *or* generated | The greeting rendered as a normal glass partner message, `{{user}}`/`{{char}}` resolved. | engine-delivered `message_type="greeting"` message |

> No-bubble case: if the card has **no** `first_mes` and the user has not generated one, there is no `GreetingBubble` — the composer shows the ✨ **scenario icon** ([`EmptyChatCTA`](#54-emptychatcta)) pointing to the greeting generator (the authored `first_mes` is never fabricated client-side).

> **Synchronous branch (backbone §3.4 C3):** the app decides *"authored first_mes delivered at INIT?"* from the **`has_first_mes: boolean`** field now carried in the INIT_ENTITY SUCCESS payload — not by racing the async greeting message. This removes the empty-state flicker.

> **First-ever only (backbone E1):** a greeting is shown only when there is **no prior interaction** for the pair. A returning user who opens a new interaction after a gap gets **no** greeting (empty + hint) unless they explicitly start a new scenario via scenario restart.

> **No reconciliation (aligned to backbone §3.6):** the app holds **no local copy** of the greeting to reconcile — it renders the message when it arrives, exactly like any other incoming partner message. There is no optimistic placeholder, no sentinel, and no replace/suppress logic. The authored `first_mes` arrives at init (instant); only a user-triggered generation shows the "preparing" shimmer. If the card has no `first_mes`, there is no greeting to render until the user generates one (empty state + CTA).

> **Message-type handling (backbone §3.4 C2):** the app must extend its `message_type` union (currently `'text' | 'audio' | 'combined' | 'image'`) and `ChatBubble` rendering to cover the new `greeting` value. No SQL schema change (the column is free TEXT); the greeting simply renders as a normal partner message.

### 1.3 The "How do you want to begin?" moment

**No greeting policy, zero friction.** There is no "pick a mode" choice and no `greeting_policy` to store — the engine always delivers the authored `first_mes` at init, which renders instantly. Three ways to start a chat:

1. **Authored `first_mes`** (default) — renders at init, zero taps.
2. **Dynamic scenario** (LLM-generated) — tap the **composer ✨ scenario icon** to open [`ScenarioGeneratorSheet`](#52-scenariogeneratorsheet); the engine generates an opener. Available whether or not the card has a `first_mes`.
3. **Alternate greeting** (authored card content) — swipe the [`AlternateGreetingSwiper`](#52-alternategreetingswiper) to a card-provided alternate; on the user's first message the chosen alternate is sent with the payload and the engine swaps the greeting + responds (§1.4 / backbone §3.5).

- **Composer scenario icon (canonical entry — and the restart trigger).** A **dynamic ✨ icon button sits on the right side of the composer** and is shown **whenever the input is empty** — at chat open *and* mid-conversation, as long as the user hasn't started typing. Tapping it opens [`ScenarioGeneratorSheet`](#52-scenariogeneratorsheet). The engine decides the effect from conversation state: if the greeting is still the only message it **replaces** the greeting; if the conversation has already started it is a **scenario restart** (new scene / new interaction, backbone §3.3). It **vanishes as soon as the user starts typing** (or sends).
- **✨ Scenario pill next to the alternate-greeting swiper (discoverability).** When a `first_mes` is shown, a **✨ Scenario…** pill sits beside the [`AlternateGreetingSwiper`](#52-alternategreetingswiper) (`‹ 1/3 › ✨ Scenario…`). It opens the same sheet — purely so users *see* the dynamic-scenario option without dropping to the composer. (The greeting message's detail-menu *Generate scenario* is no longer needed.)
- **No `first_mes`:** the chat opens empty; the composer scenario icon (and, once an opener exists, the swiper + pill) let the user generate one. Until they do, there is no greeting to render.

```
┌──────────────────────────────────────────────┐
│  ◀  Marcella                          ⋮       │   <- ScreenHeader (avatar+name)
├──────────────────────────────────────────────┤
│                                              │
│        ╭─────────────────────────────╮       │
│        │ Hey… you came. I wasn't      │       │   <- GreetingBubble (authored first_mes)
│        │ sure you would. *leans back* │       │
│        ╰─────────────────────────────╯       │
│   ‹  1/3  ›        ✨ Scenario…        │   <- AlternateGreetingSwiper + ✨ Scenario pill (discoverability)
├──────────────────────────────────────────────┤
│  [😊]  Type a message…          [✨ ▲ send]  │   <- ChatInput: ✨ composer scenario icon (right), shown whenever input empty
└──────────────────────────────────────────────┘
```

### 1.4 Alternate greetings as "swipes" (SillyTavern-style)

The opening [`GreetingBubble`](#51-greetingbubble) is wrapped in an [`AlternateGreetingSwiper`](#52-alternategreetingswiper):

- **Swipes** cycle the opener through `[first_mes, …alternate_greetings[]]`.
- **Chevrons** `‹ / ›` + a **position indicator** `2 / 4` (always visible for a11y and discoverability).
- **Reduced motion:** swipe gesture disabled; chevrons remain the only control.
- **Regenerate / "Generate another":** when the user reaches the last authored greeting and swipes further (or taps **⟳ Generate another**), the app requests a fresh engine generation (P2). While generating, the next swipe slot shows a shimmer. **Generated greetings are ephemeral messages** — only the *chosen* opener is persisted as the greeting (backbone §3.5); authored `alternate_greetings` always round-trip as card data.
- **Empty-data fallback:** a card with **no** `alternate_greetings` shows only `1 / 1` and exposes the **⟳ Generate another** affordance (P2) so users can still get variety.

**Alternate greeting as a third, zero-latency start option.** Selecting an alternate and then sending the **first** user message is a fully frictionless way to begin with a non-default opener: the chosen `alternate_greetings[]` entry is held as a *pending opener* in the chat UI, and when the user sends their first message the app includes that alternate (index or text) in the payload. The engine **updates the greeting message internally** to the selected alternate and generates the character's response from that updated initial message (backbone §3.5) — no separate generation call, no new interaction. This complements the two LLM-touching starts (authored-default delivery and dynamic scenario generation).

---

## 2. Dynamic scenario-generation UX (autonomous vs guided)

### 2.1 Autonomous (one-tap)

- **Zero input (random mode).** The engine builds the scenario prompt from the profile alone (backbone §3.3: falls back `scenario → description → backstory → mes_example → first_mes` as style cue), pulling relevant lore via RAG (backbone §1.4). This is **user-initiated** (never automatic) — it runs when the user taps "generate" from an empty chat or a regenerate swipe.
- **Loading UX:** generation is **user-initiated** (random or directed); the app shows a **"preparing"** [`GreetingShimmer`](#513-greetingshimmer) + typing indicator while it runs. The greeting arrives whole on completion (**no streaming**). The authored `first_mes`, when present, was already delivered at init and rendered instantly — no shimmer for that path.
- **Failure handling (engine-side, mirror of backbone §3.2):** on generation failure the **engine** does not fabricate a fallback; it signals failure and the app **informs the user there is an issue with the backend** (non-blocking toast / retry). The chat stays as it was (authored greeting still present, or empty). **No generic placeholder is ever shown.**

### 2.2 Guided (the [`ScenarioGeneratorSheet`](#52-scenariogeneratorsheet))

A **bottom sheet** (not a full-screen wizard) — target fill time **< 30 s**. Inputs:

| Input | Control | Notes |
|---|---|---|
| **Mood / Tone** | Multi-select **chips** | playful, tense, romantic, mysterious, melancholic, adventurous, cozy, humorous… |
| **Setting / Location** | Free text + quick suggestions | e.g. "a rain-soaked alley", "the café at dawn" |
| **Relationship to user** | `SelectPicker` | stranger, friend, rival, mentor, romantic partner, family, enemy… |
| **Time of day** | Chips (optional) | dawn, day, dusk, night |
| **Who speaks first** | Toggle | character (default) / user |
| **Scene premise** | Free text (multiline) | the "what's happening right now" |

- A **"Surprise me"** button clears all inputs = autonomous (the user always has a one-tap exit).
- On **Generate** (directed mode), the sheet collapses and the composer area shows a **"preparing"** [`GreetingShimmer`](#513-greetingshimmer) until the generated greeting arrives whole, then renders it as a normal partner message; the generated opener becomes the first message of the chat.

```
┌──────────────────────────────────────────────┐
│  Set the scene                       ✕        │   <- ScenarioGeneratorSheet (bottom sheet)
├──────────────────────────────────────────────┤
│  Mood                                         │
│  ( playful )( tense )( romantic )( + more )  │   <- TagChips (multi)
│                                               │
│  Setting                                      │
│  ┌─────────────────────────────────────┐     │
│  │ a quiet library after hours         │     │
│  └─────────────────────────────────────┘     │
│                                               │
│  Relationship        Who starts               │
│  [ strangers   ▾ ]   ( ●Marcella  ○You )      │
│                                               │
│  Premise (optional)                           │
│  ┌─────────────────────────────────────┐     │
│  │ We're hiding from the rain…         │     │
│  └─────────────────────────────────────┘     │
│                                               │
│   🎲 Surprise me        [  Generate opening ] │
└──────────────────────────────────────────────┘
```

### 2.3 Transport recommendation (the open "guided-input" decision)

**Recommendation: single dedicated `GENERATE_GREETING` event (pure).**

1. **`INIT_ENTITY` never carries generation parameters.** It always fires immediately and the engine delivers the authored `first_mes` synchronously at init (backbone §3.4) — or nothing if the card has none. The INIT_ENTITY SUCCESS payload carries **`has_first_mes: boolean`** so the app branches synchronously (backbone §3.4 C3). This keeps the init greeting hook synchronous and idempotent, and the user never sees a bare empty chat (the authored greeting is there, or the empty + "generate" hint is).
2. **One event for every generation path:** the dedicated **`GENERATE_GREETING` event** carries `{ mode: 'random'|'directed', guided?: { mood, setting, relationship, timeOfDay, whoFirst, premise } }` and serves the **first** custom greeting, **regenerate** ("generate another"), and **scenario restart** alike. Rationale:
   - Regeneration must **not** tear down and re-init the session (re-init has resume/idempotency guards and re-syncs). A dedicated event maps 1:1 to the regenerate/scenario-restart affordances and keeps the init greeting hook's idempotency intact.
   - A guided *first* greeting is simply: `INIT_ENTITY` (authored greeting lands) → user opens the [`ScenarioGeneratorSheet`](#52-scenariogeneratorsheet) → `GENERATE_GREETING` with guided inputs (which replaces the authored opener while still on the opening turn, per the regenerate precondition in backbone §3.5).

**Rejected alternative (hybrid — carrying `greeting_request` on `INIT_ENTITY`):** would save one round-trip for a guided *first* greeting, but it (a) couples guided logic into the synchronous init hook, (b) creates a timing assumption ("can the app hold `INIT_ENTITY` until the user confirms inputs?") with no clean answer, and (c) adds a second transport surface for a marginal gain — the authored greeting already removes the "bare empty chat on open" problem the hybrid was trying to solve. → This resolves the former §7 conflict #1.

### 2.4 Scenario generation entry points (no policy)

There is **no greeting policy** and no persisted preference — the authored `first_mes` is always delivered at init. Two visible entry points, plus the alternate-greeting path:

- **Composer ✨ icon (canonical — and the restart trigger).** A dynamic ✨ icon on the right side of the composer, **shown whenever the input is empty** (chat open *and* mid-conversation, as long as the user hasn't typed), vanishing once they start typing. Tapping it opens [`ScenarioGeneratorSheet`](#52-scenariogeneratorsheet). The engine distinguishes by conversation state: if the greeting is still the only message it **replaces** the greeting; if the conversation has already started it is a **scenario restart** (new scene / new interaction, backbone §3.3).
- **✨ Scenario pill next to the alternate-greeting swiper (discoverability).** When a `first_mes` is shown, a **✨ Scenario…** pill sits beside the [`AlternateGreetingSwiper`](#52-alternategreetingswiper) (`‹ 1/3 › ✨ Scenario…`). It opens the same sheet — purely so users *see* the dynamic-scenario option without dropping to the composer. (The greeting message's detail-menu *Generate scenario* is no longer needed.)
- **Alternate greeting (authored, no generation).** Swiping to an `alternate_greetings[]` entry and sending the first message sends that alternate with the payload; the engine swaps the greeting (§1.4 / backbone §3.5).

No `greeting_policy` column, no global default, and no `ChatPreferencesService` entry is needed.

---

## 3. Character profile management UX

Extends [`CharacterProfileEditScreen.tsx`](src/screens/CharacterProfileEditScreen.tsx), which today edits `name/description/personality/appearance/backstory/voiceCharacteristics/typingSpeedWpm/audioResponseChance/basePrompt/scenario/exampleDialogues` (state at [`:60`](src/screens/CharacterProfileEditScreen.tsx:60)) and already composes [`ThemedCard`](src/components/themed/ThemedCard.tsx), [`SectionHeader`](src/components/themed/SectionHeader.tsx), [`ScreenHeader`](src/components/themed/ScreenHeader.tsx), [`ThemedButton`](src/components/themed/ThemedButton.tsx), and [`useAppAlert`](src/contexts/AppAlertContext.tsx).

### 3.1 Proposed section layout

```
CharacterProfileEditScreen
├─ Identity            (name, NICKNAME, description)         <- nickname drives {{char}}
├─ Voice & Persona     (personality, voice, mes_example)     <- mes_example promoted here
├─ GREETING            (first_mes + LIVE PREVIEW bubble)     <- §3.2 (the headline editor)
│   └─ Alternate Greetings manager (add/edit/reorder/delete/mark-default)
├─ Scenario            (scenario, with helper text)
├─ Lorebook            (summary card → LorebookViewerSheet)  <- §3.3
├─ Attribution         (creator, creator_notes, character_version, SOURCE[locked], tags)
└─ Advanced  (collapsible)
    ├─ post_history_instructions (UJB)  + explainer tooltip
    ├─ base_prompt (system_prompt / {{original}})
    └─ Harmony extensions (appearance, typing_speed, audio_response_chance)
+ [Preview opening] / [Test scenario generation]  action bar
```

> **Macro handling (app scope — backbone §3.8).** On card-management screens (Greeting editor, Lorebook editor, `CharacterProfileEditScreen`) the raw macros (`{{user}}`, `{{char}}`, `{{original}}`) are **kept visible but visually highlighted** (subtle accent chip/underline) so authors see exactly what will be substituted. On interactive preview surfaces — the Greeting editor live preview, *"Preview opening"*, and character-creation card previews — macros are **resolved** using the **roleplay-selected entity** as `{{user}}` and the profile name/nickname as `{{char}}`. The engine resolves macros for any text sent to an LLM backend and for the delivered greeting message.

### 3.2 Greeting editor + live preview

- A [`GreetingEditor`](#55-greetingeditor) for `first_mes`: multiline `TextInput` with a **live [`GreetingBubble`](#51-greetingbubble) preview** directly beneath it, rendering the typed text exactly as it will appear at chat start (macros resolved: `{{user}}` → own entity name, `{{char}}` → name/nickname). This is the single highest-leverage authoring improvement.
- **Alternate Greetings manager** ([`AlternateGreetingsManager`](#56-alternategreetingsmanager)): a reorderable list (drag handle) of opener cards, each with a mini preview, edit/delete, and a **"default" radio** (which one is `first_mes` vs an `alternate_greeting`). (Marking an alternate as default simply promotes it into `first_mes` and moves the prior `first_mes` into `alternate_greetings[]` — standard card data, no extra mechanism.) Count badge. Empty-state hint: *"Add alternate openers users can swipe between."*
- **`mes_example`** promoted into *Voice & Persona* (it's few-shot voice guidance, not a greeting) — fixes the backbone's "buried into `example_dialogues`" mangling at the UX level too.

### 3.3 Lorebook editor

- A **summary card** in the editor: *"Lorebook · 12 entries · 2 constant · scan depth 5"*. Tap → [`LorebookViewerSheet`](#57-lorebookviewersheet) (bottom sheet) listing entries (enabled/disabled, key preview, constant badge).
- Per-entry [`LorebookEntryEditor`](#58-lorebookentryeditor): `content` (multiline) is the **primary** field (it's what gets embedded and matched semantically). The keyword/position fields — `keys[]`, `selective` + `secondary_keys`, `constant`, `position` (`before_char`/`after_char`), `insertion_order`, `case_sensitive`, `use_regex`, `name`/`comment` — are shown under a **collapsible "Advanced — preserved for export"** group: they round-trip to the card on export but **do not drive matching** (backbone §1.4). **Sensible defaults:** `enabled=true`, `position=before_char`, `insertion_order=10`.
- **Non-power-user usability:** each entry shows a live hint — *"Retrieved when the conversation is semantically related to this entry"* — because matching is **semantic**, not keyword-gated (backbone §1.4). The optional **"Test match"** affordance becomes a **semantic query test**: type a phrase → see the top-matching entries ranked by similarity (see flagged dependency §7 #3).

### 3.4 Attribution, provenance & tags

- **[`CreatorAttributionBadge`](#59-creatorattributionbadge)** in an *Attribution* section and on card detail: shows `creator`, `creator_notes` (discoverability is **spec-required** per backbone §4), `character_version`, and a provenance/source badge from `card_provenance`. **`source` is read-only** (spec: append-only, backbone §4).
- **[`TagChips`](#510-tagchips)** editor: add/remove tags with suggestions drawn from existing tags across the library. The same component powers character-card tag filtering (§4.2).

### 3.5 Preview / test affordance

- **"Preview opening message"** → renders a mock chat-start with the current `first_mes` (no persistence).
- **"Test scenario generation"** (P2) → triggers an engine `BuildScenarioGreetingPrompt` with the current editor contents and shows the result in a [`GreetingBubble`](#51-greetingbubble) clearly marked *Preview*. Lets authors iterate on greetings/scenarios before saving.

---

## 4. Import & character-card UX

### 4.1 Import flow (improve the current header action + speed-dial)

Today: [`CharactersScreen.tsx`](src/screens/CharactersScreen.tsx) has a speed-dial FAB (`expanded`/`expandAnim` at [`:79`](src/screens/CharactersScreen.tsx:79)) and a header "Import Card" action, calling `importCharacterCardFromFile` via `@react-native-documents/picker` `pick`. After import it just toasts success/failure.

**Recommended addition — [`ImportReviewSheet`](#512-importreviewsheet):** after parse, *before* persisting, show what was detected:

```
┌──────────────────────────────────────────────┐
│  Imported: Marcella                    ✕      │   <- ImportReviewSheet
├──────────────────────────────────────────────┤
│  [avatar]  Marcella         chara_card_v3     │   <- provenance badge
│            by CardAuthor · v2.1               │
│                                               │
│  ✓ Greeting (first_mes)        1,204 chars    │
│  ✓ Alternate greetings         3              │
│  ✓ Lorebook entries            8              │
│  ✓ Tags: romance, slow-burn, enemies-to-lovers│
│  ⚠ No example dialogue (mes_example)          │
│                                               │
│   ✏ Review & edit fields                       │
│   ⟳ Generate a greeting  (if none detected)   │
│                                               │
│              [ Cancel ]   [ Save character ]  │
└──────────────────────────────────────────────┘
```

- **"Review & edit fields"** deep-links into the editor sections (§3) pre-filled from the card.
- **No-greeting case:** a prominent **"Generate a greeting"** CTA (P2) or a prompt to author one — never silently save a card that will open **empty** (no `first_mes` ⇒ no greeting until the user generates one).

### 4.2 Tag filtering (character card screen)

The character-card / management list gains:

- A horizontal **[`TagChips`](#510-tagchips) filter row** (multi-select), sourced from `tags` (SQLite JSON1 `json_each(tags)` for v1 — backbone §4 notes a join table is the P4 upgrade if perf demands).
- **[`CreatorAttributionBadge`](#59-creatorattributionbadge)** on each card; tap creator to filter.

> **Scope:** Discover is **out of scope** for this modification — tag filtering applies only to the character-card / management screen for now.

---

## 5. Components & theming

### 5.1–5.13 New components

| # | Component | Purpose | Props (sketch) | Composes (existing) | Glass/theming notes |
|---|---|---|---|---|---|
| 5.1 | [`GreetingBubble`](src/components/chat) | Render the engine-delivered greeting as a normal partner message (2 states: `preparing` / `arrived`); macro-resolved text | `text`, `state` (`'preparing'\|'arrived'`), `partnerName`, `partnerAvatar?`, `onRegenerate?` | [`ThemedCard`](src/components/themed/ThemedCard.tsx), [`ThemedText`](src/components/themed/ThemedText.tsx), [`TypingIndicator`](src/components/chat/TypingIndicator.tsx) | Partner-side glass bubble (`accentStripe` left edge); shimmer overlay only in `preparing` |
| 5.2 | `AlternateGreetingSwiper` | Horizontal pager over `[first_mes, …alternate_greetings]` + regenerate slot | `greetings[]`, `index`, `onIndexChange`, `onGenerateAnother`, `canGenerate` | `GreetingBubble`, [`ThemedButton`](src/components/themed/ThemedButton.tsx) (chevrons) | Position pill = small glass chip; reduced-motion = chevrons only |
| 5.3 | `ScenarioGeneratorSheet` | Bottom-sheet guided-input collector (§2.2) | `open`, `onClose`, `onGenerate(guidedInputs)`, `suggestions` | [`ThemedCard`](src/components/themed/ThemedCard.tsx), `TagChips`, [`SelectPicker`](src/components/config/SelectPicker.tsx), [`ThemedButton`](src/components/themed/ThemedButton.tsx) | Elevated translucent sheet + gradient border; chips = glass pills |
| 5.4 | `EmptyChatCTA` | The scenario trigger, rendered in **two places**: (1) as an **icon on the right side of [`ChatInput`](src/components/chat/ChatInput.tsx)**, shown **whenever the input is empty** (chat open and mid-conversation) and **vanishing once the user starts typing**; (2) as a **✨ Scenario pill next to the [`AlternateGreetingSwiper`](#52-alternategreetingswiper)** when a `first_mes` is shown, for discoverability. Both open [`ScenarioGeneratorSheet`](#52-scenariogeneratorsheet) (§1.3/§2.4). | `onGenerate` | [`ThemedButton`](src/components/themed/ThemedButton.tsx) | Icon/pill = secondary glass inner (per [`systemPatterns.toon`](memory-bank/systemPatterns.toon) @Glassmorphism consumers) |
| 5.5 | `GreetingEditor` | `first_mes` editor with live preview bubble (§3.2) | `value`, `onChange`, `ownName`, `charName` | `TextInput`, `GreetingBubble`, [`SectionHeader`](src/components/themed/SectionHeader.tsx) | Preview reuses `GreetingBubble` styling |
| 5.6 | `AlternateGreetingsManager` | Reorderable list of openers; mark default | `greetings[]`, `onChange`, `defaultIndex` | [`ThemedCard`](src/components/themed/ThemedCard.tsx) list, drag handle, [`ThemedButton`](src/components/themed/ThemedButton.tsx) | Drag handle = muted icon; default = accent radio |
| 5.7 | `LorebookViewerSheet` | Browse/search entries for a profile | `profileId`, `open`, `onClose`, `onEditEntry` | [`ThemedCard`](src/components/themed/ThemedCard.tsx), `FlatList` | Entry rows = glass cards; constant/enable badges |
| 5.8 | `LorebookEntryEditor` | Create/edit one entry (§3.3) | `entry`, `onChange`, `onTestMatch?` (semantic query) | [`ThemedCard`](src/components/themed/ThemedCard.tsx), [`SelectPicker`](src/components/config/SelectPicker.tsx), toggles | Keyword/position fields collapsed under "Advanced — preserved for export"; "retrieved when semantically related" hint = muted text |
| 5.9 | `CreatorAttributionBadge` | creator/notes/version/source (spec-required discoverability) | `creator`, `creatorNotes`, `version`, `source` | [`ThemedText`](src/components/themed/ThemedText.tsx), [`ThemedCard`](src/components/themed/ThemedCard.tsx) | Small glass chip; `source` read-only styling |
| 5.10 | `TagChips` | Tag editor **and** character-card filter (dual-use) | `tags[]`, `onChange?`/`selected?`, `suggestions`, `mode` | [`ThemedButton`](src/components/themed/ThemedButton.tsx) | Pill = glass; selected = accent fill |
| 5.11 | `ImportReviewSheet` | Post-import review/preview (§4.1) | `parsedCard`, `onSave`, `onEdit`, `onGenerateGreeting?` | [`ThemedCard`](src/components/themed/ThemedCard.tsx), [`ThemedButton`](src/components/themed/ThemedButton.tsx), [`useAppAlert`](src/contexts/AppAlertContext.tsx) | Detected-item rows with ✓/⚠ icons |
| 5.12 | `GreetingShimmer` | Skeleton for in-flight greeting | (none) | [`ThemedCard`](src/components/themed/ThemedCard.tsx) skeleton | Accent-primary low-opacity sweep; **reduced-motion → static skeleton** |

**Reused as-is:** [`ChatBubble`](src/components/chat/ChatBubble.tsx), [`ChatInput`](src/components/chat/ChatInput.tsx), [`NewMessagesDivider`](src/components/chat/NewMessagesDivider.tsx), [`ProfileImagePicker`](src/components/characters/ProfileImagePicker.tsx), [`CharacterProfileCard`](src/components/characters/CharacterProfileCard.tsx), [`DynamicAtmosphericBackground`](src/components/background/DynamicAtmosphericBackground.tsx), [`ScreenHeader`](src/components/themed/ScreenHeader.tsx), [`SectionHeader`](src/components/themed/SectionHeader.tsx), [`ThemedAppbar`](src/components/themed/ThemedAppbar.tsx), [`ThemedFab`](src/components/themed/ThemedFab.tsx), [`ThemedView`](src/components/themed/ThemedView.tsx), [`useAppAlert`](src/contexts/AppAlertContext.tsx).

### 5.14 i18n (new keys)

New **`scenario`** namespace (for generation/onboarding strings) **+ extensions to `characters` and `chatDetail`**. Locale files live in [`src/i18n/locales/en/`](src/i18n/locales/en/).

| Namespace | Sample new keys |
|---|---|
| **`scenario` (new)** | `title`, `ctaScenario`, `mood`, `setting`, `relationship`, `timeOfDay`, `whoStarts`, `premise`, `surpriseMe`, `generate`, `generating`, `generateAnother`, `preparingOpening` ("preparing an opening…"), `generateFailedBackend` ("couldn't generate — issue with the backend"), `noGreetingHint` ("no opening message yet — generate one"), `scenarioRestart` |
| **`characters` (extend)** | `greeting`, `greetingHint`, `alternateGreetings`, `addAlternate`, `markDefault`, `mesExample`, `postHistoryInstructions`, `postHistoryHint`, `nickname`, `creator`, `creatorNotes`, `characterVersion`, `source`, `tags`, `addTag`, `lorebook`, `lorebookEmpty`, `lorebookEntryRetrievedWhen` ("retrieved when the conversation is semantically related to this entry"), `lorebookFieldsExportOnly`, `advanced`, `previewOpening`, `testScenario`, `importReviewTitle`, `importGreetingDetected`, `importNoGreeting`, `generateGreeting` |
| **`chatDetail` (extend)** | `swipeIndicator` (`"{{n}}/{{total}}"`), `scenarioSheetTitle` |

### 5.15 Accessibility & motion

- **Reduced motion** (honor platform setting): [`GreetingShimmer`](#513-greetingshimmer) → static skeleton; swipe gesture → chevrons only; "preparing" typing-dots → single static ellipsis; sheet open animation → cross-fade.
- All interactive affordances have `accessibilityLabel`/`accessibilityRole` (chevrons = buttons, chips = toggle buttons, position indicator = text).
- Color is never the sole signal: state badges carry icons (⟳ generate, ✓ arrived/authored, ⚠ backend-issue).

---

## 6. Phasing (UX view)

### 6.1 UX decisions (resolved & open)

| Decision | Status | UX recommendation | Why |
|---|---|---|---|
| **Guided-input transport** | **Resolved** | **Single `GENERATE_GREETING` event** (§2.3): `INIT_ENTITY` always fires immediately (authored greeting synchronous); every custom/regenerate/scenario greeting is a follow-up `GENERATE_GREETING`. | Keeps the init hook synchronous + idempotent; no timing assumption; regenerate doesn't re-init the session. |
| **Alternate-greetings swipe: P1 or P2?** | **Resolved** | **Authored swipes = P1** (JSON column lands P1, no generation); **regenerate-swipe = P2** (needs generation hook). | Delivers the flagship swipe UX with zero engine dependency in P1. |
| **Tags storage (backbone §7 #2)** | **Resolved** | JSON column for v1 is fine for UX; build **character-card** tag filtering on `json_each`. Revisit join table at P4 only if list perf degrades. | Doesn't block the character-card filter UX today. |
| **Mid-conversation scenario restart ("new scene") UI trigger** | **RESOLVED** | The composer ✨ icon is shown **whenever the input is empty** (chat open *and* mid-conversation, before the user types), so it serves as the restart trigger too: tapping it mid-conversation sends `START_NEW_SCENARIO` / `GENERATE_GREETING { scenario_restart:true }` (backbone §3.3). No separate chat-header action needed. The ✨ Scenario pill next to the swiper is a discoverability variant of the same trigger (§1.3/§2.4). | The earlier concern (icon vanishes on typing, so can't serve mid-conversation restart) is resolved: the icon is present whenever the input is empty, which includes the mid-conversation state before the user composes a message. |
| **Composer-icon state in P1 (pre-generation)** | **RESOLVED** | In P1 the generation hook (P2) is not built, so the ✨ icon/pill is present but **disabled/hidden** until P2 lands, then enabled. The availability rule (shown whenever input empty) is unchanged — only the *action* gates on P2. | Resolves the earlier phasing question: no functional icon in P1, no broken affordance. |

### 6.2 UX → backend phase mapping

| UX capability | Gated on | Phase |
|---|---|---|
| Empty-state [`GreetingBubble`](#51-greetingbubble) rendering the engine-delivered **authored** `first_mes` (render-only, new chats); authored **swipes**; `GreetingShimmer`; `GreetingEditor` + `AlternateGreetingsManager`; `ImportReviewSheet`; `CreatorAttributionBadge` + `TagChips` editor; macro resolution; empty + "generate" hint when no `first_mes` | Migration `000037` (profile columns incl. `character_book` JSON) + importer stops burying `first_mes` | **P1** |
| **"Preparing" shimmer**; **generate/regenerate** swipes; `EmptyChatCTA` → engine generate; `ScenarioGeneratorSheet` (guided) plumbing; **"Test scenario generation"**; **scenario restart** (new scene) | P2 engine generation hook (`BuildScenarioGreetingPrompt`, `GENERATE_GREETING`, `DeliverGreeting`) | **P2** |
| **[`LorebookViewerSheet`](#57-lorebookviewersheet) + [`LorebookEntryEditor`](#58-lorebookentryeditor)**; "retrieved when semantically related" hints; semantic "Test match"; `post_history_instructions`/`{{original}}` surfacing in editor; guided mode full UX | Engine **RAG semantic retrieval** (lorebook is the `character_book` JSON column from `000037`) | **P3** |
| **Character-card tag filtering** (and join-table upgrade if needed); **export** affordance in editor (round-trip) | Exporter + tags first-class | **P4** |

> **Note:** the [`GreetingShimmer`](#513-greetingshimmer) (render-only) can ship in P1 — against the authored `first_mes` the engine delivers at init (near-instant, so the shimmer is barely visible); once P2 lands, the same component covers the generated-greeting wait. There is **no reconciliation layer** to build (the app renders whatever arrives).

---

## 7. UX assumptions / conflicts flagged for the orchestrator

1. **Lorebook "Test match" is a semantic query.** Showing the top-matching entries for a typed phrase requires an **engine semantic-retrieval call** (the app has no embedding model). This optional P3 nicety is arguably more useful than a keyword fire-list; the static "retrieved when semantically related" *hint* ships without it.
2. **`source` mutability.** UX renders `source`/provenance **read-only** (spec: append-only, backbone §4). Confirmed non-conflicting — flagged only so the editor enforces it.
3. **No group chats yet.** `group_only_greetings` is round-tripped (JSON) but has **no UI surface** today (Harmony has no group chats). Confirmed non-conflicting; deferred.

**Decision log:**
- **Greeting delivery — engine-authoritative, app render-only.** The engine delivers the authored `first_mes` at `INIT_ENTITY` (truly-new chats only); the app renders it. `GreetingBubble` has **2 states** (Preparing / Arrived). No local `first_mes`, no optimistic placeholder, no reconciliation.
- **Guided-input transport — single `GENERATE_GREETING` event.** `INIT_ENTITY` always fires immediately (authored `first_mes` synchronous); every custom / regenerate / scenario-restart greeting is a follow-up `GENERATE_GREETING` (§2.3). No `greeting_request` on `INIT_ENTITY`; the init hook stays synchronous and idempotent.
- **Backward-compat cards — out of scope.** Nothing is deployed yet (initial dev); dev databases are wiped + re-imported with the new mapper, so there is no pre-migration card corpus and no "old card" UX to design (backbone §2.3).
- **No streaming** — the backend has no streaming capability; the "preparing" shimmer is the sole latency affordance (the greeting arrives whole).
- **No reconciliation** — the app holds no local greeting copy; it renders the engine-delivered message.
- **No generic placeholder / no auto-generation** — a card with no `first_mes` opens empty + hint; generation is user-initiated (random/directed/scenario-restart). On failure the user is informed of a backend issue, never a fabricated fallback.
- **Lorebook = RAG semantic retrieval** — matching is semantic, not keyword/regex; keyword/position/budget fields are stored for export, not used for matching. The lorebook editor + semantic "Test match" land in **P3** (lorebook is the `character_book` JSON column from `000037`).

---

### Appendix A — Chat-start journey (ASCII, autonomous default)

```
ChatListScreen
   │ tap entity-with-no-interaction (ChatListScreen.tsx:412)
   ▼
ChatDetailScreen  ── messages=[] , !resumed  ──►  render GreetingBubble(authored, instant)
   │                                                    │
   │  (user taps composer ✨ icon or the ✨ Scenario pill → generate scenario) │ swipe ‹ › cycles alt-greetings
   │                                                    │ tap ⟳ → GENERATE_GREETING (P2)
   ▼                                                    ▼
ChatInput  ── first user message ──►  normal conversation flow
```

### Appendix B — Guided journey (ASCII)

```
ChatDetailScreen (new chat)
   │  INIT_ENTITY fires immediately ──► authored first_mes rendered (or, if none, the composer ✨ scenario icon)
   ▼  tap pill
ScenarioGeneratorSheet  ── mood/setting/relationship/time/who-first/premise ── "Generate"
   ▼
GENERATE_GREETING { mode:'directed', guided:{…} }   (P2 engine — replaces authored opener while still on opening turn)
   ▼
GreetingBubble(preparing) ──► render persisted greeting row on completion

### Scenario restart journey (mid-conversation)

ChatDetailScreen (mid-conversation)
   │  user taps composer ✨ icon (input empty) → ScenarioGeneratorSheet
   ▼  tap "Generate" with scenario_restart
START_NEW_SCENARIO (or GENERATE_GREETING { scenario_restart:true })
   ▼  engine force-creates new interaction + seeds first greeting message
Engine ── success(event_id, new interaction_id) ──► app swaps interaction ID + blocking sync
   ▼
ChatDetailScreen reloads new interaction ──► GreetingBubble(generated scenario) rendered
```
