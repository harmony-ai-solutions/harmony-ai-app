# Phase 2 — Marketplace & Wallet Rewiring (+ paywall removal)

> Track A1/A2 wiring. Swap every marketplace/wallet consumer to the Phase-1 services; delete the legacy marketplace transport + purchase service; remove the client-side paywall (security theater, 00-Research §4.2 B2).
> Work directly in these files — run `gitnexus_impact` on edited symbols per AGENTS.md.

## Consumers to rewire (verified import list)

Screens: `src/screens/MarketScreen.tsx`, `src/screens/MarketplaceItemDetailScreen.tsx`, `src/screens/MarketplacePublishScreen.tsx`, `src/screens/MyListingsScreen.tsx`, `src/screens/MyLibraryScreen.tsx`, `src/screens/ContentAssetScreen.tsx`, `src/screens/AIProfileScreen.tsx` (price/lock UI + acquire), `src/screens/DiscoverScreen.tsx` (feed source — see below).
Components: `src/components/market/*` (except dead `MarketListingCard` — delete if still present), `src/components/market/LibraryItemRow.tsx`, `src/components/market/ListingManageRow.tsx`.
Utils: `src/utils/marketFilters.ts` (keep, operate on stub types).

### Data-source swap map

| Old (delete the call) | New |
|---|---|
| `marketplace.ts` repo: `isMarketplaceListed`, `getMarketplaceListing`, `upsertMarketplaceListing`, `removeMarketplaceListing`, `getMarketplaceCharacterProfiles`, `hasPurchased`, `getSoulPurchases`, `purchaseCharacter`, `canChatWithCharacter`, `cacheListing`, `getCachedListings`, `getCachedListing`, `getCachedMyListings`, `setCachedListingStatus`, `saveOwnedAsset`, `getOwnedAssets`, `hasOwnedAsset`, `clearMarketplaceCache` | `MarketplaceService.*` equivalents (Phase 1 doc) |
| `soulWallet.ts` repo: `getSoulBalance`, `hasClaimedSignupBonus`, `claimSignupBonus`, `creditSouls`, `debitSouls` | `WalletService.getBalance()` / internal debit |
| `contentLibrary.ts` repo: `addContentEntry`, `getContentEntries`, `getContentEntry`, `deleteContentEntry`, `applyTextToCharacter` | `MarketplaceService.getLibrary()` / `getContentAsset()` (apply-to-character flow targets local character repos directly — it never needed a sidecar table) |
| `MarketplaceApiService.ts` transport + `services/marketplace/acquireItem.ts`, `itemSnapshots.ts`, `librarySync.ts`, `marketplaceTypes.ts` | Deleted entirely (O7); stub backend owns snapshots/library internally |

**Do NOT touch the repos themselves in this phase** (deleted in Phase 4) — only remove their imports/calls. Repos must have **zero non-test importers** at the end of this phase.

### DiscoverScreen feed source (A3 consequence)

`getCommunityCharacterProfiles` relied on the doomed `character_profile_sources` table. New source: the **stub fixture feed** (O5 — fixtures visible everywhere). Discover lists marketplace/social fixture characters + keeps local search; the "created by others" real backend query lands with `20-Backend-Concept`. Add a subtle hint i18n key (e.g. `discover:previewHint` — "Preview content while the community backend is in development") so users understand the feed is preview data. Keep the screen structure verbatim.

## Paywall removal (A2 — client-side paywall = security theater)

Remove `isChatLocked` / `canChatWithCharacter` / `confirmPurchaseIfNeeded` gates from:
- `src/services/CharacterChatService.ts` — `openCharacterChat` drops the `currentUserId` param + silent-return lock; revert call sites (Characters card chat, ChatList "new chat" picker).
- `src/screens/AIProfileScreen.tsx` — lock/"Chat · {{price}} Souls" button becomes a normal Chat button; the **price pill / lock icons stay as pure UI** (they render stub listing data).
- `src/screens/DiscoverScreen.tsx`, `src/screens/MarketScreen.tsx` — `handleChat` lock checks removed; Market card chat opens the (stub) listing detail or the character chat per current UX minus the lock.
- `src/screens/ChatListScreen.tsx` — remove the `useAuth` usage that existed only to pass `user?.id` into the lock.
- Acquire flow on `MarketplaceItemDetailScreen`: `doAcquire` now calls `MarketplaceService.acquire()` — **owned state flips ONLY on success** (fixes D1-1 fake-success `finally` bug by construction). On `InsufficientCreditsError` show honest error UI ("Not enough Souls — buying Souls is coming soon").

## AuthContext cleanup (A2)

- Remove the `claimSignupBonus()` call (and its import) from `registerAction` in `src/contexts/AuthContext.tsx`.
- Remove the marketplace library-hydration effect that called `librarySync`/cache repos; `MyLibraryScreen` loads from `MarketplaceService.getLibrary()` on focus.
- Logout: `clearMarketplaceCache` call (if referenced) becomes moot — remove it (tables die in Phase 4).

## Wallet UI

- `MarketScreen` balance badge → `WalletService.getBalance()` + `on('status')` refresh.
- "Buy/Sell Souls" dropdown keeps its existing "Coming soon" window — no change.

## Files to delete in this phase

- `src/services/marketplace/MarketplaceApiService.ts` (O7)
- `src/services/MarketplacePurchaseService.ts` (fold into MarketplaceService — approved default #3)
- `src/services/marketplace/acquireItem.ts`, `src/services/marketplace/itemSnapshots.ts`, `src/services/marketplace/librarySync.ts`, `src/services/marketplace/marketplaceTypes.ts`
- Their tests. Port any test *intent* that still applies to stub behavior into the Phase-1 service suites (most intent is already covered there).

## Verification

- [ ] `grep -rn "MarketplaceApiService\|MarketplacePurchaseService\|acquireItem\|itemSnapshots\|librarySync\|isChatLocked\|canChatWithCharacter\|confirmPurchaseIfNeeded\|claimSignupBonus" src/` → zero non-historical hits
- [ ] `grep -rln "repositories/marketplace\|repositories/soulWallet\|repositories/contentLibrary" src/ --include="*.ts*" | grep -v __tests__` → empty
- [ ] `npx tsc --noEmit` 0 errors; `npm test` green
- [ ] Manual smoke (user, on-device later): Market tab loads fixture listings; acquire succeeds/fails honestly; chat opens from any card without locks
- [ ] `gitnexus_detect_changes()` before commit; commit: `feat: wire marketplace and wallet screens to in-memory stubs, remove client-side paywall`
