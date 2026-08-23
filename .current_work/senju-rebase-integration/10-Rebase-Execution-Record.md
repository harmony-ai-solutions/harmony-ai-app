# 10 — Rebase Execution Record (Phases 0–2)

> Phase 0 (preconditions) + Phase 1 (replay) + Phase 2 (conflict resolution). Phases 3/4 are NOT performed here (integration commits A–D, verification gates) — out of scope per task.

## Replay stats

| Metric | Value |
|---|---|
| Command | `git rebase --onto feat/cloud-lifecycle 07f023900f269c73a3a4457cbc9256ec9ba297ff senju-design-updates` |
| Base | `feat/cloud-lifecycle` @ `fbab5ce` (= `969baf6` + planning-docs commit) |
| Commits replayed | **52 / 52** (`git log --oneline feat/cloud-lifecycle..senju-design-updates` = 52) |
| Authorship | `git log --format='%an' feat/cloud-lifecycle..senju-design-updates | sort -u` → **only `senjuLawliet`** |
| Conflict rounds | **29** commits required manual resolution (of 52); the other 23 applied cleanly |
| Stray conflict markers in any committed src/ hunk | **0** (`git log feat/cloud-lifecycle..senju-design-updates -p -- src/ | Select-String '^\+<{7} |^\+>{7} '` → empty) |
| Working tree | **clean** (`git status --porcelain` → 0 lines) |
| rerere | **NOT enabled** (per iron rule 1b — it was poisoned in a prior attempt; rr-cache empty; every conflict resolved manually) |
| Backups | `senju-design-updates-pre-rebase` @ `5204fb5`, `feat/cloud-lifecycle-backup` @ `969baf6` — untouched |

**Final commit:** `53ba29a` "added a lot of control over the listings in the market place" (her original message, `-c core.editor=true`).

---

## Conflict rounds (commit → files that conflicted)

| # | Commit | Conflicted files | Resolution (see playbook §) |
|---|---|---|---|
| 1 | `0cd9423` (4/52) | `memory-bank/activeContext.toon`, `src/database/__tests__/repositories/characters.test.ts`, `src/database/migrations.ts`, `src/screens/CharacterProfileEditScreen.tsx` | unions; §2.1/§2.12; import-list union |
| 2 | `4d377d4` (6/52) | `src/contexts/I18nContext.tsx` | union `scenario`+`market` (3 sites) — §2.12 |
| 3 | `eb9f1c4` (7/52) | `memory-bank/activeContext.toon` | union |
| 4 | `4935e0d` (9/52) | `activeContext.toon`, `memory-bank/progress.toon`, `src/screens/CharactersScreen.tsx` | unions; §2.7 empty-state union (ThemedEmptyState + hasActiveFilters) |
| 5 | `cedafea` (10/52) | `activeContext.toon` | union |
| 6 | `02f4ff3` (11/52) | `activeContext.toon` | union |
| 7 | `f18abc4` (12/52) | `src/database/migrations.ts`, `src/i18n/locales/en/chatDetail.json` | §2.1 (aliased imports 35s–38s); JSON key union |
| 8 | `35e9530` (14/52) | `CHANGELOG.md`, `activeContext.toon`, `progress.toon`, `src/components/characters/CharacterProfileCard.tsx`, `migrations.ts`, `src/i18n/locales/en/characters.json`, `src/screens/CharactersScreen.tsx` | §2.1 (39s); §2.7 (filteredProfiles AND-composition, empty-state variants, modal sets); §2.12 (card props, JSON concat) |
| 9 | `6c3484e` (15/52) | `CHANGELOG.md`, `activeContext.toon`, `src/screens/ChatDetailScreen.tsx` | §2.12 changelog (keep-hers-for-same-feature); §2.4 (isPartnerMessage import survives); whitespace strip in `ChatInput.tsx` (gate) |
| 10 | `7f0db6b` (19/52) | `src/components/chat/ChatInput.tsx` (modify/delete), `src/screens/ChatDetailScreen.tsx` | **§2.5: accept her deletion** (`git rm`); §2.4 (take her `ChatInputBar` + her View wrapper; re-mount our `ScenarioGeneratorSheet`; drop our `EmojiPickerInline` block + its import) |
| 11 | `411ee87` (20/52) | `CHANGELOG.md`, `activeContext.toon`, `src/screens/CharactersScreen.tsx` (4 regions), `src/screens/CreateAIScreen.tsx` | §2.7 (FAB sheet replaces speed-dial: drop `expanded`/`expandAnim`; import flow stays OURS; both modal sets mount); §2.8 (her CreateAI rewrite wins; carousel dropped) |
| 12 | `9339be6` (21/52) | `CHANGELOG.md`, `activeContext.toon`, `progress.toon`, `characters.json`, `src/screens/CreateAIScreen.tsx` | unions; §2.8 her duplicate-carryover payload verbatim |
| 13 | `631a8ff` (22/52) | `activeContext.toon`, `.snap`, `migrations.ts`, `src/screens/CharacterProfileEditScreen.tsx`, `src/screens/CharactersScreen.tsx` | §2.1 (41s); §2.7 (our import flow wins in `handleImportCard`; keep `openCharacterChat` import); whitespace strip in `characters.ts` (gate) |
| 14 | `1ad4880` (23/52) | `ProfileImagePicker.tsx` (modify/delete), `CharacterProfileEditScreen.tsx` (modify/delete), `ImageViewerModal.tsx` (deleted), `characters.ts`, `CreateAIScreen.tsx` | **D4: REJECT deletions** — kept all three editor-suite files in tree (ImageViewerModal restored via `git checkout HEAD --` even though our diff was empty, per D4 + final-tree requirement); §2.8 gallery-image handlers; her `getCharacterStats` distinct-participants version wins |
| 15 | `f095269` (24/52) | `.snap`, `migrations.ts`, `characters.ts`, `CharactersScreen.tsx` (4 regions) | §2.1 (42s); her search predicate (name-prefix) wins; sort-mode union; styles union |
| 16 | `f09573d` (25/52) | `activeContext.toon`, `progress.toon`, `.snap`, `migrations.ts`, `CharactersScreen.tsx` | §2.1 (43s); import union (+`deleteCharacterProfileCascade`) |
| 17 | `a0b3607` (27/52) | `activeContext.toon`, `src/contexts/SyncConnectionContext.tsx` | **§2.9**: keep our DeviceAuth/deep-link imports, drop `ToastAndroid/Platform/Alert` (her refactor removed their usage), keep `Linking` |
| 18 | `37abc7f` (31/52) | `activeContext.toon`, `.snap`, `migrations.ts`, `src/screens/ChatDetailScreen.tsx` | §2.1 (44s); her blocked-banner conditional + our `ScenarioGeneratorSheet` |
| 19 | `20c985a` (32/52) | `activeContext.toon`, `progress.toon` | unions |
| 20 | `b9762a5` (36/52) | `activeContext.toon`, `progress.toon` | unions |
| 21 | `99e462d` (38/52) | `activeContext.toon`, `.snap`, `migrations.ts` | §2.1 (45s, 46s) |
| 22 | `f45540a` (41/52) | `activeContext.toon` | union |
| 23 | `0670759` (44/52) | `CHANGELOG.md` | union (our bullets + her "forks" bullet) |
| 24 | `de9e194` (45/52) | `activeContext.toon`, `.snap`, `migrations.ts`, `CharactersScreen.tsx` | §2.1 (47s); import union (+`filterBlockedCharacterProfiles`) |
| 25 | `18fa3ec` (46/52) | `activeContext.toon`, `ChatDetailScreen.tsx` | her "blocked→disabled" rename wins |
| 26 | `98d0ec9` (47/52) | `ChatDetailScreen.tsx` (2 regions) | union (+`DayDivider`, `isSameCalendarDay`) |
| 27 | `f254648` (48/52) | `ChatDetailScreen.tsx` | union (+`INITIAL_SCROLL_SETTLE_MS`); **also repaired an unclosed `isSameCalendarDay` closer** (see deviations) |
| 28 | `63caaf3` (50/52) | `.snap`, `migrations.ts` | §2.1 (48s) |
| 29 | `5204fb5` (52/52) | 2× `.snap`, `migrations.ts` | §2.1 (49s); whitespace strip in `librarySync.ts` (gate) |

Clean-applying commits: `8a64b1f`, `8c4051c`, `e2a6ce7`, `611c927`, `1a79f4a`, `afbb5c5`, `cd821db`, `733084b`, `7a217fd`, `eeb9031`, `19b6dee`, `f09573d`+`3fd2b0b` (replayed clean after their conflict neighbors — i.e., every other commit of the 52), `45b6243`, `79ce509`, `a2833a2`, `23ceee9`, `900a8aa`, and the remaining marketplace tail that did not conflict. 23 of 52 applied with zero manual edits.

---

## Per-category resolution summary

- **`src/database/migrations.ts`** (conflicted at 8 commits): kept OUR versions 35–40 verbatim (engine-mirror contract; exact descriptions incl. the `000039` reserved placeholder and the `lifecycle_state sync columns (watermark contract)` wording). Her 15 migrations appended as duplicate-version registrations (35–49) with `s`-suffixed identifiers (`migration035s`…`migration049s`), her descriptions VERBATIM (`purge_leaked_persona_rows` kept as-is for commit A). NOTE comments added above her import block and her registration block. Single `];` closer. `check-migrations.js` → **OK** at every migration round and at the end.
- **`memory-bank/*.toon`** (activeContext 19×, progress 8×): pure union — drop 3 marker lines, keep both sides' entries (ours first). Her duplicated 08-08 progress line left untouched (dedupe is cosmetic, not ours).
- **`src/contexts/I18nContext.tsx`**: union — our `scenario` + her `market` in all three sites.
- **`src/database/__tests__/repositories/characters.test.ts`**: union of both describe blocks, each complete with closing `});` (I re-added our block's closer that git's marker layout had displaced).
- **`src/screens/CharacterProfileEditScreen.tsx`**: our file structure wins; her `setCharacterProfileSource` import + create-on-save tagging lines merged (once via content conflict, later via D4 rejection of her deletion).
- **`src/components/characters/CharacterProfileCard.tsx`**: union — our `onCreatorPress` + her `isFavorite`/`onFavoriteToggle` (interface + destructuring).
- **`src/screens/CharactersScreen.tsx`** (7 rounds): union per §2.7 — her filter-chip row (All/Favorites/categories dropdown) + our TagChips row + creator filter + sort mode; `filteredProfiles` AND-composes search + her activeFilter + our multi-OR tags + creator; her `ThemedEmptyState` variants (favorites/category/no-profiles) + our `hasActiveFilters` variant (filter-remove-outline + clear-filters); her FAB→CreatePartnerModal wins (our speed-dial dropped); import flow stays OURS (`parseCardFile`→ImportReviewSheet→persist/deep-link; her direct `importCharacterCardFromFile` call dropped); both modal sets mount.
- **`src/screens/ChatDetailScreen.tsx`** (7 rounds): §2.4 — her structure (ChatInputBar, MessageActionSheet, persona switcher, day dividers, blocked→disabled banner) with our greeting stack re-applied on top (isPartnerMessage import, AlternateGreetingSwiper + EmptyChatCTA pill branch, GreetingBubble preparing, `ScenarioGeneratorSheet` mount, generation helpers, `isReadyToShow` reveal composes with her `INITIAL_SCROLL_SETTLE_MS` settle). Her scroll-settle/`f254648` logic kept (fixes a bug our branch still had).
- **`src/components/chat/ChatInput.tsx`**: accepted her deletion at `7f0db6b` (§2.5) after one earlier union round (haptics/reply/scenario props).
- **`src/contexts/SyncConnectionContext.tsx`**: §2.9 — our device-auth gate + `DeviceAuthModal` + `soulbits://device-auth` deep-link + purge suppression (`purge:done/failed`, `isPurging()`, `PurgeInProgressError`) survive alongside her themed-toast refactor (which removed the now-unused `ToastAndroid/Platform/Alert`).
- **`src/i18n/locales/en/*.json`**: concatenation unions (`chatDetail.json` her `myPersonas` rename + our 5 greeting/scenario keys; `characters.json` our `lifecycle.*` object + her flat category/favorite/marketplace keys). JSON validated after each round.
- **`src/database/repositories/characters.ts`**: base ours; her additions merged; her `getCharacterStats` refinements (distinct participants) taken verbatim.
- **`src/screens/CreateAIScreen.tsx`**: §2.8 — her rewrite (3-section wizard, visibility selector, gallery images, duplicate/`prefillProfileId`) wins; our carousel code dropped with the deleted `ProfilePickerCard`; her save payload (`appearance`/`backstory`/`example_dialogues`) kept verbatim (strip is commit B, NOT mine).
- **`CHANGELOG.md`** (6 rounds): her structure; our bullets merged into matching sections; where both described the same feature, hers kept (updated wording), ours kept only when substantively distinct.
- **Migration snapshots / `rn-schema.json`**: took OUR side for `.snap` conflicts (6 rounds) — regenerated in commit C, never hand-merged.
- **Modify/delete (D4)**: `ProfileImagePicker.tsx`, `CharacterProfileEditScreen.tsx` (UD) → `git add` (keep). `ImageViewerModal.tsx` auto-resolved as clean deletion (we had zero diff vs merge-base) → restored via `git checkout HEAD --` + `git add` to satisfy D4/final-tree. `ChatInput.tsx` → accepted deletion. Plain deletions (`EntityConfigScreen`, `EntityConfigEditScreen`, `EntityCard`, `entityConfig.json`, `SettingsMenu`, `navigation.json`, `SearchScreen`, `EmojiActionEditor` suite) accepted silently.
- **Auto-merged and verified**: `AuthContext.tsx`, `models.ts`, `sync.ts`, `EntitySessionService.ts`, `ChatBubble.tsx`, `AndroidManifest.xml`, `CharacterCardImportService.ts`, `entities.test.ts` — both sides' changes present where required.

---

## Deviations from the playbook (flagged)

1. **rerere NOT enabled** — playbook §0.2 says enable it; the task's iron rule 1b overrides (rr-cache was poisoned in the previous attempt). Every recurring conflict was re-resolved manually per the proven patterns. No behavioral difference in outcome.
2. **Whitespace stripping in her code (3 instances)** — the mandatory `git diff --cached --check` gate requires ZERO output, and her newly-added lines in `ChatInput.tsx` (blank-line with spaces), `characters.ts` (`getCharacterStats` section), and `librarySync.ts` (EOF blank line) tripped it. Stripped trailing whitespace on those blank lines only — no semantic change; two of the three files are marketplace/bubble code her own later commits or Phase 3 handle anyway. This is a minimal, non-semantic edit required by the iron gate.
3. **`ImageViewerModal.tsx` restored despite no modify/delete conflict** — the task list implied all three editor files conflicted as modify/delete; git evidence showed we had zero diff vs merge-base on `ImageViewerModal.tsx` (clean deletion). Restored it anyway to honor D4 and the Phase-2 exit criteria (file must exist in tree).
4. **Closer repair in `ChatDetailScreen.tsx`** — at `98d0ec9` my oldString consumed the shared `  );\n}` that closed `isSameCalendarDay`; caught it at the next round (`f254648`) when the function appeared unclosed, and re-emitted the closer as part of that round's resolution. Final file verified balanced.
5. **Unused imports left in place** (`deleteCharacterProfile` in CharactersScreen after her cascade switch; our `createCharacterProfile`/`createCharacterImage` remain for the OURS import flow) — intermediate commits need not compile; lint/`noUnusedLocals` cleanup is Phase 3 material per plan.
6. **`EmojiPickerInline` import dropped** with its render block at `7f0db6b` (rather than keeping an orphaned import) — consistent with §2.4 "block gets dropped"; noted here for completeness.

## Gate results

| Gate | Result |
|---|---|
| Conflict-marker scan per round (`Select-String '^(<{7}|={7}|>{7})'`) | 0 markers before every `--continue` |
| `git diff --cached --check` per round | **empty / exit 0** after the 3 whitespace strips noted above |
| `check-migrations.js` (all migration-touching rounds + final) | **OK** |
| JSON validity (`JSON.parse`) for characters.json / chatDetail.json | valid after each resolution |
| Final tree: `isPartnerMessage` export in `ChatBubble.tsx` | present (line 25) |
| Final tree: `isPartnerMessage` import in `ChatDetailScreen.tsx` | present (line 38) |
| Final tree: `<ScenarioGeneratorSheet>` in `ChatDetailScreen.tsx` | present (line 46 import; mount at file tail) |
| Final tree: `purge:done`/`purge:failed`/`isPurging`/`PurgeInProgressError`/`soulbits://device-auth`/`deviceDeepLink` in `SyncConnectionContext.tsx` | present |
| Final tree: our migrations 35–40 exact descriptions + her 35–49 registrations verbatim, `migration039s`-style aliases | present |
| Final tree: `CharacterProfileEditScreen.tsx` + `ProfileImagePicker.tsx` + `ImageViewerModal.tsx` exist | all True |
| Final tree: `ChatInput.tsx` gone | True (deleted) |
| Working tree clean | yes (0 entries) |

## Hard stops respected

- ✅ No Phase 3 (integration commits A/B/C/D) — no renumbering, no schema port, no snapshot regeneration, no test skip.
- ✅ No Phase 4 verification gates run (`tsc`/jest/schema-parity).
- ✅ No push / force-push / origin touched.
- ✅ rerere never enabled; rr-cache untouched.
- ✅ No reword/squash/drop of any of her 52 commits (`-c core.editor=true` preserved all messages).
- ✅ No follow-up work from `02-Followup-Stub-Plan.md`.
- ✅ No fixes for registered bugs during replay (kept her `purge_leaked_persona_rows` description, her `appearance`/`backstory`/`example_dialogues` payload, her marketplace fake-success flows, her `ensureSoulbitsDefaultConfigs` seeding — all deferred by design).
- ✅ No code edits via PowerShell text munging — every resolution used the Edit/Write tools; bash used only for git inspection.