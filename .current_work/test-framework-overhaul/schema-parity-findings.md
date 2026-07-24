# Schema Parity Findings

Generated: 2026-07-20

## Overview

| Metric | Value |
|--------|-------|
| RN entries | 53 (17 indexes, 36 tables) |
| Go entries | 53 (17 indexes, 36 tables) |
| Matching entries | 44 |
| Diverging entries | 9 |
| RN-only entries | 0 |
| Go-only entries | 0 |

## Entry Count Parity

Both sides produce **exactly 53 entries** with the same set of table and index names. No entries are missing from either side — the divergence is entirely in SQL text differences.

## Divergences

### 1. `table:conversation_messages` — CRITICAL

**Severity: Silent data corruption risk**

| Attribute | RN | Go |
|-----------|-----|----|
| `id` | `TEXT PRIMARY KEY NOT NULL` | `TEXT PRIMARY KEY` (PK implies NOT NULL) |
| `content` | `TEXT NOT NULL` | `TEXT NOT NULL DEFAULT ''` |
| `message_type` | `TEXT NOT NULL` | `TEXT NOT NULL DEFAULT 'text'` |
| `audio_data` | `TEXT` | `BLOB` |
| `image_data` | `TEXT` | `BLOB` |
| `is_recon_followup` | `INTEGER NOT NULL DEFAULT 0` | `BOOLEAN NOT NULL DEFAULT 0` |
| `is_edited` | `INTEGER NOT NULL DEFAULT 0` | `BOOLEAN NOT NULL DEFAULT 0` |
| `edit_of_message_id` | `TEXT` | (present on both sides) |
| `interaction_id` | `TEXT` (positioned after `edit_of_message_id`) | `TEXT` (positioned after `is_edited`) |
| `created_at` | `TEXT NOT NULL` | `TIMESTAMP DEFAULT CURRENT_TIMESTAMP` |
| `updated_at` | `TEXT NOT NULL` | `DATETIME DEFAULT CURRENT_TIMESTAMP` |
| `deleted_at` | `TEXT` | `DATETIME` |
| FOREIGN KEY | **Missing** | `FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE` |

**Suggested fix:** RN side is canonical? Or Go side? Need triage — the missing FOREIGN KEY on RN side could cause orphaned records during sync. The type differences (TEXT vs DATETIME, TEXT vs BLOB) are serious.

### 2. `table:entity_emoji_actions` — MODERATE

**Severity: Type mismatch, possible truncation**

| Attribute | RN | Go |
|-----------|-----|----|
| `created_at` | `TEXT NOT NULL` | `DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP` |
| `updated_at` | `TEXT NOT NULL` | `DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP` |
| `deleted_at` | `TEXT DEFAULT NULL` | `DATETIME DEFAULT NULL` |
| Comments | None | Go has inline SQL comments documenting fields |

**Suggested fix:** Both sides should use `DATETIME` for timestamps. RN side is likely wrong.

### 3. `table:interactions` — CRITICAL

**Severity: Silent data corruption risk**

| Attribute | RN | Go |
|-----------|-----|----|
| `started_at` | `TEXT NOT NULL` | `DATETIME NOT NULL` |
| `last_activity_at` | `TEXT NOT NULL` | `DATETIME NOT NULL` |
| `ended_at` | `TEXT` | `DATETIME` |
| `deleted_at` | `TEXT` | `DATETIME` |
| `created_at` | `TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP` | `DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP` |
| `updated_at` | `TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP` | `DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP` |
| `memory_id` | `TEXT` (no NULL) | `TEXT NULL` |
| `continued_interaction_id` | `TEXT` (no NULL) | `TEXT NULL` |
| FOREIGN KEY | **Missing** | `FOREIGN KEY (entity_id) REFERENCES entities(id)` |
| Comments | None | Go has extensive inline comments |

**Suggested fix:** RN side uses TEXT for timestamps. This is a migration-level issue — the RN migration `000024_create_interactions_table.ts` diverged from the Go migration. Need to reconcile.

### 4. `table:entities` — MINOR

| Attribute | RN | Go |
|-----------|-----|----|
| `alias` | `TEXT NOT NULL` | `TEXT NOT NULL DEFAULT ''` |

**Severity:** Low. SQLite treats NULL vs '' differently; missing DEFAULT could cause NOT NULL constraint violations if alias is not provided.

### 5. `table:sync_history` — MODERATE

| Attribute | RN | Go |
|-----------|-----|----|
| `updated_at` | **Missing** | `updated_at DATETIME DEFAULT CURRENT_TIMESTAMP` |
| Comments | None | Go has inline comments |

**Severity:** Moderate. RN side is missing the `updated_at` column entirely. This column is used for conflict resolution during sync. Missing it means sync history records won't have update tracking on the RN side.

### 6. `table:emotion_state` — COSMETIC

**Difference:** Go has inline SQL comments (e.g., `-- Ekman8 intensity columns`), RN does not.

**Severity:** Cosmetic — comments don't change schema behavior. RN normalization doesn't strip comments, so they appear in the dump.

### 7. `table:memories` — COSMETIC

**Difference:** Go has inline SQL comments, RN does not.

**Severity:** Cosmetic.

### 8. `table:provider_config_soulbitscloud` — COSMETIC

**Difference:** Go has inline SQL comments, RN does not. Column SQL is identical.

**Severity:** Cosmetic.

### 9. `table:sync_devices` — COSMETIC

**Difference:** Go has inline SQL comments, RN does not. Column SQL is identical.

**Severity:** Cosmetic.

## Summary of Severities

| Severity | Count | Entries |
|----------|-------|---------|
| CRITICAL | 2 | `conversation_messages`, `interactions` |
| MODERATE | 2 | `sync_history`, `entity_emoji_actions` |
| MINOR | 1 | `entities` |
| COSMETIC | 4 | `emotion_state`, `memories`, `provider_config_soulbitscloud`, `sync_devices` |

## Root Cause Analysis

1. **Comments drift (4 entries):** Go migrations include inline SQL comments (e.g., `-- Ekman8 intensity columns`). RN migrations don't have these comments. Since SQLite stores comments in `sqlite_master.sql`, the dumps differ. Fix: add matching comments to RN migrations, or strip comments during normalization on both sides.

2. **Type divergence (5 entries):** RN migrations use `TEXT` for timestamp columns where Go uses `DATETIME` or `TIMESTAMP`. SQLite treats these as type affinity (all are TEXT affinity), so the behavior is identical at runtime. However, the dump differs. Fix: harmonize to use `DATETIME` consistently (Go side is canonical — the server ships first).

3. **Missing DEFAULTs:** RN side omits `DEFAULT ''` on some TEXT columns and omits `DEFAULT CURRENT_TIMESTAMP` on some timestamp columns. This could cause runtime differences in edge cases.

4. **Missing FOREIGN KEY (2 entries):** RN `conversation_messages` and `interactions` tables lack FOREIGN KEY constraints that exist in the Go schema. This is a material difference that affects data integrity during sync.

5. **Missing column (1 entry):** RN `sync_history` table lacks the `updated_at` column. This column is used for conflict resolution.

## Recommendations

1. **Fix critical divergences first** — `conversation_messages` FK and types, `interactions` FK and types. These are the most likely cause of silent sync data corruption.

2. **Fix moderate divergences** — `sync_history` missing `updated_at`, timestamp types in `entity_emoji_actions`.

3. **Harmonize comment style** — Either add comments to RN migrations or strip comments during normalization on both sides (preferred: strip during normalization since comments are documentation, not schema).

4. **Run parity gate weekly** until divergences are resolved, then enforce in CI on every PR that touches migrations.

## Next Actions

- [ ] Triage CRITICAL divergences: determine which side is canonical for each table
- [ ] File fix PRs in the appropriate repo
- [ ] Re-generate both baselines after fixes
- [ ] Re-run comparison: target 0 divergences

## Raw Comparison Output

```
Matching:         44
RN-only:          0
Go-only:          0
Different SQL:    9
```
