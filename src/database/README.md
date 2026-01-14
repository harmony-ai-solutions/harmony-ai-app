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

```typescript
import {getDatabase} from './database/connection';
import {withTransaction} from './database/transaction';

const db = getDatabase();

await withTransaction(db, async (tx) => {
  // All operations here are atomic
  await tx.executeSql('INSERT INTO entities (id) VALUES (?)', ['entity-1']);
  await tx.executeSql('INSERT INTO character_profiles (id, name) VALUES (?, ?)', 
    ['profile-1', 'Alice']
  );
  // Auto-commit on success, auto-rollback on error
});
```

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

## 🧪 Testing Checklist

### Manual Testing
- [ ] Database initializes on first launch
- [ ] Encryption key generated and stored
- [ ] Encryption key retrieved on subsequent launches
- [ ] All 4 migrations execute successfully
- [ ] `schema_migrations` table has 4 entries
- [ ] Foreign key constraints enforced
- [ ] Transactions commit on success
- [ ] Transactions rollback on error

### Integration Testing
- [ ] Entity CRUD operations
- [ ] Character profile CRUD operations
- [ ] Module mapping updates
- [ ] CASCADE deletes work correctly
- [ ] BLOB data (images) store/retrieve correctly

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
