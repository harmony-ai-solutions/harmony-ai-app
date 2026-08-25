# Phase 1 Logbook — Senju Follow-Up Phase 1 (app-side)

> Running per-phase record of every added / modified / removed feature and component, kept for
> **follow-up Phase 2 (engine-side) planning**. Updated after each subphase by the orchestrator.
> NOTE: the D5-convention record doc (originally planned as `13-Followup-Phase1-Record.md`) moves to
> `14-Followup-Phase1-Record.md` to free the `13-` number for this logbook.
> Companion docs: `.current_work/senju-followup-phase1/*` (phase specs + checklists).

## Status

| Phase | State | Commit |
|---|---|---|
| 1 — Stub service layer | ✅ committed | `1455b6e` |
| 2 — Marketplace & wallet rewiring | ✅ committed | `82143b7` |
| 3 — Social/notifications/profile rewiring | ✅ committed | `20d70c9` |
| 4 — Schema surgery | ✅ committed | `a0992be` |
| 5 — B4 seeding revert | ✅ committed | `29871ab` |
| 6 — D-register bug mends | ✅ committed | `ba97e9a`+`4fc4ab0`+`77518e5`+`40553b3` |
| 7 — INIT_ENTITY recovery | ✅ committed | `ec0aaca` |
| 8 — Editor consolidation | ✅ committed | `ca48bd5`+`3310dde`+`7352034` |
| 9 — Verification/records/docs | ⏳ pending | — |

---

## Phase 1 — Stub Service Layer (new files only)

**Track**: A1/A2/A3 core · **Commit**: `1455b6e` · **Gates**: tsc 0 errors; unit 88 suites/861 tests; integration 10 suites/50 passed +1 skipped; GitNexus index 7110→7384 symbols, no touched flows.

### Added — services & types (16 files)

| File | Content |
|---|---|
| `src/services/stub/StubServiceError.ts` | Shared app-local error base `StubServiceError` pre-matching client `APIError` surface (`status`, `code`, `upgradeUrl`, `currentTier`, `requiredTier`, `soulCreditsAvailable`, `taskId`; getters `isAuthError`/`isQuotaError`/`isRateLimited`/`isServerError`). Domain subclasses `MarketplaceError`, `WalletError`, `SocialError`, `NotificationError`; `InsufficientCreditsError extends MarketplaceError` (402 `quota_exceeded` + remaining balance). Placeholder `upgradeUrl = https://harmony.ai/souls`. |
| `src/services/stub/stubBackendUtils.ts` | `simulateLatency()` (~300 ms ±100 ms jitter) + seeded FNV-1a `simulateTransientFailure(key, failRate)`. |
| `src/services/marketplace/MarketplaceService.ts` | App-facing marketplace API (module-level functions; ~300 ms latency on every call): `getListings(query?)`, `getListing(id)`, `publishListing(draft)`, `delistListing(id)`, `acquire(listingId)`, `getMyListings()`, `getLibrary()`, `getContentAsset(id)`, `refresh()`. Types `CharacterSnapshot`, `MarketplaceListingSummary/Detail`, `PublishListingDraft`, `AcquireResult`, `ContentAsset` (kind `character_card\|text\|theme`), `OwnedLibraryEntry` (kind `purchase\|free\|own`). `acquire` debits wallet → `InsufficientCreditsError` when short. Publish = upload-copy (A4). |
| `src/services/marketplace/marketplaceStubBackend.ts` | In-memory store (Map of listings, ownership set, library, assets); `__resetForTests()`; honest 503 on seeded transient failure (publish 3% / delist 10% real-rate constants). |
| `src/constants/marketplaceFixtures.ts` | 12 listings (prices 0–500, statuses active/pending/removed, 10 creators, full snapshots) + 4 content assets. |
| `src/services/wallet/WalletService.ts` | `walletService` singleton EventEmitter, status `idle\|syncing\|ready\|failed`; `getStatus()`, `getBalance()`, `getSubscription()`, `on()`; seeded 50 souls; NO persistence. `SubscriptionStatus {tier, soulCreditsAvailable, currentTier?, upgradeUrl?}`. |
| `src/services/wallet/walletStubBackend.ts` | In-memory balance + debit (throws `InsufficientCreditsError`); `__resetForTests()`. |
| `src/services/social/SocialService.ts` | Full social API: profiles/follows (`getPublicUserProfile`, `toggleFollow`, `isFollowing`, `getFollowedUsers`), posts (`getPosts`, `createPost`, `deletePost`, `togglePostLike`, comments), character social (`toggleCharacterLike/Save`, counts, saved entries), image social (`toggleImageLike`, comments), block list (`getBlockedUserIds` → `Set<string>`, `blockUser`, `unblockUser`), creators (`setCharacterCreator`, `getCharacterCreator`, `isCharacterCreator`). |
| `src/services/social/socialStubBackend.ts` | In-memory social store; `__resetForTests()`. |
| `src/constants/socialFixtures.ts` | 7 users, 7 posts, follow seed, image comments, like baselines, creator rows, 5 notifications. |
| `src/services/social/NotificationService.ts` | In-memory feed; `EventEmitter<'unread'>` + `subscribe(cb)`→unsubscribe; `list()`, `getUnreadCount()`, `markRead(id)`, `markAllRead()`; `registerPushToken(token)` async no-op (interface-only — engine `device_push_tokens` anticipates it). List ops synchronous. |
| `src/utils/blockedContentFilters.ts` | PURE filters: `filterBlockedCharacterProfiles`, `filterBlockedUserPosts`, `filterBlockedUserNotifications` — `(items, blockedIds: Set<string>)`, generic over author-id fields; no DB. |
| 4 test suites | `MarketplaceService.test.ts` (CRUD, acquire success/insufficient/idempotent/409, delist honest-failure, publish upload-copy incl. static no-repo-import assertion), `WalletService.test.ts` (idle→syncing→ready, seeded 50, debit, listener cleanup), `SocialService.test.ts` (toggles, feed CRUD, block + pure filters), `NotificationService.test.ts` (unread emission, markAllRead, push-token no-op). All mock `stubBackendUtils` + logger; `__resetForTests()` in `beforeEach`. |

### Modified / Removed
None (phase was new-files-only by design).

### Deviations (minor, accepted)
- `getPosts` returns `Promise<StubPost[]>` (doc typo said singular).
- `publishListing` → status `'pending'` (moderation semantics); pending excluded from public feed.
- All error classes in `StubServiceError.ts` (avoids import cycles).
- `upgradeUrl` placeholder `https://harmony.ai/souls` — backend owns real URL.
- `NotificationService` under `src/services/social/` (doc allowed either).

---

## Phase 2 — Marketplace & Wallet Rewiring (+ paywall removal)

**Track**: A1/A2 wiring · **Gates**: grep sweeps clean (only repo-internal definitions + their tests remain — Phase 4 deletes those); tsc 0 errors; unit 88 suites/858 tests; integration 10/50+1 skipped.

### Added
| File | Content |
|---|---|
| `src/utils/marketTypes.ts` | Self-contained marketplace item-type helpers replacing deleted `marketplaceTypes.ts`: `MarketplaceItemType`, `MARKETPLACE_ITEM_TYPES`, `itemTypeLabelKey`, `itemTypeIcon`, `isTextItemType`, `contentKindIcon`, `formatSoulPrice`. |
| i18n keys | `market.json` +8: `insufficientTitle`, `insufficientSoulsBuySoon`, `publishTypePreviewOnly`, `editUnavailablePreview`, `relistUnavailablePreview`, `removeUnavailablePreview`, `statusPending`, `statusRemoved`. `discover.json` +1: `previewHint` ("Preview content while the community backend is in development"). |

### Removed (7 files)
- `src/services/marketplace/MarketplaceApiService.ts` (O7)
- `src/services/MarketplacePurchaseService.ts` (fold into `MarketplaceService.acquire` — approved default #3)
- `src/services/marketplace/acquireItem.ts`, `itemSnapshots.ts`, `librarySync.ts`, `marketplaceTypes.ts`
- `src/components/market/MarketListingCard.tsx` (dead, zero importers)
- From `marketFilters.test.ts`: wire-serializer test block (no stub equivalent; acquire/publish/delist intent already covered by Phase-1 suite)

### Modified — screens/components/services
| File | Change |
|---|---|
| `services/CharacterChatService.ts` | `openCharacterChat` dropped `currentUserId` param + `isChatLocked` import + silent-return gate. 3 call sites updated. |
| `screens/CharactersScreen.tsx` | `handleChatPress` drops `user?.id`; `useAuth` removed. |
| `screens/ChatListScreen.tsx` | `handleNewChat` drops `user?.id`; lock check removed; `useAuth`/`isChatLocked` imports gone. |
| `screens/ChatDetailScreen.tsx` | **Extra consumer found** (not in doc): `isChatLocked` gate + `chatLockedRef` + session-init guard + `useAuth` removed. |
| `screens/AIProfileScreen.tsx` | Chat lock removed; `listing` retyped to stub `MarketplaceListingDetail` (always null — no profile→listing linkage); price pill/lock icons stay as pure UI. |
| `screens/MarketScreen.tsx` | `loadMarket` → `MarketplaceService.getListings()`; balance badge → `walletService.getBalance()` + `on('status')` refresh (ref-guarded); offline/sign-in empty-state branch removed; `GenericListingCard` on stub shape. NOTE: screen had no `handleChat` (doc assumed one) — current UX opens listing detail only. |
| `screens/MarketplaceItemDetailScreen.tsx` | Loads via `getListing`+`getLibrary`+`getMyListings`; `doAcquire` → `MarketplaceService.acquire()` — **owned flips ONLY on success** (D1-1 `finally` fake-success fixed by construction); `InsufficientCreditsError` → honest alert. Success navigates to My Library (asset delivered there). |
| `screens/MarketplacePublishScreen.tsx` | `handlePublish` → `publishListing` (character only; snapshot built inline via new `buildSnapshot`); text/theme publish + edit + re-list → honest "not available in preview" errors; edit prefill via `getListing`. |
| `screens/MyListingsScreen.tsx` | `getMyListings()`; toggle-status → `delistListing()`; statuses active\|pending\|removed. |
| `screens/MyLibraryScreen.tsx` | `getLibrary()`; rows on `OwnedLibraryEntry`/`ContentAsset.kind`; nav passes `asset.id`. |
| `screens/ContentAssetScreen.tsx` | `getContentAsset(id)`; apply-to-character → direct local `updateCharacterProfile` (maps asset text to `description`); delete → honest preview-unavailable. |
| `screens/DiscoverScreen.tsx` | Feed → stub fixture listings (`getListings`+`getListing`); local prefix search kept; card tap/chat → listing detail; lock removed; `previewHint` shown under header. "Created by others" real query = future backend (20-Backend-Concept). |
| `screens/CreateAIScreen.tsx` | **Extra consumer found**: removed marketplace-listing visibility segment + SOUL price input + `getMarketplaceListing`/`upsert`/`removeMarketplaceListing` + `SoulIcon` (A4: no local marketplace visibility state); legacy marketplace rows normalize to `public`. |
| `contexts/AuthContext.tsx` | `registerAction` no longer calls `claimSignupBonus`; librarySync hydration effect removed. |
| `components/market/LibraryItemRow.tsx` | Props on stub `kind`/`acquiredKind`; imports from `utils/marketTypes`. |
| `components/market/ListingManageRow.tsx` | `status` on active\|pending\|removed; `salesCount` optional. |
| `components/market/MarketFilterDropdown.tsx` | Helper imports → `utils/marketTypes`. |
| `utils/marketFilters.ts` + test | Operates on `MarketplaceListingSummary` + supplied `itemType`; search over title/creatorName. |

### Behavior changes (feature level)
- **Client-side paywall gone everywhere**: any character with an entity can be chatted with from any entry point; no silent ignores.
- **Acquire is honest**: owned state flips only on `acquire()` success; insufficient balance surfaces "Not enough Souls — buying Souls is coming soon".
- **Publish = upload-copy (A4)**: only character-card publishing supported in preview; text/theme/edit/re-list surface honest preview-unavailable errors (future backend capabilities).
- **Wallet**: seeded 50-soul balance shown on Market; "Buy/Sell Souls" keeps existing coming-soon.
- **Signup bonus flow removed** (A2).

### Deviations from phase doc (all surfaced by gates or stub reality)
1. Extra paywall consumers `ChatDetailScreen` + `CreateAIScreen` (doc's list was incomplete); both cleaned per the zero-hit gate / A4 ruling.
2. `MarketScreen` has no `handleChat` — nothing to strip there.
3. AIProfile listing pill never renders against stubs (no profile→listing linkage) — pure UI kept for future backend.
4. Stub API deliberately NOT extended: text/theme publish, listing edit, re-list, library-remove = honest errors, not fake success.
5. `salesCount` dropped from detail screen (not in stub types); optional in manage row.
6. Apply-to-character maps asset text to `description` (no itemType→field mapping in stub `ContentAsset`).
7. Acquire success → navigate My Library (stub `AcquireResult` carries no profile link).
8. Gate-1 literal zero-hit lands in Phase 4 when the repos themselves are deleted (`claimSignupBonus`/`canChatWithCharacter` still defined inside `repositories/marketplace.ts`/`soulWallet.ts` + their repo tests — zero non-test importers now).

---

## Phase 3 — Social, Notifications & Profile Rewiring

**Track**: A3/A4 wiring · **Gates**: gate-1 grep clean (only doomed-repo tests remain — Phase 4 deletes); tsc 0 errors; unit 88 suites/858 tests; integration 10/50+1 skipped.

### Added
- `AuthService.updateDisplayName(displayName)` — `PATCH /v1/auth/me` (display_name ONLY, backend-verified 2026-08-24) on the existing authenticated-fetch path; returns freshly-fetched profile. Extension items for 20-Backend-Concept: username/bio in PATCH, avatar upload + `avatar_url` in responses.
- `AuthContext.refreshUser()` — re-fetches `getProfile()` → `setUser` so display-name saves propagate to `useAuth().user`.
- `SocialService` exports `LOCAL_USER_ID` / `LOCAL_USER_DISPLAY_NAME` (from stub backend) for "my posts" queries.
- i18n: `profile.json` +3: `avatarComingSoon`, `usernameComingSoon`, `bioComingSoon`.

### Removed
- `src/services/profile/UserProfileStore.ts` — AsyncStorage shadow store (`@harmony_profile/<userId>`) deleted per A4 (cloud-first). No tests existed for it or My/EditProfile screens (verified by grep — doc's port instruction was a no-op).
- All `addNotification` creation calls (PostCommentModal ×1, AIProfileScreen ×4) — NotificationService is a read-only fixture feed with no write API; badge reflects seeded feed only. Backend writes notifications later (20-Backend-Concept item).

### Modified — components
| File | Change |
|---|---|
| `CreatePostModal` | publish via `SocialService.createPost({text, imageData, imageMimeType})`. |
| `PostCard` | `StubPost` type; derives `imageDataUrl` from raw bytes via `createDataURL`. |
| `PostCommentModal` | comments via SocialService; notify block removed. |
| `ImageCommentModal` | comments via SocialService; avatar `uri={null}` (stub comment has no avatar). |
| `HeaderNotificationButton` | badge = `notificationService.getUnreadCount()` + `subscribe()` push events; auth-independent, no focus reload. |

### Modified — screens
| File | Change |
|---|---|
| `UserProfileScreen` | profile/posts/follow/block via SocialService; posts filtered by pure `filterBlockedUserPosts` + stub blocked ids; stats from stub profile counts (was hardcoded 0/0). |
| `MyProfileScreen` | cloud display name w/ 'User' fallback; Followers honest 0 (no stub source) / Following via `getFollowedUsers().length`; Posts tab via `LOCAL_USER_ID`; Saved tab via `getSavedCharacterEntries()`. |
| `NotificationsScreen` | `notificationService.list()/markAllRead()` + pure blocked filter. |
| `BlockedUsersScreen` | `getBlockedUserIds()` → `getPublicUserProfile` rows → `unblockUser` (fixture users). |
| `AIProfileScreen` | like/save/image comments/creator/follow via SocialService; `isCharacterSaved` derived from saved entries; image-comment count = `.length`. |
| `EditProfileScreen` | display name via `AuthService.updateDisplayName` + `refreshUser()`; username/bio/avatar inputs disabled + "coming soon" hints (honest stub). |
| `DiscoverScreen` | posts tab via `SocialService.getPosts()` + pure blocked filter. |
| `CharactersScreen` | `filterBlockedCharacterProfiles` (pure) + `getBlockedUserIds()` (test mock swapped accordingly). |
| `CreateAIScreen`, `CharacterProfileEditScreen` | `setCharacterCreator({profileId, userId})` via SocialService. |
| `CharacterCardImportService` (extra consumer) | creator write via SocialService. |

### Deviations / stub limitations (relevant for engine Phase 2 planning)
1. **Notification creation gone** — stub feed is read-only; old `addNotification` call sites removed (badge = seeded feed). Backend must own notification writes.
2. **No read APIs for liked-by-me / count getters** in stub (`isPostLiked`, `isImageLiked`, `getPostLikesCount`, comments counts, `isCharacterSaved`) — screens derive from feed payload at read time, start `liked=false`, trust toggle return; focus reload resets liked visuals. Future backend should expose per-item liked-state + counts.
3. **Followers stays 0** on My Profile (only Following derivable) — honest stub limitation; backend graph needed.
4. `filterBlockedCharacterProfiles` matches blocked **user ids** against local profile ids — no creator→user resolution at stub level (old doomed table did that). Backend resolves creator membership.
5. Marketplace/Discover character feeds not blocked-filterable (listings carry `creatorName` string, no user id) — backend needs creator user ids on listings.
6. `setCharacterCreator` input narrowed to `{profileId, userId}`; display name/avatar derived from fixture users.
7. Extra consumers found: `CharacterCardImportService`, `CreateAIScreen`, `CharacterProfileEditScreen` (creator-write call sites) + stale `AuthService` comment — all handled.

---

## Phase 4 — Schema Surgery (B5 consolidation + O4 reply strip + O6 categories off tables)

**Track**: B5 amendment + O4 + O6 + repo deletions · **Gates**: reply/doomed greps → code zero (only the new migration's header docs); tsc 0; unit **84 suites/770 tests** (−5 repo suites, +1 CategoryPreferencesService suite; snapshots regenerated −648/+6 lines, v5–v40 boundaries byte-identical); integration 10/50+1 skipped; **parity = expected set exactly** (RN-only: `idx_conversation_messages_pinned` — part of the named D3 divergence; Go-only: `device_push_tokens`; different-SQL 11 = conversation_messages D3 + 10 pre-existing cosmetic drifts; the 5 client-only index leaks GONE).

### Added
- `src/database/migrations/000041_consolidate_senju_features.ts` — single consolidated migration: personas + character_favorites + chat_conversation_settings (physical `blocked` column kept) + conversation_messages `reactions_json`/`is_pinned`/pinned index. Header documents rationale, 000039 reserved placeholder, dev-DB-wipe note.
- `src/services/CategoryPreferencesService.ts` + test (O6) — AsyncStorage `@harmony_character_categories` `[{id,name}]`; rename rewrites the tag on affected profiles; delete strips it; "Add to category" writes the category name as a native `character_profiles.tags` entry (syncs to engine).

### Removed (26 files)
- 15 migrations `000041_add_character_profile_source` … `000055_add_marketplace_cache`.
- 6 sidecar repos: `marketplace.ts`, `soulWallet.ts`, `characterSocial.ts`, `userSocial.ts`, `contentLibrary.ts`, `blockedContent.ts`.
- 5 repo test suites (marketplace, marketplaceCache, characterSocial, userSocial, blockedContent).
- Reply feature (O4): `replyToMessageId` param/payload in `EntitySessionService.sendTextMessage`; reply columns in `conversation_messages` repo INSERT/SELECT/UPDATE; `reply_to_message_id` in `models.ts`; `repliedMessage` lookup + prop in `ChatDetailScreen`; reply-header rendering + prop in `ChatBubble`.
- `characters.ts`: source/visibility fns + category fns deleted; favorites fns, `getUserCharacterProfiles`, `getSiblingCharacterProfiles`, `getCharacterStats` kept.

### Modified (highlights)
- `migrations.ts`: 15 imports/entries → single `migration041`.
- `scripts/dump-schema.ts`: `CLIENT_ONLY_TABLES` 23 → 3 (`personas`, `character_favorites`, `chat_conversation_settings`).
- `schema/rn-schema.json` regenerated; both migration `.snap` files regenerated.
- **CreateAIScreen**: "Visibility & Sharing" (private/public) UI removed entirely — vestigial after stubs, its persistence table is gone.
- **AIProfileScreen**: ownership resolves from cloud creator only (source-tag fallback gone).
- Import flow (`CharacterCardImportService`, duplicate-creation paths): source-tagging writes removed.
- O6 categories UI: `CharactersScreen` + `ManageCategoriesModal`/`AddToCategoryModal`/`CategoryFilterDropdown` on AsyncStorage ∪ distinct profile tags.
- Step-6 verified (no fix needed): `is_pinned` boolean↔integer map exists in `sync.ts normalizeBooleanFields` + repo; `reactions_json` opaque passthrough.

### Deviations (accepted)
1. **`getUserCharacterProfiles` adapted, not kept verbatim** — its SQL JOINed `character_profile_sources` (dropped); now returns all non-deleted profiles via `getAllCharacterProfiles` with interim-behaviour comment. Ownership signal returns with the Phase-2 engine mirror. Consumers today: MyProfileScreen count, publish screen, content-asset apply picker.
2. **4 files still called "dead" fns** (plan assumed zero consumers): CreateAIScreen, AIProfileScreen, CharacterProfileEditScreen, CharacterCardImportService — call sites removed (see above).
3. Gate residuals are documentation-only: the new migration's header must name `reply_to_message_id` + dropped tables (self-contradiction in the phase doc resolved in favor of required docs); `@harmony_character_categories` key substring-matches `character_categories` (false positive).
4. `MarketplaceService.test.ts` doomed-repo jest.mock backstop removed (module gone — resolution fails loudly anyway).
5. `src/database/README.md` untouched — verified it never listed sidecar tables.

---

## Phase 5 — B4 Seeding Revert (engine = single default-config source)

**Track**: B4 · **Gates**: grep zero; tsc 0; unit 84/770; integration 10/50+1 skipped (service had no tests).

### Removed
- `src/services/SoulbitsDefaultConfigService.ts` (319 lines) — parallel default-config creation in engine-synced tables (duplicate rows, LWW churn, broken standalone mode). No test file existed.
- `CreateAIScreen`: auto-fill `useEffect` + `mergeDefaultOption` helper + `configSelectionsRef` live-mirror (grep-verified: no other uses) + save-time fallback (`if !anySelected → ensure…`) + `defaultConfigNote` hint block + `anyConfigSelected()` + styles.
- i18n: dead `createAI.json:defaultConfigNote` key.

### Modified
- `EntityModuleSelector`: **Disabled** option restored (`{id:-1, name:'Disabled', value:''}` first sheet row); label fallback `?? 'Select config'` → `?? 'Disabled'` (raw string matches the sheet's existing raw-string option names).
- Unset slots save as unset (`'' → null`, aligning create path with edit path).

### Decisions
- No auto-select of engine-synced default rows (doc default OFF; alternative noted for record doc).
- Constants check: `moduleDefaults.ts`/`moduleConfiguration.ts` reference engine provider `'Soulbits Cloud'`/`soulbitscloud` — NOT the service's `'Soulbits Cloud (default)'` row name; nothing to change. Dev devices' old clashing rows absorbed by existing `syncNameClash` machinery.
- Removing the auto-fill hint was in-scope honesty (it described the removed behavior).

---

## Phase 6 — D-Register Bug Mends (4 commits: 3 agent batches + 1 orchestrator fix)

**Gates per batch**: tsc 0; final unit **91 suites/810 tests** (from 84/770 baseline: +7 suites/+40 tests); integration 10/50+1 skipped throughout.

### Batch A — ChatList cluster (`ba97e9a` F3 cascade; `4fc4ab0` F1 F5 F6 F7 F8 F10 F11 F12)
- **F1**: ChatListScreen focus-scoped subscription to `message:received` (incremental row update + re-sort) / `session:started|stopped` (400 ms debounced full reload); listeners cleaned on blur.
- **F3**: `deleteConversationByParticipantKey` cascades `chat_conversation_settings` delete (repo-level) + `conversationDeleteCascade.test.ts`.
- **F5**: chat list filters via `SocialService.getBlockedUserIds()`.
- **F6**: new `getPhoneConversationsPage(entityId, {limit, offset})` in interactions repo — GROUP BY participant_key, ORDER BY MAX(last-message created_at); ChatList + Archived on 20/page `onEndReached` pagination (also fixes duplicate group entries).
- **F7**: persona resolution awaited before first list load.
- **F8**: bubble unread badge pushed through the F1 subscription (`setBubbleUnreadCount`).
- **F10**: new `setConversationUnread(key, entityId, count)` = set-to-1 semantics.
- **F11**: `handleIncomingMessage` muted guard skips `incrementConversationUnread` + `entitySessionMuteSuppression.test.ts`.
- **F12**: ArchivedChatsScreen bubble uses live persona.
- Cleanup: `getKeyLastRead`/`setKeyLastRead`/`markKeyAsRead`/`clearKeyLastRead` subsystem deleted; unused imports/styles/`_loading` gone.

### Batch B — Keys/recording/bubble (`77518e5` F4/O3 D1-3 D1-4)
- **F4 verdict: NO drift** — app derivation + all callers already match the engine exactly (own entity in the key everywhere; evidence table of both sides' callers in the phase record). Fixed the false docstring in `interactions.ts`; pinned the engine contract in `interactionsParticipantKey.test.ts` (12 cases). Data note: old-derivation settings rows = accepted loss on dev devices (comment in `chatConversationSettings.ts`; no re-key migration — decided).
- **D1-3**: ChatInputBar 120 s auto-stop now FINISHES the recording (stop + attach) — root cause was 2 stacked bugs (abort-flag set before finish + stale-closure interval). Pure helper `nextRecordingTick` + 5 tests. Countdown kept, pinned at 2:00.
- **D1-4**: `ChatBubbleModule.show()` Kotlin → **Promise-based boolean** (canDrawOverlays → false; try/catch around service start → true/false). Promise over sync-boolean because `newArchEnabled=true` (bridgeless forbids sync native returns); mirrors the module's own `hasPermission`/`isSupported` pattern. TS `result === false` check in `ChatBubbleService.showBubble` is live again. **Kotlin compile rides the user's next device build.**

### Batch C — Toggle/indicators/misc (`40553b3` A6 D1-5 D1-7 D1-8 D1-12)
- **A6**: reply-mode toggle in `ChatConversationMenuModal` (ChatList + Archived long-press); storage `@harmony_chat_reply_mode_<participantKey>` via ChatPreferencesService (key prefix migrated from her `chat_reply_mode_` — old dev values abandoned, consistent with F4 ruling); paced via `INIT_ENTITY.payload.reply_mode` on session start; `ChatPreferencesService.test.ts` (8 tests).
- **Orchestrator follow-up fix**: `InteractionSession.replyMode` field added (seeded at session start) so partner **reconnect** (`sendInitEntityForEntity`) honors the preference instead of hardcoded `'realistic'`.
- **D1-5**: background handler in `EntitySessionService.setupAppStateListener` early-returns while `cloudSessionService.isPurging()` (purge owns WS lifecycle; policy comment in code) + `entitySessionBackgroundPurge.test.ts`.
- **D1-7**: 3-state connection indicator restored in ChatDetailScreen — connected (purple), connecting (amber pulsing), offline (grey); i18n `statusConnected/Connecting/Offline`.
- **D1-8**: first message now also gets a day divider (`i === 0 ||` condition).
- **D1-12**: `getCharacterStats` chats count via aggregate SQL (JSON1 `json_each` + EXISTS) with JS-scan fallback; shape unchanged; 2 new tests.

### D1/D2 rows DONE-BY or deferred (unchanged): D1-1/2/6/9 (done by Phases 1–4), D1-11 legacy persona prefs (deferred P4/O2), F2/F9 (paywall), F4 data note above.

---

## Phase 7 — Track E: INIT_ENTITY Ingestion-Error Recovery

**Gates**: re-enabled spec suite 4/4 green UNMODIFIED; all 11 entity-session suites green; tsc 0; unit 92 suites/814 tests; integration 10/50+1 skipped. Impact pre-check: `handleInitEntityResponse` upstream LOW (event-routing path only).

### Changed — `src/services/EntitySessionService.ts`
- `MAX_INIT_ENTITY_RETRIES = 2` + `INIT_ENTITY_INGESTION_ERROR = 'entity_not_defined'` named consts.
- `InteractionSession.initRetryCount: number` (required, init 0 at session creation; test fixtures updated).
- `handleInitEntityResponse` ERROR branch: ingestion-class (`entity_not_defined`) → no teardown, increment counter, fire-and-forget recovery; cap reached → `session:error` + `failInteractionSession`; non-ingestion errors keep old behavior.
- New private `failInteractionSession` (session:error + cancel reconnects + delete session + disconnect + clear pending) — shared teardown.
- New private `recoverInitEntity`: purge guard (`isPurging?.()` optional-call so the unmodified spec's mock passes while production suppression works) → blocking `SyncService.syncAndWait()` → fresh entity WS connection (cloud/selfhosted URL resolution mirroring `reconnectPartner`) → re-send INIT_ENTITY (honors `replyMode`). Any throw → log + teardown.
- New `handleEntityConnectionError` wired to ConnectionManager `error:entity` (transport-error-storm guard): error carrying `event.event_type === 'INIT_ENTITY'` defers to event-path recovery; genuine transport errors stay fatal.
- Dedup composition verified: `started` flag + register-before-send → no double `session:started`.

### Re-enabled
- `src/services/__tests__/entitySessionInitRecovery.test.ts` (was `.skip`, D2 skip from the rebase now resolved).

### Notes
- Manual on-device smoke (create partner → immediately open chat → recovers after brief connecting) — pending user.
- The D2 rebase decision (skip red test with TODO) is now fully closed.

---

## Phase 8 — Track C: Editor Consolidation (3 commits)

**Gates**: tsc 0 (verified at final state AND at both intermediate commits via worktrees); unit 95 suites/834 tests (+3 suites/+20 tests); integration 10/50+1 skipped; grep `CharacterProfileEdit` in src/ → zero.

### Commit `ca48bd5` — refactor: extract editor sections
- New `src/components/character-card/editor-sections/`: `editorState.ts` (pure snake↔camel V3 mapping — shared with the round-trip test so they can't drift), `imageReconcile.ts` (pure diff-based image deltas), section components `GreetingEditorSection` (incl. test-scenario generator bar), `AlternateGreetingsSection`, `LorebookSection`, `TagsSection`, `LifecycleSection`, `AttributionSection`, `ExportSection`, `ImportReviewSheet` (**moved** here — Characters import flow depends on it), barrel `index.ts`.
- Tests: `EditorState.test.ts` (8), `imageReconcile.test.ts` (7 — image-churn gate: unchanged images keep ids), `EditorSectionsRoundtrip.test.ts` (2 — v3-card fixture import → edit every section → export → field-by-field parity), `ProfileEditorSections.test.tsx` (8 — retargeted from the deleted screen's suite).
- `CharactersScreen` + tests: ImportReviewSheet import path + navigation retarget (→ `CreateAI {editProfileId}`). i18n +4 keys (`creatorPlaceholder`, `creatorNotesPlaceholder`, `characterVersionPlaceholder`, `lifecycleInvalidNumber`). `characters.test.ts` +in-place caption test.

### Commit `3310dde` — feat: V3 RP editor suite in CreateAI edit mode
- Edit-mode load → `loadEditProfile` (V3/RP state via `profileToEditorState` + images + entity + tags); pull-to-refresh reloads.
- Save: validation alerts (typing 1–200, audio 0–100, `validateLifecycleConfig`) instead of silent clamping; V3 columns (`first_mes`, `alternate_greetings`, `character_book`, `tags`, `creator`, `creator_notes`, `card_provenance`, `lifecycle_config`, `scenario`, `post_history_instructions`, `nickname`) explicit; hidden `group_only_greetings`/`extensions`/`assets` carried as state so the spread can't wipe them.
- **Image churn fixed**: `computeImageDeltas(existing, desired)` → apply only create/update/remove deltas via `createCharacterImage`/`updateCharacterImage` (existed: caption/order/primary, id preserved)/soft-delete. Untouched ids stable.
- Layout: General → Details → Greeting/Alternate/Lorebook/Images/Tags/Lifecycle/Attribution/Export → Advanced; create mode keeps lightweight subset (RP cards only when `editProfileId`).
- Restored capabilities: `ProfileImagePicker` + `ImageViewerModal` zoom, per-image "Set as primary" + captions, pull-to-refresh.

### Commit `7352034` — chore: remove comparison-only screen
- Deleted `CharacterProfileEditScreen.tsx` + old `ProfileEditorSections.test.tsx` + route/param/`// D4: comparison-only` scaffolding in `AppNavigator.tsx`.
- **`EntityConfigEdit` finding**: zero references anywhere — the screen did NOT survive the rebase; no survivor navigates to it; nothing to drop/TODO. Q-D4a fully closed.
- Stale artifact flagged: `e2e/.maestro/03-conflict-resolution.yaml` references the old card-tap→editor flow (already broken pre-Phase-8; outside jest gates; needs on-device e2e rework).
- `ProfileImagePicker` + `ImageViewerModal` kept as shared components.

### Deviations
- Image reconcile uses soft delete (repo default) not permanent delete — audit trail kept.
- `updateCharacterImage` already existed → no new repo fn (doc's conditional).
- D4 (two-step editor handling) from the rebase decision record is now fully closed.

---

## Pointers for follow-up Phase 2 (engine) planning

*(append after each phase)*

- **Stub seam contract** (client design input, wire shapes must survive): `MarketplaceService`/`WalletService`/`SocialService`/`NotificationService` method surfaces as shipped in Phase 1 (see `src/services/*/[A-Z]*Service.ts` doc comments); error taxonomy = `StubServiceError` ≡ client `APIError` observable surface.
- **Backend concept items discovered during Phase 2**: profile→listing linkage (AIProfile price pill + acquire-success deep link currently have none); text/theme publish + listing edit + re-list + library-remove (honest-error placeholders now); `salesCount`; itemType→profile-field mapping for apply-to-character; "created by others" Discover query; real `upgradeUrl` (placeholder `https://harmony.ai/souls`).
- **Honest-error i18n keys added**: see Phase-2 Added table — copy review when backend makes them real.
- **Phase-3 additions**: profile extension = `username`/`bio` in PATCH /v1/auth/me + avatar upload endpoint + `avatar_url` in responses; notification **write** side (comment/like/follow/image-comment events → notifications); per-item liked-state + count reads on posts/images; follower graph for local user; creator user ids on marketplace listings (blocked-filter + attribution + `filterBlockedCharacterProfiles` creator resolution).
- **Phase-4 state (parity baseline for engine Phase 2)**: RN↔Go divergence set = `conversation_messages` D3-narrowed (`reactions_json`, `is_pinned`, `idx_conversation_messages_pinned`) + 10 pre-existing cosmetic drifts + `device_push_tokens` Go-only. B1 (Go mirror migration for message actions incl. read flags, shape O12) closes D3. `CLIENT_ONLY_TABLES` interim = `personas` (dies B3), `character_favorites` + `chat_conversation_settings` (redesigned B2) — mechanism expires with the last entry.
- **Ownership signal gap (B2 input)**: `getUserCharacterProfiles` interim-returns ALL profiles (old `character_profile_sources` JOIN dropped). Engine mirror must restore per-user ownership so MyProfile "AI Characters" count, publish flow, and apply-to-character picker filter correctly.
- **Phase-6 inputs**: reply-mode becomes a synced `chat_conversation_settings` column in B2 (interim AsyncStorage `@harmony_chat_reply_mode_<participantKey>`); read-flags (B1) supersede `unread_count` (kept until then); F4 confirmed NO app/engine key drift — contract pinned by test; Kotlin `show()` is now Promise<boolean> (device-build compile pending); F1/F8 event contract (`message:received` + session lifecycle) is app-local — engine-side event needs only exist if B1 planning wants push-driven chat lists.
- **Phase-7/8 state**: INIT_ENTITY recovery live (bounded 2 retries; engine contract: `entity_not_defined` rejection during pre-ingestion race is now recovered app-side — engine unchanged). Editor consolidated into CreateAI edit mode; V3 column surface fully editable app-side (matters if the engine ever validates/normalizes card columns on sync).
