# Phase 4-3: Card Import Service

## Objective

Add the import orchestration: pick a file (PNG or JSON) via the document picker,
read it, detect type, parse (4-1), map (4-2), validate, and persist via the
existing repositories so it syncs through the normal pipeline. No REST/management
API calls — fully local (works in cloud and self-hosted modes, and offline).

## Background / References

- Repositories:
  [`createCharacterProfile`](../../src/database/repositories/characters.ts),
  [`createCharacterImage`](../../src/database/repositories/characters.ts).
- File reading: `react-native-fs` (`RNFS`) is already a dependency
  (used in [`connection.ts`](../../src/database/connection.ts),
  [`AudioRecorder.ts`](../../src/services/AudioRecorder.ts)).
- Document picker: memory-bank records a migration to
  `@react-native-documents/picker`. **Verify the import path** before use
  (likely `import { pick } from '@react-native-documents/picker'`); confirm it is
  in `package.json`.
- Base64/byte helpers: app has `src/database/base64.ts` (`createDataURL`); add a
  `base64ToBytes` / `bytesToBase64` helper if not present.

## Files to create

- `src/services/CharacterCardImportService.ts` — `importCharacterCardFromFile(uri, mime)`.

## API surface

```ts
export interface ImportResult { profileId: string; name: string; hadImage: boolean; }
export async function importCharacterCardFromFile(uri: string, mime: string): Promise<ImportResult>;
```

Errors are thrown as typed `CharacterCardImportError` (with a user-facing reason
code): `no_file`, `read_failed`, `unsupported_type`, `parse_failed`,
`name_required`. The UI (4-4) maps these to localized messages + toasts.

## Implementation steps

1. Read the picked file:
   - PNG: `const b64 = await RNFS.readFile(uri, 'base64'); const bytes = base64ToBytes(b64);`
   - JSON: `const text = await RNFS.readFile(uri, 'utf8');`
2. Detect type by `mime` / extension:
   - `image/png` or `.png` → `extractCharacterCardFromPNG(bytes)` → `{ card, imageBytes }`.
   - `application/json` / `.json` → `parseCharacterCard(text)` → `{ card, imageBytes: undefined }`.
   - else → throw `unsupported_type`.
3. `const { profile, image } = mapCardToProfile(card, imageBytes)` (4-2). Name
   missing → `mapCardToProfile` throws → wrap as `name_required`.
4. Persist:
   ```ts
   await createCharacterProfile(profile);          // generates/uses the id
   if (image) await createCharacterImage(image);   // avatar
   ```
   Use the same id for both (the mapper pre-generates it; ensure
   `createCharacterProfile` accepts a caller-supplied `id` — it does, per the
   cross-repo test which passes `id: profileId`).
5. Return `{ profileId: profile.id, name: profile.name, hadImage: !!image }`.
6. Wrap all in try/catch and rethrow as typed errors; never crash the picker flow.
7. Concurrency/dedupe: optional — skip if a profile with the same name exists, or
   allow duplicates. Mirror HL (HL allows duplicates). Default: allow duplicates.

## Notes / risks

- Large PNGs: read as base64 then to bytes in memory; fine for character cards
  (typically < 2 MB). No streaming needed.
- iOS/Android URI schemes differ (`file://` vs `content://`); `RNFS.readFile`
  handles both on RN. Verify with a real pick on each platform.
- Ensure the picker requests the right MIME types (see 4-4 for the `pick` call).

## Progress checklist

- [ ] `CharacterCardImportService.ts` created with `importCharacterCardFromFile`
- [ ] PNG + JSON detection and parsing wired to 4-1/4-2
- [ ] Persists via `createCharacterProfile` (+ `createCharacterImage` for PNG)
- [ ] Typed errors with reason codes
- [ ] Picker import path verified (`@react-native-documents/picker`)
- [ ] Integration/manual test on Android (emulator) in Phase 5
