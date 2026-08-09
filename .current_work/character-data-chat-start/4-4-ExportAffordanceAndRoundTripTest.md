# 4-4 — Export Affordance + Round-Trip Test

> **Phase 4** (closing). Depends on [4-1](4-1-GoExporter.md), [4-2](4-2-AppExporterMirror.md). Read [`00-VerificationAndGroundTruth.md`](00-VerificationAndGroundTruth.md) first.
> **Repo:** `harmony-ai-app/` (+ Go export endpoint from [4-1](4-1-GoExporter.md)).

## Objective

Surface the export affordance in the editor (export to JSON / PNG), and add a full end-to-end **round-trip fidelity test** (import V3 card → profile → export → re-parse → field equality) on both sides as the headline spec-conformance gate. Verify full V3 field fidelity and that `extensions`/`character_book`/`@@` decorators survive unchanged.

## Ground truth (verified — [00 §B.2](00-VerificationAndGroundTruth.md))

- Exporters: Go [4-1](4-1-GoExporter.md) + TS [4-2](4-2-AppExporterMirror.md).
- `CharacterProfileEditScreen.tsx` ([3-5](3-5-AppProfileEditorSectionsAndImport.md)) — add the export action to the action bar.
- File saving: use the established RN file-save/share pattern (check `.planning/codebase/INTEGRATIONS.md` for the share-sheet/FS helper in use).

## Deliverables

### Export affordance

- In `CharacterProfileEditScreen` action bar (near `[Preview opening]` / `[Test scenario]`): an **Export** menu → **JSON** / **PNG**.
  - JSON → `exportToJSON` → save/share `.json`.
  - PNG → `exportToPNG` (ccv3) → save/share `.png`.
- On the management screen card detail: an Export action (optional, discoverability).

### Round-trip fidelity test (the P4 acceptance gate)

- **TS test** (`src/utils/charactercard/__tests__/roundtrip.test.ts`): load a V3 fixture card → `mapCardToProfile` → `exportProfileToCardV3` → re-parse (`parseCharacterCard`) → assert deep equality on: all standard fields, `character_book` (top-level + every entry incl. keyword/position fields), `extensions` (unchanged), `assets`, `card_provenance` (`source`/`creation_date` unchanged; `modification_date` bumped), `@@` decorators preserved in `content`.
- **Go test** (from [4-1](4-1-GoExporter.md)): same round-trip on the Go side.
- **Cross-side parity**: a shared V3 fixture asserted on both sides produces equal canonical JSON-card output.

## Files to create / modify

- `src/screens/CharacterProfileEditScreen.tsx` — Export menu (JSON/PNG).
- `src/utils/charactercard/__tests__/roundtrip.test.ts` — TS round-trip fidelity test.
- `src/utils/charactercard/__tests__/fixtures/v3-card.json` — shared V3 fixture (with `character_book`, `extensions`, `assets`, `@@` decorators).
- (Go) `utils/charactercard/exporter_test.go` — Go round-trip + cross-side parity (from [4-1](4-1-GoExporter.md)).

## Implementation steps

1. Add the Export menu (JSON/PNG) to the editor action bar + wire to the TS exporter + save/share.
2. Create the shared V3 fixture (rich: lorebook with all entry fields, `extensions`, `assets`, `@@` decorators, provenance).
3. Write the TS round-trip test; write/confirm the Go round-trip test; add cross-side parity assertion.
4. Run both; fix any fidelity gaps (field drops, key losses).

## Verification

- [ ] Export menu (JSON + PNG) in the editor; save/share works.
- [ ] TS round-trip test green (all fields, `character_book`, `extensions`, `assets`, provenance, `@@`).
- [ ] Go round-trip test green.
- [ ] Cross-side parity (canonical JSON-card equal).
- [ ] `extensions` survives unchanged (spec mandate).
- [ ] `modification_date` bumped; `source`/`creation_date` preserved.
- [ ] `npx jest charactercard` + `go test ./utils/charactercard/...` pass.
- [ ] Final `gitnexus_detect_changes()` across both repos — full feature scope confirmed.

## Notes / deviations

- This is the closing subtask; on completion, mark all of P4 (and the plan) done in [`summary.md`](summary.md).
- CHARX remains deferred (concept §2.2) — not part of this round-trip gate.
