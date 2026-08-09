# 4-2 — App Exporter Mirror (JSON + PNG `ccv3`)

> **Phase 4** (frontend). Depends on [4-1](4-1-GoExporter.md) (for format parity). Read [`00-VerificationAndGroundTruth.md`](00-VerificationAndGroundTruth.md) first.
> **Repo:** `harmony-ai-app/`.

## Objective

Mirror the Go exporter on the TS side so the app can export a profile to V3 JSON + PNG (`ccv3`) for sharing. Format **must** match the Go exporter byte-for-byte at the JSON-card level (same field order/default policy) so exports from either side are interchangeable.

## Ground truth (verified — [00 §B.2](00-VerificationAndGroundTruth.md))

- TS V3 types from [1-5](1-5-CharacterCardV3TypesAndPngParser.md) (`TavernCardV3Data`, full `CharacterBookEntry`, index signature for unknown keys).
- TS PNG reader `src/utils/charactercard/pngParser.ts` (read-only; no writer today).
- `CharacterProfile` snake_case fields ([1-3](1-3-AppMigration000037AndModels.md)).

## Design

`src/utils/charactercard/exporter.ts`:
- `exportProfileToCardV3(profile: CharacterProfile, images: CharacterImage[]): TavernCardV3` — mirror [4-1](4-1-GoExporter.md): `spec:"chara_card_v3"`,`spec_version:"3.0"`; columns→fields; `base_prompt`→`system_prompt`; JSON-decode `alternate_greetings`/`tags`/`group_only_greetings`/`extensions`/`assets`; `character_book` verbatim from the JSON column; `card_provenance`→`source`/`creation_date`/`creator_notes_multilingual` + bump `modification_date`.

> **Canonical format reference = `SPEC_V3.md`** (not "whatever the Go exporter emits"). Both the Go exporter ([4-1](4-1-GoExporter.md)) and this TS mirror MUST independently conform to the spec's `ccv3` chunk format (utf-8→base64 JSON, `SPEC_V3.md:28`). The cross-side parity test in [4-4](4-4-ExportAffordanceAndRoundTripTest.md) asserts both sides produce spec-conformant output — not just that they match each other.
- `exportToJSON(card): string` — `JSON.stringify`.
- `exportToPNG(card): Uint8Array` — encode card JSON → base64 → write a PNG with a `ccv3` tEXt chunk. Use a PNG writer (e.g. a small tEXt-chunk writer; if RN lacks one, share the encoder with the reader's chunk logic in `pngParser.ts`). Confirm parity with the Go PNG output.

> **Parity:** add a shared round-trip test fixture (a known V3 card) asserted on both sides — the JSON-card output must match (canonical JSON). Document any intentional divergence (e.g. key ordering) and canonicalize if needed.

## Files to create

- `src/utils/charactercard/exporter.ts`
- `src/utils/charactercard/pngWriter.ts` (or fold into exporter) — PNG `ccv3` tEXt writer.
- `src/utils/charactercard/__tests__/exporter.test.ts` — round-trip + parity test.

## Implementation steps

1. Mirror the Go exporter field mapping exactly.
2. Implement the PNG `ccv3` writer (parity with Go).
3. Round-trip + parity test (import → profile → export → re-parse → equal; cross-side JSON-card equality).
4. Expose an export action in the UI (wired in [4-4](4-4-ExportAffordanceAndRoundTripTest.md)).

## Verification

- [ ] `exportProfileToCardV3` + `exportToJSON` + `exportToPNG` created.
- [ ] `character_book` verbatim; `extensions` survives; `modification_date` bumped; `source`/`creation_date` preserved.
- [ ] Round-trip + parity test green (matches Go exporter JSON-card output).
- [ ] `npx jest charactercard` passes.

## Notes / deviations

- Cross-side parity is the key acceptance criterion — canonicalize JSON if key ordering differs.
- PNG writer is net-new on TS too.
