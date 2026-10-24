# Entities, Interactions & Character Profiles — A Plain-English Guide

> **Audience:** contributors / team.
> Explains the four core concepts of the Harmony AI App chat model — and, crucially, *why you (the human) are also an "entity".*
>
> Written in simple words, but technically accurate. See the reference table in §5 for exact table/field anchors.
>
> **Storage note (2026-10):** the four concepts below are unchanged, but they no
> longer live in an app-side SQLite replica. They are the **embedded engine's**
> data model (the engine owns the one database). The app reads/writes them
> through the engine's loopback management API, and the app-side DTOs live in
> [`src/services/engine/EngineApiClient.ts`](src/services/engine/EngineApiClient.ts)
> (the repository seam `src/services/engine/repositories/index.ts` is a pure re-export of
> the API-backed adapters). Table names below are the engine's SQLite tables.

---

## TL;DR

- A **Character Profile** is the *card* — the persona data (name, personality, greeting, voice, lore…). It is a reusable, shareable template.
- An **Entity** is a *living instance* of a profile that actually takes part in chats. It has a brain (cognition), memory, emotions, a voice, and module bindings. **Every participant in a chat is an entity — the AI characters *and* you.**
- An **Interaction** is the *conversation thread* between a set of entities.
- A **Conversation Message** is a single line of dialogue, always stamped with the entity that sent it.
- The **"user entity"** is simply *your* entity. Because the model treats all speakers uniformly, you must impersonate an entity to send messages and be "seen" by the AI. You can be yourself, or roleplay a character — each identity is a separate relationship.

---

## 1. The mental model (analogy)

| Concept | Analogy | One line |
|---|---|---|
| **Character Profile** | A **character sheet / recipe** | "Who they are on paper" — importable, exportable data |
| **Entity** | A **living person** brought to life from the sheet | Has a brain, memory, emotions, a voice; can actually talk |
| **Interaction** | A **chat thread / room** | A conversation scoped to who is in it |
| **Conversation Message** | A **line of dialogue** | One message, tagged with *who said it* |
| **User Entity** | **You**, wearing a name badge | The identity you "chat as" |

---

## 2. The object model

```mermaid
flowchart LR
    CP["📋 Character Profile<br/><i>character_profiles</i><br/>name · personality · greeting · lore"]
    E["🧠 Entity<br/><i>entities</i><br/>alias · → profile"]
    EMM["⚙️ Module Bindings<br/><i>entity_module_mappings</i><br/>brain · voice · memory · vision…"]
    I["💬 Interaction<br/><i>interactions</i><br/>participant_key · scope"]
    M["✉️ Message<br/><i>conversation_messages</i><br/>sender_entity_id · content"]

    CP -- "instantiated into" --> E
    E   -- "wired with"        --> EMM
    E   -- "joins as participant" --> I
    I   -- "holds"             --> M
```

A profile is *data*. An entity is that data *made alive and equipped with modules*. Entities gather inside an interaction, and every message they exchange is recorded with its sender.

---

## 3. The four concepts in plain words

### 3.1 Character Profile — the *card*

Defined in [`CharacterProfile`](src/services/engine/EngineApiClient.ts:13) (table `character_profiles`).

- Pure **persona data**: `name`, `description`, `personality`, `appearance`, `backstory`, `voice_characteristics`, `scenario`, `example_dialogues`, …
- It is a **template/blueprint**, modeled on the community character-card standard (greeting, lorebook, alternate greetings, etc. — see the chat-start concept docs in `.current_work/character-data-chat-start-concept/`).
- It is **stateless on its own** — it cannot talk. It has no memory, no emotions, no modules. It is the *sheet of paper*.
- An entity *references* one profile via [`character_profile_id`](src/services/engine/EngineApiClient.ts:36).

### 3.2 Entity — the *living participant*

Defined in [`Entity`](src/services/engine/EngineApiClient.ts:33) (table `entities`).

- A **living instance** of a character: `id`, `alias` (display name), `character_profile_id`, `lifecycle_config`.
- Wired up with **AI modules** via [`EntityModuleMapping`](src/services/engine/EngineApiClient.ts:44) — cognition (brain), TTS (voice), STT (ears), vision (eyes), RAG (memory), imagination, movement, backend.
- Carries an **inner life**: emotion state, memory, emoji actions — all keyed to the entity.
- **This is what actually participates in a chat.** It is the smallest unit that can send or receive messages.

> 🔑 Key insight: an entity is *not* synonymous with "an AI". The user is an entity too (see §4).

### 3.3 Interaction — the *conversation thread*

Defined in [`Interaction`](src/services/engine/EngineApiClient.ts:448) (table `interactions`).

- A **conversation** scoped to a set of participants:
  - [`entity_id`](src/services/engine/EngineApiClient.ts:450) — the entity this thread is anchored to (whose conversation list it belongs to).
  - [`participant_ids`](src/services/engine/EngineApiClient.ts:453) / [`participant_key`](src/services/engine/EngineApiClient.ts:452) — every entity in the chat, plus a stable derived key (the sorted join of their IDs; empty string for "world").
  - [`interaction_scope`](src/services/engine/EngineApiClient.ts:451) — `private` (2 participants), `group` (3+), or `world`.
  - [`presence_type`](src/services/engine/EngineApiClient.ts:462) — e.g. `'phone'` (the in-app chat surface), `status`, `started_at`, `last_activity_at`.
- Has a lifecycle: it can be active, resumed, ended, or continued into a new interaction.

### 3.4 Conversation Message — a *line of dialogue*

Defined in [`ConversationMessage`](src/services/engine/EngineApiClient.ts:468) (table `conversation_messages`).

- One message inside an interaction: `content`, `message_type` (`text` / `audio` / `image` / `greeting` …), optional media, emotional state.
- **Crucially, it always carries a [`sender_entity_id`](src/services/engine/EngineApiClient.ts:471)** — the entity that said it. There is no nullable "the human typed this" flag.
- **Each participant keeps its own POV copy** (`entity_id` = the POV owner, `sender_entity_id` = who spoke). AI entities author theirs through cognition; the user persona (no cognition) gets its copy from the engine's Session Utterance Recorder when the app relays the utterance onto the user's session. `origin_message_id` ties the copies of one wire message together and is unique per `(interaction_id, origin_message_id)`, so relays/sync echoes never duplicate a row.

### 3.5 Presence — where an entity lives (channels & plugins)

An entity doesn't just *exist* — it **lives** in one or more **Presences**: concrete communication channels that carry its contextual reality. A presence separates *where* the entity is (channel context) from *how* it is connected (plumbing). Each active entity session carries one presence.

A presence owns:
- **Presence type** — the channel topology (phone app, game plugin, web, messaging…)
- **Capabilities** — what the entity can do there (audio, vision, movement…)
- **Participant set** — who else is present in this context
- **Perception context** — what the entity currently perceives
- **Output preferences** — TTS output type, reply mode (instant / realistic)

**Plugins are presences.** Soulbits Engine game plugins and other application plugins act as presence providers: they report the participant set with every message, and the engine derives the interaction scope from it. The engine trusts what the plugin reports — it does *not* model perception asymmetry (e.g. eavesdropping) itself; that is the plugin's responsibility.

| Presence Type | Interaction Scope |
|---|---|
| App / Messaging (1:1) | Private — exactly 2 participants |
| App / Messaging (group) | Group — managed roster |
| **Game Plugin** | Derived from participant set (in-game scenes, NPC dialogue) |
| World (ambient) | World — entity perceives world events |

Key rules:
- An entity can have **zero or more** active presences at once; events are routed to presences, not to entities directly.
- A presence can be **suspended and resumed** (phone session behaviour).
- Multiple presences can feed the **same interaction** (phone + Discord DM with the same partner = one interaction); one presence can host several interactions.
- When a plugin-provided participant set shifts the scope (2 → 3 participants), the current interaction is **closed** and a new one with the new scope is created — scope transitions are interaction boundaries.

> Full detail: [Presence — Entity Channel Context](../harmony-link-private/docs/Cognition-System.md) in the Soulbits Engine Cognition System docs.

---

## 4. The "user entity": why *you* are an entity too

This is the part that trips people up, so here is the full reasoning.

### Everyone is an entity — by design

The engine treats **every speaker identically**. To build a prompt, track memory, update emotion, or resolve who is in a conversation, the code only ever asks "which entities are participating?" There is **no special-case `if (speaker is the human)` branch**. A speaker is always an [`Entity`](src/services/engine/EngineApiClient.ts:33).

For *your* messages to fit that model, **you must also be an entity.** That entity is your **user entity** — the identity you "chat as".

```mermaid
flowchart TD
    UE["👤 Your Entity<br/>(the identity you 'chat as')"]
    AE["🤖 AI Entity — e.g. Marcella"]

    I["💬 Interaction (private chat)<br/>participant_ids = [ you, Marcella ]<br/>participant_key = sorted join → 'Marcella+you'<br/>scope: 2 participants → private"]

    UE -- participates --> I
    AE -- participates --> I

    I --> M1["✉️ 'Hey, you came…'<br/>sender_entity_id = Marcella"]
    I --> M2["✉️ 'I missed you.'<br/>sender_entity_id = you"]

    Note["Both ends are Entities.<br/>Every Message is owned by its sender Entity."]
    I -.-> Note
```

### Why it has to be this way (the technical reasons)

1. **Uniform participant model.** The engine, prompt builder, sync layer, and scope/participant-key logic are written generically over *entities*. Treating you as an entity means **zero special cases** for the human — the same code path handles group chats, world chats, and 1:1 chats.
2. **Every message needs a sender.** [`sender_entity_id`](src/services/engine/EngineApiClient.ts:471) is non-optional. Your messages must be owned by *some* entity, so you must have one.
3. **Stable relationships & memory per identity.** The AI forms a relationship and accumulates memory scoped to the entity-pair (via [`participant_key`](src/services/engine/EngineApiClient.ts:452)). Your entity gives the AI a stable "person" to remember and relate to.
4. **The `{{user}}` macro.** Character cards reference `{{user}}`; it resolves to *your entity's* name/alias. Without an entity, there is nothing to resolve it to.
5. **Roleplay is a feature, not a workaround.** Because you are "just another entity", you can impersonate **any** character. The AI treats each identity as a distinct conversation partner with its own relationship. That is exactly the "Chatting as" experience.

### The "Chatting as" identity (impersonation)

Your chosen identity is stored by `ChatPreferencesService.getGlobalImpersonatedEntity` (see its use in [`ChatListScreen`](src/screens/ChatListScreen.tsx:343)) and shown in the **"Chatting as"** banner ([`ChatListScreen`](src/screens/ChatListScreen.tsx:654)). You can switch it any time; the chat list is then rooted at that entity (interactions where [`entity_id`](src/services/engine/EngineApiClient.ts:450) = your identity).

### The `'user'` sentinel

When **no** identity has been chosen yet, the literal string `'user'` is used as a placeholder (`impersonatedEntityId ?? 'user'`, with fallback logic in [`ChatListScreen`](src/screens/ChatListScreen.tsx:343) and [`CreateAIScreen`](src/screens/CreateAIScreen.tsx:477)). It is a **safe default so the app can proceed**, not necessarily a real row. As soon as you create/select a real identity, that entity takes over.

---

## 5. Reference: concept → table → key fields

| Concept | Table / interface | Key fields | Purpose |
|---|---|---|---|
| **Character Profile** | [`character_profiles`](src/services/engine/EngineApiClient.ts:13) | `name`, `description`, `personality`, `appearance`, `backstory`, `voice_characteristics`, `scenario`, `example_dialogues` | Persona data / the card (template) |
| **Entity** | [`entities`](src/services/engine/EngineApiClient.ts:33) | `id`, `alias`, `character_profile_id`, `lifecycle_config`, `rag_reindex_required` | A living participant (AI *or* user) |
| **Module Bindings** | [`entity_module_mappings`](src/services/engine/EngineApiClient.ts:44) | `entity_id` + 8 × `*_config_id` (backend, cognition, tts, stt, vision, rag, imagination, movement) | The AI "brain & body" wired to an entity |
| **Interaction** | [`interactions`](src/services/engine/EngineApiClient.ts:448) | `entity_id`, `participant_ids`, `participant_key`, `interaction_scope`, `presence_type`, `status` | A conversation thread |
| **Message** | [`conversation_messages`](src/services/engine/EngineApiClient.ts:468) | `sender_entity_id`, `interaction_id`, `content`, `message_type` | One line of dialogue, owned by its sender |

**Scope/participant derivation** (from [`deriveScopeFromParticipants`](src/screens/CreateAIScreen.tsx:479) / [`deriveParticipantKey`](src/screens/CreateAIScreen.tsx:479)):
- 0–1 participants → `world` (empty key)
- 2 participants → `private` (key = sorted `"A+B"`)
- 3+ participants → `group` (key = sorted join of all IDs)

---

## 6. Worked example

1. You import a card → a **Character Profile** "Marcella" exists (just data).
2. You create an AI from it → an **Entity** "Marcella" is instantiated, referencing the profile, wired with cognition/TTS/memory modules. It can now talk.
3. You open a chat with her → an **Interaction** is created. `participant_ids = [ you, Marcella ]`, `participant_key = "Marcella+you"`, `scope = private`. It is anchored to *your* entity.
4. Marcella's greeting arrives → a **Message** with `sender_entity_id = Marcella`.
5. You reply → a **Message** with `sender_entity_id = <your entity>`. This is only possible *because you are an entity too.*
6. Switch your "Chatting as" identity to a different character → the AI now relates to a *different* entity, with its own separate relationship and history.

---

## 7. Where to look in the code

| Want to understand… | Read |
|---|---|
| The data model (all four concepts) | engine tables `character_profiles` / `entities` / `entity_module_mappings` / `interactions` / `conversation_messages`; app DTOs in [`src/services/engine/EngineApiClient.ts`](src/services/engine/EngineApiClient.ts) |
| How an AI entity is created & wired | [`src/screens/CreateAIScreen.tsx`](src/screens/CreateAIScreen.tsx:407) |
| Entity ↔ profile ↔ modules editing | [`src/screens/EntityConfigEditScreen.tsx`](src/screens/EntityConfigEditScreen.tsx:1) |
| The "Chatting as" / impersonated identity | [`src/screens/ChatListScreen.tsx`](src/screens/ChatListScreen.tsx:343) |
| Interaction session lifecycle (`ownEntityId`) | [`src/contexts/EntitySessionContext.tsx`](src/contexts/EntitySessionContext.tsx:149) |
| Interaction / message reads & writes | [`src/services/engine/repositories/`](src/services/engine/repositories) (API-backed adapters) |
| How entity IDs are minted / how deletion cascades | [`src/utils/entityIdUtils.ts`](src/utils/entityIdUtils.ts:1), [`src/services/engine/repositories/entities.ts`](src/services/engine/repositories) |

---

## 8. Entity lifecycle: IDs, deletion, and rebuilds

> Added 2026-09-07 (entity-id/tombstone-integrity work). Plain-English summary; the binding rulings live in
> [`.current_work/entity-id-tombstone-integrity/summary.md`](../.current_work/entity-id-tombstone-integrity/summary.md)
> and the engine-side companion doc is [`../harmony-link-private/docs/Entity-Lifecycle.md`](../harmony-link-private/docs/Entity-Lifecycle.md).

### 8.1 IDs are minted, never chosen — and never change

- You give your AI a **name**; its **ID** is internal plumbing generated from that name plus the creation
  second (UTC): `Isabella` → `Isabella-20260905123514`. Same name recreated later gets a different
  timestamp — IDs are unique *by construction*, which is what makes reuse impossible.
- IDs are **immutable for life**. There is no rename — anywhere, in any app or UI. "Renaming" an AI or a
  persona only edits its display name (`alias` and/or the profile name); the ID underneath never changes.
- All creation goes through **one minting seam** (`mintEntityId`), which also enforces the reserved names
  (`user`, `deleted`) and falls back to a `-2`/`-3` suffix if the same name is minted twice in the same
  second. If two devices each create "the same" AI offline, they independently mint different IDs.

### 8.2 Deletion: tombstone → garbage collection (and it's final)

```mermaid
flowchart LR
    L["🟢 Live entity"] -- "user deletes" --> T["🪦 Tombstone<br/>(soft delete — propagates<br/>to every device via changeset sync)"]
    T -- "all devices have received it" --> G["🗑️ Garbage-collected<br/>(purged at the next sync-finalize;<br/>the whole family: chats, memories,<br/>settings, images…)"]
    G -. "recreate? mint a NEW timestamped id<br/>(fresh start — no history comes back)" .-> L2["🟢 New entity"]
```

- Deleting an entity is a **tombstone** (soft delete), not an immediate erase. The tombstone is a
  propagation record: it tells every paired device "this family is gone".
- Once propagation is complete, each side **garbage-collects** the tombstoned family (entity + its 8 child
  kinds — chats, messages, memories, emotion/lifecycle state, emoji actions, conversation settings, module
  bindings — all stamped with one shared delete-time so families purge cleanly).
- **There is no restore, no undo, no "deleted items" list.** Deletion is final once propagated and
  collected; the only way back is recreating the AI, which starts fresh (new ID, new greeting, no memory of
  the deleted family). Deleted conversation settings are likewise soft-deleted and filtered everywhere.
- Accepted exception: when the engine *consolidates* a memory (merging several into a better one), the
  source memories are hard-deleted engine-side and app devices keep their copies — a known, documented
  divergence, not a deletion feature.

### 8.3 No app-side rebuilds (the app has no local database)

- The app no longer keeps a local SQLite replica, so the old "one-time wipe +
  re-sync" and "stale-device rebuild" mechanics are **gone** — there is nothing
  app-side to rebuild. The engine owns the database and its migrations.
- Stale-peer convergence is handled **engine-side** by the changeset protocol: a
  peer whose `(epoch, seq)` continuity is broken (a gap beyond retention) is
  served a **baseline snapshot + a fresh epoch** (baseline rejoin) — see the
  engine repo's `docs/Changeset-Sync.md`.
- **Version gate:** the engine advertises `sync_schema_version` (and negotiates
  `sync_protocol: ["changeset-v1"]`) in its handshake as a mismatched-dev-builds
  guard, so two builds that would not sync cleanly refuse each other instead of
  corrupting data.

## 9. One brain, many presences (plan 7-8)

An entity is **one person**. When you sync your own devices into a group, exactly
one of them is the **cognition authority** — the "brain" that feels, remembers
and replies — while every other device is a **presence terminal**: you type into
it and it renders what the brain produced.

- **Reactive replies are minted by the authority.** When you send a message on
  your phone, the phone writes it (and forwards it through the relay); the
  authority applies it and mints the companion's reply, which then syncs back and
  renders on the phone. You never get two replies because two devices both
  "thought" — only the authority narrates.
- **Background beats and dreams** run on the authority only. Other devices pause
  their beat runners while they are clients.
- **If the authority goes quiet** (sleeping laptop, lost network), its lease
  expires and narration pauses rather than duplicating; the app offers to promote
  this device, and the next connection converges (baseline + fresh epoch). The
  one-person guarantee is statistical — during a short failover window a duplicate
  beat is possible, but never corruption (replies merge append-only).
- **Where to see it:** the Desktop Sync status card shows a **Cognition** row
  (this device / a device id / none) and a **narration-paused** banner; the iOS
  background passes report a well-formed `not_authoritative` skip instead of
  silently doing nothing.
