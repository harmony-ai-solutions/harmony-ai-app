# 1-2 — Go `CharacterProfile` Model + Sync DTO + Repository + `sync_utils`

> **Phase 1 · Coupled release.** Depends on [1-1](1-1-GoMigration000037.md). Read [`00-VerificationAndGroundTruth.md`](00-VerificationAndGroundTruth.md) first.
> **Repo:** `harmony-link-private/` (Go engine).

## Objective

Extend the Go data layer to carry the 14 new columns end-to-end: struct → sync DTO → both conversion directions → 4 repository SQL statements → changed-records sync query. The `character_book` JSON rides inside the profile sync payload (no separate sync slot).

## Ground truth (verified — [00 §B.1](00-VerificationAndGroundTruth.md))

- `CharacterProfile` struct `database/models/character.go:9` (17 fields, lines 10–27).
- `CharacterProfileSync` DTO `character.go:30`.
- `ToSyncModel` `:50` / `ToDBModel` `:77` — field-by-field; nullable cols need pointer/null handling like `VisionConfigID`/`DeletedAt` (`:68-73`,`:95-100`); `ToDBModel` forces `LifecycleConfig="{}"` (`:102-104`).
- Repository: INSERT `character_profiles.go:13-18`, SELECT-id `:38-43`, SELECT-all `:67-72`, UPDATE `:109-117`.
- `queryGetChangedCharacterProfiles` SELECT `sync_utils.go:23-26` + Scan `:261-265`; `CountChangedRecords` `:1285`.

## Design decision: JSON columns as typed structs (not raw `string`)

Store the JSON columns (`character_book`, `extensions`, `assets`, `card_provenance`, `tags`, `alternate_greetings`, `group_only_greetings`) as **typed Go structs/slices with `json.Marshaler`/`Unmarshaler`** (or `sql.NullString` + marshal helpers) so the model is type-safe and the repository scans/inserts plain strings. Recommended approach (consistent with how `LifecycleConfig` is already a string-stored JSON in the current model): keep them as `string` (raw JSON) on the DB model + DTO, and decode/encode at the mapper ([1-6](1-6-CharacterCardMapperRedesign.md)) and prompt-builder boundaries. This minimizes struct churn and matches the existing `LifecycleConfig` precedent. **Use `sql.NullString` semantics via nullable `*string` on conversions only if a distinct empty-vs-absent matters — for JSON columns it does not, so plain `string` is fine.**

> Scalar new fields (`first_mes`, `mes_example`, `post_history_instructions`, `creator_notes`, `creator`, `character_version`, `nickname`) → plain `string` on both structs.

## Files to modify

### `database/models/character.go`

1. Add fields to `CharacterProfile` (after line 27, before timestamps or grouped logically):
   ```go
   FirstMes                 string `json:"first_mes" db:"first_mes"`
   MesExample               string `json:"mes_example" db:"mes_example"`
   AlternateGreetings       string `json:"alternate_greetings" db:"alternate_greetings"` // JSON []
   PostHistoryInstructions  string `json:"post_history_instructions" db:"post_history_instructions"`
   CreatorNotes             string `json:"creator_notes" db:"creator_notes"`
   Creator                  string `json:"creator" db:"creator"`
   CharacterVersion         string `json:"character_version" db:"character_version"`
   Nickname                 string `json:"nickname" db:"nickname"`
   Tags                     string `json:"tags" db:"tags"`                               // JSON []
   GroupOnlyGreetings       string `json:"group_only_greetings" db:"group_only_greetings"` // JSON []
   Extensions               string `json:"extensions" db:"extensions"`                   // JSON {}
   Assets                   string `json:"assets" db:"assets"`                           // JSON []
   CardProvenance           string `json:"card_provenance" db:"card_provenance"`         // JSON {}
   CharacterBook            string `json:"character_book" db:"character_book"`           // JSON {}
   ```
2. Mirror **all 14** on `CharacterProfileSync` (`:30`).
3. `ToSyncModel` (`:50`): add 14 assignments.
4. `ToDBModel` (`:77`): add 14 assignments.

### `database/repository/characters/character_profiles.go`

Update the **4** statements to include the 14 new columns (and their `?` placeholders / Scan targets):
- INSERT (`:13-18`) — add columns + placeholders (14 more `?`).
- SELECT-by-id (`:38-43`) — add columns to the SELECT list + Scan.
- SELECT-all (`:67-72`) — same.
- UPDATE (`:109-117`) — add `first_mes = ?, …` to the SET clause.

Row-scan: add 14 `&profile.FirstMes, …` targets in the scan call(s).

### `database/sync_utils.go`

- `queryGetChangedCharacterProfiles` SELECT (`:23-26`): add the 14 columns to the SELECT list.
- Scan (`:261-265`): add 14 scan targets.
- Audit `CountChangedRecords` (`:1285`) — it counts rows, not columns, so it needs **no** column change; confirm it doesn't SELECT columns (it should be a `COUNT(*)`).

## Implementation steps

1. Run `gitnexus_impact({target:"CharacterProfile",direction:"upstream"})` and `gitnexus_impact({target:"CharacterProfileSync",direction:"upstream"})` — report blast radius before editing. These are widely consumed structs; expect MEDIUM/HIGH.
2. Edit `character.go` (struct + DTO + both conversions).
3. Edit the 4 repository statements + scan targets.
4. Edit `sync_utils.go` SELECT + Scan.
5. Fix any test that inserts a column subset (verification noted `sync_utils_test.go:49`, `emotion_engine_test.go:363`, `eventserver/synchronization_test.go:929` insert partial columns — these still work because all new columns are nullable, but if any test does a `SELECT *`-shaped equality it must be updated).

## Code reference — nullable handling precedent

Mirror the existing nullable pattern (`character.go:68-73`):
```go
// existing VisionConfigID null-handling shape (copy for any nullable col that needs it):
if profile.VisionConfigID != "" {
    sync.VisionConfigID = &profile.VisionConfigID
}
```
For the new fields, plain `string` (empty ↔ NULL not required) is sufficient — JSON columns encode `{}`/`[]` and scalars encode `""`. Confirm the repository writes `NULL` when the string is empty **only if** you want NULL semantics; otherwise empty-string is fine and simpler.

## Verification

- [ ] `gitnexus_impact` run + blast radius reported.
- [ ] `character.go`: 14 fields on struct + DTO + both conversions.
- [ ] **New test:** `ToSyncModel`/`ToDBModel` round-trip — populate a `CharacterProfile` with all 14 new fields (non-empty), convert to sync DTO and back, assert all 14 fields survive unchanged (TDD).
- [ ] `character_profiles.go`: 4 statements + scans updated.
- [ ] `sync_utils.go`: SELECT + Scan updated; `CountChangedRecords` audited.
- [ ] `go build ./...` passes.
- [ ] `go test ./database/... ./eventserver/...` passes (fix subset-insert tests if needed).
- [ ] `gitnexus_detect_changes()` shows only expected symbols/flows affected.

## Notes / deviations

- JSON columns kept as raw `string` (matching `LifecycleConfig` precedent) — type-safe decode/encode happens at mapper/prompt-builder boundaries, not in the model. This is the lowest-churn choice and avoids a custom `sql.Scanner` per column.
- No `go-schema.json` lockstep comment to update (parity is CI-enforced — [00 §A9](00-VerificationAndGroundTruth.md)); the schema baseline itself is regenerated in [1-1](1-1-GoMigration000037.md).
