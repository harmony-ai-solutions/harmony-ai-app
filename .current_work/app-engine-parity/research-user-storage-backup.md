# Research — User-Owned Cloud Storage Backup (Google Drive / iCloud / Alternatives)

> **Compiled:** 2026-10-11, via parallel research subagents (web-verified, primary sources fetched live) + codebase inventory
> **Purpose:** design basis for the backup subsystem replacing the retired S3 snapshot plane + per-user DEK infrastructure (the in-cloud session feature's backup mechanic). The operator's cloud stores **no user database data** after this plan; backups go to the **user's own cloud storage**, WhatsApp-style, with least friction.
> **Consumed by:** [2-5-CloudAccountMode.md](2-5-CloudAccountMode.md), [2-6-UserStorageBackupRestore.md](2-6-UserStorageBackupRestore.md), Phase 6 (6-2 especially)
> Labels: VERIFIED (primary source) / REPORTED (secondary source) / INFERRED (synthesis)

## FINAL DECISIONS (ruled 2026-10-11)

| Decision | Ruling | Rationale digest |
|---|---|---|
| Android strategy | **Drive-ready, no Drive API in v1.** Local export (SAF + share sheet) always available; integrated targets: WebDAV, Dropbox, OneDrive. Google consent request filed in parallel; provider interface accepts a Drive target if consent is ever granted | Drive API ToS explicitly restricts app-content backup without written consent (§1.3b); no responsive consent route exists (§1.3c); Dropbox/OneDrive terms permit it (§4) |
| iOS mechanism | **iCloud Drive ubiquity container** (WhatsApp-exact): opaque encrypted files, invisible in Files, app-named in iCloud → Manage Storage, zero consent friction, system daemon owns the upload | §2.2 Option B beats CloudKit on friction/WhatsApp-parity; weak error surface acceptable for 1–2 files |
| Key custody | **Hybrid wrap set** on one random 256-bit backup DEK: W1 account escrow (server-side KEK, v1; SVR2-style enclave as upgrade path) + W2 iCloud-Keychain-synced key (iOS) + W3 recovery code (always set) + W4 opt-in passphrase. Wrap copies: manifest carries W3/W4; account service holds W1; keychain holds W2 | Multi-path precedent = WhatsApp (password/64-digit/passkey) + Signal (30-digit local / 64-char cloud); Android has **no** synced app-secret store, so W1 is what makes Android restore "sign in and go" |
| Backup content | **DB + RAG store + media**, all content-addressed objects; no re-embedding on restore | Zero token cost & no provider dependency at restore; vectors/media compress well (§3.2) |
| v1 artifact strategy | **Full snapshots** (skip-if-unchanged), manifest format designed to accept delta objects in v2 (Phase 2 changesets dual-use) | Launch-scale DBs are small; daily fulls ≈ fine; delta chain = new failure mode not worth it at launch |
| Cadence & retention | Daily opportunistic (Wi-Fi + charging + idle; cellular opt-in), manual "Back up now", **keep 2 generations** (manifest.prev), upload-then-commit | WhatsApp/Signal keep 1; 2 is nearly free and rescues "I deleted something yesterday" |
| Cleanup decomposition | **Phase 6, 4 sub-phases**: 6-1 session infra · 6-2 snapshot plane + DEK + purge rework · 6-3 engine-import zeroing + relicensing · 6-4 engine dead-code | Inventory §5; natural blast-radius boundaries |

Also ruled: GDPR Art. 20 plaintext export = flagged follow-up (encrypted blob ≠ portability); `baremetal-scheduler` stub deleted (its rationale dies with the warm pool); lifecycle-dispatcher's DLQ-drainer deleted wholesale with the dispatcher (correction: `pkg/dlqarchive` has no other importer — the inference gateway's `drainer/` is ALB connection-draining; `dlq-archive` is a prefix inside s3-internal-assets, not a bucket); desktop gets the same artifact pipeline behind the Wails UI (engine-side targets make this nearly free).

---

## 1. Android — Google Drive

### 1.1 What WhatsApp actually does (and why we can't copy it exactly)

- WhatsApp writes to the **Drive "Backups" area** (visible in Drive → Storage → Backups) — a **reserved folder with no public API**; third-party apps cannot register there (VERIFIED: developers.google.com/workspace/drive/api/guides/appdata; corroborated by SO 48435960).
- WhatsApp backups **count against the user's 15 GB/Google One quota** since Nov 2024 (VERIFIED: support.google.com/drive/answer/9312312). Only the newest backup is kept; ~5 months of inactivity may trigger auto-deletion (REPORTED: faq.whatsapp.com/407643231403807).
- **The replicable third-party equivalent would be `appDataFolder`** — hidden, per-app, purpose-built — but see §1.3.

### 1.2 `appDataFolder` mechanics (VERIFIED unless noted — appdata guide, updated 2026-09-03)

- Only the creating app can see/modify it; not browsable in any Drive UI.
- Uninstalling the Android app does NOT delete it — the grant is keyed server-side to the OAuth client (package name + SHA-1). Survives reinstall & device switch. (Grant semantics VERIFIED; survival INFERRED from server-side keying.)
- **User disconnecting the app in Drive settings deletes the whole folder permanently** — no trash in appDataFolder. Must handle 404 `notFound` + re-consent.
- Counts against the user's Google storage quota ("hidden app data" listed explicitly — VERIFIED). User can audit/delete via Drive (web) → Settings → Manage Apps.
- List/query: `files.list spaces=appDataFolder` returns `id,name,size,modifiedTime` — enough for a restore screen without downloading.

### 1.3 The ToS blocker (why Drive is not in v1)

**(a) The clause** — Google Drive API Terms, "Customer implementation" section (VERIFIED, fetched 2026-10-11):

> "The Drive API is not allowed for certain use cases without Google's express prior written consent, including the following: **Backup of user or app content from a developer's app or project to Drive.** Cryptocurrency mining. Broad video distribution or dissemination of copyrighted content without authorization. Using Drive as a replacement for a large-scale content delivery network (CDN). File cloning tools that enable sharding of user storage and/or circumvention of Drive storage limits."

**(b) The inferred rationale** — every list-mate is a "don't use Drive as free infrastructure at scale" concern; the backup clause targets developers offloading app-storage economics onto consumer quota. History: Google stored WhatsApp backups quota-free ~8 years (ended Nov 2024); appDataFolder began counting ~2022; all Android backup data counts since Jul 2026. Not a privacy rule — a cost rule. (INFERRED from the list + quota timeline; **no official rationale statement exists**.) Note the asymmetry: the same ToS *allows* apps providing "local sync or automatic backup of **users' Drive files**" — backing up Drive→device is fine; app→Drive is the gated direction.

**(c) No consent route** — Google's own developer forum has **three unanswered threads** asking exactly this (Sept–Oct 2026): "Policy clarification: Backing up personal photos to Drive" (discuss.google.dev/t/397019), "…uploading a user's own recordings to their My Drive with drive.file" (t/402029), and "**Official route for prior written consent** under Drive API Customer implementation policies" (t/401812, 882 views, zero replies). WhatsApp's consent was a bespoke partner arrangement with no published small-developer process. (VERIFIED: threads fetched, all zero replies.)

**(d) Scope classification** (would matter if consent were obtained): `drive.appdata` and `drive.file` are **non-sensitive** (no OAuth verification, no CASA); restricted scopes (`drive`, `drive.metadata*`…) require full verification + annual CASA (VERIFIED, api-specific-auth guide 2026-09-03). Upload mechanics if ever needed: resumable sessions (1-week expiry, 256 KB-multiple chunks, `files.create`→`files.update` PATCH), revision double-count ~30 days after in-place update, `403 storageQuotaExceeded`/`401 authError`/`404 notFound` error surface; auth via `AuthorizationClient.authorize()` (silent after first grant, ~1 h tokens, no refresh tokens on-device) — full detail in the agent report if Drive is ever enabled.

### 1.4 Android Auto Backup / D2D (complement) — VERIFIED, autobackup/backup docs

- **25 MB hard per-app cap** (over-quota = nothing backed up); free, does NOT count against user quota; E2E-encrypted with screen lock; only latest kept.
- Our encrypted DB will exceed 25 MB → **exclude the DB (and backup staging dir) from `<cloud-backup>` in `dataExtractionRules`**, **include it in `<device-transfer>`** so D2D carries the full DB locally on new-device setup. Three recovery tiers: D2D (full, fast, local) → user-storage backup (full, on-demand) → Auto Backup (small prefs).

---

## 2. iOS — iCloud

### 2.1 What WhatsApp actually does

Backups are opaque encrypted files (`.ChatStorage.sqlite.enc.icloud`, `.Media.tar.icloud`, `.Backup.plist.icloud`) in WhatsApp's **iCloud Drive ubiquity container** (REPORTED: filesystem evidence, timmyomahony.com); iCloud Drive must be enabled; entry shows as "WhatsApp Messenger" in Settings → Apple ID → iCloud → Manage Storage, counting against the user's plan; daily/weekly/monthly/off cadence + "Back Up Now"; quota exhaustion stops uploads. E2EE (opt-in since 2021): random key secured by password (escrowed in Meta's **HSM Backup Key Vault** with attempt limits) or a 64-digit key; 2025 adds a **passkey** option riding the OS password manager (VERIFIED: engineering.fb.com 2021 + 2026 labyrinth post; wabetainfo).

### 2.2 Options matrix (2026 state)

| Criterion | A: CloudKit CKAsset | **B: iCloud Drive container ✓** | C: System iCloud Backup | D: NSPersistentCloudKitContainer |
|---|---|---|---|---|
| Fit for 10 MB–1 GB opaque blob | Good (assets sized for GBs; no published native cap) | Good (≤50 GB/file) | ✗ (device-setup restore only) | ✗ (Core Data mirroring, no blobs) |
| Fresh-install restore on new device | ✓ query after iCloud sign-in | ✓ container appears after sign-in | **✗ — no API to fetch a prior device's backup on an already-set-up device** | ✓ (wrong data model) |
| Upload survives app kill | ✓ long-lived CKOperations (daemon) | ✓✓ **system `bird` daemon uploads** — strongest | n/a | ✓ |
| User visibility | Manage Storage entry only | Manage Storage entry; Files-app visibility **optional** (WhatsApp keeps it off) | opaque "Backup" | Manage Storage entry |
| Error surface | Rich (`CKError`, `accountStatus`) | Poor (metadata flags) | none app-visible | moderate |
| Setup cost | Entitlements + schema + dev/prod deploy | Entitlements (`ubiquity-container-identifiers`) | none | re-architecture |
| WhatsApp-parity | close | **exact** | different | different |

**Decision: Option B.** Keep the container non-public (no Files visibility — Manage Storage entry only, like WhatsApp). CloudKit remains a documented fallback if richer account/quota handling is needed later. Option C's limitation is precisely why WhatsApp (and we) layer an explicit backup on top.

### 2.3 Key roaming on iOS

`kSecAttrSynchronizable=true` keychain items sync via **iCloud Keychain** to the user's devices (arrives on fresh device after sign-in w/ iCloud Keychain+2FA; `kSecAttrAccessibleAfterFirstUnlock`; cannot combine with ThisDeviceOnly; restricted query options) — VERIFIED (Apple kSecAttrSynchronizable docs + Platform Security guide). This is **W2**: zero-user-effort DEK roaming on Apple devices. Fallbacks when iCloud Keychain is off / Apple ID changed: W3 recovery code, W1 account escrow. WhatsApp does NOT use iCloud Keychain (it uses HSM/64-digit/passkey escrow) — W2 is our friction edge, layered with their pattern.

### 2.4 Background upload feasibility

`BGProcessingTaskRequest` "can take minutes", `requiresNetworkConnectivity`/`requiresExternalPower`, runs at system-friendly times (typically overnight; "daily" if the user charges daily) — VERIFIED. iOS 26 adds `BGContinuedProcessingTask` (starts foreground on user action, continues in background) — purpose-built for "Back up now" — VERIFIED (WWDC25 session 227). With Option B the app only writes the file (NSFileCoordinator); the system uploads it — process death is a non-issue. Restore listing/download via `NSMetadataQuery` + `startDownloadingUbiquitousItemIfNeeded`. Entitlements: `com.apple.developer.ubiquity-container-identifiers` (+ iCloud capability); container `iCloud.<bundle-id>`; App Store builds must use Production environment; container IDs effectively immutable once shipped. Guideline 2.5.4/5.1: no special backup restrictions found; BGTask-based nightly backup is standard practice.

### 2.5 RN integration

No mature CloudKit OSS; `react-native-cloud-storage` (ubiquity wrapper) has community-reported write-path edge cases (REPORTED). Recommendation (matches codebase practice — the app builds a Turbo Native Module for the engine in 4-2): a **small dedicated Swift/ObjC module** ("HarmonyBackup": stage file → ubiquity write, NSMetadataQuery progress, account status, synchronizable-keychain get/put). Engine (Go) produces/validates the artifacts; the module only moves bytes + keys.

---

## 3. Cross-cutting: crypto, efficiency, content policy

### 3.1 Exemplar teardown (what 2026 looks like)

- **WhatsApp:** random backup key; password path via HSM vault (attempt-limited), 64-digit key path, passkey path (rides Google Password Manager/iCloud Keychain — but as a *vault gate*, since passkeys are assertion credentials, not exportable key material). Nov 2024: Drive backups count against quota. Apr 2026: first-party cloud backup provider in development (2 GB free, E2EE mandatory) — signals quota pressure on user-owned storage AND that the multi-path key model is the industry standard.
- **Signal:** refused cloud for a decade; 2025 "Secure Backups" = operator storage, **64-char recovery key never shared with servers, loss = permanent loss**; daily refresh replacing previous archive; media as per-backup-encrypted objects + padding; free tier caps (100 MiB compressed messages) + paid 100 GB. SVR2 = SGX-enclave server-assisted key wrap with guess-rate limiting — the upgrade path for our W1.
- **Telegram:** the anti-pattern (all-cloud, no backup concept) — the friction-free extreme; our model is the opposite bet.
- **Obsidian/Craft (BYO-storage):** BYO storage works for files-as-source-of-truth; it fails for a live SQLite DB (file-lock corruption across iCloud/Dropbox) — confirms our *snapshot artifact* pattern (never the live DB in a synced folder). Craft even retreated to in-house sync.

### 3.2 Artifact pipeline (engine-side, Go)

- **Consistent snapshot:** `VACUUM INTO` from the live WAL DB = consistent, compacted, purged-of-deleted-content standalone file (VERIFIED: sqlite.org/lang_vacuum). SQLite3MultipleCiphers supports `VACUUM INTO 'file:…?cipher=…&key=…'` writing an encrypted output under a *different* key (VERIFIED: utelle S3MC FAQ + maintainer discussion #72; jgiannuzzi fork is a listed S3MC integration).
- **Compression order matters:** compress-then-encrypt, never the reverse — page-encrypted output is incompressible. Pipeline: `VACUUM INTO` plaintext temp (app-private, no-backup-flagged staging dir) → **zstd-3** (`klauspost/compress`, pure Go; ~3–6× on chat/memory SQLite, 6–10× on float32 vector data; ~100–300 MB/s/mobile core) → **AEAD (ChaCha20-Poly1305)** under the backup DEK with per-object nonce → `.blob` object. Integrity = sha256 over the final object. Cost at 500 MB ≈ seconds — fine for nightly windows. (Correction: `klauspost/compress` v1.17.7 already sits in the engine's `go.mod` as a transitive indirect dep — 2-6 promotes it to direct; no new dependency weight.)
- **Incrementals (v2, deferred):** daily logical churn ≈ 0.5–5 MB raw → ~100 KB–1 MB compressed; session-extension changesets are dual-use with 2-2's sync store. Caveats already known: virtual tables are not captured by sessions (RAG must live in ordinary files/tables or be rebuilt); NULL-PK rows ignored. Manifest format accepts delta objects without format change.
- **Content-addressed side objects (v1):** RAG store + media files named by plaintext sha256, uploaded on creation not per-snapshot, deduped forever; manifest references them. Content-defined chunking (restic-style) explicitly rejected — overkill for one structured file + exact objects.

### 3.3 Manifest & crash safety

`manifest.json` = single commit point: format version, engine schema version, created_at, device label, generation pointer (baseline object id/size/sha256 + object list), KDF/AEAD params, **wrap entries W3/W4** (W1 lives at the account service, W2 in keychain). Upload-then-commit: write new objects → upload manifest (whole-object replace) → flip `manifest.prev.json` → GC unreferenced. Crash at any point leaves the old generation authoritative. Keep **2 generations**.

### 3.4 Key scheme (hybrid, decided)

One random 256-bit backup DEK per lineage (regen = user-initiated "reset backup key"). Wraps:
- **W1 — account escrow** (all platforms): DEK wrapped under a server-side KEK (KMS-wrapped) stored on the SoulbitsCloud account (`PUT/GET /v1/account/backup-key`, PASETO-auth). v1 honest claim: *"Harmony stores only a locked copy of your backup key — it cannot read your backup, which lives in your own cloud storage, without attacking your account infrastructure."* Upgrade path: SVR2-style enclave escrow for the stronger claim. OAuth-only auth (Google/Apple sign-in) is why a PAKE-derived wrap is not available — recorded as the reason W1 is escrow, not derivation.
- **W2 — iCloud Keychain wrap** (iOS): random unlock key as `kSecAttrSynchronizable` keychain item wrapping the DEK; zero-effort Apple-to-Apple restore.
- **W3 — recovery code** (always set): 64-char code shown at backup setup (type-back confirmation, copy-to-password-manager button, re-displayable in settings); wraps a DEK copy recorded in the manifest. The reset path, the Apple-ID-changed path, and the desktop-standalone path.
- **W4 — passphrase wrap** (opt-in): Argon2id (OWASP 2026: m=19 MiB, t=2, p=1) for users who want the strong claim; does not disturb other paths.
- Password-reset/account-recovery semantics: W1 survives OAuth account recovery via the provider; account deletion drops W1 and must warn that remaining unlock paths are W3/W4. Desktop never needs the live DB key — peers resync via changesets; standalone desktop restore uses W3 (or W1 via the desktop's own auth).

### 3.5 Honest-claims matrix (copy review uses this)

| Config | Claim allowed |
|---|---|
| W1 only | "Encrypted end-to-end in transit and at rest in your own cloud. Harmony cannot read it without attacking your account." — NOT "we can never read it" |
| + W2 | "On Apple devices your backup key syncs via iCloud Keychain and never touches Harmony servers." |
| + W4 set | "Even we cannot read this backup" only with dual-path disclosure (W1 still exists) |
| Always | "If you lose all unlock methods, neither we nor your cloud provider can recover your data." (Signal's standard) |

### 3.6 GDPR / portability

An encrypted blob in the user's storage **does not satisfy Art. 20** portability (not machine-readable to the user without the app; portability is about leaving). A plaintext export feature is flagged as a follow-up (not in this plan). Side benefit: operator breach scope shrinks to "account only". Privacy labels/data-safety forms must still describe the backup upload flows.

---

## 4. Alternative providers (terms verified 2026-10-11)

| Target | Terms verdict | Notes |
|---|---|---|
| **Local export** | No API → no ToS exposure | Android SAF folder picker + share sheet (user can manually share into Drive — user action, not our API use); iOS Files/save (incl. third-party provider extensions — a second free path into Dropbox/OneDrive without our OAuth); desktop folder |
| **WebDAV** | User's server, user's rules (self-hosted = none) | Nextcloud/Synology/QNAP/Koofr presets; no OAuth; tiny Go client (PUT/GET/MKCOL/PROPFIND); strongest fit with the self-hosted Harmony Link audience |
| **Dropbox** | **Permitted** — current Developer Terms (eff. 2025-03-01): prohibited = AUP violations, scraping, mishandling user data; §3.4 *requires* processing "in accordance with Users' instructions" (= user-initiated backup). VERIFIED (dropbox.com/developers/reference/tos) | OAuth 2 + PKCE, App Folder; production-status review gate; 2 GB free (size display matters); chunked upload >150 MB |
| **OneDrive** | No backup clause in Microsoft API terms | Graph `Files.ReadWrite.AppFolder`, MSAL PKCE, large-file upload sessions; 5 GB free; third OAuth stack — included per ruling |
| Google Drive | Restricted (§1.3) | Interface-ready; ship only with written consent |
| Operator tier | Out of scope (future commercial option — WhatsApp is building exactly this in 2026) | Would reintroduce operator-held storage |

---

## 5. Codebase inventory (high-value findings — full detail in the agent report; consumed by Phase 6 + 2-6)

1. **`cmd/push-service` imports `harmony-link-private/push`** — the only engine import outside lifecycle-worker, on a KEEPER service → 6-3 resolves it: backend switches to `firebase.google.com/go/v4/messaging` (Admin SDK; relay payloads are opaque now per 4-4, so decay-context SQL dies unported), engine keeps its light internal package (survey 2026-10-11: wrapper delta ~150–250 LOC; own-OSS-lib extraction not justified).
2. **auth-service GDPR deletion → broker purge** (`accountpurge.go`/`account.go` → `POST /v1/session/data/delete`) is the **sole surviving consumer** of the S3 plane + DEK infra → 6-2 rewrites it (DB-only + W1 escrow drop + app-side purge-contract rework + generated-client regen).
3. **RAG persistence rides the sessions bucket** (`{userID}/rag/*`; engine rebuilds if absent) → new home = the backup artifact (2-6); rebuild stays the fallback.
4. **Engine cloud-mode machinery is a third deletion surface** (`cmd/cloud_mode.go`, `cloud_reload.go`, snapshot watchers, PASETO seeder, cloud-mode docs) → 6-4 (with rows-v1 sync server).
5. **No engine "snapshot to file" API exists; no compression exists** — the "checkpoint→gzip→S3" recollection was wrong (sidecar uploaded the raw trio). 2-6 builds the real artifact pipeline from `CheckpointWAL`/encryption helpers.
6. **Desktop DB key sits in plaintext `config.json`** — cloud DEK infra was the only cross-device escrow → W1/W2/W3 replace it; `docs/Database-Encryption.md` custody section updates in 6-4.
7. Smaller: sessions bucket is versioned (teardown = explicit all-version purge); lifecycle-**dispatcher** owns the DLQ drainer and it dies with it — `pkg/dlqarchive`'s only importer is the dispatcher, and `dlq-archive` is a prefix + lifecycle rule inside s3-internal-assets, not a separate bucket (nothing survives; corrected 2026-10-11 review); `pkg/valkey/session.go` = auth sign-in sessions (keep — name collision with `pkg/session`); E2E harness hard-depends on `CLOUD_SESSIONS_BUCKET` (reworked in 6-2); openapi.yaml session-path removal regenerates `soulbits-api-client-go` + the app's `soulbits-api-client`; iOS has zero custom native modules today (4-2's Turbo Module is first; HarmonyBackup is second); app already ships `react-native-fs`, `react-native-keychain`, `@react-native-documents/picker`.

## 6. Primary sources (index)

- Drive: developers.google.com/workspace/drive/api/terms · /guides/appdata · /guides/api-specific-auth · /guides/manage-uploads · /guides/limits · developer.android.com/identity/authorization · /identity/data/autobackup · discuss.google.dev threads 397019/401812/402029 · support.google.com/drive/answer/9312312
- Apple: developer.apple.com/documentation/security/ksecattrsynchronizable · FileManager ubiquity APIs · BGProcessingTaskRequest / BGContinuedProcessingTask (WWDC25-227) · CKError/accountStatus · iCloud storage docs · App Review Guidelines
- Crypto/efficiency: sqlite.org/lang_vacuum · utelle.github.io/SQLite3MultipleCiphers FAQ + discussion #72 · OWASP Password Storage Cheat Sheet (2026) · klauspost/compress · engineering.fb.com (WhatsApp E2EE backups 2021, labyrinth 2026) · signal.org/blog/introducing-secure-backups + SVR · wabetainfo (passkey/first-party cloud 2025–26)
- Providers: dropbox.com/developers/reference/tos (2025-03-01) · learn.microsoft.com Graph AppFolder
