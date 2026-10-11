# Phase 2-6 — App+Engine: User-Owned Storage Backup & Restore

> **Repos:** `harmony-ai-app` + `harmony-link-private` (engine) + cloud backend (W1 escrow only — built in [2-5](2-5-CloudAccountMode.md))
> **Research basis:** [research-user-storage-backup.md](research-user-storage-backup.md) (decided 2026-10-11) — supersedes the original S3-snapshot-plane backup design: that plane belonged to the removed in-cloud session feature and is retired in [6-2](6-2-SnapshotPlaneAndKeyInfraRetirement.md)
> **Depends on:** 1-1/1-2 (Android embedding) for the Android path; 4-1/4-2 for the iOS path (native module lands with the engine module); 4-3 (iOS automatic scheduling — the backup rides its overnight `BGProcessingTask`); 2-5 (W1 escrow endpoint). **Not** dependent on the changeset machinery (v1 = full snapshots; deltas are a v2 consumer of 2-2's store).
> **Codebase mapping consulted:** `.planning/codebase/` — all three repos (ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md; TESTING.md where present)

## Objective

A WhatsApp-style continuity story with the operator storing **no user database data**: encrypted engine snapshots (DB + RAG store + media) written to **the user's own cloud storage**, restorable on a fresh device by signing in. Least friction per platform: iCloud on iOS (zero consent, system-uploaded), integrated OAuth targets + WebDAV + local export on Android, Google Drive only if Google ever grants written consent (interface-ready, not in v1).

## Design

### 1. Backup artifact pipeline (engine, Go — `modules/backup/`)

- **Snapshot:** `VACUUM INTO` the live WAL DB to a **plaintext temp file** in an app-private, no-backup-flagged staging dir → **zstd-3** (`klauspost/compress` — already in the engine's `go.mod` as a transitive **indirect** dep, v1.17.7; **promote to direct**, no new dependency weight) → **AEAD ChaCha20-Poly1305** under the **backup DEK** (per-object random nonce). Compress-then-encrypt, never the reverse (page-encrypted output is incompressible). Integrity = sha256 over the final object.
- **Side objects (content-addressed):** RAG store files + engine media blobs (data-dir audit in step 1 enumerates them) named by plaintext sha256, each zstd+AEAD'd, **uploaded on creation** (not per snapshot), deduped forever; the manifest references them. Rebuild-if-absent stays the engine's fallback (existing behavior).
- **Manifest (`manifest.json`) = single commit point:** format version, engine schema version, created_at, device label, baseline object (id, size, sha256), side-object list, AEAD/KDF params, **wrap entries W3 (+W4 if set)** — W1 lives at the account service (2-5), W2 in the keychain. Sequence per generation: upload objects → upload manifest (whole-object replace) → rotate previous to `manifest.prev.json` → GC unreferenced objects. Crash at any point leaves the old generation authoritative. **Retention: 2 generations.** Manifest fields (sizes/timestamps/count) are visible to the storage provider — accepted, documented.
- **Facade/management surface:** no engine "snapshot to file" API exists today; add facade + management route (`management/routes_backup.go`, pattern: `routes_config.go`): `CreateBackupArtifact(destDir)` / `RestoreArtifact(srcDir)` / `DataVersion()`.

### 2. Key management — hybrid wrap set (one random 256-bit backup DEK per lineage)

- **W1 account escrow** (all platforms; built in 2-5): sign in → restore works. v1 honest claim per research §3.5; SVR2-style enclave escrow is the documented upgrade path.
- **W2 iCloud Keychain wrap** (iOS): random unlock key stored as `kSecAttrSynchronizable` keychain item (`kSecAttrAccessibleAfterFirstUnlock`, app keychain-access-group) wrapping the DEK — zero-effort Apple-to-Apple restore.
- **W3 recovery code** (always set): 64-char code at backup setup — type-back confirmation, copy-to-password-manager button, re-displayable in settings; wraps a DEK copy in the manifest. The reset path, the Apple-ID-changed path, the desktop-standalone path.
- **W4 passphrase wrap** (opt-in): Argon2id (OWASP 2026: m=19 MiB, t=2, p=1) for the strong claim; leaves other paths intact.
- DEK regeneration = explicit user action ("reset backup key") with old-generation disclosure. Desktop peers never need the live DB key (changesets are logical deltas); standalone desktop restore uses W3/W1.

### 3. Targets — `BackupTarget` interface (engine Go; auth material supplied by the app layer)

| Target | v1 | Mechanics |
|---|---|---|
| `LocalFolderTarget` | ✓ all platforms | Engine stages artifact; app writes via Android SAF folder picker / iOS Files save / desktop path; share-sheet export = plain file share (a user share into their own Drive is their action, not our API use) |
| `WebDAVTarget` | ✓ | Engine-native client (PUT/GET/MKCOL/PROPFIND, TLS-validated); Nextcloud/Synology/self-host presets; credentials in `react-native-keychain` |
| `DropboxTarget` | ✓ | OAuth 2 + PKCE (App Folder), native-module flow → token to engine; engine REST upload (chunked >150 MB); terms permit (research §4) |
| `OneDriveTarget` | ✓ | MSAL PKCE, Graph `Files.ReadWrite.AppFolder`, upload sessions; same shape as Dropbox |
| `ICloudContainerTarget` | ✓ iOS | **Swift native module** ("HarmonyBackup"): engine stages to a local inbox; module moves files into the ubiquity container via NSFileCoordinator (container non-public — Manage Storage entry only, WhatsApp-parity); system `bird` daemon uploads (app death irrelevant); `NSMetadataQuery` for progress/restore listing |
| `GoogleDriveTarget` | **stub only** | Interface + impl sketch per research §1.3d; ships **only** with Google's written consent (request filed in parallel — open item in summary) |

### 4. Scheduling

- **Android:** WorkManager daily job — constraints Wi-Fi (default; cellular opt-in) + charging + idle; skip-if-unchanged (`DataVersion()` + side-object hashes); manual "Back up now".
- **iOS:** rides the 4-3 overnight `BGProcessingTask` deep sweep (requiresExternalPower + network); user-initiated "Back up now" adopts `BGContinuedProcessingTask` (iOS 26+) so it survives backgrounding; skip-if-unchanged.
- **Estimate UX:** reuse the estimate-confirm dialog contract — staging yields the exact artifact size; show "~X MB → your <target>, counts against your storage".
- **Auto Backup / D2D (Android complement):** `dataExtractionRules` — exclude the DB **and the staging dir** from `<cloud-backup>` (25 MB hard cap), include both in `<device-transfer>`. Tiers: D2D (full, local) → user-storage backup → Auto Backup (prefs).

### 5. Restore

Fresh install → sign in → probe targets (iCloud container metadata / integrated target list / account W1 presence) → show date/size/generation → fetch manifest → unwrap DEK via any available wrap (W1 auto; W2 auto on iOS; W3 code entry; W4 passphrase) → download + verify sha256 + AEAD-decrypt → decompress → engine validates (`PRAGMA integrity_check`, schema version) → assemble DB + RAG + media into the data dir → engine applies local at-rest policy and opens. Handle per-target failures: quota exceeded, revoked consent, wrong Google/Apple account (record target account identity in manifest), missing manifest (fresh start).

**Multi-device note (v1):** last-writer-wins with device label in the manifest; a restored device that also has a desktop peer goes through the 2-2 rejoin rule (baseline re-transfer) on next connect.

## Implementation steps

1. Engine: data-dir audit (enumerate RAG/media blobs) → `modules/backup/` (pipeline, manifest, targets: Local/WebDAV/Dropbox/OneDrive + GoogleDrive stub) + facade/management routes + `DataVersion()` marker.
2. App: `BackupOrchestrator` + native modules — Android (WorkManager scheduler, SAF saver, share export, Dropbox/OneDrive OAuth), iOS (HarmonyBackup module: ubiquity container + W2 keychain) — iOS parts land with 4-2.
3. App: settings UI (target picker, cadence, Wi-Fi-only, size display, "Back up now", recovery-code display/regenerate, passphrase opt-in, per-target status) + restore onboarding screen + honest-limits copy (research §3.5).
4. Android manifest rules (`dataExtractionRules` cloud-backup/device-transfer split).
5. Desktop parity (engine targets make this nearly free): Wails settings — "Back up to folder/WebDAV" + restore; uses W3/W1.
6. E2E: backup → wipe → restore round-trip per target; quota/revocation UX; kill-mid-upload (resumable where the target supports it); D2D complement verified.

## Files to create/modify

- Engine: `modules/backup/` (+ tests), `management/routes_backup.go`, facade hooks, `docs/Backup.md`
- App: `src/services/backup/BackupOrchestrator.ts` (+ provider adapters), native modules (`android/.../backup/`, `ios/.../HarmonyBackup/`), restore onboarding screen, settings screens, `dataExtractionRules`
- Both repos' CHANGELOG.md

## Verification gates

- Engine: `go build/vet/test ./...` green incl. round-trip, corrupted-object rejection (AEAD), tampered-manifest rejection, cross-key rejection
- App: `npx tsc --noEmit` 0 errors, full jest green
- Device smoke per platform: backup → wipe → restore on ≥1 integrated target + local export; iOS iCloud round-trip; D2D transfer carries the DB
- Honest-claim copy review (§3.5 matrix); zero operator storage of backup data (grep + review gate)

## Risks & rollback

- **Plaintext temp in staging** → app-private, no-backup-flagged dir; secure delete after staging; staging never on external storage
- Dropbox 2 GB free tier → exact size display + local/WebDAV alternatives surfaced; OneDrive 5 GB similar
- iCloud Keychain off / Apple ID changed → W3 recovery-code flow is the designed fallback; measure W2 hit rate during beta
- W1 escrow compromise → honest claim + narrow store (wrapped blob only); SVR2 upgrade path documented
- Provider API churn → small per-target surface behind one interface; targets independently disableable
- Users confusing user-storage backups with the old invisible cloud copy → expectation-setting copy at first backup (quota counting is now the user's problem — WhatsApp-trained users will recognize it)

## Progress checklist

- [ ] Engine artifact pipeline + manifest + integrity tests
- [ ] Engine targets (Local/WebDAV/Dropbox/OneDrive + Drive stub) + facade/management routes
- [ ] App orchestrator + Android native modules + WorkManager scheduling
- [ ] iOS HarmonyBackup module (with 4-2) + BGTask scheduling
- [ ] Settings UI + recovery-code/passphrase flows
- [ ] Restore onboarding + per-target failure UX
- [ ] Android dataExtractionRules (cloud-backup exclusion / device-transfer inclusion)
- [ ] Desktop parity (Wails export/restore)
- [ ] E2E round-trips green per target
