# 1-3 — App Migration `000037` + `models.ts`

> **Phase 1 · Coupled release.** App mirror of [1-1](1-1-GoMigration000037.md) + [1-2](1-2-GoCharacterProfileModelAndSync.md). Read [`00-VerificationAndGroundTruth.md`](00-VerificationAndGroundTruth.md) first.
> **Repo:** `harmony-ai-app/` (this repo, RN/TS).

## Objective

Mirror migration `000037`, extend the `CharacterProfile` TS interface with the 14 new fields (snake_case — [00 §A12](00-VerificationAndGroundTruth.md)), and add `'greeting'` to the `ConversationMessage.message_type` union.

## Ground truth (verified — [00 §B.2](00-VerificationAndGroundTruth.md))

- `CharacterProfile` interface `src/database/models.ts:13-31` (snake_case fields; 14 new fields all absent).
- `ConversationMessage` `models.ts:469-499`; `message_type` union `:476` = `'text' | 'audio' | 'combined' | 'image'`. Column is free TEXT (`migrations/000005:44`, `000013:52`) → adding `'greeting'` is a pure TS change, **no migration**.
- Migrations forward-only (single SQL string export); max `000036`; register in `src/database/migrations.ts:11-46` (imports) + `:58-239` (`MIGRATIONS` array). Guard `migrations.ts:298-351` forbids `DROP/RENAME COLUMN` — **`000037` is additive `ADD COLUMN`, so the guard is satisfied trivially** ([00 §A13](00-VerificationAndGroundTruth.md)).

## Files to create

### `src/database/migrations/000037_add_character_card_standard_fields.ts`

```ts
/**
 * 000037 — Character Card V3 standard-field fidelity.
 * Mirrors engine migration 000037 (harmony-link-private). All additive, all nullable.
 * NOTE: RN migrations are forward-only (no down). character_book JSON column included here
 * (the P3 lorebook feature adds no further migration).
 */
export const migration037 = `
ALTER TABLE character_profiles ADD COLUMN first_mes TEXT;
ALTER TABLE character_profiles ADD COLUMN mes_example TEXT;
ALTER TABLE character_profiles ADD COLUMN alternate_greetings TEXT;
ALTER TABLE character_profiles ADD COLUMN post_history_instructions TEXT;
ALTER TABLE character_profiles ADD COLUMN creator_notes TEXT;
ALTER TABLE character_profiles ADD COLUMN creator TEXT;
ALTER TABLE character_profiles ADD COLUMN character_version TEXT;
ALTER TABLE character_profiles ADD COLUMN nickname TEXT;
ALTER TABLE character_profiles ADD COLUMN tags TEXT;
ALTER TABLE character_profiles ADD COLUMN group_only_greetings TEXT;
ALTER TABLE character_profiles ADD COLUMN extensions TEXT;
ALTER TABLE character_profiles ADD COLUMN assets TEXT;
ALTER TABLE character_profiles ADD COLUMN card_provenance TEXT;
ALTER TABLE character_profiles ADD COLUMN character_book TEXT;
`;
```

> The migration runner supports multi-statement SQL strings (confirmed — existing migrations like `000027` use the same pattern). Match the exact export shape of `000036`.

## Files to modify

### `src/database/migrations.ts`

- Import: add `import { migration037 } from './migrations/000037_add_character_card_standard_fields';` (near `:11-46`).
- Register: add an entry to the `MIGRATIONS` array (`:58-239`) following the `{ version: 37, description: 'Add character card standard fields (V3 fidelity, incl. character_book JSON)', sql: migration037 }` shape.

### `src/database/models.ts`

1. Extend `CharacterProfile` (`:13-31`) with the 14 fields (snake_case, nullable → `string | null` or just `string` to match existing fields which are typed `string`). Use `string` for consistency with `backstory`/`scenario` etc.:
   ```ts
   first_mes: string;
   mes_example: string;
   alternate_greetings: string;      // JSON []
   post_history_instructions: string;
   creator_notes: string;
   creator: string;
   character_version: string;
   nickname: string;
   tags: string;                     // JSON []
   group_only_greetings: string;     // JSON []
   extensions: string;               // JSON {}
   assets: string;                   // JSON []
   card_provenance: string;          // JSON {}
   character_book: string;           // JSON {}
   ```
2. `ConversationMessage` (`:476`): extend the union:
   ```ts
   message_type: 'text' | 'audio' | 'combined' | 'image' | 'greeting';
   ```

## Implementation steps

1. Create the migration file.
2. Register it in `migrations.ts`.
3. Extend `models.ts` (both interfaces).
4. Regenerate schema baseline + update snapshots (see [1-4](1-4-AppCharactersRepositoryAndSchemaParity.md) — parity work lands there, but the snapshot update is triggered from here).

## Verification

- [ ] `000037_add_character_card_standard_fields.ts` created (14 `ADD COLUMN`).
- [ ] Registered in `migrations.ts` (import + `MIGRATIONS` entry, version 37).
- [ ] `CharacterProfile` has all 14 new fields (snake_case).
- [ ] `ConversationMessage.message_type` union includes `'greeting'`.
- [ ] `npx tsc --noEmit` passes.
- [ ] (Snapshot/parity — completed in [1-4](1-4-AppCharactersRepositoryAndSchemaParity.md).)

## Notes / deviations

- Forward-only migration (no `down`) — [00 §A13](00-VerificationAndGroundTruth.md).
- `'greeting'` needs no migration (free TEXT) — [00 §A21](00-VerificationAndGroundTruth.md); consumer audit in [1-8](1-8-GoGreetingDeliveryPrimitives.md) / [1-10](1-10-AppGreetingRenderUx.md).
