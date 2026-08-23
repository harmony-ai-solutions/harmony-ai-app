# 04 — Preference & Unread-State Alignment Inventory

> Born from proof-read Q1 + ChatListScreen audit. **Directive (senior dev):** whether a message was read (by the user or the AI) must be a **flag on the messages themselves**; anything shown in the chat UI (unread badges, "new messages" dividers) is **calculated from `conversation_messages` state** — never stored as separate counters. This doc inventories EVERY preference/unread-ish setting on her branch and proposes: fixed vs. dynamic, and where it lives.

## 1. Current state: THREE parallel unread/read systems on her branch

Found by the ChatListScreen audit (evidence: her `ChatListScreen.tsx`, `ChatPreferencesService.ts`, `EntitySessionService.ts`):

| System | Storage | Writers | Readers | Status |
|---|---|---|---|---|
| (a) `chat_conversation_settings.unread_count` | SQLite | `EntitySessionService.handleIncomingMessage` (inc unless conversation registered open); ChatListScreen on open / mark-read | Chat list badge **only** | live — the only badge source |
| (b) `chat_last_read_<entityId>` last-read timestamp | AsyncStorage | ChatDetailScreen — **but keyed by `interactionId`, not partnerEntityId** (misuse) | ChatDetail in-chat "new messages" divider | live but inconsistent |
| (c) `chat_last_read_key_<participantKey>` | AsyncStorage | ChatListScreen/ArchivedChatsScreen (`markKeyAsRead`) | **NONE — write-only dead subsystem** (`getKeyLastRead` has zero callers) | dead writes |

They disagree in practice: opening a chat resets (a)+(c) but never seeds (b) → fresh conversation shows zero badge but "everything is new" divider; persona switches reset (b) per persona while pair-chat (a) survives (and **group** participant_keys embed the own-entity id → (a) resets per persona — the exact opposite of the code's own docstring claim).

## 2. Target model (per directive)

- `conversation_messages` gains a **read-state flag/timestamp** (e.g. `read_at`/`read_by_user` — exact shape is an engine-parity design item; base model has **no** read field today — verified at merge-base).
- Unread count per conversation = **derived**: `COUNT(messages WHERE incoming AND unread)` — computed in the list query, never stored.
- In-chat "new messages" divider = same flag (first unread message), replacing AsyncStorage system (b).
- All three systems (a)(b)(c) are **removed** in the alignment step.

## 3. Complete preference inventory & proposals

"Synced" = engine-mirrored table (parity gate + SyncService registration + watermark columns). "Engine-relevant" = engine could/should act on it.

### 3.1 Chat-conversation preferences (`chat_conversation_settings`)

| Preference | Kind | Proposal | Where it lives | Engine-relevant |
|---|---|---|---|---|
| `pinned` | fixed (user-set) | keep as synced column | `chat_conversation_settings` (engine-mirrored) | no (pure UI) — syncs for unified experience |
| `archived` | fixed | keep as synced column | same | no |
| `muted` | fixed | keep as synced column | same | **yes** — engine should suppress notifications/proactivity for muted conversations (contract item) |
| `disabled` (physical column `blocked`) | fixed | keep as synced column; rename physical column when the table is redesigned for parity (pre-release, editable) | same | **yes** — strongest candidate: engine-side disable = stop proactive/lifecycle automations for that AI (contract item) |
| `unread_count` | **dynamic — derived** | **DROP column**; derive from message read-flags (§2) | nowhere (computed) | read flags themselves sync (below) |
| `entity_id` | denormalized helper | keep as non-preference metadata column (name/avatar resolution for Disabled-AIs screen) | same | — |
| `participant_key` | identity | **[O3 ruled]** keep (PK); the own entity IS part of the participant key **everywhere, matching the engine** — per-persona settings/unread is intended semantics for pairs AND groups alike; fix app-side derivation + her docstring to match engine `deriveParticipantKey` exactly | same | — |
| `reply_mode` (`instant`\|`realistic`) | fixed | **[A6 ruled]** NEW column in the redesigned table (synced): the toggle returns, UI in the conversation settings menu (not immediate chat UI/header); AsyncStorage keyed by participant key as Phase-1 interim | same (B2) | minor — engine could adapt response pacing eventually **[Q-lean-no]** |

### 3.2 Message read-state (NEW)

| Item | Kind | Proposal | Where | Engine-relevant |
|---|---|---|---|---|
| read-by-user flag/timestamp | fixed per message (set once) | new column on `conversation_messages` → **engine-parity item** (Go migration + sync; aligns cross-device unread for unified product) | `conversation_messages` | yes — engine stores it; also enables "AI has read your message" display later (the directive mentions read-by-AI: engine-side concept, same column family, **[Q]** shape) |
| read-by-AI state | dynamic (engine knows when it ingested/processed) | engine-side only; expose via event/field later if UI wants it — **[Q]** deferred | engine | yes |

### 3.3 Character-organization preferences

| Preference | Kind | Proposal | Where |
|---|---|---|---|
| `character_favorites` | fixed | synced table (engine-mirrored) | keep table |
| `character_categories` + members | fixed organization | **[O6 ruled — lightweight model]** custom categories live in **AsyncStorage** (transient user groupings); assigning a category to a character **writes a native tag on the profile** (synced via `character_profiles.tags`); filtering derives from tags ∪ AsyncStorage list; her two category tables are dropped (B5) | custom list: AsyncStorage; membership: profile tags |
| `character_profile_sources.source` (`user`\|`community`) | dynamic — derivable | **[A3 ruled, confirmed]** drop column. Origin of the concept: her migration 000035 invented it for the Discover split ("created by others"); authorship is already covered by V3 `creator`/`creator_notes` + our `card_provenance` (import vs. local creation) — derivation: locally created = no import provenance. "Created by others" Discover filter becomes a backend query in the cloud concept (stubbed meanwhile) | nowhere (derived) |
| `character_profile_sources.visibility` (`public`\|`private`) | fixed | keep as synced column (Discover privacy is a real user pref); `'marketplace'` value dropped with the paywall — **[A4 ruled]** publishing = copy of the card contents uploaded to the marketplace backend, never a local visibility state (see `20-Backend-Concept`) | synced column (home finalized in B2 table work) |

### 3.4 Identity & per-chat prefs (AsyncStorage — per directive)

| Preference | Kind | Proposal | Where |
|---|---|---|---|
| `chat_global_impersonated_entity` (global persona / "chat as") | fixed | **[directive] keep in AsyncStorage** — this is precisely the "chat as XY" pref, "just more precise" after persona redesign (stores user-entity id) | AsyncStorage (keep) |
| `chat_entity_pref_<partnerEntityId>` (per-partner identity override) | fixed, legacy | **[A5 ratified]** dead code on her branch (zero callers beyond the service). Drop in persona redesign — global persona pref supersedes. | — (dropped) |
| `chat_reply_mode_<partnerEntityId>` (`instant`\|`realistic`) | fixed | **[A6 ruled: returns]** the toggle comes back with its UI in the **conversation settings menu** (not immediate chat UI/header); re-keyed by participant key (AsyncStorage interim), becomes a synced `chat_conversation_settings` column in B2. NOTE: the reply-to-message *feature* is separately **dropped** [O4] — different things, explicitly disambiguated. | AsyncStorage interim → synced column (B2) |
| last-read keys (b)+(c) | dynamic — superseded | **DROP both key families** when message read-flags land (§2) | — |

### 3.5 Explicitly NOT part of the engine alignment (device-local UX settings)

These stay AsyncStorage per existing conventions; cross-device settings sync is a separate future discussion, out of scope here:
`@harmony_setting_haptic_feedback`, `PUSH_NOTIFICATIONS`, `SOUND_EFFECTS` (SettingsScreen), theme family (`@harmony_current_theme`/`theme_mode`/`custom_themes`/`dynamic_background`/`background_style`/`dark_mode`), emoji (`emoji_set`/`skin_tone`/`recent`), `@harmony_language`, biometric lock (`setting_biometric_lock`/`lock_pin`), `connection_mode`, module-config Simple/Advanced toggle, `soulbits.device_id`.

Ephemeral UI state (in-memory React state, correct as-is, never syncs): CharactersScreen `sortMode`/`activeFilter`, ChatList filter state, `signInVersion` counter.

### 3.6 Cloud-concept "preferences" already handled elsewhere

`blocked_users` (cloud moderation → stub service, table dropped — Track A), marketplace/social everything (Track A), user profile fields (cloud-first, Track A4), `soul_wallet`/purchases (dropped).

## 4. Migration mechanics summary (into Track B when engine phase opens)

1. Add message read flag → parity item (Go + RN), backfill = all existing messages read.
2. Switch badge + divider reads to derived counts; delete (b)/(c) AsyncStorage usage; muted conversations suppress badge increments [O10].
3. Redesign `chat_conversation_settings` for parity: watermark triple, physical `blocked`→`disabled` rename, drop `unread_count`, add `reply_mode` column [A6], align `participant_key` derivation with the engine incl. own entity [O3] — **pre-release table edit** (B5 rules) since it never shipped.
4. `character_favorites` + visibility: parity + watermark columns.
5. Categories [O6]: AsyncStorage list + native tags on assignment; drop `character_categories`/`character_category_members` tables in B5.
