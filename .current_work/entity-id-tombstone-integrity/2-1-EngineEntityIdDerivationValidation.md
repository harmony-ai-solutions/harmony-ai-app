# 2-1 — Engine: Entity ID Derivation & Derived-Only Creation

## Objective

Implement decision **D2** engine-side: timestamped default id derivation at every creation seam, and — per
review-3 rulings **D22/D23** — **derived-only creation**: ids are minted by construction and locked from
birth. There is no explicit-id mode, no charset validation surface at runtime (D20 moot), and no rename
(D22). Resolves ledger **N3** (charset, by construction) and **N4** (by removal — see 2-1b).

## ID Schema (binding, matches summary.md D2/D3; creation is derived-only per D23)

```
id        := base "-" timestamp
base      := slug(displayName)           // runs of [^A-Za-z0-9] → single "-", trim edges, cap 48 chars
                                             empty → "entity"
timestamp := YYYYMMDDHHMMSS in UTC       // second precision
exempt    : built-in ids — "user" (D10), "claire"/"default-user-profile" seeds (D31)
```

Example: card "Isabella" created 2026-09-05 12:35:14 UTC → `Isabella-20260905123514`.
Derived-id collisions within the same second fall through to the existing ghost-aware
`dedupe_id_if_taken` in-transaction next-free resolution (`base-N` series — keep exactly as-is).
The charset regex survives **only** inside 3-1's migration as the "already-conforming" detector.

## Implementation Steps

1. **Shared derivation helper** in the engine (e.g. `database/controllers/entity_controller.go` next to
   `ResolveEntityID`): `DeriveEntityID(name string, t time.Time) string` per the schema above (UTC
   formatting). Unit-test the slug rules: `"Isabella 2" → "Isabella-2"`, `"  Max  2 " → "Max-2"`,
   `"«Zoë»!!" → "Zo"…"` (non-ASCII strips to `-` boundaries), empty → `entity`. (6-1 §1 vectors pin this
   function — they are 2-1-only post-D40.)
2. **Management API `POST /api/entities`** (`management/routes_entities.go`) — **derived-only wire contract
   (D15 as amended by D23)**:
   - **D66 (review 5 — final shape):** `{ name, character_profile_id?, entity_type?, dedupe_id_if_taken: true }` —
      the ONLY mode: `name` required (400 otherwise; human name, may contain spaces — never
      charset-validated), id derived via `DeriveEntityID(name, now)` before in-transaction next-free
      resolution; 201 echoes the resolved id. `entity_type` stays optional exactly as today
      (`routes_entities.go:184`) — persona creates depend on it (`entityService.js:94` sends
      `entity_type: 'user'`; dropping it would collapse the ai/user split). Today's route takes `id`
      (**required**, `:182`) + optional `alias` (`:185`): requests carrying `id` **or `alias`** now →
      `400 'id and alias are server-assigned at creation'` (alias editable afterwards via `updateEntity`).
      *(Implementation: route through the existing `CreateEntityWithAliasResolved` spine,
      `entity_controller.go:105-118`; note `DuplicateEntity` does NOT share it — it calls `ResolveEntityID`
      + `CreateEntity` directly (`:280`), which is where the D52 swap lands — review-5.)*
   - `duplicate` (`POST /entities/:id/duplicate`): derived id via **`DeriveEntityID(source display name,
     now)`** — display name = `alias` if set, else linked profile name, else id (**D63, review 5:
     deliberately decoupled from 3-1's migration source `alias → old id → profile` — runtime duplicates
     live in the post-migration world where ids are timestamps; migrations deal with legacy ids-as-names**),
     with `dedupe_id_if_taken` backstop. **D52 (review 4 — behavior change):** this REPLACES
     the copy-series `ResolveEntityID(src.ID)` mechanic from ed517ea (`Max-2` → now `Max-<ts>`); the old
     "duplicate derivation intact" checklist line is void. Alias stays copy-suffixed via `ResolveAliasCopy`
     (existing `DuplicateEntity` path — the D52/D56 tie-in).
   - **Rename route deleted** (D22 — owned by 2-1b).
3. **Alias population (D15 + D30):** `alias` defaults to `name` on derived create. If the alias collides
   with a **live** entity's alias (`enforceAliasUniqueness`, definition `routes_entities.go:82-93`,
   create-path call `:233-242`), **auto-suffix via existing `ResolveAliasCopy`**
   (`entity_controller.go:209-244`): live twin `Isabella` → alias `Isabella 2`. Create never 400s on a
   name collision. **(Review-7 precision: uniqueness is enforced by BOTH the query guard AND the DB
   partial unique index `idx_entities_alias_unique` (`000018:5`, recreated `000042:31`) — tombstoned
   aliases never block (partial index); the guard also runs on UPDATE (`:315-331`) and residual
   constraint races map to 400 via `isEntityUniqueConstraintConflict`.)**
4. **Seeds (D31, seed-time scope pinned review 7):** `claire` (`config/db/init.go:132`) and
   `default-user-profile` (`:289`) keep their raw ids **at seed time** — documented exempt built-ins
   like `user`; no per-install derivation churn. The seed path needs no new machinery. **(Existing
   installs' `claire` is migrated by 3-1's 000045 like any non-conforming id — review 7 user ruling;
   only `user` is migration-exempt. `default-user-profile` is a profile id — unaffected.)**
5. **`EntityConfig` payload note**: keep the phase-2 contract (profile embedded as `character_profile`; 201
   echoes the **resolved** id) — the FE depends on the echo (record decision 1).

## Review-3 Amendments

- Explicit-create mode and rename validation are **deleted** (D22/D23); the charset/reserved 400s on
  create/rename no longer exist at runtime. Reserved ids remain relevant only as: `user` exempt (D10),
  `deleted` reserved as belt-and-braces (the 5-1 deleted-list route is deleted with Phase 5 — review 6 —
  but the reservation stays cheap future-proofing), and app-side **name** checks (D33).
- Test-suite precision: "33 tests" = `routes_entities_test.go` specifically; the management package has
  39 (extend the entity file).

## Files to Modify

- `database/controllers/entity_controller.go` (`DeriveEntityID`; derived create/duplicate paths; alias
  auto-suffix via `ResolveAliasCopy`)
- `management/routes_entities.go` (derived-only contract, 400-on-`id`, alias default + suffix)
- Seed path `config/db/init.go` — documentation comment only (D31)

## Tests (extend `routes_entities_test.go`'s 33; management package totals 39)

- Derivation unit tests (slug rules, UTC, cap — the 6-1 §1 vector list).
- Create `{ name, dedupe_id_if_taken: true }` → id matches `Name-YYYYMMDDHHMMSS` (clock seam injected);
  `name` missing → 400; **request carrying `id` or `alias` → 400 'server-assigned'** (D23/D66).
- `alias` defaulted to `name`; live same-name twin → alias `Isabella 2` (D30); tombstoned twin → no suffix.
- Same-second id collision → `Name-YYYYMMDDHHMMSS-2` (next-free series; ghost-aware).
- **Duplicate derives `Name-YYYYMMDDHHMMSS` from the source display name (D52 — copy-series replaced);
  alias copy-suffixed (`ResolveAliasCopy`).**
- Rename endpoint absent (covered in 2-1b).

## Codebase Mapping Consulted

`harmony-link-private/.planning/codebase/`, senju record decisions 1–3 + ledger N3/N4, plan reviews 1–3.

## Checklist

- [x] `DeriveEntityID` + unit tests (6-1 §1 vectors — all 7 pinned; UTC/clock-seam rule; slug edge cases)
- [x] Derived-only create contract (400 on `id`/`alias`; `name` required; reserved `user`/`deleted` → 400; alias default + auto-suffix D30)
- [x] Duplicate derivation switched to `DeriveEntityID` (D52 — copy-series replaced; D63 display-name chain); rename route deleted (2-1b, verified absent)
- [x] Seed exemptions documented (D31, seed-time scope)
- [x] Tests green; phase doc updated

## Implementation Notes (deviations)

All deviations below are "adapt + note" class — every sub-item was implemented; none required a stop.

1. **Slug-rule pin (orchestrator-ruled, adopted):** `DeriveEntityID` preserves `[A-Za-z0-9._-]`
   verbatim, collapses runs of everything else to a single `-`, trims non-alphanumeric edges, caps
   the base at 48 chars, and falls back to `entity` — matching the app-side reference
    (`entityIdUtils.ts`) and the 6-1 §1 vectors. **CORRECTION (orchestrator, verified by execution):**
    the initial claim that the app's code fails `(a) "  Max  2 "` and `(b) "--__--"` was a MISREAD of
    the app implementation — `slugifyEntityName` collapses runs (`[^A-Za-z0-9._-]+` → `-`, the `+`
    collapses `Max··2` to `Max-2`, never `Max--2`) and its `EDGE_NON_ALNUM` trim (`^[^A-Za-z0-9]+|…`)
    consumes `--__--` entirely → `entity` fallback. Executed vectors (tsx): `Max-2` ✓, `entity` ✓,
    `Isabella-2` ✓, `Zo` ✓, `a.b_c-d` ✓ — **both implementations pass the identical 6-1 §1 vectors;
    no 2-2 fix needed; cross-repo parity confirmed.**
2. **`stripIDCopySuffix` learned the timestamp shape:** the phase doc's "keep the ghost-aware
   `dedupe_id_if_taken` mechanism exactly as-is" cannot be satisfied literally together with the 6-1
   §1 backstop vector ("never stripping the timestamp suffix": taken `Isabella-20260905123514` →
   `Isabella-20260905123514-2`, never `Isabella-2`). The as-is resolver strips ANY trailing digit
   run, so it would strip the timestamp. The in-tx existence probe + series walk + ghost-awareness
   are kept as-is; only the suffix classifier now treats a trailing 14-digit run (YYYYMMDDHHMMSS) as
   part of the derived base and never strips it. `Name-<ts>-2` taken → `Name-<ts>-3` works.
3. **Clock seam:** added exported `controllers.Now` (var, `time.Now` default) as the derivation
   clock; `handleCreateEntity` and `DuplicateEntity` route through it; tests pin it to
   `2026-09-05T12:35:14Z` via a `fixedDeriveNow` helper (t.Cleanup restore). `DeriveEntityID`
   always formats `t.UTC()` — the +02:00 timezone vector is covered at the function level.
4. **`dedupe_id_if_taken` stays opt-in** (absent/false → loud 400 on a same-second derived-id
   collision; true → in-tx next-free resolution). D66's "the ONLY mode" is read as the FE always
   sending `true`; the flag semantics are preserved per the phase doc's "keep exactly as-is".
5. **201 echo:** `alias` now echoes the RESOLVED alias (defaulted to name / auto-suffixed);
   `entity_type` echoes the raw request value as before; the slim create echo keeps
   `character_profile_id` (the "profile embedded as `character_profile`" note refers to the
   `EntityConfig` payload of GET/list, not the create 201).
6. **Obsolete/rewritten tests:** 6 pre-D23 create tests and 5 duplicate tests were rewritten to the
   derived-only contract (the old explicit-`id` bodies now hit the 400 'server-assigned' guard); one
   obsolete test (`TestHandleCreateEntity_WithoutAliasUnchanged` — "no alias → null alias" is void
   post-D23) was removed. 5 new contract tests added (name required; id/alias server-assigned;
   reserved names incl. 6-1 `user`; tombstoned-twin alias never blocks; duplicate derives from
   linked profile name). `routes_entities_test.go`: 39 → **43**; management package: **49**;
   controllers package: **42** (4 new derivation tests).
7. **Seed docs (D31):** `config/db/init.go` gained documentation comments pinning `claire` and
   `default-user-profile` as seed-time-exempt built-ins (seed-time-only for `claire`; 000045
   migrates existing installs; only `user` is migration-exempt; the profile id is unaffected). No
   behavior change — the seed path keeps raw ids.
8. **New 400 messages:** `"name is required"` and `"name is reserved"` were chosen (not pinned by
   the plan); `"id and alias are server-assigned at creation"` is used verbatim from D23/D66.
