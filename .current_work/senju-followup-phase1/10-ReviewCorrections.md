# Review Corrections — Post-Phase-1 UI Restoration & Bug Mends

> Follow-up to Phases 1–9, driven by the user's code review of the phase-1 diff (baseline `59739e0` → working tree). The phase plan promised "screens stay verbatim, only the data layer swaps" — the review found several screens/elements modified or removed beyond that goal. This doc records the user's correction rulings, what was restored and how the stub layer was extended to support it honestly, two bugs surfaced during verification, and what remains open.
> Code: commit `755c117` ("fix: restore UI elements mistakenly dropped during rebase + alignment"). Backend-contract updates (visibility component, preview-lock ruling, stub seam additions, gap status) live in `../senju-rebase-integration/20-Backend-Concept-Marketplace-Profile.md` §1/§5/§6/§7 — updated in the same commit.

## Rulings → restorations (user feedback, 2026-08-26)

| # | Element removed in phase 1 | Ruling | Implementation |
|---|---|---|---|
| 1 | `MarketplaceItemDetailScreen` preview region (preview image + teaser text + "unlock hint") | Extend the stub, restore | `MarketplaceListingDetail` gained `previewText` / `previewImageData` / `previewMimeType` (detail-only wire fields); all 12 character fixtures got hand-written teasers; screen re-renders image (data URL), text block and `unlockHint` for unowned paid listings (styles from `59739e0`, current theme tokens). +4 component tests. |
| 2 | `salesCount` ("N sales") | Extend the stub, restore | `MarketplaceListingSummary.salesCount: number` (backend already tracked it internally for the 'popular' sort); rendered in the detail screen's meta row and `ListingManageRow` via `MyListingsScreen`. |
| 3 | Post-acquire navigation to `AIProfile` | Keep base code, comment out until backend | Preserved as a commented `TODO(backend)` block in `MarketplaceItemDetailScreen.doAcquire` — requires backend profile materialization (20-Backend-Concept §7). All acquires land in My Library for now; non-character kinds short-circuit via the listing `kind`. |
| 4 | Listing edit / re-list / text & theme publish | Should be *actually stubbed* (working), not honest-error toasts | New stub APIs `updateListing(id, changes)` (owner-only), `relistListing(id)` (removed→active), `removeLibraryEntry(entryId)` (revokes ownership). `PublishListingDraft` gained `kind` (`character_card\|text\|theme`), `text`, `previewText`, `sourceProfileId`. Full publish wizard restored: character snapshot (+`sourceProfileId` linkage), text from character field (backstory→description, prompt→base_prompt, dialogue→mes_example) or scratch, theme lightweight payload. Edit mode prefills via `getListing` and saves via `updateListing`; MyListings re-list action restored. Also fixed a latent bug: the theme source step was unreachable (`canContinue` returned false). |
| 5 | Chat lock gates | Special case — lock in the *marketplace preview context*, never in the own library; extend stub, restore UI | Stub models the lock via `sourceProfileId` linkage (set when publishing from a character): `getListingForProfile(profileId)` + `isChatLocked(profileId)` (active listing + not creator + not owner ⇒ locked; pending/removed never lock). Restored: central step-0 gate in `CharacterChatService.openCharacterChat` (no userId param — stub owns ownership state); `AIProfileScreen` resolves the listing on load → price pill + lock icon are live again, locked tap routes to the listing detail to acquire (the old silent-ignore predates working acquire — deviation noted below); `ChatDetailScreen` re-gained the `chatLockedRef` defense-in-depth gate. `ChatPartnerPickerModal` per-row pre-filter intentionally not re-added — the central gate covers the behavior. |
| 6 | "Marketplace" visibility option + SOUL price input (removed from `CreateAIScreen`) | Correct call — not in the create screen; but restore as a **separate component** for marketplace content settings; note it in the backend doc | NEW `src/components/market/VisibilitySettingsSection.tsx` (private/public/marketplace segments + storefront icon + conditional SOUL price input; reuses the legacy `createAI` `visibility*` i18n keys + `market` price keys). Wired into the publish screen's preview/price step. Existence + required backend field documented in 20-Backend-Concept §1. |
| 7 | Username / bio / avatar picker + remove-avatar (EditProfile), avatar/username/bio in MyProfile header | Misunderstanding — restore the component as it was AND extend the stub | NEW explicit stub seam `src/services/profile/ProfileExtrasService.ts` — AsyncStorage `@harmony_profile/<userId>` (the old UserProfileStore key, deliberately reused so existing dev data survives), shape `{username, bio, avatarDataUrl}`. `EditProfileScreen` fully interactive again (avatar pick via `withExternalFlow`, remove-avatar, username/bio inputs, display→username→bio submit chain); `display_name` still persists cloud-side via `AuthService.updateDisplayName`; extras persist per-device via the stub. `MyProfileScreen` header merges extras (`avatarDataUrl ?? user.avatar_url`). |

## Stub-layer API additions (wire contract — client design input)

- `MarketplaceService`: `updateListing`, `relistListing`, `removeLibraryEntry`, `getListingForProfile`, `isChatLocked` (new); `acquire` result now carries `deliveredEntryId`/`deliveredAssetId`; summary carries `salesCount`; detail carries `kind` + preview fields; draft carries `kind`/`text`/`previewText`/`sourceProfileId`.
- `ListingRecord` gained `kind`/`text`/`preview*`/`sourceProfileId`; `assetFromListing` is kind-aware (text/theme deliver `text` assets); new fixtures: one active text + one active theme listing.
- NEW `ProfileExtrasService`: `getExtras(userId)` / `saveExtras(userId, extras)`.
- Tests: `MarketplaceService.test.ts` +~20 cases (chat-lock matrix incl. creator/owner/acquired/pending/removed, update/relist/remove happy+error paths, kind delivery, preview/salesCount wire), new `ProfileExtrasService.test.ts` (round-trip, defaults, per-user isolation), new `VisibilitySettingsSection.test.tsx` (5 cases), new `MarketplaceItemDetailScreen.test.tsx` (4 cases). One test-only fix: `marketFilters.test.ts` fixture supplies the now-required `salesCount`.

## Bugs surfaced & resolved during review verification

### 1. Character-card import fails on device — `no such column: first_mes` (stale dev DB, not a code bug)

- **Symptom** (adb logcat, 2026-08-26): `Failed to persist imported card: table character_profiles has no column named first_mes` + the same error on every profile SELECT (Characters/MyProfile/ChatPartnerPicker).
- **Root cause**: the device DB predated migration `000037` (the V3-column table rebuild). The consolidated `000041` records as applied on such devices, so the V3 columns never arrive — they exist only via the fresh-migration path. This is exactly standing open question #2 ("one-time dev DB wipe").
- **Resolution**: user wiped the app DB → import works. **Question #2 is now CONFIRMED on-device** (2026-08-26); keep the wipe note in the release/docs material for any dev device that ran pre-consolidation builds.

### 2. `ChatBubbleService` foreground-service crash (`ForegroundServiceDidNotStartInTimeException`)

- **Symptom** (crash buffer, 2026-08-23 + 2026-08-26): FATAL exception ~10 s after closing the floating chat window; trace: `ChatBubbleModule.closeWindow → startForegroundService`.
- **Root cause**: `closeWindow`/`hideOne`/`setUnreadCount` deliver command intents via `startForegroundService()`, which obligates the service to call `startForeground()` on EVERY delivery (even when already foreground). `onStartCommand` only did so in the `ACTION_SHOW` branch — the three command branches returned early → system kills the app. On-device-only failure mode (jest mocks the native module), delayed ~10 s from the triggering tap, so it escaped both test gates and manual testing; it was also not tracked in any register (D1-4 covered a different bug in the same file).
- **Fix** (`ChatBubbleService.kt`): `startForegroundCompat()` now runs unconditionally at the top of `onStartCommand` (legal + cheap re-post); `conversationJson` refresh moved ahead of the notification build; new `maybeStopWhenEmpty()` guard prevents a zombie notification when a command revives a service with zero bubbles. Compile-verified: `:app:compileDevDebugKotlin` → BUILD SUCCESSFUL.
- **Pending**: on-device verification (show bubble → open window → close → wait 15 s → app survives) rides the next device build, together with the D1-4 Kotlin `show()` boolean. Record the result in the logbook when it lands.

## Validation (review-phase gates)

- `npx tsc --noEmit` → 0 errors.
- `npm test` → unit 98 suites / 873 tests green; integration 10 suites / 50 green + 1 skipped.
- `gitnexus_impact` before every edit → LOW risk throughout; `gitnexus_detect_changes` → all changed symbols confined to the marketplace/profile/chat domain.
- i18n: zero new keys — every restored element reuses existing `market`/`createAI`/`profile` keys (the phase-1 "coming soon"/preview-only keys remain in the locale files, currently unreferenced; prune when the backend makes them real).

## Open items / intentionally not done

1. Acquire → AIProfile deep link: preserved as commented code; needs backend profile materialization (20-Backend-Concept §7).
2. Apply-to-character UI (removed with the sidecar repos in Phase 4): NOT restored — needs a ruling (stub maps asset text to `description` only). Listed as a gap in 20-Backend-Concept §7.
3. Locked-tap behavior on `AIProfileScreen` = navigate to the listing detail (old behavior was silent-ignore because payment didn't exist). Flagged for user confirmation.
4. `ChatPartnerPickerModal` per-row lock pre-filter: covered by the central `openCharacterChat` gate; restore the visual filter only if UX demands it.
5. Bubble FGS fix + D1-4 Kotlin: both ride the next device build — verify on-device, then record.
6. Marketplace preview lock enforcement stays client-side until the backend owns it server-side (20-Backend-Concept §1) — client gates are defense-in-depth only.
