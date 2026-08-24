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
| 2 — Marketplace & wallet rewiring | ✅ committed | (this commit) |
| 3 — Social/notifications/profile rewiring | ⏳ pending | — |
| 4 — Schema surgery | ⏳ pending | — |
| 5 — B4 seeding revert | ⏳ pending | — |
| 6 — D-register bug mends | ⏳ pending | — |
| 7 — INIT_ENTITY recovery | ⏳ pending | — |
| 8 — Editor consolidation | ⏳ pending | — |
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

## Pointers for follow-up Phase 2 (engine) planning

*(append after each phase)*

- **Stub seam contract** (client design input, wire shapes must survive): `MarketplaceService`/`WalletService`/`SocialService`/`NotificationService` method surfaces as shipped in Phase 1 (see `src/services/*/[A-Z]*Service.ts` doc comments); error taxonomy = `StubServiceError` ≡ client `APIError` observable surface.
- **Backend concept items discovered during Phase 2**: profile→listing linkage (AIProfile price pill + acquire-success deep link currently have none); text/theme publish + listing edit + re-list + library-remove (honest-error placeholders now); `salesCount`; itemType→profile-field mapping for apply-to-character; "created by others" Discover query; real `upgradeUrl` (placeholder `https://harmony.ai/souls`).
- **Honest-error i18n keys added**: see Phase-2 Added table — copy review when backend makes them real.
