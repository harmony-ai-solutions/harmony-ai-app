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
- **Marketplace preview lock** (review-phase user ruling): a listed character is viewable free but CHAT is locked
  until acquired (creator/owner bypass). Client stub models this via `sourceProfileId` linkage +
  `MarketplaceService.isChatLocked()`; the backend must own this enforcement server-side (client gates are
  defense-in-depth only).
- **Visibility classification UI exists**: `src/components/market/VisibilitySettingsSection.tsx`
  (private/public/marketplace segments + SOUL price input, reused createAI i18n keys) — wired into the publish
  screen's preview step. The backend contract needs a per-listing (or per-content) visibility/classification
  field so this component maps 1:1; today the stub ignores private/public beyond marketplace semantics.
- Listing `kind` (`character_card|text|theme`) + text payload: stub already publishes/delivers all three kinds
  (review-phase restore); backend needs the same asset-family model.

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
- UX contract (updated, review phase): EditProfile's username/bio/avatar editing is FULLY RESTORED and persists
  per-device through the explicit stub seam `src/services/profile/ProfileExtrasService.ts` (AsyncStorage key
  `@harmony_profile/<userId>` — the old shadow-store key, deliberately reused). When the backend lands these
  fields, swap the service internals for cloud calls — the screens already treat it as the seam.

## 6. Stub seam contract (client design input — surfaces shipped in Phase 1 + review phase)

- `MarketplaceService`: `getListings(query?)`, `getListing(id)`, `publishListing(draft)`, `delistListing(id)`,
  `acquire(listingId)`, `getMyListings()`, `getLibrary()`, `getContentAsset(id)`, `refresh()`; review-phase
  additions: `updateListing(id, changes)`, `relistListing(id)`, `removeLibraryEntry(entryId)`,
  `getListingForProfile(profileId)`, `isChatLocked(profileId)`. Types:
  `CharacterSnapshot`, `MarketplaceListingSummary/Detail` (summary carries `salesCount`; detail carries `kind` +
  `previewText/previewImageData/previewMimeType`), `PublishListingDraft` (kind `character_card|text|theme`,
  `text`, `previewText`, `sourceProfileId`), `AcquireResult` (ok + `deliveredEntryId`/`deliveredAssetId`),
  `ContentAsset` (kind `character_card|text|theme`), `OwnedLibraryEntry` (kind `purchase|free|own`),
  `ListingUpdateChanges`.
- `ProfileExtrasService` (review phase): `getExtras(userId)`, `saveExtras(userId, extras)` — per-device
  AsyncStorage stub behind the profile-extras seam (see §5).
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

> Review-phase status (2026-08-26): the ✅ items below are now STUB-SUPPORTED (in-memory preview works); each
> still needs its real backend counterpart before launch.

- ✅ Profile→listing linkage (AIProfile price pill resolves via `getListingForProfile`; acquire-success deep
  link to AIProfile is preserved as commented TODO code in MarketplaceItemDetailScreen — needs backend profile
  materialization, still open).
- ✅ Text/theme publish + listing edit + re-list + library-remove (all flow through the stub APIs now).
- ✅ `salesCount` (exposed on the summary wire; MyListings + detail screen render it).
- itemType→profile-field mapping for apply-to-character (stub maps asset text to `description` only;
  apply-to-character UI was removed with the sidecar repos and is NOT yet restored — needs a ruling).
- Creator user ids on marketplace listings (blocked-filter + attribution + creator resolution).
- Notification write side (comment/like/follow/image-comment events → notifications).
- Per-item liked-state + count reads on posts/images (and `isCharacterSaved`).
- Follower graph for the local user ("Followers" honest-0 on My Profile today).

## 8. Open items

- Offline caching (O9) — stub state is in-memory; no persistence decisions made.
- Moderation/blocking backend (moderation queue, block enforcement server-side).
- Pricing (Soul economy, creator payouts).
- Real `upgradeUrl` (placeholder `https://harmony.ai/souls`).