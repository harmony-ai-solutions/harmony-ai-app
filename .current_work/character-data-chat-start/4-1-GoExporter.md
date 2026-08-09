# 4-1 — Go `ExportProfileToCardV3` (JSON + PNG `ccv3`)

> **Phase 4.** Depends on P1+P3 data being present. Read [`00-VerificationAndGroundTruth.md`](00-VerificationAndGroundTruth.md) first.
> **Repo:** `harmony-link-private/`.

## Objective

Add the **exporter** (Go side) — reconstructs a `CharacterCardV3` from `character_profiles` (incl. the `character_book` JSON column) + `character_images` and emits **JSON** + **PNG** (`ccv3` tEXt chunk, base64). **CHARX deferred** (adopt only if the community requests it + we ship bundled-asset features — concept §2.2). `extensions` MUST survive round-trip unchanged (spec mandate — the opaque JSON column guarantees this). Bump `modification_date` on export; preserve `creation_date`/`source` unchanged.

## Ground truth (verified — [00 §B.1](00-VerificationAndGroundTruth.md))

- **No exporter exists today** (import-only: `management/routes_character_profiles.go:140`→`:153`). The PNG reader is `utils/charactercard/png_parser.go` (read-only; no writer).
- V3 types from [1-5](1-5-CharacterCardV3TypesAndPngParser.md) (`TavernCardV3`/`TavernCardV3Data`, full `CharacterBookEntry`, pointer optionals, unknown-key passthrough).
- Spec: `SPEC_V3.md` — V3 `spec:"chara_card_v3"`,`spec_version:"3.0"`; PNG `ccv3` chunk = utf-8→base64 JSON; `modification_date` bump `:205`; `source` append-only/non-editable `:151`.

## Design

`ExportProfileToCardV3(profile *models.CharacterProfile, images []models.CharacterImage) (*TavernCardV3, error)`:

1. **Top-level:** `spec:"chara_card_v3"`, `spec_version:"3.0"`.
2. **`data` fields (from columns):** `name`, `description`, `personality`, `scenario`, `first_mes`, `mes_example`, `alternate_greetings` (JSON-decode the column → []string), `creator`, `character_version`, `creator_notes`, `system_prompt` (← `base_prompt`), `post_history_instructions`, `nickname`, `tags` (JSON-decode), `group_only_greetings` (JSON-decode), `extensions` (JSON-decode the column → object), `assets` (JSON-decode the column → []object).
3. **`character_book`:** emit **verbatim** from the `character_book` JSON column — `json.Unmarshal` column → `CharacterBook` → re-marshal into the card (lossless: top-level + every entry, incl. the stored-but-unused keyword fields and `@@` decorators in `content`).
4. **Provenance:** from `card_provenance` JSON → `source` (unchanged), `creation_date` (unchanged), `creator_notes_multilingual`; **bump `modification_date`** to `time.Now().Unix()`.
5. **Primary icon asset:** from `character_images` → emit as the `icon` entry in `assets` (the full `assets` JSON column already preserves the manifest; reconcile the primary icon if needed).
6. **Unknown-key passthrough:** preserved by the catch-all from [1-5](1-5-CharacterCardV3TypesAndPngParser.md).

**Output formats:**
- `ExportToJSON(card) ([]byte, error)` — `json.Marshal` (trivial; backup/interop).
- `ExportToPNG(card) ([]byte, error)` — encode the card JSON → base64 → write a PNG with a `ccv3` tEXt chunk (value = base64). Use `image/png`; write a tEXt chunk per the PNG spec. (No existing PNG writer in the repo — net-new, but small.)

## Files to create — Go

- `utils/charactercard/exporter.go` — `ExportProfileToCardV3`, `ExportToJSON`, `ExportToPNG`.
- `utils/charactercard/png_writer.go` (or fold into exporter) — PNG `ccv3` tEXt chunk writer.
- `utils/charactercard/exporter_test.go` — round-trip fidelity tests.

## Files to modify — Go

- `management/routes_character_profiles.go` (or a new route) — expose an export endpoint (JSON + PNG) consuming `ExportProfileToCardV3`. (Wire per the repo's route conventions — consult `.planning/codebase/STRUCTURE.md`.)

## Implementation steps

1. Run `gitnexus_impact` on the profile repository reads (reference) — the exporter only reads.
2. TDD: round-trip test — import a V3 card → profile → `ExportProfileToCardV3` → re-parse → assert field equality (incl. `character_book` entries, `extensions`, `assets`, `@@` decorators). This is the headline fidelity gate.
3. Implement the exporter + PNG writer.
4. Wire the export endpoint.
5. `modification_date` bump; `source`/`creation_date` preserved.

## Verification

- [ ] `gitnexus_impact` run.
- [ ] `ExportProfileToCardV3` + `ExportToJSON` + `ExportToPNG` (ccv3 tEXt) created.
- [ ] `character_book` emitted verbatim (lossless).
- [ ] `extensions` survives round-trip unchanged (spec mandate).
- [ ] `modification_date` bumped; `source`/`creation_date` preserved.
- [ ] Round-trip test green (import → profile → export → re-parse → equal).
- [ ] `go test ./utils/charactercard/... ./management/...` passes.

## Notes / deviations

- CHARX deferred (concept §2.2) — JSON + PNG only.
- The PNG writer is net-new (the repo has only a reader); keep it minimal (tEXt chunk only).
