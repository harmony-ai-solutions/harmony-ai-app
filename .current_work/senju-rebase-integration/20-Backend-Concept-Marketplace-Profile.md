# 20 — Backend Concept: Marketplace, Wallet, Social & Profile (OUTLINE)

> OUTLINE ONLY — not the full design. Captures what Phase 1 (app-side stub layer) learned and locked, to feed the
> backend/engine planning round (Phase 2 + the community backend). The stub method surfaces shipped in Phase 1 are
> the **client design input**; wire shapes must keep the first-party client's observable surface
> (`APIError.isQuotaError`, `soulCreditsAvailable`, `currentTier`, `upgradeUrl`, subscription sub-API).
> Source: `.current_work/senju-followup-phase1/9-VerificationRecords.md` §3 + logbook
> `.current_work/senju-rebase-integration/13-Phase-1-Logbook.md` "Pointers for follow-up Phase 2".

## 1. Real marketplace service (replaces stub)

- Listings CRUD: create/update/delist/re-list; statuses active/pending/removed (pending = moderation semantics,
  excluded from public feed — stub already models this).
- Search: title/creator; filter by item type; pagination.
- Moderation: pending review, removal reasons, appeals (open question).
- Publishing model (A4): **upload-copy semantics** — publishing uploads a copy of the character card; the local
  profile and the listing are independent. "Created by others" = **backend query** (Discover feed), never a
  client-side scan.
- Ownership: creator user ids on listings (needed for blocked-filter + attribution + creator resolution).
- salesCount (shown optionally in the manage row today; needs a backend source).

## 2. Wallet ledger (souls accounting)

- Balance, debit/credit with atomic ledger (no client-side `soul_wallet` single-row balance anymore).
- Purchases: acquire flow folds into `MarketplaceService.acquire()` (Phase-1 default #3) → backend authorizes,
  ledger debits, ownership granted.
- Error taxonomy: `InsufficientCreditsError` ≡ client `APIError` 402 `quota_exceeded` with remaining balance.
- Real `upgradeUrl` (stub placeholder `https://harmony.ai/souls` — backend owns it).

## 3. Social graph

- Profiles, follows/followers (backend graph; My Profile "Followers" stays honest-0 until then), follow counts.
- Posts + comments; per-item liked-state + count reads (stub gap: screens derive at read time, start `liked=false`).
- Character social (likes/saves) + image social (likes/comments) — same per-item state reads.
- Block list: user-level blocks stored server-side; blocked content filtered server-side (creator resolution).
- Creator membership: who created each character (replaces the dropped `character_profile_sources` sidecar; feeds
  the ownership signal gap — `getUserCharacterProfiles` interim-returns all profiles).

## 4. Notifications + push

- Write side (stub gap): comment/like/follow/image-comment events → notifications. Stub feed is read-only.
- Unread badge + markRead/markAllRead; per-type routing.
- Push: `registerPushToken` (stub no-op) → real device-push registration; engine table `device_push_tokens`
  (Go-only today) is the anticipated sink.

## 5. Profile extension (PATCH /v1/auth/me — extend, don't redesign)

- Backend already accepts `display_name` only (verified 2026-08-24). Phase 1 added `AuthService.updateDisplayName`.
- Extend: `username`, `bio` in PATCH /v1/auth/me; avatar upload endpoint + `avatar_url` in responses.
- UX contract: EditProfile shows disabled username/bio/avatar inputs with "coming soon" hints until the backend
  lands these fields.

## 6. Stub seam contract (client design input — exact surfaces shipped in Phase 1)

- `MarketplaceService`: `getListings(query?)`, `getListing(id)`, `publishListing(draft)`, `delistListing(id)`,
  `acquire(listingId)`, `getMyListings()`, `getLibrary()`, `getContentAsset(id)`, `refresh()`. Types:
  `CharacterSnapshot`, `MarketplaceListingSummary/Detail`, `PublishListingDraft`, `AcquireResult`,
  `ContentAsset` (kind `character_card|text|theme`), `OwnedLibraryEntry` (kind `purchase|free|own`).
- `WalletService`: `getStatus()`, `getBalance()`, `getSubscription()`, `on()`; status `idle|syncing|ready|failed`;
  `SubscriptionStatus {tier, soulCreditsAvailable, currentTier?, upgradeUrl?}`.
- `SocialService`: `getPublicUserProfile`, `toggleFollow`, `isFollowing`, `getFollowedUsers`, `getPosts`,
  `createPost`, `deletePost`, `togglePostLike`, comments; `toggleCharacterLike/Save` + counts + saved entries;
  `toggleImageLike` + comments; `getBlockedUserIds` → `Set<string>`, `blockUser`, `unblockUser`;
  `setCharacterCreator`, `getCharacterCreator`, `isCharacterCreator`. `LOCAL_USER_ID`/`LOCAL_USER_DISPLAY_NAME`
  exports for "my posts".
- `NotificationService`: `list()`, `getUnreadCount()`, `markRead(id)`, `markAllRead()`, `registerPushToken(token)`,
  `subscribe(cb)`→unsubscribe; `EventEmitter<'unread'>`.
- Error taxonomy: `StubServiceError` ≡ client `APIError` observable surface (`status`, `code`, `upgradeUrl`,
  `currentTier`, `requiredTier`, `soulCreditsAvailable`, `taskId`; getters `isAuthError`/`isQuotaError`/
  `isRateLimited`/`isServerError`).
- Latency/failure simulation contract: ~300 ms ±100 ms latency; seeded transient failures (publish 3% / delist 10%).
- Honest-error i18n keys (added in Phase 2) — copy review when the backend makes them real: `insufficientTitle`,
  `insufficientSoulsBuySoon`, `publishTypePreviewOnly`, `editUnavailablePreview`, `relistUnavailablePreview`,
  `removeUnavailablePreview`, `statusPending`, `statusRemoved`, `previewHint`.

## 7. Concrete gaps discovered in Phases 2–3 (from the logbook)

- Profile→listing linkage (AIProfile price pill + acquire-success deep link currently have none).
- Text/theme publish + listing edit + re-list + library-remove (honest-error placeholders now).
- `salesCount` (optional in the manage row; no stub source).
- itemType→profile-field mapping for apply-to-character (stub maps asset text to `description` only).
- Creator user ids on marketplace listings (blocked-filter + attribution + creator resolution).
- Notification write side (comment/like/follow/image-comment events → notifications).
- Per-item liked-state + count reads on posts/images (and `isCharacterSaved`).
- Follower graph for the local user ("Followers" honest-0 on My Profile today).

## 8. Open items

- Offline caching (O9) — stub state is in-memory; no persistence decisions made.
- Moderation/blocking backend (moderation queue, block enforcement server-side).
- Pricing (Soul economy, creator payouts).
- Real `upgradeUrl` (placeholder `https://harmony.ai/souls`).