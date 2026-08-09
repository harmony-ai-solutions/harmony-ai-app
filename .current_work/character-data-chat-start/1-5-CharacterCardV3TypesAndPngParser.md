# 1-5 — Character-Card V3 Types + PNG `ccv3` Parser Fix

> **Phase 1.** Read [`00-VerificationAndGroundTruth.md`](00-VerificationAndGroundTruth.md) first. **Both repos** (Go `harmony-link-private/` + TS `harmony-ai-app/`).
> **Depends on:** nothing (foundational). **Feeds:** [1-6](1-6-CharacterCardMapperRedesign.md).

## Objective

Promote the card types to the full **`CharacterCardV3`** superset (pointer types for optional numeric/bool fields + raw passthrough for unknown keys), and fix the PNG readers to **prefer `ccv3` over `chara`** when both chunks are present (SPEC_V3:28). The parser fix is coupled to the V3 struct — fixing the chunk preference alone is insufficient because `ParseCharacterCard` currently unmarshals into the V2-only struct ([00 §A10](00-VerificationAndGroundTruth.md)).

## Ground truth (verified — [00 §B.1](00-VerificationAndGroundTruth.md), [§B.2](00-VerificationAndGroundTruth.md))

**Go (`utils/charactercard/types.go`):**
- `TavernCardV2:4`, `TavernCardV2Data:10-26` (has `Extensions map[string]any:25` — scoped passthrough EXISTS, [00 §A11](00-VerificationAndGroundTruth.md)), `CharacterBook:28-36` (`Extensions:34`), `CharacterBookEntry:38-44` (**only** keys/content/extensions/enabled/insertion_order — missing 10 V3 fields), `TavernCardV1:47`.
- Lossy value types: `ScanDepth:31`, `TokenBudget:32`, `RecursiveScanning:33` (`int`/`bool` + `omitempty`).
- PNG reader `png_parser.go:60` (`chara`||`ccv3`), `break:83` (first match, no `ccv3` preference); `ParseCharacterCard:108-121` unmarshals into V2 struct.

**TS (`src/utils/charactercard/`):**
- `types.ts:21-37` `TavernCardV2Data`; `CharacterBookEntry:49-55` (only 5 fields); no index signature.
- `jsonParser.ts:33-51` `normalizeData` (applied `:86`) rebuilds field-by-field, drops unknown top-level keys.
- `pngParser.ts:271-293` (`break:292`) — first match, no `ccv3` preference.

## Spec reference

`harmony-link-private/.current_work/character-card-spec-v3/SPEC_V3.md` — `ccv3` mandate `:28`; `CharacterCard` fields `:75`; `entries` fields `:290`; optional `entries` `:346`; `@@` decorators `:374`; macros `:564`.

## Net-new struct fields (both repos)

On the card `data` object (V3 superset): `assets`, `nickname`, `creator_notes_multilingual`, `source` (string[]), `group_only_greetings` (string[]), `creation_date`, `modification_date`.
On `CharacterBookEntry`: `case_sensitive`, `use_regex`, `constant`, `name`, `priority`, `id` (**number OR string** — use `any`/`interface{}` or a custom type), `comment`, `selective`, `secondary_keys` ([]string), `position` (`'before_char' | 'after_char'`).
Pointer types for every optional numeric/bool (`*int`, `*bool`) so `0`/`false` ≠ absent.
Raw passthrough for unknown keys (Go: `Extensions` exists for the `extensions` key; add a catch-all `Raw map[string]json.RawMessage` — or rely on a custom `UnmarshalJSON` that preserves unknown keys; TS: `[key: string]: unknown` index signature).

## Files to modify — Go

### `harmony-link-private/utils/charactercard/types.go`

1. Add a `TavernCardV3` / promote `TavernCardV2Data` to the V3 superset (decide: extend in place vs. new `V3` struct). **Recommended:** introduce `TavernCardV3` (and `TavernCardV3Data`) as a superset, keep `V2` for V2-only parsing. Add the V3-only fields above.
2. Extend `CharacterBook` with top-level V3 fields if missing (`name`, `description`, `scan_depth`, `token_budget`, `recursive_scanning`) — make `scan_depth`/`token_budget` `*int`, `recursive_scanning` `*bool`.
3. Extend `CharacterBookEntry` with all 10 missing V3 fields; make `case_sensitive`/`constant`/`selective`/`use_regex` `*bool`, `priority`/`insertion_order` `*int`, `id` `interface{}` (accept number or string).
4. Add a catch-all for unknown keys: either a custom `UnmarshalJSON` on the card/book/entry that stashes unknown keys into `Raw map[string]json.RawMessage`, or document that the explicit field list + `Extensions` covers the spec. **Spec mandate:** unknown keys MUST survive round-trip (P4 export depends on this) — implement the catch-all now (it's cheap and unblocks P4).

### `harmony-link-private/utils/charactercard/png_parser.go`

1. Change the chunk-selection loop (`:60`–`:83`) to **scan all chunks and prefer `ccv3`**: collect all `chara`/`ccv3` matches; if a `ccv3` exists, use it; else fall back to `chara`. (Per SPEC_V3:28.)
2. `ParseCharacterCard` (`:108-121`): detect `spec === "chara_card_v3"` and unmarshal into the V3 struct; else V2. Prefer the `ccv3` chunk over `chara`.
3. (Spec §26 *SHOULD*): when a backfilled `chara` chunk is present alongside `ccv3`, log a warning into `creator_notes` (e.g. prepend `"[import] trimmed legacy V2 chunk; …"`) — non-blocking.

## Files to modify — TS

### `src/utils/charactercard/types.ts`

Mirror the Go changes: V3 superset fields on `TavernCardV2Data` (or a new `TavernCardV3Data`), full `CharacterBookEntry` (10 fields), pointer-equivalent optionals (TS has no value/pointer distinction — just `?` optional + `| undefined`), and a `[key: string]: unknown` index signature for unknown-key passthrough. `id`: `number | string`.

### `src/utils/charactercard/jsonParser.ts`

`normalizeData` (`:33-51`): instead of rebuilding a fixed-shape object field-by-field, **preserve unknown keys** — spread the incoming `data` and override only the known/normalized fields. (e.g. `return { ...data, name: data.name ?? '', … }`.) Keep `extensions` opaque.

### `src/utils/charactercard/pngParser.ts`

`extractCharacterCardFromPNG` (`:271-293`): change the first-match-`break` (`:292`) to scan all chunks and prefer `ccv3` (mirror Go). `findCharacterCardTextChunks` (`:133-215`) already collects all matches — reuse it to pick `ccv3` first.

## Implementation steps

1. Run `gitnexus_impact({target:"TavernCardV2Data"})` / `CharacterBookEntry` (Go) — report blast radius (consumed by mapper + tests).
2. Go: extend `types.go`; fix `png_parser.go` chunk preference + V3 dispatch; add catch-all unknown-key handling.
3. TS: mirror in `types.ts`; fix `jsonParser.ts` unknown-key preservation; fix `pngParser.ts` chunk preference.
4. Add unit tests: (a) parse a V3 card with all fields → all fields populated; (b) parse a PNG with both `chara`+`ccv3` → `ccv3` wins; (c) unknown keys survive a parse → re-serialize round-trip (P4 prep).

## Verification

- [ ] `gitnexus_impact` run on the type symbols.
- [ ] Go `types.go`: V3 superset + full `CharacterBookEntry` (pointer optionals) + unknown-key passthrough.
- [ ] Go `png_parser.go`: `ccv3` preferred; V3 dispatch.
- [ ] TS `types.ts` + `jsonParser.ts` + `pngParser.ts` mirrored.
- [ ] Unit tests pass (Go `go test ./utils/charactercard/...`; TS `npx jest charactercard`).
- [ ] Unknown keys survive parse (round-trip test green).

## Notes / deviations

- The `extensions` passthrough already exists (scoped) — [00 §A11](00-VerificationAndGroundTruth.md). Do not remove it; augment with a top-level unknown-key catch-all.
- Spec uses *SHOULD* (not MUST) for `ccv3` preference (§28) and backfill-trim (§26) — implement as recommended-level conformance.
