# Phase 3 — Social, Notifications & Profile Rewiring

> Track A3/A4 wiring. Social + notification screens to stubs; block list via stub; user profile goes cloud-first (drop the AsyncStorage shadow store).

## Social & notification consumers

Components: `src/components/social/CreatePostModal.tsx`, `PostCard.tsx`, `PostCommentModal.tsx`; `src/components/characters/ImageCommentModal.tsx`; `src/components/navigation/HeaderNotificationButton.tsx`.
Screens: `src/screens/UserProfileScreen.tsx`, `src/screens/MyProfileScreen.tsx` (Posts/Saved tabs, follower stats), `src/screens/NotificationsScreen.tsx`, `src/screens/settings/BlockedUsersScreen.tsx`, `src/screens/AIProfileScreen.tsx` (character like/save + image posts/comments).

### Repo → service swap map (repos deleted in Phase 4)

| Old repo functions (delete calls) | New |
|---|---|
| `characterSocial.ts`: `isCharacterLiked/addCharacterLike/removeCharacterLike/toggleCharacterLike/getCharacterLikesCount`, `isCharacterSaved/addCharacterSave/removeCharacterSave/toggleCharacterSave/getSavedCharacterProfileIds/getSavedCharacterEntries`, `isImageLiked/toggleImageLike/getImageLikesCount/addImageComment/getImageComments/deleteImageComment/getImageCommentsCount`, `setCharacterCreator/getCharacterCreator/isCharacterCreator` | `SocialService.*` equivalents (Phase 1 doc) |
| `userSocial.ts`: `createUserPost/getUserPost/getUserPostsByAuthor/getMyUserPosts/getAllUserPosts/deleteUserPost`, post like/comment fns, `isFollowing/addFollow/removeFollow/getFollowedUsers`, `getBlockedUserIds/isUserBlocked/addBlockedUser/getBlockedUsers/removeBlockedUser` | `SocialService.*` (block list included) |
| `blockedContent.ts`: `getBlockedProfileIds`, `filterBlockedCharacterProfiles`, `filterBlockedUserPosts`, `filterBlockedUserNotifications` | Move pure filters to `src/utils/blockedContentFilters.ts` (created Phase 1) taking `(items, blockedIds: Set<string>)`; callers fetch ids via `SocialService.getBlockedUserIds()` |

- `HeaderNotificationButton`: unread badge → `NotificationService.getUnreadCount()` + `subscribe` (push updates, not reload-synced — also fixes the bubble-badge pattern for F8 later).
- `NotificationsScreen`: list/markRead → `NotificationService`.
- `BlockedUsersScreen`: block list management via `SocialService` (works against fixture users — approved default #1).
- All blocked-content filtering (Discover/Market/Characters/Notifications/UserProfile posts) keeps working via the pure filters + stub ids.

## Profile cloud-first (A4 directive)

`src/services/profile/UserProfileStore.ts` (AsyncStorage shadow: `@harmony_profile/<userId>`) is **deleted**:
- `MyProfileScreen.tsx`: display name resolves `useAuth().user.display_name` (cloud) with a graceful "User" fallback; stats keep local counts (AI Characters via `getUserCharacterProfiles`; Followers/Following via `SocialService` stub counts); Posts/Saved tabs via SocialService / character saves.
- `EditProfileScreen.tsx`:
  - `display_name` persists via `AuthService` → existing `PATCH /v1/auth/me` (backend accepts `display_name` ONLY — cross-verified 2026-08-24).
  - `username` / `bio` / local avatar upload: **cannot persist yet** — render disabled with a "coming soon" hint (honest stub) instead of silently shadow-storing. Documented as extension item in `20-Backend-Concept` outline (Phase 9): add `username`/`bio` to PATCH + avatar upload endpoint + `avatar_url` in responses.
- `UserProfileStore` tests deleted; `MyProfileScreen`/`EditProfileScreen` tests ported to the new data sources.

## NotificationService event wiring

- App start / auth change: nothing to hydrate (in-memory). `registerPushToken` stays interface-only.
- `EventEmitter<'unread'>` consumers: `HeaderNotificationButton` (badge), later `ChatListScreen`/bubble (Phase 6, F8).

## Verification

- [x] `grep -rln "repositories/characterSocial\|repositories/userSocial\|repositories/blockedContent\|UserProfileStore" src/ --include="*.ts*" | grep -v __tests__` → empty (remaining hits = doomed-repo tests, deleted Phase 4)
- [x] `npx tsc --noEmit` 0 errors; `npm test` green (unit 88/858, integration 10/50+1 skipped)
- [ ] Manual smoke: My Profile loads (cloud display name), Edit Profile saves display name, username/bio visibly "coming soon"; notifications badge updates live after stub actions; Block/Unblock filters fixture content across Discover/Market/Characters — **pending user**
- [x] `gitnexus_detect_changes()`; commit: `feat: wire social, notifications and profile to stub services, drop user profile shadow store`

### Implementation notes (deviations — full detail in 13-Phase-1-Logbook.md)

- `addNotification` call sites removed (NotificationService is a read-only fixture feed — backend writes notifications later).
- New `AuthService.updateDisplayName` (PATCH /v1/auth/me) + `AuthContext.refreshUser()`.
- Extra creator-write consumers wired: `CharacterCardImportService`, `CreateAIScreen`, `CharacterProfileEditScreen`.
- Stub read-API gaps (liked-by-me, count getters) derived at read time; My-Profile Followers honest 0.
- No UserProfileStore/screen tests existed to port (verified); only `CharactersScreen.test.tsx` mock swapped.
