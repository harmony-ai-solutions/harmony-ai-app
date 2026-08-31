# 6-1 — Verification Gates (Both Repos)

> Phase 6 / repos: BOTH. Contract: `21-Engine-Contract` §7; working agreements in `summary.md`.

## Engine repo (`feat/engine-track-phase2`)

```bash
go build ./...
go vet ./...
go test ./...                      # incl. database roll-forward/rollback suite
go run . dump-schema | tail -n +3 > /tmp/go-final.json   # dump emits 2 header lines — assert output starts with [
```

## App repo (`senju-design-updates-rebase`)

```bash
npx tsc --noEmit
npx jest --selectProjects unit --maxWorkers=45
npx jest --selectProjects integration --maxWorkers=45
npm run schema:dump -- --output /tmp/rn-final.json
python scripts/compare-schemas.py /tmp/rn-final.json /tmp/go-final.json
npx gitnexus analyze
```

## Expected results (assert ALL)

- [ ] tsc = 0 errors; unit + integration all green (no new skips; `entitySessionInitRecovery` still green)
- [ ] `go test ./...` green incl. migration rollback/re-apply for 000041/000042/000043
- [ ] **Parity compare exits 0**; output = EXACTLY the allowlist: **2 entries** — `device_push_tokens` Go-only +
      `sync_devices` (engine-local `synced_tables` column, added in 4-2 per §9-A9). Everything else MATCHES after
      comment normalization (§9-A8): `conversation_messages` byte-identical (§9-A9), `entities`, `emotion_state`,
      `entity_emoji_actions`, `interactions`, `sync_history` reconciled, `character_favorites` +
      `chat_conversation_settings` mirrored. RN-only index leaks: zero. (+ the `000043` placeholder pairing noted.)
- [ ] Grep sweeps (app `src/`): `CLIENT_ONLY|unread_count|chat_last_read_|chat_entity_pref_|getKeyLastRead` →
      zero; `blocked` → zero **scoped to the chat_conversation_settings concept only** (social blocking —
      `SocialService.getBlockedUserIds` and its ChatList/Discover/Characters consumers — STAYS, A4); `personas`
      repo imports → zero; `reply_to_message_id` present in engine models (spot-check)
- [ ] `gitnexus analyze` both repos; no stale warnings; `gitnexus_detect_changes()` clean-scope on the final commits

## Cross-repo integration smoke (on-device, manual — hand-off list)

1. Fresh install (or wiped dev DB) + engine branch build: seeder delivers `user` entity + "You" profile.
2. Chat round-trip: create AI partner → chat → react/pin a message → second device (or wipe+resync) sees
   reactions/pin/read-state via sync.
3. Unread derivation: partner message while app closed → badge appears after sync (the old bug); open → clears;
   "mark unread" → exactly 1.
3b. Copy-model integrity (A2): after a sync round-trip, an engine-authored partner message appears EXACTLY ONCE
   in ChatDetail and counts EXACTLY ONCE in unread (entity-scoped queries; catches the per-side-uuid duplication
   vector — WS copy + synced engine copy).
4. Reply-mode toggle in conversation menu → survives reinstall via sync.
5. Mute partner → outreach arrives in-chat, no push. Disable partner → chat blocked (engine `entity_disabled`),
   AIProfile can re-enable.
6. Personas: create from scratch + from card; switch "chatting as"; conversations per-persona; edit built-in "You"
   persona; delete custom persona (built-in delete refused).
7. Favorites + settings survive device re-pair (per-table backfill: second device receives full tables on first
   post-upgrade sync).
