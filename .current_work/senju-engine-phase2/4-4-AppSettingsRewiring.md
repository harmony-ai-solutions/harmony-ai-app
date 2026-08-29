# 4-4 — App Settings Rewiring: reply_mode Sync, Entity-Level Mute/Disable UI

> Phase 4 / repo: **harmony-ai-app**. Contract: `21-Engine-Contract` Q6/Q8, §3.3. Prerequisites: 1-2 (schema),
> 4-1 (registration), 4-3 (engine gates).

## Objective

Finish the consumer rewiring: reply-mode becomes the synced `reply_mode` column; mute/disable become global
entity-level actions; the settings repo shrinks to its final surface.

## 1. `chatConversationSettings.ts` final surface

- Keep: `getChatConversationSettings` (defaults incl. `replyMode: 'realistic'`), `getChatConversationSettingsBatch`,
  `upsertSettings`, `setConversationPinned/Archived`, `conversationSettingsExistForEntity`,
  `listConversationsByFlag` (pinned/archived only now).
- Add: `getReplyMode(participantKey)` / `setReplyMode(participantKey, mode)` (upsert merge-preserving, bumps `updated_at`).
- Delete: mute/disable functions (`getDisabledConversation`, `getDisabledEntityIds`) — replaced by entity queries
  (below). The `'blocked'` mapping and header hack comments die; document Q6 (entity_id = POV) in the header.
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
  - `ChatListScreen` long-press menu (`:1068` area): "Mute"/"Disable" actions now entity-scoped (partner entity);
    labels/i18n adjusted ("Mute {name}" global semantics); the disabled partner's conversations are filtered from
    the list (reuse the blocked-filter seam `SocialService.getBlockedUserIds` position — replace with
    `getDisabledEntityIds` union).
  - O10 badge suppression (3-1): partner `is_muted` from the entities map (already wired there; verify).
  - `CharacterChatService.openCharacterChat` + `ChatDetailScreen`: client-side defense-in-depth — disabled partner →
    honest error toast + navigate to AIProfile (which shows state + enable action); engine `entity_disabled`
    INIT error → same UX (extend `handleInitEntityResponse` ERROR branch: `entity_disabled` → toast, NO recovery
    retries — distinct from `entity_not_defined`, `EntitySessionService.ts:1697-1737`).
  - `AIProfileScreen`: disabled/muted state chip + toggle actions (i18n keys).
- Disabled partners list: wherever ChatList surfaced disabled conversations before (ArchivedChats "disabled" filter)
  — switch to a disabled-ENTITIES section or drop the filter (decide at implementation: prefer AIProfile + a
  "Disabled" manage list in Settings → Keep Simple: AIProfile toggle only, no dedicated list screen this phase).

## 3. i18n

New keys in `src/i18n/locales/en/chat.json` (+ registration): `entityDisabledTitle/Body`, `entityDisabledEnable`,
`muteEntity`, `unmuteEntity`, `disableEntity`, `enableEntity`, `replyModeSyncedHint` (if needed).

## Tests

- Repo: setReplyMode upsert-merge; reply-mode fallback+key-delete; entity flag round-trips.
- Screen: menu actions call entity repo; disabled partner blocked client-side with toast; INIT `entity_disabled`
  handled without retries; ChatList filters disabled partners' rows.

## Verification

- [ ] tsc 0; `npm test` green; grep: `blocked.*disabled|getDisabledConversation` zero in `src/`
- [ ] `gitnexus_impact` on `openCharacterChat`, `handleInitEntityResponse`, ChatList menu symbols before editing;
      `gitnexus_detect_changes()` before committing
