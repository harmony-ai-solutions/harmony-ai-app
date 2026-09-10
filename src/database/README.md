# Harmony AI App - SQLite Database Layer

This directory contains the complete database infrastructure for the Harmony AI mobile app, with schema and structure matching Harmony Link for seamless data synchronization.

## ✅ Implemented Components

### Core Infrastructure
- **✅ Connection Management** (`connection.ts`)
  - Encrypted SQLite database with SQLCipher
  - Secure key storage via React Native Keychain
  - Automatic key generation and persistence
  - Foreign keys enabled, WAL mode configured
  
- **✅ Migration System** (`migrations.ts`)
  - Forward-only migrations (no rollback)
  - 4 migrations copied from Harmony Link
  - Automatic pending migration detection
  - Transaction-safe migration application

- **✅ Type Definitions** (`types.d.ts`, `models.ts`)
  - Complete TypeScript interfaces matching Go structs
  - All 3 core models (Entity, CharacterProfile, EntityModuleMapping)
  - All 11 provider config models
  - All 6 module config models
  - CharacterImage model

- **✅ Transaction Helpers** (`transaction.ts`)
  - `withTransaction()` wrapper for atomic operations
  - Automatic rollback on error
  - Promise-based API

- **✅ Metro Configuration** (`metro.config.js`)
  - SQL files bundled as assets
  - Imported as strings at build time

## 📁 Directory Structure

```
src/database/
├── connection.ts          # Database initialization & connection
├── migrations.ts          # Migration system
├── models.ts              # TypeScript interfaces
├── transaction.ts         # Transaction helpers
├── types.d.ts            # Type declarations
├── README.md             # This file
├── migrations/           # SQL migration files
│   ├── 000001_initial_schema.sql
│   ├── 000002_make_character_profile_optional.sql
│   ├── 000003_add_character_card_fields.sql
│   └── 000004_add_cognition_generate_expressions.sql
└── repositories/         # Data access layer (TO BE IMPLEMENTED)
    ├── entities.ts       # TODO: Entity & EntityModuleMapping CRUD
    ├── characters.ts     # TODO: CharacterProfile & CharacterImage CRUD
    ├── modules.ts        # TODO: Module configs CRUD
    └── providers.ts      # TODO: Provider configs CRUD
```

## 🚀 Usage

### Initialize Database (App Startup)

```typescript
import {initializeDatabase} from './database/connection';

// In App.tsx or app initialization
useEffect(() => {
  initializeDatabase()
    .then(() => console.log('Database ready'))
    .catch(error => console.error('Database init failed:', error));
}, []);
```

### Using Transactions

#### ⚠️ CRITICAL: Transaction Helper Limitations

The `withTransaction()` helper has a **major limitation** in React Native SQLite:

**❌ DO NOT use it for transactions that issue more than ONE `await tx.executeSql()` per callback.**

react-native-sqlite-storage's `tx.executeSql` is **callback-based** — it does *not* return a Promise. Inside an async `withTransaction` callback, `await tx.executeSql(...)` therefore just defers to a microtask; it does not wait for the statement. The library's `SQLitePluginTransaction.start()` (see `node_modules/react-native-sqlite-storage/lib/sqlite.core.js`) runs your callback **synchronously** and finalizes the transaction right after the callback's synchronous portion returns. Consequences:

- **One awaited statement is safe.** The `tx.executeSql(...)` *call itself* runs synchronously — the statement is queued before the `await` yields — so the transaction still executes it.
- **A second `await tx.executeSql(...)` in the same callback throws** `InvalidStateError: DOM Exception 11: This transaction is already finalized.` The second call is issued from a microtask, after the transaction has already been finalized.
- **INSERT returning `insertId` is also broken**: `await tx.executeSql(...)` yields `undefined` (no result set), so you can never read the auto-generated ID.

If you see DOM Exception 11 at runtime, you have more than one `await tx.executeSql(...)` inside a single `withTransaction` callback — even "harmless" pairs of UPDATEs (e.g. a soft-delete that also touches a child table). The fix is the callback-form `db.transaction` with nested success callbacks (see below).

> ⚠️ **Why the tests don't catch this:** the NodeDatabase test double (`__test_utils__/nodeDatabase.ts`) implements a *proper* promise-based `tx.executeSql`, which is strictly more lenient than the real RN adapter. Code that passes all Jest DB tests can still throw DOM Exception 11 on device. The RN-semantics double in `entities.test.ts` (`createRunToCompletionDatabase`) reproduces the real behaviour.

#### ✅ Correct Pattern for INSERT with insertId

Use **direct transaction callbacks** with Promise wrappers:

```typescript
import {getDatabase} from './database/connection';

const db = getDatabase();

// ✅ CORRECT: Direct transaction callback pattern
export async function createEntity(entity: Entity): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    db.transaction(
      (tx) => {
        tx.executeSql(
          'INSERT INTO entities (id, name) VALUES (?, ?)',
          [entity.id, entity.name],
          (_, result) => {
            resolve(result.insertId!);  // ✅ Works correctly
          },
          (_, error) => {
            reject(error);
            return false;
          }
        );
      },
      (error) => reject(error)
    );
  });
}
```

#### ✅ Correct Pattern for Multiple Sequential Statements

For operations with multiple statements (like updating multiple rows):

```typescript
// ✅ CORRECT: Nested callbacks for sequential operations
export async function setPrimaryImage(profileId: string, imageId: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    db.transaction(
      (tx) => {
        // First operation
        tx.executeSql(
          'UPDATE images SET is_primary = 0 WHERE profile_id = ?',
          [profileId],
          () => {
            // Second operation in success callback
            tx.executeSql(
              'UPDATE images SET is_primary = 1 WHERE id = ?',
              [imageId],
              () => resolve(),
              (_, error) => {
                reject(error);
                return false;
              }
            );
          },
          (_, error) => {
            reject(error);
            return false;
          }
        );
      },
      (error) => reject(error)
    );
  });
}
```

> 💡 **Prefer the helper:** for anything beyond a couple of statements, use the exported `runStatementsInTransaction(db, statements)` helper from `./database/transaction` (re-exported from `./database`). It wraps exactly this nested-callback pattern in a `Promise`, chaining each statement from the previous one's success callback:
>
> ```typescript
> import {runStatementsInTransaction} from './database';
>
> // ✅ CORRECT: Sequential multi-statement transaction (RN-safe)
> await runStatementsInTransaction(db, [
>   {sql: 'UPDATE images SET is_primary = 0 WHERE profile_id = ?', params: [profileId]},
>   {sql: 'UPDATE images SET is_primary = 1 WHERE id = ?', params: [imageId]},
> ]);
> ```
>
> Resolves when the last statement succeeds; rejects on any statement error or transaction rollback.

#### ✅ When withTransaction() IS Safe to Use

The `withTransaction()` helper can be used for — **provided the callback contains only ONE `await tx.executeSql()`**:
- UPDATE operations that don't need return values (other than rowsAffected check)
- DELETE operations that don't need return values (other than rowsAffected check)
- Operations where you construct the return value from input data

> ⚠️ **Rule of thumb:** one `await tx.executeSql()` per `withTransaction` callback. The instant you need a second statement, switch to the callback-form `db.transaction` with nested success callbacks (previous section). Do not "just add another `await`".

```typescript
// ✅ SAFE: UPDATE that returns input object
await withTransaction(db, async (tx) => {
  const now = new Date().toISOString();
  await tx.executeSql(
    'UPDATE entities SET name = ?, updated_at = ? WHERE id = ?',
    [entity.name, now, entity.id]
  );
  return {...entity, updated_at: new Date(now)};  // ✅ Constructed from input
});

// ✅ SAFE: DELETE with rowsAffected check
await withTransaction(db, async (tx) => {
  const [result] = await tx.executeSql(
    'DELETE FROM entities WHERE id = ?',
    [id]
  );
  if (result.rowsAffected === 0) {
    throw new Error('Entity not found');
  }
});
```

#### Summary Table

| Operation | Use withTransaction()? | Pattern |
|-----------|------------------------|---------|
| Single statement (one `await tx.executeSql`) | ✅ YES | `withTransaction` is fine |
| INSERT returning `insertId` | ❌ NO | Callback-form `db.transaction` + Promise wrapper |
| Second+ `await tx.executeSql()` in the same callback | ❌ NO | `runStatementsInTransaction(db, statements)` (or manual nested `executeSql` success callbacks) |
| SELECT queries | ✅ YES | Either pattern (reads don't mutate) |

**Root Cause:** react-native-sqlite-storage's `tx.executeSql` is callback-based (returns `undefined`, not a Promise), and `SQLitePluginTransaction.start()` finalizes the transaction immediately after the callback's *synchronous* portion returns. `await`-ing `tx.executeSql` only defers to a microtask — so the first statement is queued synchronously and runs, but a second statement queued from a microtask hits an already-finalized transaction and throws `InvalidStateError: DOM Exception 11: This transaction is already finalized.`

## 📋 Schema Overview

### Core Tables
- **character_profiles**: Character identity & personality
- **entities**: Active instances
- **entity_module_mappings**: Links entities to module configurations

### Provider Config Tables (11 types)
- provider_config_openai
- provider_config_openrouter
- provider_config_openaicompatible
- provider_config_harmonyspeech
- provider_config_elevenlabs
- provider_config_kindroid
- provider_config_kajiwoto
- provider_config_characterai
- provider_config_localai
- provider_config_mistral
- provider_config_ollama

### Module Config Tables (6 types)
- backend_configs
- movement_configs
- stt_configs
- cognition_configs
- rag_configs
- tts_configs

### Additional Tables
- character_image: Character avatars with BLOB storage
- schema_migrations: Migration tracking

## 🔐 Encryption

- **Algorithm**: SQLCipher (industry-standard SQLite encryption)
- **Key Size**: 256 bits (32 bytes)
- **Key Storage**: React Native Keychain (hardware-backed when available)
- **Key Generation**: Cryptographically secure random generation
- **Auto-Management**: Keys generated on first launch, retrieved on subsequent launches

### Encryption Key Management

```typescript
// Encryption is automatic - no manual key management needed
// Keys are stored securely in the device keychain
// Keys persist across app restarts
```

## 🔄 Schema Synchronization

The database schema is **identical** to Harmony Link's schema to enable:
- Seamless data export/import between desktop and mobile
- Future cloud synchronization
- Consistent data models across platforms

### Migration Matching

| Version | Description | Source |
|---------|-------------|--------|
| 1 | Initial schema | Harmony Link migration 000001 |
| 2 | Optional character_profile_id | Harmony Link migration 000002 |
| 3 | Character card fields + images | Harmony Link migration 000003 |
| 4 | Cognition generate_expressions | Harmony Link migration 000004 |

## ⚠️ Important Notes

### Foreign Key Constraints
- **ALWAYS ENABLED**: `PRAGMA foreign_keys = ON`
- CASCADE deletes work as expected
- Critical for data integrity

### Date Handling
- SQLite stores dates as TEXT (ISO 8601 format)
- Convert to/from JavaScript Date in repository layer
- Use `CURRENT_TIMESTAMP` for defaults

### BLOB Data
- `character_image.image_data`: Store as Uint8Array
- `character_image.vl_model_embedding`: Store as Uint8Array
- Convert to/from Base64 for API transport

### NULL vs Empty String
- Follow Go conventions: use NULL for absent data
- Empty strings ('') only for explicitly empty text

## 🔨 Next Steps (Repository Layer)

### Priority 1: Entity Repository
```typescript
// src/database/repositories/entities.ts
export async function createEntity(entity: Entity): Promise<void>
export async function getEntity(id: string): Promise<Entity | null>
export async function getAllEntities(): Promise<Entity[]>
export async function updateEntity(entity: Entity): Promise<void>
export async function deleteEntity(id: string): Promise<void>
// + EntityModuleMapping CRUD
```

### Priority 2: Character Repository
```typescript
// src/database/repositories/characters.ts
export async function createCharacterProfile(profile: CharacterProfile): Promise<void>
export async function getCharacterProfile(id: string): Promise<CharacterProfile | null>
// + CharacterImage CRUD with BLOB handling
```

### Priority 3: Module & Provider Repositories
- Implement CRUD for all 6 module config types
- Implement CRUD for all 11 provider config types
- Consider generic repository pattern to reduce boilerplate

## 🧪 Running Database Tests

### In-App Test Runner (Development Only)

The easiest way to run database tests is using the built-in test runner screen:

1. **Launch the app in development mode:**
   ```bash
   npm run android
   # or
   npm run ios
   ```

2. **Navigate to Settings:**
   - Tap the hamburger menu (settings icon)
   - Look for **"Database Tests"** with a yellow "DEV" badge
   - This option only appears in development builds

3. **Run Tests:**
   - Tap "Run All Tests" button
   - Watch real-time console output
   - See color-coded results (✅/❌)
   - View summary of passed/failed tests

4. **Features:**
   - Real-time test execution in React Native environment
   - Uses actual SQLite database with encryption
   - Tests all repository functions (entities, characters, modules, providers)
   - Clear console output between runs
   - Progress indicators

**Note:** The test runner screen is automatically hidden in production builds thanks to `__DEV__` checks.

### Testing Checklist

- [x] Database initializes on first launch
- [x] Encryption key generated and stored
- [x] Encryption key retrieved on subsequent launches
- [x] All 4 migrations execute successfully
- [x] `schema_migrations` table has 4 entries
- [x] Foreign key constraints enforced
- [x] Transactions commit on success
- [x] Transactions rollback on error
- [x] Entity CRUD operations
- [x] Character profile CRUD operations
- [x] Module mapping updates
- [x] CASCADE deletes work correctly
- [x] BLOB data (images) store/retrieve correctly

## 📚 Additional Resources

- [Harmony Link Database Schema](../../../harmony-link-private/database/)
- [SQLite Documentation](https://www.sqlite.org/docs.html)
- [SQLCipher Documentation](https://www.zetetic.net/sqlcipher/)
- [React Native SQLite Storage](https://github.com/andpor/react-native-sqlite-storage)

## 🐛 Troubleshooting

### Build Errors
- **"Cannot find module '*.sql'"**: Restart Metro bundler (`npm start --reset-cache`)
- **TypeScript errors**: Ensure `types.d.ts` is in `src/database/`
- **"Database not initialized"**: Call `initializeDatabase()` before any DB operations

### Runtime Errors
- **"FOREIGN KEY constraint failed"**: Enable foreign keys with `PRAGMA foreign_keys = ON`
- **"Database is locked"**: Ensure transactions are properly closed
- **"Encryption error"**: Check keychain permissions in iOS Info.plist

## 📝 Migration Workflow

### Adding New Migrations

1. Create new SQL file: `000005_description.sql`
2. Add to `migrations.ts`:
   ```typescript
   const migration005 = require('./migrations/000005_description.sql');
   
   const MIGRATIONS: Migration[] = [
     // ... existing migrations
     { version: 5, description: 'description', sql: migration005 },
   ];
   ```
3. Database will auto-apply on next launch

### Schema Changes

**IMPORTANT**: Any schema changes must be:
1. Applied to Harmony Link first
2. Tested with Harmony Link
3. Migration SQL copied exactly to mobile app
4. TypeScript models updated to match

This ensures schema compatibility for data sync.
