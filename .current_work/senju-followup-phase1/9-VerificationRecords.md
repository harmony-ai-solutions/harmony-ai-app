# Phase 9 — Verification Gates, Records & Documentation

> Wrap-up of Phase 1. Produces the execution record (D5 convention), the two planning outlines, and the documentation updates required by workspace rules.

## 1. Full verification gates

```bash
npx tsc --noEmit                                   # 0 errors
npx jest --selectProjects unit --maxWorkers=45     # all green, incl. re-enabled entitySessionInitRecovery
npx jest --selectProjects integration --maxWorkers=45
npm run schema:dump -- --output schema/rn-schema.json
# engine side (read-only): cd ../harmony-link-private && go run . dump-schema
python scripts/compare-schemas.py <rn> <go>
npx gitnexus analyze
```

**Expected parity result (Phase-1 end state):** divergences = `conversation_messages` **narrowed D3** (`reactions_json` + `is_pinned` + `idx_conversation_messages_pinned`) + the 10 pre-existing cosmetic drifts + `device_push_tokens` Go-only. RN-only index leaks: **zero**. Anything else → investigate, do not paper over.

**Grep sweeps (all must be empty in src/):**
- deleted modules: `MarketplaceApiService|MarketplacePurchaseService|SoulbitsDefaultConfigService|UserProfileStore|acquireItem|itemSnapshots|librarySync`
- deleted repos: `repositories/marketplace|repositories/soulWallet|repositories/characterSocial|repositories/userSocial|repositories/contentLibrary|repositories/blockedContent`
- dropped concepts: `isChatLocked|canChatWithCharacter|confirmPurchaseIfNeeded|claimSignupBonus|reply_to_message_id|replyToMessageId|character_profile_sources|character_categories|CLIENT_ONLY` (last one: only the 3-entry set in dump-schema.ts remains)
- numeric-id stragglers: `imageId: number`

## 2. Record doc — `.current_work/senju-rebase-integration/13-Followup-Phase1-Record.md`

Per the D5 convention (10/11/12 records): per-phase what-changed/why, deviations from the phase docs (with reasoning), what was intentionally NOT fixed, gate outputs (parity excerpt incl.), the dev-DB-wipe note, and the standing decisions consumed (consolidation amendment, blocked_users → stub, MarketplacePurchaseService fold, blocked-column deferral).

## 3. `20-Backend-Concept-Marketplace-Profile.md` — OUTLINE (in the same directory)

Not the full design (that is its own round); capture what Phase 1 learned/locked:
- Real marketplace service (listings, search, moderation), wallet ledger (souls accounting, purchases), social graph, notifications + push (`device_push_tokens`), profile extension: `PATCH /v1/auth/me` += `username`/`bio`, avatar upload endpoint + `avatar_url` in responses (backend already accepts `display_name` only — extension, not redesign).
- The stub seam contract: for each service, the exact method surface + types shipped in Phase 1 = the client design input (first-party client pattern; wire shapes must keep `APIError.isQuotaError`, `soulCreditsAvailable`, `currentTier`, `upgradeUrl`, subscription sub-API).
- Publishing model (A4): upload-copy semantics; "created by others" = backend query (Discover).
- Open: offline caching (O9), moderation/blocking backend, pricing.

## 4. Phase-2 outline section (same record doc or summary addendum)

Engine track (LAST, own planning round — produces `21-Engine-Contract-Persona-Enums.md`):
1. **B1**: Go mirror migration for `conversation_messages` (`reactions_json`, `is_pinned`, read flags — shape O12) + engine ingestion/persistence → **D3 closes, parity gate green**.
2. **B2**: Go mirrors + app watermark-contract columns (`deleted_at`) + SyncService registration for `character_favorites`, redesigned `chat_conversation_settings` (unread → derived read-flags; her 3 parallel unread systems die); tags→categories sync path.
3. **B3**: `entities.entity_type` enum (P3/O1 naming), personas → user entities conversion (O8), engine lifecycle/emotion/proactivity = AI-only, user-entity prompt-injection symmetry + `rag_reindex_required` semantics (O13).
4. Engine-side ChatList consequences (F1/F8 event contract if needed).

## 5. Repo documentation updates (workspace rules)

- `CHANGELOG.md`: user-relevant entries per wave (no internals/constant names): marketplace/wallet/social/notification preview data; paywall gates removed; seeding revert behavior change (Disabled option back); chat-list fixes; fresh-partner chat reliability; editor consolidation; dev-build DB-wipe hint.
- `README.md` / `docs/`: update feature descriptions touched by the stub layer if they promise real marketplace/social functionality; `docs/schema-parity.md` — note narrowed D3 set + the 3-entry interim CLIENT_ONLY set with its Phase-2 expiry.
- Memory bank: update `.toon` files FIRST (`activeContext` @Focus new entry summarizing Phase 1; `progress`), then `.md` counterparts if they exist. Also check sibling repos' memory banks (harmony-link-private untouched this phase — app-only; note that explicitly).
- `.current_work/senju-followup-phase1/summary.md`: tick all Implementation Status boxes.

## Verification

- [ ] All gates green with expected outputs; no unexplained parity entries
- [ ] Record doc + outlines written; CHANGELOG/README/docs/memory bank updated
- [ ] Final `gitnexus_detect_changes()` on the docs commit
- [ ] Hand-off note to user: on-device smoke list (Market/Discover/Chat create→chat reliability/Editor round-trip) + pending coordination item (senju origin force-push window)
