# Phase 6 — D-Register Bug Mends (cherry-pickable small fixes)

> Tracks D1/D2 registers from `02-Followup-Stub-Plan.md`. Each item is independently landable; commit per logical group. Items already subsumed by earlier phases are marked DONE-BY. Context for the unread/preference forensics: `04-Preference-Alignment-Inventory.md`.

## D1 register (original)

| # | Item | Fix spec | Status |
|---|---|---|---|
| 1 | `MarketplaceItemDetailScreen.doAcquire` setOwned in `finally` | DONE-BY Phase 2 (stub acquire flips owned only on success) | ✅ |
| 2 | Publish/delist fake-success fallbacks | DONE-BY Phase 1/2 (honest stub errors) | ✅ |
| 3 | `ChatInputBar` 120 s auto-stop discards recording | On timeout: **finish the recording** (stop + attach to the composer) instead of discarding; keep the visible countdown | ☐ |
| 4 | `src/services/ChatBubbleService.ts` dead `result === false` check | Make native `ChatBubbleModule.show()` return a real boolean (canDrawOverlays + try/catch in `ChatBubbleService.kt`) and keep the check; or if native return unreliable on some OEMs, drop the check and log-only | ☐ (pick with user if native behavior unclear — default: real boolean) |
| 5 | Background cloud WS policy (her `20c985a` removed background disconnect) | Keep her always-connected behavior BUT guard interaction with purge semantics: `EntitySessionService` background handler must not disconnect/reconnect when `SyncConnectionContext.isPurging()` is active (`PurgeInProgressError` path already exists in connect catch — reuse). Document chosen policy in record doc | ☐ |
| 6 | `clearMarketplaceCache` on logout | DONE-BY Phase 2 (cache tables gone; call removed) | ✅ |
| 7 | `cd821db` — 3rd "connecting…" indicator state | Restore the three-state connection indicator where she collapsed it to two (ChatDetailScreen header/connection banner region — locate via her commit `cd821db` in `git log`) | ☐ |
| 8 | `98d0ec9` — first-message day divider | Day-divider rendering: also emit divider for `i === 0` (first message) in ChatDetailScreen list rendering | ☐ |
| 9 | Reply feature | DONE-BY Phase 4 (O4 strip) | ✅ |
| 10 | Reply-mode toggle (`chat_reply_mode_*`, A6 ruling) | **Feature returns**: UI = a toggle in the **conversation settings menu** (`ChatConversationMenuModal`), NOT the chat header. Storage interim = AsyncStorage keyed by participant key (`@harmony_chat_reply_mode_<participantKey>` via `ChatPreferencesService` pattern). Becomes a synced `chat_conversation_settings` column in Phase 2 (B2) | ☐ |
| 11 | Legacy persona prefs (P4/O2) | DEFERRED (open question — silent fallback stays for now) | ➖ |
| 12 | `getCharacterStats` interactions full-scan | Replace full-scan count with aggregate SQL (`SELECT COUNT(*) … WHERE`) or an index-backed query in `characters.ts` | ☐ |

## D2 register (ChatListScreen audit)

| # | Fix spec | Status |
|---|---|---|
| F1 HIGH | Live reload while list focused: subscribe to `EntitySessionService` events (`message:received` + session lifecycle) in `ChatListScreen`; refresh visible rows/badges incrementally (or debounce full reload) | ☐ |
| F2 | DONE-BY Phase 2/4 (paywall removed; read-flags alignment is Phase 2) | ✅ |
| F3 | Cascade: `deleteConversationByParticipantKey` (interactions repo) also deletes the `chat_conversation_settings` row for that key — no resurrected stale pinned/muted/badge state | ☐ |
| F4 | **[O3 ruled engine-aligned keys]** Fix app-side pair-key derivation + the false docstring to match engine `deriveParticipantKey` EXACTLY (own entity in the key everywhere; per-persona semantics intended for pairs AND groups). Cross-check `deriveParticipantKey`/`deriveScopeFromParticipants` in `src/services/…` against `harmony-link-private` `DeriveParticipantKey` — no drift. ⚠️ Data note: existing settings rows keyed by the old derivation need a one-time re-key or accept stale-loss (dev devices only — default: accept loss, note in record) | ☐ |
| F5 | Blocked users filter the chat list: apply `SocialService.getBlockedUserIds()` in the list query path (stub-gap tolerant — fixture users rarely have chats) | ☐ |
| F6 **[O11]** | Unify recency on last-message `created_at` (not `interactions.last_activity_at`); replace hard LIMIT-50 with proper pagination (`offset`/cursor + load-more) | ☐ |
| F7 | Await persona resolution before first list load (kills the 'user'-perspective flash + double load) | ☐ |
| F8 | Bubble unread badge pushes updates via the same F1 event subscription (per-bubble `setUnreadCount` native action already exists) | ☐ |
| F9 | DONE-BY Phase 2 (paywall removed) | ✅ |
| F10 | "Mark unread" = **set-to-1** semantics (not +1); drop dead key-last-read writes | ☐ |
| F11 **[O10]** | Muted ⇒ suppress unread-badge increments (conversation stays visible) — guard in `EntitySessionService.handleIncomingMessage` badge increment | ☐ |
| F12 | `ArchivedChatsScreen` bubble uses live persona (not hardcoded `ownEntityId:'user'`) | ☐ |
| — | Dead subsystem: `getKeyLastRead`/`setKeyLastRead`/`markKeyAsRead`/`clearKeyLastRead` (write-only) — delete fns + call sites | ☐ |
| — | Cleanup: unused imports (`hasBubblePermission`, `listConversationsByFlag`), dead styles (`timeBadge`), never-rendered `_loading` state | ☐ |

## Suggested commit grouping

1. `fix: chat list live updates, pagination and unread semantics (F1 F6 F7 F8 F10 F11 F12)` 
2. `fix: conversation delete cascades settings rows and blocked users filter chat list (F3 F5)`
3. `fix: engine-aligned participant key derivation (F4/O3)`
4. `fix: chat recording kept on 120s auto-stop; bubble show() returns real result (D1-3 D1-4)`
5. `feat: reply-mode toggle returns in conversation settings menu (A6)`
6. `fix: restore connecting indicator, first-message divider, background WS purge guard, stats aggregate (D1-5 D1-7 D1-8 D1-12)`

## Verification

- [ ] Per-group: `npx tsc --noEmit` + affected suites green
- [ ] New unit tests where cheap: F3 cascade, F10 set-to-1, F11 mute suppression, reply-mode service, stats aggregate
- [ ] `gitnexus_detect_changes()` before each commit
