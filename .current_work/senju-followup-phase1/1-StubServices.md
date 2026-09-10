# Phase 1 — Stub Service Layer (new files only)

> Track A1/A2/A3 core. Build the four service seams + in-memory stub backends + fixtures + tests.
> **This phase creates ONLY new files** (plus test config if needed) — zero edits to existing screens/services. That guarantees a green commit with no rewiring yet (rewiring is Phases 2–3).
> Binding rules: `03-Pattern-Cheat-Sheet.md` §"Stub-layer rules" + O5 ruling (stubs ship in ALL builds, no env/visibility gating — the service interface is the future swap seam).

## Context

The app currently persists marketplace/wallet/social data in 23 client-only SQLite sidecar tables (see `scripts/dump-schema.ts` `CLIENT_ONLY_TABLES`). Per the table-drop directive (summary.md "Marketplace/social tables") these tables die in Phase 4; their repos die with them. The stub layer replaces them as the **only** data source for these domains.

Reference patterns already in the repo (do NOT reinvent):
- `src/services/cloud/soulbitsModelsCatalog.ts` — cache + single-flight + never-throw fallback.
- `src/services/cloud/CloudSessionService.ts` — EventEmitter status singleton (`idle|requesting|…`), typed states.
- `src/services/cloud/DeviceAuthService.ts` — app-local error mapping from client errors.
- `src/services/cloud/deviceDeepLink.ts` — pure parser + tests (structure for pure helpers).

## Wire-shape pre-matching (binding, A1 directive)

Types the stub MUST match exactly because `@harmony-ai-solutions/soulbits-api-client` already anticipates them (verified in `node_modules/@harmony-ai-solutions/soulbits-api-client/dist/index.d.ts` ~lines 5370–5392):

```ts
// Error taxonomy — mirror APIError's observable surface:
class MarketplaceError extends Error {
  readonly status: number;              // HTTP-like status of the stub operation
  readonly code?: string;               // e.g. 'quota_exceeded', 'not_found'
  readonly upgradeUrl?: string;         // present on 402 quota_exceeded
  readonly currentTier?: string;
  readonly requiredTier?: string;
  readonly soulCreditsAvailable?: number;
  get isQuotaError(): boolean;          // status === 402
  get isAuthError(): boolean;           // status === 401 || 403
  get isRateLimited(): boolean;         // status === 429
  get isServerError(): boolean;         // status >= 500
}

// Wallet/subscription tier shape (mirrors GET /v1/subscription/me semantics):
interface SubscriptionStatus {
  tier: string;                  // 'free' | future paid tiers
  soulCreditsAvailable: number;  // wallet balance
  currentTier?: string;
  upgradeUrl?: string;
}
```

Listing/feed types are OUR design (no client anticipation exists) — keep them REST-shaped and document them for `20-Backend-Concept` (Phase 9).

## Files to create

### 1. Marketplace — `src/services/marketplace/MarketplaceService.ts`

App-facing typed API. Singleton module (module-level functions, like the repos it replaces). Every method returns promises resolving after ~300 ms artificial latency (see stub backend). **UI imports ONLY this module** in the marketplace domain.

API surface (map against actual screen calls when rewiring; extend if a screen needs more, never bypass):

```ts
export interface MarketplaceListingSummary { id, title, creatorName, creatorAvatarText?, priceSouls, thumbnailText?, status, createdAt }
export interface MarketplaceListingDetail extends MarketplaceListingSummary { description, tags: string[], snapshot: CharacterSnapshot }
export interface AcquireResult { ok: true; listingId: string } // throws MarketplaceError on failure

getListings(query?: { search?: string; sort?: 'recent'|'price'|'popular' }): Promise<MarketplaceListingSummary[]>
getListing(id: string): Promise<MarketplaceListingDetail>        // throws not_found
publishListing(draft: { title, description, priceSouls, tags?, cardSnapshot }): Promise<MarketplaceListingSummary>  // upload-copy semantics (A4 ruling): the local character/profile is NEVER touched
delistListing(id: string): Promise<void>                          // honest stub: if backend op "fails" (simulated), throw — no fake success
acquire(listingId: string): Promise<AcquireResult>                // checks WalletService balance → throws InsufficientCreditsError (a MarketplaceError with code 'quota_exceeded', 402) when short
getMyListings(): Promise<MarketplaceListingSummary[]>
getLibrary(): Promise<OwnedLibraryEntry[]>                        // replaces contentLibrary repo + marketplace_ownership_cache
getContentAsset(id: string): Promise<ContentAsset>                // replaces ContentAssetScreen's data path
refresh(): Promise<void>                                          // re-seeds fixtures (pull-to-refresh)
```

Publishing model (A4 ruling): publishing = upload a copy of the card contents to the marketplace backend (here: the stub store). No local `'marketplace'` visibility state, no local listing rows, the local character and its card stay untouched.

### 2. Marketplace stub backend — `src/services/marketplace/marketplaceStubBackend.ts`

- In-memory store: `Map` of listings, ownership set, library entries, content assets.
- Fixtures in `src/constants/marketplaceFixtures.ts` (≥ 10 listings with varied prices/status/creators, 3–4 content assets, realistic display names — fixtures visible everywhere per O5).
- `simulateLatency()` helper (~300 ms ± jitter) shared across stub backends — put it in `src/services/stub/stubBackendUtils.ts` (new tiny module: latency + a seeded `simulateTransientFailure` used by delist/publish to exercise honest-error paths deterministically in tests).
- Statuses: `active | pending | removed`; ownership keyed by listing id.

### 3. Wallet — `src/services/wallet/WalletService.ts` (+ `walletStubBackend.ts`)

- EventEmitter status singleton: `'idle' | 'syncing' | 'ready' | 'failed'` (pattern: `CloudSessionService`).
- Seeded fixed balance (e.g. **50 souls** — matches her signup-bonus UX expectation; the bonus flow itself is REMOVED, A2).
- API: `getStatus()`, `getBalance(): Promise<number>`, `getSubscription(): Promise<SubscriptionStatus>`, `on(event, cb)`; internal `debit(amount)` used by MarketplaceService.acquire — throws typed `InsufficientCreditsError` (extends the shared error shape with `soulCreditsAvailable` = remaining).
- NO persistence (in-memory only). "Buy/Sell Souls" stays the existing "Coming soon" placeholder (already honest).

### 4. Social — `src/services/social/SocialService.ts` (+ `socialStubBackend.ts` + `src/constants/socialFixtures.ts`)

Replaces `characterSocial.ts` + `userSocial.ts` repos AND absorbs the block list (blocked_users table dies, Phase 4):

```ts
// profiles & follows
getPublicUserProfile(userId): Promise<StubUserProfile>
toggleFollow(userId): Promise<boolean>; isFollowing(userId): Promise<boolean>; getFollowedUsers(): Promise<StubUserProfile[]>
// posts (community feed)
getPosts(opts?: { authorId? }): Promise<StubPost>
createPost(input): Promise<StubPost>; deletePost(id): Promise<void>
togglePostLike(id): Promise<boolean>; getPostComments(id); addPostComment(input); deletePostComment(id)
// character social (AIProfileScreen: likes/saves, gallery images as posts)
toggleCharacterLike(profileId); isCharacterLiked(profileId); getCharacterLikesCount(profileId)
toggleCharacterSave(profileId); getSavedCharacterEntries()
toggleImageLike(imageId); getImageLikesCount(imageId); addImageComment({imageId, text}); getImageComments(imageId); deleteImageComment(id)
// block list (replaces blocked_users table + blockedContent repo reads)
getBlockedUserIds(): Promise<Set<string>>; blockUser(userId): Promise<void>; unblockUser(userId): Promise<void>
// creators (attribution row) — until V3-authorship derivation lands
setCharacterCreator({profileId, userId}); getCharacterCreator(profileId); isCharacterCreator(profileId, userId)
```

- Fixtures: 5–8 stub users with posts/follows; block list starts empty.
- Keep the **pure filter helpers** in `src/utils/blockedContentFilters.ts` (new home — Phase 3 rewires `blockedContent.ts` callers): `filterBlockedCharacterProfiles`, `filterBlockedUserPosts`, `filterBlockedUserNotifications` become pure functions taking `(items, blockedIds: Set<string>)` — trivially unit-testable, no DB.

### 5. Notifications — `src/services/social/NotificationService.ts` (or `src/services/notifications/`)

- In-memory notification list (fixtures: a few welcome/marketplace-social events).
- `EventEmitter<'unread'>` with `getUnreadCount()`, `markAllRead()`, `markRead(id)`, `list()`, `subscribe(cb)`.
- Model `registerPushToken(token: string): Promise<void>` in the interface NOW (no-op storing in memory) — the engine's `device_push_tokens` + `DeviceAuthService.registerDevice` pushToken param already anticipate it (A3).

### 6. Shared stub error base — `src/services/stub/StubServiceError.ts`

The `MarketplaceError` shape above generalized (`status`, `code`, quota/auth getters). Wallet/Social/Notification errors extend it. App-local errors only — UI never imports client `APIError` directly.

## Tests (per 03 §8)

New suites, mocking the stub-backend module boundary (pattern: `deviceAuth.test.ts` — `jest.mock` the backend module, stash fns on module exports):
- `src/services/marketplace/__tests__/MarketplaceService.test.ts` — listing CRUD, acquire success path, acquire throws `InsufficientCreditsError` when balance short (assert `isQuotaError === true`, `soulCreditsAvailable`), delist honest-failure path (no fake success), publish = upload-copy (store mutated, no local-repo calls — assert zero repo imports in module).
- `src/services/wallet/__tests__/WalletService.test.ts` — status transitions idle→syncing→ready, seeded balance, debit/InsufficientCreditsError, EventEmitter subscription/cleanup.
- `src/services/social/__tests__/SocialService.test.ts` — like/save toggles, post feed, block/unblock + pure filters (`filterBlocked*` unit tests with plain arrays).
- `src/services/social/__tests__/NotificationService.test.ts` — unread event emission, markAllRead, registerPushToken no-op.

## Explicitly NOT in this phase

- No screen/component edits (Phases 2–3). No deletions of old services/repos (Phase 2–4). No migration changes (Phase 4).

## Verification

- [x] `npx tsc --noEmit` — 0 errors
- [x] `npm test` — all suites green (unit 88 suites / 861 tests incl. 4 new; integration 10 suites / 50 passed + 1 skipped)
- [x] `npx gitnexus analyze` then `gitnexus_detect_changes()` — new symbols only (274 new; index 7110→7384), no unexpected touched flows
- [x] Commit: `feat: add in-memory stub service layer for marketplace, wallet, social and notifications`
- [x] Phase doc checklist updated; summary.md Implementation Status ticked

### Implementation notes (deviations, all minor)

- `getPosts` returns `Promise<StubPost[]>` (doc's singular return type was a typo — a feed is a list).
- `publishListing` → status `'pending'` (moderation semantics; doc didn't specify) — pending listings excluded from the public feed.
- `InsufficientCreditsError extends MarketplaceError`; all domain error classes live in `StubServiceError.ts` to avoid import cycles.
- `upgradeUrl` on 402 uses placeholder `https://harmony.ai/souls` (backend owns the real URL — noted for 20-Backend-Concept).
- `NotificationService` lives at `src/services/social/NotificationService.ts` (doc allowed either location); list ops synchronous, `registerPushToken` async no-op.
- Stub backends expose `__resetForTests()`; tests mock `stubBackendUtils` (instant latency + deterministic failures).
