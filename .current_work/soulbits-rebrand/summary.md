# Soulbits Rebrand — harmony-ai-app

> **Overview**: Rename all Harmony Link references in the mobile app to Soulbits Engine naming, in preparation for public rebrand. This repo is already public, so changes must be coordinated with users.

## Implementation Status

- [ ] **Phase 1: AsyncStorage Keys** ([1-AsyncStorageKeys.md](./1-AsyncStorageKeys.md))
  Modify all persistent storage key names (`harmony_jwt` → `soulbits_jwt`, etc.)
  ⚠️ Needs migration logic for existing users

- [ ] **Phase 2: Build Config Fields** ([2-BuildConfigFields.md](./2-BuildConfigFields.md))
  Rename Gradle buildConfig fields from `HARMONY_LINK_WSS_URL` to `SOULBITS_ENGINE_WSS_URL`
  
- [ ] **Phase 3: Database Migrations** ([3-DatabaseMigrations.md](./3-DatabaseMigrations.md))
  Create new migration `000033` to rename `device_type` values in both repos

- [ ] **Phase 4: E2E Infrastructure** ([4-E2EInfrastructure.md](./4-E2EInfrastructure.md))
  Update CI workflows, docker-compose, env vars (`HL_*` → `SE_*`)

- [ ] **Phase 5: Code Identifiers** ([5-CodeIdentifiers.md](./5-CodeIdentifiers.md))
  Rename TypeScript identifiers, mock classes, test data

- [ ] **Phase 6: Documentation** ([6-Documentation.md](./6-Documentation.md))
  Update docs, comments, README files
