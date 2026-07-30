# Phase 4-1: Character Card Parser Port (TypeScript)

## Objective

Port Harmony Link's `charactercard` parsing logic to TypeScript so the app can
parse standard **Tavern Card V1/V2/V3** character cards from both **raw JSON**
and **PNG-embedded** (`tEXt`/`iTXt` `chara`/`ccv3` chunks) sources. This phase is
the parser only; mapping to `CharacterProfile` is Phase 4-2.

## Background / References (port sources)

Port these Go files to TS faithfully:
- [`types.go`](../../harmony-link-private/utils/charactercard/types.go) —
  `TavernCardV2` (`spec`, `spec_version`, `data`), `TavernCardV2Data`
  (`name, description, personality, scenario, first_mes, mes_example,
  creator_notes, system_prompt, post_history_instructions, alternate_greetings,
  character_book, tags, creator, character_version, extensions`),
  `CharacterBook` + `CharacterBookEntry`, and `TavernCardV1` (fallback).
- [`png_parser.go`](../../harmony-link-private/utils/charactercard/png_parser.go) —
  `ExtractCharacterCardFromPNG(imageData []byte) (*TavernCardV2, []byte, error)`
  and `ParseCharacterCard(jsonData string) (*TavernCardV2, error)`.

## Files to create

New package at `src/utils/charactercard/`:
- `types.ts` — TS interfaces mirroring the Go structs.
- `jsonParser.ts` — `parseCharacterCard(json: string): TavernCardV2`.
- `pngParser.ts` — `extractCharacterCardFromPNG(bytes: Uint8Array): { card:
  TavernCardV2; imageBytes: Uint8Array }`.
- `index.ts` — re-exports + a top-level `parseCardFromUri/bytes` convenience.

## Implementation steps

1. **`types.ts`**: define `TavernCardV1`, `TavernCardV2`, `TavernCardV2Data`,
   `CharacterBook`, `CharacterBookEntry`. Use the exact JSON keys from
   `types.go` (`first_mes`, `mes_example`, `system_prompt`, `alternate_greetings`,
   `character_book`, etc.). Keep `extensions` as `Record<string, unknown>`.
2. **`jsonParser.ts`** — port `ParseCharacterCard`:
   - Parse JSON.
   - Detect version: if `obj.spec === 'chara_card_v2'` || `'chara_card_v3'` →
     return as `TavernCardV2` (V3 is compatible). If it has top-level `name`
     (V1 shape) → coerce V1 → V2 (`data.name`, `data.description`, etc.).
   - Throw a typed error (`CharacterCardParseError`) on unrecognized shapes, mirroring the Go "unable to detect" failure.
3. **`pngParser.ts`** — port `ExtractCharacterCardFromPNG`:
   - Validate the 8-byte PNG signature.
   - Iterate chunks: each chunk = 4-byte length (big-endian) + 4-byte type +
     `length` data bytes + 4-byte CRC. Stop at `IEND`.
   - For `tEXt` chunks: split on first `0x00` → keyword + text. Keywords of
     interest: `chara`, `ccv3`.
   - For `iTXt` chunks: keyword (null-term) + compression flag (1 byte) +
     compression method (1 byte) + language tag (null-term) + translated keyword
     (null-term) + text. If compression flag === 1, the text is zlib-compressed
     → decompress (see note). Same keywords.
   - The extracted text is **base64-encoded JSON** (standard Tavern Card).
     Base64-decode → `parseCharacterCard`.
   - Return the parsed card plus the original image bytes (for the avatar in 4-2).
4. **zlib note (compressed iTXt):** most cards use uncompressed `tEXt`. If
   compressed `iTXt` support is required, add the `pako` dependency
   (`npm i pako @types/pako`) and `inflate`. Confirm scope; uncompressed-only is
   acceptable for a first cut — mirror what the Go `png_parser.go` actually
   supports (check whether it decompresses).
5. **Reading the file:** the import service (4-3) reads the picked file to bytes
   via `react-native-fs` (`RNFS.readFile(uri, 'base64')` → `base64.toByteArray`).
   Keep the parser pure (operates on `Uint8Array`/`string`) so it is unit-testable
   in Node (Jest).

## Code sketch (chunk loop)

```ts
const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];
function readUint32BE(b: Uint8Array, off: number) {
  return (b[off] << 24 | b[off+1] << 16 | b[off+2] << 8 | b[off+3]) >>> 0;
}
export function findTextChunk(bytes: Uint8Array): { keyword: string; text: string }[] {
  // verify signature, then walk chunks, collect tEXt/iTXt for 'chara'/'ccv3'
}
export function extractCharacterCardFromPNG(bytes: Uint8Array) {
  const hits = findTextChunk(bytes).filter(h => h.keyword === 'chara' || h.keyword === 'ccv3');
  const json = base64DecodeUtf8(hits[0]?.text ?? '');
  return { card: parseCharacterCard(json), imageBytes: bytes };
}
```

## Progress checklist

- [ ] `types.ts` mirrors Go structs with exact JSON keys
- [ ] `jsonParser.ts` handles V1/V2/V3 + throws typed error
- [ ] `pngParser.ts` walks PNG chunks, extracts `chara`/`ccv3`, base64-decodes
- [ ] Compressed iTXt scope decided (pako or skip)
- [ ] Parser is pure (no RN imports) and Jest-tested (Phase 5)
