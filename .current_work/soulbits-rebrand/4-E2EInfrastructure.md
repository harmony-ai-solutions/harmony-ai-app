# Phase 4: E2E Infrastructure (CI Workflows + Docker Compose)

> **Goal**: Update the E2E test infrastructure to use `SE_*` env vars, new container/image names, and new build config field names.

## Analysis

The iOS E2E workflow (`e2e-ios.yml`) starts a native Go binary and passes `HL_*` env vars — these will **not** be read by the soulbits-engine binary which now looks for `SE_*` vars. The Android E2E uses `e2e/docker-compose.yml` which also references `HL_*` env vars, the `harmony-link` container name, and old image tags.

## Files to Modify

### 1. `.github/workflows/e2e-ios.yml` — iOS CI workflow

**Env vars (line 105):** ALL `HL_*` → `SE_*`:
- `HL_GENERAL_PORT` → `SE_GENERAL_PORT`
- `HL_WSS_PORT` → `SE_WSS_PORT`
- `HL_DATA_DIR` → `SE_DATA_DIR`
- `HL_DATABASE_FILENAME` → `SE_DATABASE_FILENAME`
- `HL_DATABASE_ENCRYPTION` → `SE_DATABASE_ENCRYPTION`
- `HL_INFERENCE_TOKEN` → `SE_INFERENCE_TOKEN`
- `HL_CERT_DIR` → `SE_CERT_DIR`

**Build contextual references:**
- `go build -o /tmp/harmony-link .` → `go build -o /tmp/soulbits-engine .`
- `/tmp/harmony-link-data` → `/tmp/soulbits-engine-data`
- `mkdir -p /tmp/harmony-link-data` → `mkdir -p /tmp/soulbits-engine-data`
- All comments/log messages: "Harmony Link" → "Soulbits Engine"
- Checkout `path: harmony-link` can stay (it's just the checkout directory name)
- `repository: harmony-ai-solutions/harmony-link-private` stays (repo URL)

### 2. `e2e/docker-compose.yml` — Docker Compose for Android E2E

**Service name** `harmony-link:` → `soulbits-engine:` (⚠️ breaks other service references)

**Env vars (lines 54-61):** ALL `HL_*` → `SE_*`:
- `HL_GENERAL_PORT` → `SE_GENERAL_PORT`
- `HL_WSS_PORT` → `SE_WSS_PORT`
- `HL_ADMIN_PORT` → `SE_ADMIN_PORT`
- `HL_DATA_DIR` → `SE_DATA_DIR`
- `HL_DATABASE_FILENAME` → `SE_DATABASE_FILENAME`
- `HL_DATABASE_ENCRYPTION` → `SE_DATABASE_ENCRYPTION`
- `HL_INFERENCE_TOKEN` → `SE_INFERENCE_TOKEN`
- `# HL_ADMIN_API_KEY` → `# SE_ADMIN_API_KEY`

**Comment updates:**
- Line 37: `CLOUD_MODE + HL_* pattern` → `CLOUD_MODE + SE_* pattern`
- All "harmony-link" references in comments → "soulbits-engine"

**Service references** (if service renamed):
- Line 93: `docker compose up -d harmony-link` → `docker compose up -d soulbits-engine`
- Line 120-121: `docker compose logs harmony-link` → `docker compose logs soulbits-engine`
- Line 128: `harmony-link.log` → `soulbits-engine.log`
- Line 141: `condition: service_healthy` reference updates

### 3. `.github/workflows/e2e-android.yml` — Android CI workflow

- Line 93: `docker compose up -d harmony-link` → `docker compose up -d soulbits-engine`
- Lines 120-122: `harmony-link.log` → `soulbits-engine.log`
- Line 128: `harmony-link.log` → `soulbits-engine.log`
- All comments referencing `harmonyai/harmony-link` or `harmony-link` → updated references

### 4. `e2e/build-apk.sh` and `e2e/build-apk.ps1` — Build scripts

If present, update `-PHARMONY_LINK_WSS_URL` → `-PSOULBITS_ENGINE_WSS_URL` build flags.

### 5. `e2e/README.md` — E2E documentation

- All references to `harmony-link` in container names, image names, paths
- `soulbits/harmony-link:latest` image tag reference

### 6. `.github/workflows/schema-parity.yml` — Schema parity workflow

- All `harmony-link-private` checkout path references
- `harmony-link` working directory references

## ⚠️ Compatibility Note

If the `harmony-link` service name in `e2e/docker-compose.yml` is renamed to `soulbits-engine`, the android-emulator's socat port forwarding and the maestro-runner's `HARMONY_LINK_URL`/`HARMONY_LINK_HEALTH_URL` must also be updated:
- `HARMONY_LINK_URL=wss://harmony-link:28443` → `SOULBITS_ENGINE_URL=wss://soulbits-engine:28443`
- `HARMONY_LINK_HEALTH_URL=http://harmony-link:28080/health` → `SOULBITS_ENGINE_HEALTH_URL=http://soulbits-engine:28080/health`
