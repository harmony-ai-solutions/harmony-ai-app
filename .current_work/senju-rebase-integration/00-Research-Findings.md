# 00 — Research Findings (Complete Analysis Record)

> Method: read-only investigation of `feat/cloud-lifecycle` (working tree), `senju-design-updates` (via `git show senju-design-updates:<path>`), and merge-base `07f0239`. Conflict prediction via `git merge-tree --write-tree` simulation (git 2.51). Ten deep-dive investigations (6 first-round subagents: marketplace/wallet, DB layer, chat-UX audit, personas/social/navigation, preservation inventory, repo patterns; 4 second-round: `f45540a` seeding, persona implementation, profile-edit replacement, INIT_ENTITY recovery test). All claims carry commit sha + file evidence; speculation is labeled.

---

## 1. Branch Facts

- Merge-base: `07f0239` ("Simplify Module Configurations & Handle Cloud Mode Automatically")
- `feat/cloud-lifecycle` @ `969baf6`: 20 commits, 162 files (+19,738/−996). Author: RuntimeRacer.
  - e575ab1 character image PK→UUIDs · 5ee5133 stale cloud refs removal · d754c33 RP improvements (character card V3, greetings/scenario/lorebook) · d612cea lifecycle editor · 33fb4fd/7485958/969baf6 device authorization + deep link · 4b24c25 typed client connectPoll · 89c2c70 soulbits-api-client git ref · 5f14969 lifecycle/device-push/sync-column migrations + sync fixes · f2d2357 reset-cloud-data purge flow · 6d354ff migration pragma fix.
- `senju-design-updates` @ `5204fb5`: 52 commits, 206 files (+35,452/−7,660). Author: senjuLawliet <goutasalaa@gmail.com>. Single-author linear history → clean replay candidate.
- Infra: she did **not** touch `package.json`/`package-lock.json` (no dependency collisions; ours pins `soulbits-api-client` git ref). She did **not** touch `SyncService.ts` (sync table list unchanged on her side). Both branches pushed → rebase requires coordinated force-push of her branch.

## 2. Conflict Map (merge-tree simulation)

**Content conflicts (15):**
`CHANGELOG.md`, `memory-bank/activeContext.toon`, `memory-bank/progress.toon`, `src/components/characters/CharacterProfileCard.tsx`, `src/contexts/I18nContext.tsx`, `src/contexts/SyncConnectionContext.tsx`, `src/database/__tests__/__snapshots__/migrations.rollforward.test.ts.snap`, `...migrations.snapshot.test.ts.snap`, `src/database/migrations.ts`, `src/database/repositories/characters.ts`, `src/i18n/locales/en/characters.json`, `src/i18n/locales/en/chatDetail.json`, `src/screens/CharactersScreen.tsx`, `src/screens/ChatDetailScreen.tsx`, `src/screens/CreateAIScreen.tsx`.

**Modify/delete conflicts (3) — she deleted, we modified:**
`src/components/chat/ChatInput.tsx` (→ her `ChatInputBar.tsx`), `src/screens/CharacterProfileEditScreen.tsx` (→ her `CreateAI` edit mode + `AIProfileScreen`), `src/components/characters/ProfileImagePicker.tsx` (→ inline `launchImageLibrary`).

**Auto-merged but semantically risky:** `AuthContext.tsx`, `database/models.ts`, `database/sync.ts`, `EntitySessionService.ts`, `CharacterCardImportService.ts`, `ChatBubble.tsx`, `AndroidManifest.xml`, `schema/rn-schema.json`, `characters/entities.test.ts`.

**Silent runtime killers (not textual conflicts):**
1. Her repo + screens SELECT/INSERT `appearance`/`backstory`/`example_dialogues` — columns our migration 000037 **drops**. Every character create + her 3 new profile queries (`getUserCharacterProfiles`, `getCommunityCharacterProfiles`, `getPublicCharacterProfiles`) → `no such column` on merged schema. (`characters.ts` on her branch, e.g. lines 169-170, 336-337.)
2. Character image PK: ours `TEXT` UUID (migration 000035, `models.ts`, repo signatures return `Promise<string>`); hers `number` everywhere. Her migration 000041 `character_image_likes.image_id INTEGER PRIMARY KEY` is a rowid alias — **rejects TEXT UUID inserts** ("datatype mismatch"). `characterSocial.ts`/`AIProfileScreen` typed `imageId: number`.
3. Her migration `000040_add_message_actions` ALTERs the **synced** `conversation_messages` table (`reactions_json`, `reply_to_message_id`, `is_pinned`) — she even added `is_pinned` to `sync.ts` boolean normalization. Engine lacks these columns → sync push failures + parity-gate divergence on `table:conversation_messages`. Her only migration missing the "client-only sidecar" header comment — the pattern break is visible in the file itself.
4. Route deletions: her `AppNavigator` removes `CharacterProfileEdit`, `EntityConfig`, `EntityConfigEdit`, `EmojiActionEditor` (+ `Search` tab, `navigation.json`). Our `CharactersScreen` (import-review deep-link), `EntityConfigEditScreen` cross-links, and our `ChatDetailScreen`'s `navigate('EmojiActionEditor')` → runtime route-not-found. (The last one originates in code her `a677b68` deleted the screen for — the rebase naturally resolves it, but must be verified.)

## 3. Migration Layer (BLOCKER detail)

### 3.1 Numbering collision

| Version | Ours (engine-mirrored, keep fixed) | Hers (renumber +6) |
|---|---|---|
| 35 | `character_image_uuid_primary_key` | `add_character_profile_source` → 41 |
| 36 | `harmonyspeech_api_key` | `backfill_character_profile_source` → 42 |
| 37 | `add_character_card_standard_fields` (V3; drops `appearance`/`backstory`/`example_dialogues`) | `add_personas_table` → 43 |
| 38 | `add_lifecycle_state` | `cleanup_leaked_persona_rows` → 44 |
| 39 | `device_push_tokens_reserved` (**reserved-number no-op placeholder**; app==engine numbering contract) | `add_character_categories_and_favorites` → 45 |
| 40 | `lifecycle_state_sync_columns` (watermark contract) | `add_message_actions` → 46 |
| — | — | 000041–000049 → 47–55 (`character_social`, `user_posts_social`, `character_profile_visibility`, `chat_conversation_settings`, `marketplace_and_soul_wallet`, `extend_visibility_check_marketplace`, `add_blocked_users`, `add_signup_bonus_flag`, `add_marketplace_cache`) |

Our block must **not** shift: the files explicitly mirror Go migrations 1:1 and 000039 exists purely to hold the number. Runner mechanics that make a naive merge fatal: `schema_migrations.version INTEGER PRIMARY KEY` + pending filter by version → fresh DB hits PK violation; installs with our 35–40 applied silently skip her renumbered-as-35–40 set, then her marketplace migrations crash (e.g. 000046's rebuild `DROP TABLE character_profile_sources` on installs that never created it).

### 3.2 Her migration inventory (classification at analysis time; reclassifications per decisions in §11)

| Her # | Purpose | Analysis-time class | Notes |
|---|---|---|---|
| 35/36 | profile source sidecar + backfill | client-only, parity-safe | good quality, documented reasoning |
| 37/38 | personas table + leaked-row cleanup | client-only; personas later redesign (→ 02-Followup Track B: table dropped) | 38's SQL deletes personas whose entity has `character_profile_id NOT NULL` — directly conflicts with persona-from-card design |
| 39 | categories + favorites | client-only | no index on `character_category_members(category_id)` (hot query full-scans) |
| 40 | message actions on `conversation_messages` | **parity-breaking** (synced table) | genuine engine-appropriate *data*, wrong placement; → Track B |
| 41 | character social (likes/saves/comments/creators) | cloud-only semantics, local impl | INTEGER image FKs vs our UUID PKs |
| 42 | user posts/likes/comments/follows/notifications | cloud-only semantics, local impl | |
| 43 | visibility column on profile sources | client-only | OK |
| 44 | chat_conversation_settings | engine-appropriate candidate (→ Track B sync) | `blocked`→`disabled` was a comment-only in-place edit (18fa3ec) — SQL identical, immutability held |
| 45 | marketplace listings + soul_wallet + soul_purchases | cloud-only (currency in local DB) | sound SQL (`CHECK balance >= 0`, single-row wallet) |
| 46 | visibility CHECK rebuild incl. `'marketplace'` | client-only | correct `_new`-table rebuild pattern |
| 47 | blocked_users | cloud-only (moderation) | |
| 48 | signup bonus flag on soul_wallet | cloud-only; per-install mint | |
| 49 | marketplace cache tables + content_library | cloud-only cache | `ON DELETE SET NULL` clean |

**Dependency chain** (verified): 36→35, 38→37+entities, 43→35, 46→43 (rebuilds its CHECK), 48→45, 41→character_image. Uniform +6 shift preserves all internal ordering; no SQL references version numbers literally; only doc comments do (`000046` header "Migration 000043 added…", `characters.ts:776`). One immutability edit total (000044, comment-only). Dev-device caveat (INFO): devices that already applied her 35–49 would re-run renumbered ALTERs → duplicate-column; no production exposure.

### 3.3 Sync layer facts

- Established pattern: `SyncService.ts` hardcodes the sync table list (provider configs → module configs → `character_profiles` → `character_image` → `entities` → `entity_module_mappings` → `interactions` → `conversation_messages` → `emotion_state` → `lifecycle_state` (ours) → `entity_emoji_actions` → `memories`); watermark contract = TEXT `created_at/updated_at/deleted_at` + `strftime('%s', …) > watermark` predicate; only listed tables sync; everything else is engine-irrelevant.
- Her only sync-layer change: `sync.ts` `conversation_messages` boolean map += `is_pinned` (evidence she knew the columns traverse sync).
- Her 15 new tables are all sync-orphaned by design ("client-only sidecar" headers + `CLIENT_ONLY_TABLES` in `scripts/dump-schema.ts` — a genuinely good mechanism worth keeping).
- `schema/rn-schema.json` is stale on **both** branches (hers predates her 39–49; ours misses `lifecycle_state`) — regenerate post-merge, never hand-merge.

### 3.4 Characters repo / models collisions

- Hers (additive): `getUserCharacterProfiles`, `getCommunityCharacterProfiles`, `getPublicCharacterProfiles`, `deleteCharacterProfileCascade`, source/visibility getters/setters, favorites/categories set (12 fns), `getSiblingCharacterProfiles`, `getCharacterStats` (full-scans `interactions` + per-row JSON parse — perf smell). All hardcoded to legacy column list → must be ported to V3 columns.
- Ours (rewrite): `create/get/getAll/updateCharacterProfile` to V3 column set; `createCharacterImage(): Promise<string>` (UUID); `get/deleteCharacterImage`, `setPrimaryImage` retyped `number→string`; new `getDistinctTags` + `parseTagsColumn`.
- `models.ts`: ours rewrites `CharacterProfile` (drops `appearance`/`example_dialogues`, non-null strings, 14 optional V3 fields), `CharacterImage.id: string`, `message_type` += `'greeting'`, `LifecycleState`, `HarmonySpeechProviderConfig.api_key`. Hers adds only `ConversationMessage.{reactions_json, reply_to_message_id, is_pinned}` (clean merge) and keeps `number` image ids (type-level break against ours — her fixtures/tests won't compile until widened).
- Her `createCharacterImage` callers ignore the return value (verified) → only signatures/tests need fixing, not call sites.

## 4. Marketplace / Souls / Wallet / Paywall

### 4.1 Two overlapping systems that don't talk to each other

1. **Local marketplace** (99e462d): `character_marketplace_listings` + `soul_wallet` + `soul_purchases` + `visibility='marketplace'`. Drives the "hard chat paywall". All client-only sidecars → **paywall exists only on the seller's device**; every other install sees `visibility='public'` + no listing → `canChatWithCharacter` returns true → free chat.
2. **Cloud marketplace** (5204fb5): `marketplace_listings_cache` + `marketplace_ownership_cache` + `content_library` + `MarketplaceApiService` targeting `${CLOUD_HOSTS.auth}/v1/marketplace/*` via real `AuthService.fetch` transport. No marketplace service exists in the documented backend (docker-compose: auth :8083, session-broker :8080, conduct-proxy :8085, inference :8082; no `/v1/marketplace` anywhere in docs/plans). Speculation-labeled: with routes unimplemented, every call 404s → screens fall back to cache.

### 4.2 Key findings

| ID | Sev | Finding |
|---|---|---|
| B1 | BLOCKER (merge) | Migration numbering collision (§3.1) — her marketplace series sits on top of it |
| B2 | BLOCKER (product) | Paywall bypassable for all non-sellers; client-only gate, no server verification possible (server has no knowledge) |
| H1 | HIGH | **No purchase path exists**: `confirmPurchaseIfNeeded` (the only dialog) has zero call sites; screens silently ignore locked chats; her CHANGELOG claims "requires buying it once with Souls" — false |
| H2 | HIGH | Two disconnected wallets: cloud `acquire()` returns `AcquireDTO.balance` — never read; local wallet only debited by the dead `purchaseCharacter` path; visible balance never changes on any purchase |
| H3 | HIGH | Fake-success flows: publish/delist/update cloud failures silently degrade to local cache writes **with success toasts** (`MarketplacePublishScreen.handlePublish` catch; `MyListingsScreen.handleToggleStatus`) |
| H4 | HIGH | `MarketplaceItemDetailScreen.doAcquire` `finally { setOwned(true) }` — shows "Owned" after a **failed** acquire |
| M1 | MED | `librarySync` cleanup: compares owned-asset ids vs listing ids (never matches) and deletes `content_library` by wrong key → guaranteed no-op |
| M2 | MED | `clearMarketplaceCache` never called on logout → cross-account library/ownership cache leakage |
| M3 | MED | Backend contract unverified; HTTP 409 → `MarketInsufficientError` mapping invented |
| M4 | MED | Signup bonus is per-install (`soul_wallet` single row `id=1`), not per-account; reinstall re-mints 50 SOUL |
| L1–L3 | LOW | `debitSouls` non-atomic check-then-debit; already-owned shortcut labels free items `'purchase'`; dead code (`MarketListingCard.tsx` zero importers, `creditSouls` prod-never-called, `hasClaimedSignupBonus`, `_createDataURL` re-export) |

### 4.3 Auth entanglement

Her `AuthContext` changes: `signInVersion` counter + bump on fresh logins (not bootstrap); `claimSignupBonus()` in `registerAction` (best-effort, wrapped); marketplace library hydration `useEffect` on `status==='authenticated'` (dynamic import of `librarySync`, failures swallowed). Our change: `DeviceAuthService.registerDevice()` in the `auth:changed` listener. Regions are disjoint but adjacent (imports L24-33, effects ~L144-184) — highest-risk merge window in the file. Her hydration pulls the whole marketplace stack into the auth lifecycle; with a dead backend it no-ops today, but must be re-gated in the stub track.

### 4.4 Quality credit where due

Her marketplace repos **do** follow the established repository style (`getDatabase()` + `executeSql`, `withTransaction`, `ON CONFLICT DO UPDATE`, parameterized queries, UUIDv7 `generateId`); migrations are idempotent and correctly excluded from the parity dump; the 409-mapping and transport plumbing show real (if misdirected) capability. The problem is architecture, not craftsmanship.

## 5. Chat-UX Audit (per-commit verdicts)

| Commit | Claim | Verdict |
|---|---|---|
| f985d69 | message actions + modern chat UI | **PARTIAL / collision** — real feature stack; migration 000040 collision (§3); reply feature added here was **deleted 2.5h later** in 7f0db6b; toast swap downgrades iOS error paths |
| cd821db | online/offline dot | REAL (cosmetic); loses 3rd "connecting…" state |
| afbb5c5 | bubble sizing | PARTIAL — `width→maxWidth` legit; long-press menu dead for non-last messages (superseded 90 min later) |
| 6c3484e | haptics toggle actually works | **REAL FIX** — root cause correct (pref never loaded); `loadHapticPreference` at App mount + settings wiring + 8 tests |
| 7f0db6b | keyboard input bar fixed | **PARTIAL + INTRODUCES BUGS** — new 120s auto-stop **discards** the recording (`recordingAbortedRef` guard in `finishRecording`); reply feature silently removed; iOS keyboard inset lost (bare View + translateY hack); input locked when sync offline (not just session-inactive) |
| e8d6c18 | emoji picker latency | **REAL FIX** — context split (`EmojiPreferencesContext`/`EmojiRecentsContext`), `useCallback` renderItem, stable handlers; addresses actual re-render churn, not a memo band-aid |
| a677b68 | avatar/name → AI profile | REAL + heavy scope creep — also deleted the entire EmojiActionEditor feature (screen/route/pickers); our `ChatDetailScreen` still navigates there → crash after naive rebase |
| 23ceee9 | hide reactions/forward | REAL — honest, as claimed |
| 37abc7f | conversation menu/options | PARTIAL/HIGH RISK — real functionality (settings table, archived screen, unread counting, `assertNotBlocked` guards, native bubble stack + FGS + SYSTEM_ALERT_WINDOW manifest); "block" renamed to "disable" 2 commits later |
| 45b6243 | bubble open/close animation | REAL — ValueAnimator over window LayoutParams (correctly avoids SurfaceView view-alpha glitch) |
| 20c985a | "bubble chat finally work" | **PARTIAL + BUGS** — `FloatingChat` second React root, `readOnly` provider mode (correct); BUT removed `cloudSessionService.disconnect()` on background (WS stays open — interacts with our purge suppression); dead `result === false` check (`ChatBubbleModule.show()` is a void `@ReactMethod` → native-refused path unreachable → failures report success) |
| 79ce509 / a2833a2 | floating window messages / header | REAL — keyboard translateY + `overflow:hidden` clipping, coherent pair |
| b9762a5 | category filter dropdown | PARTIAL (hygiene) — real UI work but bundles a 698-line native multi-bubble rewrite + `setUnreadCount` signature change under an unrelated title |
| 1d58f99 | chat list UI | REAL (cosmetic restyle) |
| 98d0ec9 | day separator works | REAL FIX (minor gap: `i === 0` skipped — first message never gets a divider) |
| 900a8aa | only last message deletable | **RED HERRING** — UI-only button hiding; repo delete unrestricted; stale-`messages` race re-enables deletion of non-last message |
| f254648 | conversation opened at first message | **REAL FIX** — correct root cause (scroll target pointed at divider index in non-inverted list); **our branch still has the old buggy logic** — her fix is an improvement we want |
| 3fd2b0b | (souls dropdown commit) | **RED HERRING / RED TEST** — adds `entitySessionInitRecovery.test.ts` documenting a real INIT_ENTITY teardown bug; the fix (`MAX_INIT_ENTITY_RETRIES`, `session.initRetryCount`, `handleEntityConnectionError` event-deferral) was **never implemented** — test red on both branches (→ D2 skip + Track E spec) |
| a0b3607 | themed toasts everywhere | REAL — `AppToastContext`/`TopToastModal` (modal-window toast insight); converges with our purge-flow `showToast` helper |

**Bubble-chat native stack verdict: KEEP-WITH-FOLLOWUP.** Functional, iterated (5 commits), unit-tested, unusually precise in-code design notes. Required follow-ups: fix dead `show()` result check; null-guard ReactHost force-resume vs. our deep-link cold start; decide background-WS policy; Play-Console FGS `specialUse` justification; verify second React root + shared DB singleton on RN 0.86 new arch.

## 6. Personas / Profiles / Social (as-built)

### 6.1 Persona implementation (second-round deep dive)

- Schema: client-only `personas(id, name, description, personality, avatar_image_data, avatar_mime_type, ts)` — **standalone identity structure, no FK to character_profiles** (a slim parallel, not a layer on top).
- `createPersona` transaction: INSERT `personas` row + INSERT `entities` row with **same id**, `alias = name`, `character_profile_id NULL`, `lifecycle_config '{}'`, `rag_reindex_required 1`, no module mappings. `updatePersona` syncs `entities.alias`; `deletePersona` removes both. All persona reads JOIN `entities` with `character_profile_id IS NULL` as the "is-persona" test (defense-in-depth after the leaked-row incident).
- Chat integration: `PersonaSwitcherModal` → `ChatPreferencesService.setGlobalImpersonatedEntity(personaId)` (AsyncStorage `chat_global_impersonated_entity`) → `resolvePersonaId(storedId)` at ChatList/Discover/`CharacterChatService` → flows as `ownEntityId`/participant id → `INIT_ENTITY` sent for it; `PersonaEditScreen` does blocking `syncAndWait(45s)` after save so the entity reaches the engine.
- **Engine sees personas as opaque id + alias.** Personality/description/avatar never reach the engine (`personas` client-only; `entities` has no identity columns). — Exactly the gap the persona redesign (02-Followup Track B) closes via profile-linked user entities.
- Legacy: `resolvePersonaId` silently maps old AI-character impersonation prefs → `'user'` (deliberate breaking change; P4 pending). Base resolution (`stored > 'user' entity > first entity`) allowed impersonating AI chars; hers is persona-only.
- The `'user'` identity is a **magic sentinel id with no DB row** at base and on her branch; the engine seeds it (senior dev confirmation). Personas differ structurally (real synced rows).
- Latent bug: persona `alias = name` with no conflict handling vs `idx_entities_alias_unique` → raw `SQLITE_CONSTRAINT` ("Failed to save persona") when a persona shares a name with an AI entity. (Moot after redesign; keep in register.)
- Avatar: base64 in `personas.avatar_image_data` + mime, data-URL rendering.

### 6.2 UserProfileStore (02f4ff3)

AsyncStorage `@harmony_profile/<userId>` storing `{displayName, username, bio, avatar_data_url}`; read-merge-write; self-documented as interim until `PATCH /v1/auth/me` exists. Problems: local copy **shadows** cloud truth (`local.x ?? user.x`) with no reconciliation; base64 avatar data-URLs in AsyncStorage (hundreds of KB — violates the lightweight-state convention); edits unrecoverable on reinstall/other device. → Cloud-first directive (§11).

### 6.3 Social layer

All local tables, no backend anywhere: `character_likes/saves/image_likes/image_comments/creators` (000041), `user_posts/likes/comments/follows/notifications` (000042). Notifications are architecturally revealing: `addNotification` writes rows addressed to **other** users; the feed queries `recipient_user_id = <current user>` → the local user's feed can never contain real incoming notifications. Pure scaffold awaiting a backend. `CharacterChatService.openCharacterChat` (631a8ff) is the one engine-appropriate piece (entity + module mapping creation + `syncAndWait`).

### 6.4 Screen restructuring & deletion map

- Deleted in `1ad4880`: `CharacterProfileEditScreen`, `ProfileImagePicker`, `ImageViewerModal`, `EntityConfigScreen`, `EntityConfigEditScreen`, `EntityCard`, `entityConfig.json`. Deleted in `eb9f1c4`: `SettingsMenu`, `navigation.json`. Deleted in `0cd9423`: `SearchScreen`, `search.json`. Deleted in `a677b68`: EmojiActionEditor suite.
- Replacement: editing consolidated into `CreateAIScreen` (unified create/edit/fork via `editProfileId`/`duplicateProfileId`/`prefillProfileId` params), `AIProfileScreen` read-only view + owner-only edit pill, `CharactersScreen` long-press menu, module configs via `ModuleConfigEditScreen` + CreateAI Advanced section.

### 6.5 Navigation end-state (her branch)

Tabs: `Characters | Chat | Discover [center] | Market | MyProfile`, `initialRouteName="Discover"`. Stack adds: `EditProfile`, `PersonaEdit`, `AIProfile`, `Notifications`, `UserProfile`, `BlockedUsers`, `DisabledAIs`, `MarketplacePublish`, `MarketplaceItemDetail`, `MyLibrary`, `MyListings`, `ContentAsset`, `Settings` (stack route after tab removal), hamburger (`HeaderMenuButton`) + bell (`HeaderNotificationButton`) in main headers. Stack removes: `CharacterProfileEdit`, `EntityConfig`, `EntityConfigEdit`, `EmojiActionEditor`. Our branch touched none of these files (verified empty diff) — all navigation decisions are hers to keep; only orphaned `navigate()` calls from our side need mending.

## 7. Profile-Edit Replacement (second-round reconstruction)

**Capability matrix (base editor → her branch):** all 13 base text fields MOVED into CreateAI edit mode (with clamping instead of alerting on WPM/audio validation — minor UX gap); image pick/add/delete MOVED (split avatar vs gallery); create mode MOVED; delete character IMPROVED (`deleteCharacterProfileCascade` via long-press); module mapping / visibility+marketplace / fork flow / categories / social ADDED (superset). **Gaps:** full-screen zoom viewer LOST (no successor); per-image "Set as Primary" PARTIAL (only avatar can be primary); image captions LOST (never settable); pull-to-refresh LOST (minor).

**Data model: unchanged on her side.** `CharacterProfile` interface byte-identical to base; repo changes purely additive; edit-save is `updateCharacterProfile({...current, <13 base fields>})` — spread preserves everything else. → Extending her screens with our V3 fields is a clean additive port (repo/models side already done on our branch; the work is UI sections). **Verdict: her CreateAI edit mode is a functionally sufficient successor; nothing material lost.**

**New finding (follow-up register):** her edit-save **hard-deletes all image rows and recreates them on every save** (`deleteCharacterImage(img.id, true)` → re-insert). With our UUID PKs and engine-synced image rows: id instability + delete/create sync churn on every save. Fix during editor consolidation.

## 8. `f45540a` — SoulbitsCloud default seeding (second-round deep dive)

**Established mechanism (base + our branch):** the app **never** creates soulbitscloud provider/module-config rows. The engine seeds `"Default SoulbitsCloud"` rows that **sync down**; the app only bulk-injects the PASETO via `updateAllSoulbitsCloudApiKeys` on every `auth:changed` (`soulbitsTokenSync.ts` documents "the engine seeds its own default soulbitscloud row"). `moduleDefaults.ts` = editor form defaults only. `syncNameClash.ts` exists specifically to absorb engine-seeded defaults colliding with local rows — engine-first seeding is baked into the sync architecture.

**What she built:** `ensureSoulbitsDefaultConfigs()` creates a **parallel, differently-named set** — up to 9 `provider_config_soulbitscloud` rows (`"Soulbits Cloud (default) (backend|…|vad)"`) + 8 module-config rows (`"Soulbits Cloud (default)"`), fresh `generateId()` per call, non-atomic check-then-create (module tables hit `UNIQUE(name)` on races; provider rows duplicate silently — no unique constraint since 000032). Triggered from a `CreateAIScreen` effect re-firing on **every module-selection change** plus save time; the effect's `cancelled` flag suppresses setState, **not DB writes**. **No connection-mode gating anywhere.**

**Consequences:** two soulbitscloud configs per module per partner (engine's + hers); cross-device name-clash prompts; token-refresh LWW re-push of 9 extra provider rows; in standalone mode: pre-selected, non-functional defaults (`api_key: ''` + cloud `base_url`), and with "Disabled" removed users can't leave slots empty. **Verdict: yes — she reimplemented engine-originating behavior app-side, in the wrong direction (app→engine instead of engine→app).** Follow-up: revert auto-fill, restore Disabled, auto-select the engine's synced default row.

## 9. Preservation Inventory (our must-survive changes — condensed)

- `migrations.ts` 35–40 registration + engine-mirror contract (never renumber).
- `characters.ts` V3 CRUD + UUID image functions; `models.ts` V3 interface; `getDistinctTags`.
- `ChatDetailScreen`: greeting render branch, `AlternateGreetingSwiper`, `EmptyChatCTA`, `GreetingBubble`/shimmer, `ScenarioGeneratorSheet`, `performGenerateGreeting`/`performScenarioRestart`, `showScenarioButton`/`onScenarioPress` (→ port onto her `ChatInputBar`).
- `CharacterProfileEditScreen` (+`ProfileImagePicker`, `ImageViewerModal`): entire RP editor suite (Lorebook, Greeting, Lifecycle, ImportReview, Export, MacroHighlighter, TagChips) — restored unlinked per D4.
- `CharactersScreen`: import-review flow (`parseCardFile` → `ImportReviewSheet` → persist/deep-link), TagChips filter row, creator filter.
- `SyncConnectionContext`: device-auth gate + `DeviceAuthModal`, `soulbits://device-auth` deep link (cold+warm), purge suppression (`purge:done/failed`, `isPurging()`, `PurgeInProgressError`) — must survive her `readOnly` mode + toast refactor (verify her early-return can't skip our purge listeners).
- `AuthContext`: `registerDevice()` in `onChanged` (disjoint from her additions).
- `EntitySessionService`: generation API (`generateGreeting`, `startNewScenario`, `handleGenerationResponse`, session re-keying) — she never touched the same functions (additive both sides; her unread/block-disable guards + `replyToMessageId`/`assertNotDisabled` merge mechanically).
- `soulbitsClient.ts` typed-client pattern, `config/cloud.ts`, `CloudSessionService` purge flow, `DeviceAuthService`/`deviceDeepLink`, `SyncService` lifecycle watermark contract, `soulbitsTokenSync` engine-first seeding.
- `sync.ts`: both boolean-map entries must survive (ours `lifecycle_state.sleeping`, hers `conversation_messages.is_pinned`).
- Tests: `ProfileEditorSections.test.tsx` (renders the restored editor), `CharactersScreen.test.tsx`, greeting/scenario suites, `characters/entities.test.ts` (merge; her fixtures updated to V3 + UUID).

## 10. Red Herrings & Bug-Introducing Register (follow-up Tracks C/D)

| Where | Issue |
|---|---|
| 900a8aa | UI-only delete gate + stale-array race |
| 3fd2b0b test | INIT_ENTITY recovery spec, never implemented (→ Track E) |
| 7f0db6b | 120s auto-stop discards recording; reply silently removed; iOS keyboard inset; offline input lock |
| 20c985a | dead `show()` result check; background WS stays open |
| Marketplace | H1–H4 + M1–M4 (§4.2): fake-success flows, owned-after-failure, no purchase path, wallet disconnect, logout cache leak |
| f45540a | engine-seeding reimplementation (§8) |
| Personas | alias-collision raw constraint error (moot post-redesign) |
| CreateAI save | image hard-delete/recreate churn (§7) |
| cd821db / 98d0ec9 | minor: lost "connecting" state; first-message day divider |

**Genuinely valuable, must-preserve:** 6c3484e (haptics), e8d6c18 (emoji perf), f254648 (scroll-to-latest — fixes a bug our branch still has), 98d0ec9, a0b3607 (toasts), 733084b (fork rollback + tests), eeb9031, bcb404f, 45b6243/79ce509/a2833a2 (bubble animations), plus the entire redesign corpus.

## 11. Pattern-Violation Classification (final, after senior-dev reclassifications)

| Her data / mechanism | Final classification | Rationale / destination |
|---|---|---|
| `soul_wallet`, `soul_purchases`, signup bonus | **Remove** | Currency/payment state → cloud ledger (stub now) |
| `character_marketplace_listings`, `visibility='marketplace'`, `isChatLocked` gates | **Remove** | Cloud-only; client-side paywall is security theater |
| `user_posts`/likes/comments, `follows`, `notifications` | **Remove** | Social graph → stub service + future backend |
| `character_likes/saves/image_likes/image_comments/creators` | **Remove** | Same |
| `blocked_users` | **Remove** | Cloud moderation data |
| Message actions (`reactions_json`/`reply_to_message_id`/`is_pinned`) | **Engine-parity track** | Engine-appropriate data on a synced table → Go migration + engine support (closes D3) |
| `personas` table + shim entities | **Redesign (Track B)** | Logical concept over user entities; table dropped; `entity_type` enum; default persona = engine-seeded `user` entity; persona-from-card = copy at creation |
| `character_categories`/`character_favorites`, `chat_conversation_settings`, `character_profile_sources` | **Engine-parity track** (reclassified) | User prefs sync to engine (unified product); watermark columns needed; `unread_count` split; categories derived dynamically from `character_profiles.tags` |
| `UserProfileStore` (AsyncStorage) | **Cloud-first** | Drop shadow store; `PATCH /v1/auth/me` + avatar upload in backend concept; optional read-through cache, cloud-wins |
| `MarketplaceApiService` | **Stub → backend concept** | Real transport, wrong pattern (bypasses first-party client, reintroduces orphaned `authFetch` style); pre-match `soulbits-api-client` shapes in stub |
| `SoulbitsDefaultConfigService` (f45540a) | **Revert** | Engine seeds defaults; app-side parallel set is wrong direction |
| `CLIENT_ONLY_TABLES` in `dump-schema.ts` | **Interim-only (D6 — supersedes earlier "keep")** | Scaffolding for senju's sidecar tables; **deleted in the B5 pass with the last sidecar table drop**. End state: zero dump exclusions — "app-only SQLite table" is not a category (local state = AsyncStorage; engine-appropriate data = mirrored migrations both sides). Index leak on the mechanism fixed in commit F (`isClientOnlyEntry` also matches indexes by `ON <table>`). |

## 12. Canonical Patterns (summary — full sheet in 03-Pattern-Cheat-Sheet.md)

Cloud client = `buildSoulbitsClient` factory over `@harmony-ai-solutions/soulbits-api-client`, PASETO-only (no client-side refresh — AuthService is the credential authority), hosts from `config/cloud.ts`, app-local typed errors at service boundaries, bounded retry constants, EventEmitter status singletons. Local DB = numbered TS-string migrations registered in one array (engine 1:1 mirror), models mirror Go structs, free-function repositories, `withTransaction`, soft-delete + watermark triple. Sync = hardcoded FK-ordered table list, watermark predicate, LWW, buffered atomic apply; parity gate = dump-and-diff CI. Storage = AsyncStorage for lightweight non-secret per-device state (`harmony_*`/`@harmony_*` keys), Keychain for secrets, no MMKV/Redux. Feature gating = `ComingSoon` screen, `__DEV__` gates, build-flavor env (`react-native-config`), runtime `connection_mode`. i18n = per-domain JSON namespaces registered in `I18nContext`. Testing = Jest 30 unit+integration, in-memory better-sqlite3 `useFreshDatabase`, migration snapshot + rollforward suites, `HarmonyLinkMockServer` protocol harness, per-PR typecheck + parity gate.
