# 4-4 — App Settings Rewiring: reply_mode Sync, Entity-Level Mute/Disable UI

> Phase 4 / repo: **harmony-ai-app**. Contract: `21-Engine-Contract` Q6/Q8, §3.3. Prerequisites: 1-2 (schema),
> 4-1 (registration), 4-3 (engine gates).

## Objective

Finish the consumer rewiring (the mute/disable→entity-flag LOGIC and derived-unread core already landed in
Phase 1 per A5 — 4-4 does the final UI treatment + verification): reply-mode becomes the synced `reply_mode`
column; mute/disable get their final UX (labels, AIProfile chip, guards); the settings repo reaches its final
surface.

## 1. `chatConversationSettings.ts` final surface

- Keep: `getChatConversationSettings` (defaults incl. `replyMode: 'realistic'`), `getChatConversationSettingsBatch`,
  `upsertSettings`, `setConversationPinned/Archived`, `conversationSettingsExistForEntity`,
  `listConversationsByFlag` (pinned/archived only now).
- Add: `getReplyMode(participantKey)` / `setReplyMode(participantKey, mode)` (upsert merge-preserving, bumps `updated_at`).
- Delete (executed in the Phase-1 change set — verify zero remnants): mute/disable functions
  (`getDisabledConversation`, `getDisabledEntityIds`). The `'blocked'` mapping and header hack comments die; Q6
  (entity_id = POV) documented in the header with all writers passing POV ids (A6).
- `EntitySessionService` reply-mode: `startInteractionSession`/`sendInitEntityForEntity` read the SYNCED value
  (repo `getReplyMode`) instead of `ChatPreferencesService.getReplyMode`; `SET_REPLY_MODE` broadcast + the
  `InteractionSession.replyMode` field stay (live partner pacing still needs the WS push).
- `ChatConversationMenuModal` toggle + `ChatListScreen` menu action (`:751-768`) call the repo; **migrate** existing
  `@harmony_chat_reply_mode_*` values → one-time best-effort read-and-copy into settings rows on first toggle/open
  (keep it simple: `ChatPreferencesService.migrateReplyModesOnce()` reading all keys is overkill — instead: on
  `getReplyMode` miss, fall back to the legacy key once, then write the row and delete the key; dev-wipe makes even
  this optional, but it's ~10 lines and honest).

## 2. Entity-level mute/disable

- `src/database/repositories/entities.ts`: `setEntityMuted(id, muted)` / `setEntityDisabled(id, disabled)` via
  `updateEntityFields` (allowlist from 1-3); `getDisabledEntityIds()` / `getMutedEntityIds()` re-implemented here
  (SELECT id FROM entities WHERE is_disabled = 1 AND deleted_at IS NULL …).
- Consumers:
  - `ChatListScreen` long-press menu (`:1068` area): "Mute"/"Disable" actions are entity-scoped since Phase 1
    (A5); 4-4 adjusts labels/i18n ("Mute {name}" global semantics). The disabled partner's conversations are
    filtered from the list as social-blocked (`SocialService.getBlockedUserIds` — **UNCHANGED, A4; social-graph
    blocking is a different feature**) **∪** `getDisabledEntityIds` — a union at the same seam, never a
    replacement.
  - O10 badge suppression (3-1): partner `is_muted` from the entities map (already wired there; verify).
  - `CharacterChatService.openCharacterChat` + `ChatDetailScreen`: client-side defense-in-depth — disabled partner →
    honest error toast + navigate to AIProfile (which shows state + enable action); engine `entity_disabled`
    INIT error → same UX (extend `handleInitEntityResponse` ERROR branch: `entity_disabled` → toast, NO recovery
    retries — distinct from `entity_not_defined`, `EntitySessionService.ts:1697-1737`).
  - `AIProfileScreen`: disabled/muted state chip + toggle actions (i18n keys).
  - Guards (A3): `setEntityMuted`/`setEntityDisabled` throw for `entity_type='user'` (landed Phase 1 — verify);
    user entities are NEVER offered as chat partners anywhere a partner is picked (see 5-4 §4); engine INIT gate
    is type-scoped (4-3).
- Disabled partners list: **DisabledAIsScreen is KEPT and rewired** (A5) — it is the existing management UI
  (`AccountSettingsScreen.tsx:72` → `AppNavigator.tsx:206`), listing disabled AI entities
  (`entity_type='ai' AND is_disabled=1`) instead of `listConversationsByFlag('blocked')`. The earlier
  "ArchivedChats 'disabled' filter" reference was factually wrong (ArchivedChats filters only `archived`; its
  `:307-320` mark-read handler is the only seam touched there). AIProfile keeps the new state chip + toggles.

## 3. i18n

New keys in `src/i18n/locales/en/chat.json` (+ registration): `entityDisabledTitle/Body`, `entityDisabledEnable`,
`muteEntity`, `unmuteEntity`, `disableEntity`, `enableEntity`, `replyModeSyncedHint` (if needed).

## Tests (TDD — red → green)

- **RED first**: repo tests setReplyMode upsert-merge; reply-mode legacy-key fallback + key-delete (fail before
  the fns exist — note the flag round-trips moved to Phase 1 per A5).
- **RED first**: screen tests menu actions call entity repo; disabled partner blocked client-side with toast;
  INIT `entity_disabled` handled without retries; ChatList filters disabled partners' rows
  (social-blocked ∪ disabled union — A4).

## Verification

- [ ] tsc 0; `npm test` green; grep: `blocked.*disabled|getDisabledConversation` zero in `src/`
- [ ] `gitnexus_impact` on `openCharacterChat`, `handleInitEntityResponse`, ChatList menu symbols before editing;
      `gitnexus_detect_changes()` before committing
