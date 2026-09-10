# 12 — Verification Record (Phase 4 gates)

> All gates run on `senju-design-updates-rebase` @ `55d1fcd` (commits
> `790357c`/`e494fdb`/`add5062`/`55d1fcd`). Windows / PowerShell 5.1 —
> `npx`/`npm` were invoked as `npx.cmd`/`npm.cmd` because the `.ps1` shims are
> blocked by the local execution policy.

## GitNexus (per AGENTS.md)

- `npx.cmd gitnexus analyze` → **success** (12.7s; 7,101 nodes / 14,646 edges /
  181 clusters / 300 flows). Index refreshed at the start of Phase 3.
- `gitnexus_detect_changes` tool: **AVAILABLE** in this session — run before
  Commit A (staged: 3 symbols, medium risk, matched A's intent) and before
  Commit B (42 symbols, CRITICAL risk — expected for the schema-port commit;
  every changed symbol mapped onto the B checklist). The orchestrator may re-run
  it for an independent confirmation.

## Gate results

### 1. `npx tsc --noEmit` — **EXIT 2 — NOT 0 errors** (pre-existing, reported, not fixed)

```
src/screens/CharactersScreen.tsx(193,39): error TS2304: Cannot find name 'Animated'.
src/screens/CharactersScreen.tsx(204,5): error TS2304: Cannot find name 'Animated'.
src/screens/CharactersScreen.tsx(837,10): error TS2304: Cannot find name 'Animated'.
src/screens/CharactersScreen.tsx(878,11): error TS2304: Cannot find name 'Animated'.
src/screens/ChatDetailScreen.tsx(1696,7): error TS2304: Cannot find name 'ToastAndroid'.
src/screens/ChatDetailScreen.tsx(1696,62): error TS2304: Cannot find name 'ToastAndroid'.
src/services/__tests__/syncApplyFailureClearsSession.test.ts(162,16): error TS2341: Property 'currentSession' is private and only accessible within class 'SyncService'.
src/services/__tests__/syncApplyFailureClearsSession.test.ts(163,16): error TS2341: Property 'currentSession' is private and only accessible within class 'SyncService'.
src/services/cloud/__tests__/deviceAuth.test.ts(273,29): error TS2749: 'MockAPIError' refers to a value, but is being used as a type here. Did you mean 'typeof MockAPIError'?
```

**Classification (evidence-backed):** all 9 errors are pre-existing at the
rebase tip `53ba29a` — proven by `git diff HEAD` showing **zero** changes to
`CharactersScreen.tsx`, `syncApplyFailureClearsSession.test.ts`,
`deviceAuth.test.ts`, and a 2-line-only diff (scenario props wiring) in
`ChatDetailScreen.tsx` that does not touch the flagged regions. They are
Phase-2 conflict-resolution artifacts (union merges dropped the `Animated` /
`ToastAndroid` imports; two test files have type-level issues that Jest ignores
via babel transform). Per iron rule 3 ("no fixes beyond the playbook; STOP and
report"), they were **not fixed** and are flagged for orchestrator decision —
each is a 1-line fix in follow-up if authorized.

### 2. `npx jest --selectProjects unit --maxWorkers=45` — **NOT fully green** (pre-existing, reported, not fixed)

```
Test Suites: 4 failed, 80 passed, 84 total
Tests:       18 failed, 776 passed, 794 total
Snapshots:   14 passed, 14 total
```

**Failed suites — all pre-existing at `53ba29a` (verified in a worktree with a
node_modules junction; identical failure counts):**

| Suite | Pre-rebase (53ba29a) | After A–D | Root cause (pre-existing) |
|---|---|---|---|
| `components/chat/__tests__/ChatBubble.greeting.test.tsx` | 2 fail / 4 | 2 fail / 4 | test-env gap (unchanged) |
| `screens/__tests__/CharactersScreen.test.tsx` | 7 fail / 7 | 7 fail / 7 | runtime `Animated` ReferenceError (tsc group 1) |
| `screens/__tests__/chatDetailScenarioGenerate.test.tsx` | suite failed to collect (0 tests; `Cannot find module …/ChatInput`) | 5 fail / 8 (3 pass) | her ChatDetailScreen calls `useSafeAreaInsets()` at top level; test env has no SafeAreaProvider/mock. **B improved this suite** (mock retarget unblocked collection). |
| `components/character-card/__tests__/ProfileEditorSections.test.tsx` | 4 fail / 4 | 4 fail / 4 | test-env gap (unchanged) |

All 18 failures trace to the 4 pre-existing structural groups above (missing
imports + safe-area env + private-access/type issues). **None were introduced
by commits A–D.** Per Phase-4 instruction ("any red test outside D3: STOP,
investigate, report, do not fix") → investigated + reported, not fixed.

### 3. `npx jest --selectProjects integration --maxWorkers=45` — **GREEN**

```
Test Suites: 10 passed, 10 total
Tests:       1 skipped, 50 passed, 51 total
```
(Worker "failed to exit gracefully" warning = jest teardown noise, not a failure.)

### 4. Targeted suites (playbook risk table)

| Suite | Result |
|---|---|
| `chatDetailGreetingGate` | **PASS** — 1 suite / 4 tests |
| `chatDetailScenarioGenerate` | **RED** — 5 fail / 8 (safe-area env gap; pre-existing; see row above) |
| `DeviceAuthModal.render` | **PASS** — 1 suite / 7 tests |
| `cloudSessionPurge` | **PASS** — 1 suite / 7 tests |

### 5. Schema parity — **NOT the expected "exactly one divergence"** (STOP/report item)

Command used (go-schema.json is generated from the engine repo, not committed
in harmony-ai-app; docs/schema-parity.md workflow):

```
npm.cmd run schema:dump -- --output <temp>/merged-schema.json
cd ../harmony-link-private && go run . dump-schema   # sliced from first '[' line → <temp>/go-schema.json
python scripts/compare-schemas.py <temp>/merged-schema.json <temp>/go-schema.json
```

Result (Go baseline = harmony-link-private HEAD, 55 entries):

```
Summary:
  Total RN entries: 61     Total Go entries: 55
  Matching:         43
  RN-only:          7      Go-only: 1      Different SQL: 11
```

**Divergence breakdown (rebase-attribution via a pre-rebase control run — the
stale committed rn-schema.json vs the same Go dump showed `RN-only: 0,
Go-only: 2, Different SQL: 10`, i.e. the parity gate was ALREADY red before the
rebase):**

| Divergence | Origin |
|---|---|
| `table:conversation_messages` (her `reactions_json` / `reply_to_message_id` / `is_pinned`) | **D3 — pre-approved**, rebase-introduced |
| `index:idx_conversation_messages_pinned`, `index:idx_conversation_messages_reply_to` | Part of the D3 `conversation_messages` divergence (her migration 000046) |
| `index:idx_character_image_comments_image`, `idx_marketplace_ownership_listing`, `idx_notifications_recipient`, `idx_soul_purchases_profile`, `idx_user_post_comments_post` (5) | **Rebase-carried mechanism flaw** — her `CLIENT_ONLY_TABLES` excludes client-only TABLES by name only, so indexes on them leak into the dump. Present on her original branch by design; new relative to `feat/cloud-lifecycle`. **Not pre-approved — reported** (02-Followup's table drops remove them; not fixed per iron rule 3) |
| 10× "Different SQL" (`character_profiles` comment, `emotion_state` comments, `entities.alias DEFAULT ''`, `entity_emoji_actions` comments/DATETIME, `interactions` comments/FK, `lifecycle_state` comments, `memories` comments, `provider_config_soulbitscloud` comments, `sync_devices` comments, `sync_history` comments + `updated_at`) | **Pre-existing baseline drift** — present in the pre-rebase control run; mostly the cosmetic categories docs/schema-parity.md acknowledges (inline SQL comments, TEXT vs DATETIME, INTEGER vs BOOLEAN); not introduced by the rebase |
| `table:device_push_tokens` Go-only | **Pre-existing** — our 000039 is the reserved-number placeholder; RN deliberately never creates the table (engine-only). Present pre-rebase |

**Bottom line:** the only *rebase-introduced* parity divergence is
`conversation_messages` (D3, pre-approved) plus its 2 indexes (part of D3) and
5 client-only-table index leaks (her mechanism, rebase-carried). The other 11
entries were already divergent pre-rebase. The literal "exactly one divergence"
expectation does not hold in the script's output → **flagged per instruction;
nothing fixed.**

## Known-red items (consolidated)

1. **D3 (pre-approved):** `conversation_messages` — her 3 columns vs engine.
2. **tsc:** 9 errors / 4 groups — pre-existing Phase-2 artifacts (Animated,
   ToastAndroid, private `currentSession`, `MockAPIError` type).
3. **Unit:** 4 suites / 18 tests — all pre-existing (same root causes + safe-area
   env gap); `chatDetailScenarioGenerate` improved by B (0→3 passing).
4. **Parity:** beyond D3 — 5 client-only index leaks (rebase-carried) + 11
   pre-existing drift entries + `device_push_tokens` Go-only.

## No flake reruns needed
The 3 known better-sqlite3 flaky suites (`nodeSide`, `nodeDatabase.smoke`,
`cross-repo`) all PASSED in the full unit run — no reruns required this run.

## Gate command log (exit statuses)
| # | Command | Exit |
|---|---|---|
| 1 | `npx.cmd tsc --noEmit` | 2 (pre-existing errors, reported) |
| 2 | `npx.cmd jest --selectProjects unit --maxWorkers=45` | non-zero (4 pre-existing suites) |
| 3 | `npx.cmd jest --selectProjects integration --maxWorkers=45` | 0 (10/10) |
| 4a | `npx.cmd jest --selectProjects unit '--testPathPatterns=chatDetailGreetingGate'` | 0 (4/4) |
| 4b | `npx.cmd jest --selectProjects unit '--testPathPatterns=chatDetailScenarioGenerate'` | non-zero (5 pre-existing) |
| 4c | `npx.cmd jest --selectProjects unit '--testPathPatterns=DeviceAuthModal.render'` | 0 (7/7) |
| 4d | `npx.cmd jest --selectProjects unit '--testPathPatterns=cloudSessionPurge'` | 0 (7/7) |
| 5 | `python scripts/compare-schemas.py <merged> <go>` | 1 (drift; D3 + flagged items) |
| — | `npx.cmd gitnexus analyze` | 0 |
| — | `gitnexus_detect_changes` (before A and B) | available + run |
---

## Post-fix re-verification (after commits E/F/G, senju-design-updates-rebase @ fe1408f)

| Gate | Before (A–D) | After (E/F/G) |
|---|---|---|
| tsc --noEmit | 9 errors (6 rebase artifacts + 3 pre-existing) | **0 errors** |
| jest --selectProjects unit | 4 failing suites / 18 tests | **84/84 suites, 794/794 tests** |
| jest --selectProjects integration | 10/10 (50+1 skip) | **10/10 (50+1 skip)** |
| Targeted: chatDetailGreetingGate / DeviceAuthModal.render / cloudSessionPurge | 4/4 · 7/7 · 7/7 | unchanged green |
| Targeted: chatDetailScenarioGenerate | 5/8 (safe-area gap) | **8/8** |
| Parity (fresh dumps, compare-schemas equivalent) | RN-only 7 (5 index leaks + 2 D3), Different SQL 11 | **RN-only 2 (D3 indexes only), Different SQL 11 (conversation_messages = D3 + 10 pre-existing), Go-only 1 (device_push_tokens, known)** |

Root causes fixed in E (attribution):
- CharactersScreen missing Animated + ChatDetailScreen missing ToastAndroid — OUR code survived the §2.7/§2.4 unions, her import lines won (her originals use neither). Integration damage, not her bugs.
- 4 failing suites were harness gaps: our tests render her-augmented components without the now-required providers. Her ChatBubble renders ThemedText (ThemeContext); her screens call useToast/useAuth; her ChatInputBar uses safe-area insets; her filterBlockedCharacterProfiles (blockedContent repo) is called at the top of loadProfiles; her PersonaSwitcherModal needs navigation; her registerOpenConversation/unregisterOpenConversation need stubbing on the EntitySessionService mock.

Remaining known-red (unchanged, pre-approved):
- D3: conversation_messages (+ its 2 indexes) — closes in Track B1.
- 10× pre-existing cosmetic SQL drift + device_push_tokens Go-only (000039 reserved placeholder).
