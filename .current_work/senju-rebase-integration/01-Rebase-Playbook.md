# 01 — Rebase Execution Playbook

> Objective: replay all 52 commits of `senju-design-updates` onto `feat/cloud-lifecycle` (`969baf6`), preserving her UI work and bugfixes verbatim. Fixes beyond "make the rebase land and the app boot" are **out of scope** (they live in 02-Followup-Stub-Plan). Per D5, every phase produces a record doc in this directory.

## Guiding rule

During replay: **her code wins verbatim wherever it exists; our code wins only where she never touched the region.** The only permitted modifications are the integration commits in Phase 3 (A: migration renumbering, B: schema-compat porting, C: generated artifacts) — the minimum for build/boot/no-DB-corruption. All identified bugs/pattern violations are preserved as-is and deferred.

---

## Phase 0 — Preconditions

```powershell
# 0.1 Safety backups (her origin branch stays untouched until coordinated force-push)
git branch senju-design-updates-pre-rebase senju-design-updates
# feat/cloud-lifecycle-backup already exists at 969baf6 (verified)

# 0.2 Rerere learns repeated resolutions (conflicts concentrate in ~6 files)
git config rerere.enabled true

# 0.3 Working tree must be clean (verified clean at analysis time); abort if not
git status
```

**Coordination note:** after the rebase, `senju-design-updates` on origin must be force-pushed. Agree with senju on a time window and tell her to not build on the old tip meanwhile. Do **not** push without explicit go.

## Phase 1 — Rebase replay

```powershell
git rebase --onto feat/cloud-lifecycle 07f023900f269c73a3a4457cbc9256ec9ba297ff senju-design-updates
```

Expected: conflicts start around her commit `0cd9423` (first migrations.ts/snapshot touch) and recur through the marketplace series. ~18 files total (15 content + 3 modify/delete, see 00-Research §2). With rerere, each recurring resolution is auto-applied after its first occurrence.

**Fallback (only if replay proves untractable):** interactive rebase with fixups of her self-correcting micro-commit chains (`733084b`→`411ee87`, `98d0ec9`/`900a8aa`/`f254648` onto their subjects, `eeb9031`→`9339be6`). Requires user sign-off first — D1 says full replay.

## Phase 2 — Conflict resolution playbook

Resolution order matters; suggested order below minimizes rework. For every file: her structure wins; our features re-apply on top.

### 2.1 `src/database/migrations.ts` 🔴

- Keep **our** 35–40 entries verbatim (engine 1:1 mirror; 000039 is the reserved-number placeholder — must not shift).
- Her 35–49 registrations: during replay, resolve by keeping **both** import blocks and registration arrays (intermediate commits won't run tests; only final state matters). Final registration cleanup happens in integration commit A (Phase 3).
- Her `000038` entry description says `purge_leaked_persona_rows` while the file is `cleanup_leaked_persona_rows` — fix the description string in commit A (cosmetic accuracy).

### 2.2 `src/database/repositories/characters.ts` 🔴

- Base = **ours** (V3 column set, UUID image functions — matches merged schema).
- Port her additions (source/visibility getters+setters, `getUserCharacterProfiles`, `getCommunityCharacterProfiles`, `getPublicCharacterProfiles`, `deleteCharacterProfileCascade`, favorites/categories functions, `getSiblingCharacterProfiles`, `getCharacterStats`) replacing every `appearance`/`backstory`/`example_dialogues` reference with the V3 column set. This port is integration commit B material; during replay, resolving toward ours + minimal her-additions compile is acceptable, final correctness in B.

### 2.3 `src/database/models.ts` (auto-merge risk)

- Take ours wholesale; her `ConversationMessage` additions merge alongside our `'greeting'` union member. Both sides' edits are disjoint here — verify both survived.

### 2.4 `src/screens/ChatDetailScreen.tsx` 🟠

- Base = **her** rewrite (she owns the structure: `ChatInputBar`, `MessageActionSheet`, persona switcher, day dividers, keyboard lift, scroll-settle).
- Re-apply our block on top: greeting render branch (`isPartnerMessage` + opening-greeting → `AlternateGreetingSwiper` + scenario pill), `GreetingBubble`/`GreetingShimmer` preparing state, `ListEmptyComponent` + `EmptyChatCTA`, `<ScenarioGeneratorSheet>` + `performGenerateGreeting`/`performScenarioRestart`/`handleRegenerateGreeting`, partner-profile loading (`hasFirstMes`, `partnerProfile`).
- Her scroll-settle logic (`f254648`) replaces our divider-index initial-scroll target — **take hers**, it fixes a bug our branch still has; verify our greeting reveal (`isReadyToShow`-class logic) composes with her settle interval.
- Route calls: her deletions removed `EmojiActionEditor` navigation (fine — our call sites lived in code she replaced); verify no survivor navigates to removed routes.

### 2.5 Modify/delete: `src/components/chat/ChatInput.tsx` → `ChatInputBar.tsx` 🟠

- Accept her deletion of `ChatInput.tsx`.
- Port our scenario trigger: add optional `showScenarioButton?: boolean` / `onScenarioPress?: () => void` props to her `ChatInputBar`, rendering our `EmptyChatCTA variant="icon"` beside the mic when the input is empty (integration commit B; smallest structural delta).
- Update our `chatDetailScenarioGenerate.test.tsx` mock target from `ChatInput` to `ChatInputBar` (commit B).

### 2.6 Modify/delete: `src/screens/CharacterProfileEditScreen.tsx` + `ProfileImagePicker.tsx` + `ImageViewerModal.tsx` 🔴 (D4)

- **Restore our versions of all three files** (reject her deletion). They host the entire RP editor suite (Lorebook, Greeting, AlternateGreetingsManager, LifecycleConfigEditor, ImportReviewSheet, Export via pngWriter, MacroHighlighter, TagChips, SheetModal, lorebook barrel).
- Per D4: kept **unlinked from her UI** — for immediate comparison only.
- **Q-D4a (APPROVED — senior dev, proof-read round): register the `CharacterProfileEdit` route** (prevents runtime route-not-found and keeps our import-review feature intact — it's our branch's feature, her UI never links it either way) with a `// D4: comparison-only, unlinked from primary UX` comment.
- Also restore `EntityConfigEdit` route **only if** a survivor navigates to it (check `EntityConfigEditScreen.tsx` survival — she deleted the screen; if only our restored editor referenced it via cross-link, the link target must be resolved — verify during B and either restore the screen or drop the cross-link with a TODO).

### 2.7 `src/screens/CharactersScreen.tsx` 🟠

- Union merge: her filter row (All/Favorites/`CategoryFilterDropdown`) **and** our TagChips + creator-filter rows (stacked or wrapped).
- `filteredProfiles`: combine both predicates (search + her favorites/categories + our tag-OR + creator).
- Import flow: **ours supersedes** (`parseCardFile` → `ImportReviewSheet` → persist/deep-link); drop her direct `importCharacterCardFromFile` call.
- Card tap behavior: hers (AIProfile / duplicate-picker). Long-press menu: hers.

### 2.8 `src/screens/CreateAIScreen.tsx` 🟠

- Base = her rewrite (collapsible sections, fork flow, visibility/marketplace, module pickers).
- Strip `appearance`/`backstory`/`example_dialogues` from her form state and save payload (integration commit B — required, not optional: her save path would write dropped columns).
- Her `ensureSoulbitsDefaultConfigs` auto-fill stays **as-is** (its revert is follow-up Track B/D per decisions — do not "fix" during rebase).

### 2.9 `src/contexts/SyncConnectionContext.tsx` 🟠

- **Both must survive.** Ours: device-auth gate + `DeviceAuthModal`, `soulbits://device-auth` deep-link handling (cold+warm), purge suppression (`purge:done`/`purge:failed` listeners, `isPurging()` connect guard, `PurgeInProgressError` in connect catch). Hers: `readOnly` mode (floating chat) + themed-toast `showToast` helper.
- **What her two changes do (kept verbatim, per proof-read Q):**
  - **`readOnly` mode** (`20c985a`): a provider flag consumed by `FloatingChat` (the bubble window's second React root). When `readOnly` is active, the context's main connect/reconnect effect **early-returns**, so the floating window can *read* connection state and receive updates without triggering a full connect cycle — and, critically, without its unmount tearing down or re-provisioning the main app's connection. It is load-bearing for the bubble feature; that's why it survives.
  - **Themed toast refactor** (`a0b3607`): a `showToast` helper replacing `ToastAndroid`/`Alert` usage. It holds a ref to the themed toast component (rendered above modal windows — `TopToastModal`), so toasts triggered from background contexts (reconnect events, failures) match the app design instead of Android-native toasts. It survives because our purge flow already routes through the same helper — both branches converged on it independently.
- Semantic check (manual, after textual merge): her `readOnly` early-return in the main effect must not skip registration of our purge listeners / deep-link handlers. Toast behavior converges (both use `showToast`) — only the import line conflicts (`ToastAndroid/Platform/Alert` removal vs our `Linking` addition).

### 2.10 `src/contexts/AuthContext.tsx` (auto-merge, verify)

- Ours: `DeviceAuthService.registerDevice()` in the `auth:changed` listener. Hers: `signInVersion`, `claimSignupBonus()` in `registerAction`, marketplace library hydration effect. Disjoint regions — verify all four survive; her signup-bonus and hydration stay as-is (follow-up removes them).

### 2.11 `EntitySessionService.ts` (auto-merge, verify)

- Ours: generation API (`generateGreeting`, `startNewScenario`, `handleGenerationResponse`, `pendingGenerations`, `hasFirstMes`). Hers: `replyToMessageId` param + `assertNotDisabled` in `sendTextMessage` (+ audio/image), `forwardTextMessage`, unread/open-conversation registry, blocked/disabled overrides.
- Both add cases near the top of `handleEntityEvent` — order matters: her generation-response handling returns **before** the session-required guard (keep her ordering; our GENERATE_GREETING/START_NEW_SCENARIO responses route the same way).

### 2.12 Trivial resolutions

- `CharacterProfileCard.tsx`: take both (our creator attribution row + her favorite heart / SOUL price pill).
- `ChatBubble.tsx`: take both; keep our exported `isPartnerMessage` (our tests import it); her reply header + reactions bar merge into props.
- `I18nContext.tsx`: our `scenario` namespace addition + her removals (`search`, `entityConfig`, `navigation`) + her `market` addition. Post-merge grep for `useTranslation('search'|'entityConfig'|'navigation')` — should be zero survivors.
- `characters.json` / `chatDetail.json`: concatenate key sets; her replacement of `myIdentitySettings`→`myPersonas` keys applies (our 5 greeting/scenario keys preserved); watch for duplicate keys.
- `AndroidManifest.xml`: auto-merges (her overlay/FGS additions, our device-auth intent-filter are in different sections). Verify both present.
- `CHANGELOG.md`: her structure, our bullets merged into matching sections.
- `memory-bank/*.toon`: union; ours-first for `@Focus`, append-dedupe hers (her branch has one duplicated 08-08 line).
- Migration snapshots + `schema/rn-schema.json`: **do not hand-merge** — resolve by taking either side; commit C deletes and regenerates.

## Phase 3 — Integration commits (the only allowed "fixes")

### Commit A — `chore(db): renumber senju migrations 000035–000049 → 000041–000055`

1. `git mv` each of her 15 migration files (+6); update `export const migrationNNN` names inside.
2. `migrations.ts`: replace her registrations; final array = base 1–34, ours 35–40, hers 41–55 (internal order unchanged — dependency chain verified safe under uniform shift, 00-Research §3.2).
3. Update literal version references in doc comments: `000046`-renumbered header ("Migration 000043 added…" → new number), `characters.ts` "pre-000043" comment, `models.ts` "Migration 40" comment. (Cosmetic; do them here so the history shows one coherent renumber.)
4. Keep her `CLIENT_ONLY_TABLES` in `dump-schema.ts` as-is (name-based, unaffected).

### Commit B — `fix: port senju code to cloud-lifecycle schema (V3 columns, UUID image ids, routes, scenario props)`

1. Her repo functions ported to V3 column lists (§2.2 final state).
2. `CreateAIScreen` form/save payload: legacy columns removed.
3. `number → string` image-id widening: `characterSocial.ts` (all `imageId: number` params), `AIProfileScreen` image flows, her test fixtures asserting numeric ids.
4. Renumbered-47 content fix (her `000041_add_character_social`; flagged, pre-approved): `character_image_likes.image_id INTEGER PRIMARY KEY` / `character_image_comments.image_id INTEGER` → `TEXT` (rowid-alias PK rejects UUID inserts — the FK is unusable as written against our 000035; her migration has never shipped, editing it is safe and required for boot).
5. Route mending: register `CharacterProfileEdit` per Q-D4a default; resolve `EntityConfigEdit` cross-links (restore-or-drop with TODO).
6. `ChatInputBar` scenario props + `EmptyChatCTA` mount; update `chatDetailScenarioGenerate.test.tsx` mock.
7. Her test fixtures: update `CharacterProfile` constructions (no `appearance`/`backstory`/`example_dialogues`, non-null strings) across `characters.test.ts`, `characterSocial.test.ts`, `cross-repo.test.ts`, `userSocial.test.ts`, etc. — preserve her test *intent*, port the fixtures.

### Commit C — `chore: regenerate schema dump + migration snapshots`

1. Delete both `.snap` files; `npx jest --selectProjects unit --testPathPatterns migrations -u`.
2. `npm run schema:dump -- --output schema/rn-schema.json`.
3. Inspect snapshot diff (should show: ours 35–40 + her renumbered 41–55; `conversation_messages` with her 3 columns — the known D3 divergence).

### Commit D — D2 skip

1. `git mv src/services/__tests__/entitySessionInitRecovery.test.ts src/services/__tests__/entitySessionInitRecovery.test.ts.skip`
2. Add `// TODO(followup Track E): implement INIT_ENTITY recovery per this spec; re-enable by renaming back. See .current_work/senju-rebase-integration/02-Followup-Stub-Plan.md §Track E.`
3. `entitySessionInitRecovery.test.ts.skip` is not picked up by Jest — CI green again.

## Phase 4 — Verification gates

```powershell
npx tsc --noEmit                 # catches number/string widening + fixture stragglers
npx jest --selectProjects unit
npx jest --selectProjects integration
npm run schema:dump > merged-schema.json
python3 scripts/compare-schemas.py merged-schema.json schema/go-schema.json
```

Expected parity result (D3): **exactly one** divergence — `conversation_messages` (her `reactions_json`/`reply_to_message_id`/`is_pinned` vs engine). Any other divergence = investigate before proceeding.

Per AGENTS.md: run `gitnexus_detect_changes()` before each commit; after the rebase completes, the GitNexus index is stale (new commit shas) — expect warnings and re-run `npx gitnexus analyze` before relying on graph tools for follow-up work.

**Record docs (D5):** create `10-Rebase-Execution-Record.md` (replay stats, rerere resolutions, any deviations from this playbook), `11-Integration-Commits-Record.md` (A/B/C/D contents + reasoning + what was intentionally NOT fixed), `12-Verification-Record.md` (gate outputs, parity diff excerpt, known-red items).

## Risks & abort paths

| Risk | Mitigation |
|---|---|
| Replay too noisy mid-phase | rerere + this playbook's per-file rules; escalation = interactive fixup fallback (needs sign-off, D1) |
| Semantic merge mistakes in ChatDetailScreen / SyncConnectionContext | the two files get a dedicated manual review pass + targeted test runs (`chatDetailGreetingGate`, `chatDetailScenarioGenerate`, `DeviceAuthModal.render`, cloudSessionPurge) |
| Hidden assumption in her code on numeric image ids beyond known files | `tsc --noEmit` gate; grep `imageId: number` + `insertId` post-merge |
| Her `chatConversationSettings` repo assuming `blocked` column semantics | her 18fa3ec kept the column; no action needed (verified comment-only edit) |
| Anything unrecoverable | `senju-design-updates-pre-rebase` + `feat/cloud-lifecycle-backup` branches; `git rebase --abort` until Phase 3 begins |

## Explicitly NOT done in the rebase (deferred to 02-Followup)

All §10-register bugs (fake-success flows, doAcquire finally, recording discard, dead show() check, background WS, f45540a seeding revert, image churn, alias guard), all stub work, all engine-parity migrations, persona redesign, editor consolidation, recovery implementation, logout cache clear.
