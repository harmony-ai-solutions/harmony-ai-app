# 1-4 — Parity Tooling: Allowlist, Baselines, CLIENT_ONLY_TABLES Deletion

> Phase 1 / repo: **harmony-ai-app** (+ regenerate engine baseline artifact).
> Contract: `21-Engine-Contract-Persona-Enums.md` Q12/Q16; ground truth in §1.3 of the contract.

## Objective

Make "parity green" a real, enforceable state: an allowlisted comparator, truthful committed baselines, and the
end of the D6 interim exclusion mechanism.

## 1. `scripts/compare-schemas.py` — documented allowlist

Add a versioned `EXPECTED_DIVERGENCES` registry (exact `type:name` keys + one-line reason each), loaded from a
sibling file `scripts/parity-allowlist.json` (keeps the policy reviewable):

- 9 cosmetic drifts (post-reconciliation state): `table:character_profiles` (inline comment),
  `table:emotion_state` (comments + `deleted_at` label), `table:entities` (`alias DEFAULT ''`),
  `table:entity_emoji_actions` (comments + timestamp labels), `table:interactions` (comments + FK clause),
  `table:memories` (comments), `table:provider_config_soulbitscloud` (comments),
  `table:sync_devices` (comments), `table:sync_history` (comment + `updated_at` column).
- `table:device_push_tokens` — **Go-only**, engine push infra, app `000039` is the reserved placeholder.
- Semantics: exit 0 iff (diff − allowlist) is empty AND every allowlist entry still matches an actual divergence
  (stale allowlist entries = failure — forces cleanup when a drift is reconciled). Report format keeps the
  RN-only/Go-only/different sections, annotated `[allowlisted]`.
- Note in-file: allowlist entries may only be REMOVED (reconciliation), never added, without a senior-dev ruling.

## 2. Baselines

- Regenerate app baseline: `npm run schema:dump -- --output schema/rn-schema.json` (after 1-2/1-3).
- Regenerate engine baseline: `go run . dump-schema | tail -n +4 > schema/go-schema.json` in harmony-link-private
  (the committed one is STALE — missing `lifecycle_state` + `device_push_tokens`; CI doesn't notice because it
  re-dumps). Commit on `feat/engine-track-phase2`.
- `docs/schema-parity.md`: rewrite the "Current Divergence State" section — Phase-2 end state = allowlist only;
  D3 closed via canonical rebuild; document the allowlist mechanism + the CI-red-by-design note (Q16: workflow pins
  engine `main`; until the coordinated merge, local compare is authoritative).

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

- [ ] Local compare on fresh dumps exits 0 with output = 11 `[allowlisted]` entries (9 + device_push_tokens +
      whatever of the 9 splits into RN-only/Go-only sections — assert EXACTLY the registered set)
- [ ] Stale-allowlist detection tested: temporarily remove a real drift → comparator fails (manual check OK)
- [ ] `CLIENT_ONLY` grep zero; dump byte-identical before/after mechanism deletion
- [ ] tsc 0, `npm test` green; commits + `gitnexus_detect_changes()`
