# Phase 4-2: Card → CharacterProfile Mapper Port

## Objective

Port Harmony Link's `MapToCharacterProfile` to TypeScript, converting a parsed
`TavernCardV2` into the app's existing [`CharacterProfile`](../../src/database/models.ts)
shape (plus a `CharacterImage` when a PNG avatar is present). This is a near 1:1
port of [`mapper.go`](../../harmony-link-private/utils/charactercard/mapper.go).

## Background / References

- Port source:
  [`mapper.go`](../../harmony-link-private/utils/charactercard/mapper.go)
  (`MapToCharacterProfile`, `mapCharacterBook`, `mapExampleDialogues`).
- Target model: [`CharacterProfile`](../../src/database/models.ts) —
  `name, description, personality, appearance, backstory, voice_characteristics,
  base_prompt, scenario, example_dialogues, typing_speed_wpm,
  audio_response_chance_percent, vision_config_id, lifecycle_config` (+ id/timestamps).
- Image repo:
  [`createCharacterImage`](../../src/database/repositories/characters.ts) takes
  `Omit<CharacterImage, 'id'|'created_at'|'deleted_at'>` =
  `character_profile_id, image_data, mime_type, description, is_primary,
  display_order`. (Confirm exact `CharacterImage` field names in `models.ts`.)
- Defaults used by HL: `typing_speed_wpm = 60`, `audio_response_chance_percent = 50`.

## Field mapping (port faithfully)

| `CharacterProfile` | Source from card |
|---|---|
| `name` | `data.name` (required) |
| `description` | `data.description` |
| `personality` | `data.personality` |
| `appearance` | `""` (HL leaves blank; set separately if needed) |
| `backstory` | `mapCharacterBook(data.character_book)` (formatted "CHARACTER LORE: …") |
| `voice_characteristics` | `""` |
| `base_prompt` | `data.system_prompt` |
| `scenario` | `data.scenario` |
| `example_dialogues` | `mapExampleDialogues(data)` (first_mes + mes_example + alternate_greetings) |
| `typing_speed_wpm` | `60` (default) |
| `audio_response_chance_percent` | `50` (default) |
| `vision_config_id` | `null` |
| `lifecycle_config` | `'{}'` (opaque JSON, consistent with app's other defaults) |

Image (PNG only): `{ character_profile_id, image_data: <bytes/base64 per repo>,
mime_type: 'image/png', description: profile.appearance, is_primary: true,
display_order: 0 }`.

## Files to create

- `src/utils/charactercard/mapper.ts` — `mapCardToProfile(card, imageBytes?)`.

## Implementation steps

1. Port `mapCharacterBook(book)`: return `""` if no enabled entries; else build
   the `"CHARACTER LORE:\n\n"` + per-entry `"Keywords: k1, k2\n<content>\n\n---\n\n"`.
   Skip entries where `enabled === false`.
2. Port `mapExampleDialogues(data)`: prefix `"EXAMPLE DIALOGUES:\n\n"`; append
   `first_mes`, then `mes_example`, then each `alternate_greeting`, each
   followed by `"\n\n---\n\n"`.
3. Implement `mapCardToProfile` per the table. Generate a UUID v7 id via the
   app's [`generateId()`](../../src/utils/uuid.ts) utility (do **not** import
   `uuid` directly — keep parity with the Phase 7 UUID migration).
4. Return `{ profile, image }` where `image` is `null` when no PNG bytes were
   provided.
5. Validate: throw if `card.data.name` is empty (matches HL's 400 "character card
   must have a name" guard). Let the caller (4-3) surface the error to the user.

## Code sketch

```ts
import { generateId } from '../../utils/uuid';
import type { CharacterProfile } from '../../database/models';
import type { TavernCardV2, CharacterBook } from './types';

export function mapCardToProfile(card: TavernCardV2, imageBytes?: Uint8Array) {
  if (!card.data.name) throw new CharacterCardParseError('character card must have a name');
  const id = generateId();
  const profile: Omit<CharacterProfile, 'created_at' | 'updated_at' | 'deleted_at'> = {
    id,
    name: card.data.name,
    description: card.data.description ?? '',
    personality: card.data.personality ?? '',
    appearance: '',
    backstory: mapCharacterBook(card.data.character_book),
    voice_characteristics: '',
    base_prompt: card.data.system_prompt ?? null,
    scenario: card.data.scenario ?? null,
    example_dialogues: mapExampleDialogues(card.data),
    typing_speed_wpm: 60,
    audio_response_chance_percent: 50,
    vision_config_id: null,
    lifecycle_config: '{}',
  };
  const image = imageBytes ? { character_profile_id: id, image_data: toBase64(imageBytes),
    mime_type: 'image/png', description: profile.appearance, is_primary: true, display_order: 0 } : null;
  return { profile, image };
}
```

## Progress checklist

- [ ] `mapper.ts` ports `mapCharacterBook` + `mapExampleDialogues` + `mapCardToProfile`
- [ ] Uses app `generateId()` (UUID v7) for the profile id
- [ ] Throws on missing name
- [ ] Image payload shape matches `createCharacterImage` input (verified)
- [ ] Unit test (Phase 5) asserts the formatted backstory/example output
