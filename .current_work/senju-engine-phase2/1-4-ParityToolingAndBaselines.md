# 1-4 — Parity Tooling: Allowlist, Baselines, CLIENT_ONLY_TABLES Deletion

> Phase 1 / repo: **harmony-ai-app** (+ regenerate engine baseline artifact).
> Contract: `21-Engine-Contract-Persona-Enums.md` Q12/Q16; ground truth in §1.3 of the contract.

## Objective

Make "parity green" a real, enforceable state: a **comment-insensitive** comparator (§9-A8), truthful committed
baselines, and the end of the D6 interim exclusion mechanism. With the §9-A9 reconciliation sweep, the end-state
allowlist shrinks to **deliberate cross-repo design differences only**.

## 0. Dump-writer hardening — comment-insensitive normalization (§9-A8, DO THIS FIRST)

Both dump writers strip SQL comments BEFORE whitespace collapse (the comparator receives already-collapsed text,
where inline `--` comments have no recoverable terminator — a comparator-side stripper was verified to TRUNCATE
the engine's `lifecycle_state` DDL at the first comment):

- Engine `normalizeSQL` (`cmd/dump_schema.go`) and app `normalizeSql`
  (`src/database/__test_utils__/dumpSchema.ts`, consumed by `scripts/dump-schema.ts` + migration snapshots):
  add a string-literal-aware comment stripper (`--` to end-of-line + `/* */` blocks; a `'` state machine with
  `''` escaping protects string bodies containing `--`), applied before the existing whitespace collapse.
- **TDD**: write the stripper tests FIRST (red) — fixtures: inline `--` comments, block comments, a DEFAULT
  string containing `--` (e.g. `DEFAULT 'a--b'`), escaped quotes (`'it''s'`), comment at end without newline.
  Cross-impl: the SAME fixture list runs in Go (`cmd/dump_schema_test.go`) and TS, asserting identical outputs.
- Migration snapshots + `schema/rn-schema.json` regenerate (outputs change where comments existed).

## 1. `scripts/compare-schemas.py` — documented allowlist

Add a versioned `EXPECTED_DIVERGENCES` registry (exact `type:name` keys + one-line reason each), loaded from a
sibling file `scripts/parity-allowlist.json` (keeps the policy reviewable). With §9-A8 (comment-insensitivity)
+ §9-A9 (label reconciliation in 1-2/1-3), the registry at THIS phase contains exactly ONE entry:

- `table:device_push_tokens` — **Go-only**, engine push infra, app `000039` is the reserved placeholder.

(`table:sync_devices` joins in 4-2 when the engine-local `synced_tables` column lands — sanctioned by §9-A9;
end state = 2 entries. The former 9 cosmetic drifts + `conversation_messages` are gone: comment-only drifts
ceased to exist via §9-A8; label/column drifts reconciled app-side via §9-A9.)

- Semantics: exit 0 iff (diff − allowlist) is empty AND every allowlist entry still matches an actual divergence
  (stale allowlist entries = failure — forces cleanup when a drift is reconciled). Report format keeps the
  RN-only/Go-only/different sections, annotated `[allowlisted]`.
- Note in-file: allowlist entries may only be REMOVED (reconciliation), never added, without a senior-dev ruling
  (the 4-2 `sync_devices` addition is pre-sanctioned by §9-A9 — cite it in the entry reason).

## 2. Baselines

- Regenerate app baseline: `npm run schema:dump -- --output schema/rn-schema.json` (after §0 + 1-2/1-3).
- Regenerate engine baseline: `go run . dump-schema | tail -n +3 > schema/go-schema.json` in harmony-link-private
  (**the dump emits 2 header lines on this machine — verify the output starts with `[` before committing it**;
  the committed baseline is STALE — missing `lifecycle_state` + `device_push_tokens`; CI doesn't notice because
  it re-dumps). Commit on `feat/engine-track-phase2`. Baselines regenerate AFTER the §0 writer hardening so they
  are comment-insensitive artifacts.
- `docs/schema-parity.md`: rewrite the "Real Differences (Fix Required)" and "Common Cosmetic Differences"
  sections (the doc has no "Current Divergence State" heading — those are the actual section names) + update
  "Timestamp Column Labels" to the §9-A9 policy (rebuilt tables adopt engine `TIMESTAMP`/`DATETIME` labels; no
  timestamp defaults; app never relies on `DEFAULT CURRENT_TIMESTAMP`). Document the comment-insensitive
  comparator (§9-A8), the allowlist mechanism, and the CI-red-by-design note (Q16: workflow pins engine `main`;
  until the coordinated merge, local compare is authoritative).

## 3. Delete the `CLIENT_ONLY_TABLES` mechanism (D6 end state)

- `scripts/dump-schema.ts`: remove the set + `isClientOnlyEntry` (:49-72) + the filter application (:94-96) +
  the D6 docblock. "App-only SQLite table" ceases to be a category. (Entry deletions happened in 1-2; this is the
  mechanism deletion — verify the dump output is unchanged by this refactor beyond formatting.)
- Grep gate: `CLIENT_ONLY` in `src/` + `scripts/` → zero hits (the `scripts/dump-schema.ts` allowlist file name
  `parity-allowlist.json` must not trip the old sweep).

## Files

- Modify: `scripts/compare-schemas.py`, `scripts/dump-schema.ts`, `docs/schema-parity.md`
- Create: `scripts/parity-allowlist.json`
- Regenerate: `schema/rn-schema.json` (app), `schema/go-schema.json` (engine repo)

## Verification

- [ ] Comment stripper: cross-impl fixtures green in BOTH repos (Go + TS produce identical normalized output)
- [ ] Local compare on fresh dumps (once the 1-1/1-2/1-3 pairs exist locally — §9-A11) exits 0 with output =
      EXACTLY 1 `[allowlisted]` entry (`table:device_push_tokens`); `conversation_messages`, `entities`,
      `emotion_state`, `entity_emoji_actions`, `interactions`, `sync_history` all MATCH; RN-only index leaks:
      zero (2 entries only after 4-2 adds `sync_devices` — end state)
- [ ] Stale-allowlist detection tested: temporarily remove a real drift → comparator fails (manual check OK)
- [ ] `CLIENT_ONLY` grep zero; dump output unchanged by the mechanism deletion beyond formatting
- [ ] tsc 0, `npm test` green; `go build ./...` + `go test ./cmd/...` green (stripper tests); commits +
      `gitnexus_detect_changes()` per repo
