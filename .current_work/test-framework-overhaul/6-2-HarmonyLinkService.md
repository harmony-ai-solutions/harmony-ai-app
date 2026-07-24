# Phase 6-2: Harmony Link Service

> **STATUS: ✅ COMPLETE** (post-plan update: image name is `soulbits/harmony-link:latest`,
> NOT `harmonyai/harmony-link` as originally written. See "Post-plan updates" below).

## Objective

Configure the published Harmony Link Docker image for use in the E2E Compose stack (Phase 6-1). The image already runs headless by default (`CMD ["disable-gui"]`) and ships with everything E2E needs — `/health` endpoint, self-signed cert generation, cloud-mode env-var config. **No new Dockerfile, no new scripts, no Go-side code changes are required.** This phase is pure configuration: which env vars to pass, how to wire the healthcheck, and how to seed test data if needed.

> **Cross-repo context.** The `harmony-link-private` repo publishes a single Docker image used by: (a) the community for self-hosting, (b) the desktop app distribution via Wails, (c) `soulbits-cloud-backend` for its E2E tests, and (d) starting now, `harmony-ai-app` for its E2E tests. The image is `harmonyai/harmony-link:latest` on Docker Hub (public) and mirrored to `soulbits/harmony-link:latest` on ECR. The `soulbits-cloud-backend` E2E setup is the canonical reference pattern — copy its env var set and entrypoint strategy.

## Current State (what already exists)

### Published Image

| Property | Value |
|----------|-------|
| Docker Hub image | `harmonyai/harmony-link` |
| ECR mirror | `soulbits/harmony-link` (in `soulbits-cloud-backend` AWS account) |
| Image type | Public on Docker Hub (pullable without auth) |
| Mirror workflow | `.github/workflows/mirror-harmony-link.yml` in `soulbits-cloud-backend` — daily sync at 06:00 UTC |
| Image reference in E2E | `HARMONY_LINK_IMAGE=${HARMONY_LINK_IMAGE:-soulbits/harmony-link:latest}` in `soulbits-cloud-backend/docker-compose.yml` |

### Docker Infrastructure (harmony-link-private)

Two Dockerfiles already exist:

**`harmony-link-private/Dockerfile`** (production runtime, single-stage, uses pre-built binary):
```dockerfile
FROM alpine:3.22
ARG BINARY_NAME=harmony-link
ENV HOME /app
WORKDIR ${HOME}
COPY ./build/bin/${BINARY_NAME} ${HOME}/harmony-link
RUN chmod +x ${HOME}/harmony-link
RUN apk update
RUN apk add libc6-compat gtk+3.0 webkit2gtk-4.1 curl docker-cli docker-compose
ENV PATH="${HOME}:${PATH}"
EXPOSE 28080 28443 28081
RUN chown -R 1000:1000 ${HOME}
USER 1000:0
ENTRYPOINT ["/app/harmony-link"]
CMD ["disable-gui"]
```

**`harmony-link-private/Dockerfile.build`** (multi-stage build with Go 1.26-alpine builder, used by CI):
```dockerfile
# Multi-stage: Go 1.26-alpine builder → alpine:3.22 runtime
# Image is tagged as: soulbits/harmony-link:latest
```

Key observations:
- Uses `alpine:3.22` as base (not golang — Go binary is pre-built)
- Binary lives at `/app/harmony-link`
- Default cmd is `disable-gui` (headless mode — no Wails desktop UI)
- Exposes ports: **28080** (HTTP/WS), **28443** (WSS/TLS), **28081** (Admin API)
- Requires `curl` (already installed) for healthcheck
- Runs as UID 1000
- `Dockerfile.build` is the CI-ready multi-stage variant — for E2E we can use this or a simplified version

### `/health` Endpoint

**Already exists.** Located at `eventserver/request.go:42-50`:

```go
func (h *harmonyLinkEventServerRequestHandler) ServeHTTP(w http.ResponseWriter, req *http.Request) {
    if req.URL.Path == "/health" {
        w.Header().Set("Content-Type", "application/json")
        w.WriteHeader(http.StatusOK)
        w.Write([]byte(`{"status":"ok"}`))
        return
    }
    // ... rest of handler
}
```

This endpoint is explicitly documented as being for Docker health checks ("In cloud mode, Docker health checks hit `GET /health` on this server", line 43-44). It always returns `200 OK` — it does NOT currently verify that migrations are applied or the WSS listener is bound.

**Gap for E2E:** The health check is simplistic (always returns 200). For a proper container healthcheck, this is sufficient for basic readiness since the HTTP server only starts after successful initialization. If a more nuanced healthcheck is needed (checking WSS listener, DB readiness), it's a ~5-line addition.

### Self-Signed TLS Certificate Generation

**Already exists in Go code** — no shell script needed. Located at `auth/cert_manager.go`:

```go
func NewCertManager(certPath, keyPath string) (*CertManager, error) {
    // ...
    if _, err = os.Stat(certPath); os.IsNotExist(err) {
        logger.Info("Generating new self-signed certificate for WSS...")
        certPEM, keyPEM, err := GenerateSelfSignedCert("localhost")
        // ... writes to certPath/keyPath on disk, creates dirs if needed
    }
    // ...
}
```

The `GenerateSelfSignedCert` function (lines 115-153):
- Generates **4096-bit RSA** key
- **10-year validity**
- SANs: `localhost`, `127.0.0.1`, `::1`
- Common Name: `"localhost"`
- Organization: `"Harmony AI Solutions"`
- Cipher suites: TLS 1.2+ with ECDHE + AES-GCM + CHACHA20

The cert/key paths come from config (`general.servercertpath` / `general.serverkeypath`), with defaults of `{dataDir}/server.crt` and `{dataDir}/server.key`.

**Gap for E2E:** The auto-generated cert only has `localhost` / `127.0.0.1` as SANs. In a Docker Compose setup, containers reach each other by service name (e.g., `harmony-link`). We need to add the Docker hostname as a SAN, OR configure the healthcheck/WSS client to skip hostname verification. The soulbits-cloud-backend uses `curl -f http://localhost:28080/health` (plain HTTP, not HTTPS) for healthchecks, bypassing the TLS check entirely.

### Config System

- **Format:** JSON (not YAML as originally assumed). Config file is `config.json` by default.
- **Library:** Viper (spf13/viper) + Cobra (spf13/cobra)
- **Env prefix:** `HARMONY_LINK_` (e.g., `HARMONY_LINK_PORT=28080`)
- **Cloud mode env vars:** `HL_*` prefix (e.g., `HL_GENERAL_PORT=28080`, `HL_WSS_PORT=28443`), activated by `CLOUD_MODE=true`
- **Config struct:** `config/types.go` — top-level sections: `general`, `admin`, `entities`

Key config fields relevant to E2E:

```go
type GeneralConfig struct {
    Port                   int    `json:"port"`                     // 28080
    WSSPort                int    `json:"wssport"`                  // 28443 (set via env or config)
    SinglePort             bool   `json:"singleport"`               // false (dual-port mode)
    DataDir                string `json:"datadir"`                  // ./data
    WorkingDir             string `json:"workingdir"`               // ./harmony-tmp
    DatabaseFileName       string `json:"databasefilename"`         // data.sqlite
    DatabaseEncryption     bool   `json:"databaseencryption"`       // true
    DatabaseEncryptionKey  string `json:"databaseencryptionkey"`
    UseHarmonyCloud        bool   `json:"useharmonycloud"`          // false
    ServerCertPath         string `json:"servercertpath"`           // {dataDir}/server.crt
    ServerKeyPath          string `json:"serverkeypath"`            // {dataDir}/server.key
    LogFile                bool   `json:"logfile"`                  // true
}

type AdminConfig struct {
    Port   int    `json:"port"`     // 28081
    APIKey string `json:"apikey"`   // "admin"
}
```

### Cloud Mode Overrides (relevant to E2E)

When `CLOUD_MODE=true`, `applyCloudModeOverrides()` in `cmd/cloud_mode.go` applies these env var overrides:

| Env Var | Effect |
|---------|--------|
| `HL_GENERAL_PORT` | Sets `config.ApplicationConfig.General.Port` |
| `HL_WSS_PORT` | Sets `config.ApplicationConfig.General.WSSPort` |
| `HL_ADMIN_PORT` | Sets `config.ApplicationConfig.Admin.Port` |
| `HL_DATA_DIR` | Sets `config.ApplicationConfig.General.DataDir` |
| `HL_WORKING_DIR` | Sets `config.ApplicationConfig.General.WorkingDir` |
| `HL_DATABASE_FILENAME` | Sets `config.ApplicationConfig.General.DatabaseFileName` |
| `HL_DATABASE_ENCRYPTION` | Sets `config.ApplicationConfig.General.DatabaseEncryption` |
| `HL_DATABASE_ENCRYPTION_KEY` | Sets `config.ApplicationConfig.General.DatabaseEncryptionKey` |
| `HL_ADMIN_API_KEY` | Sets `config.ApplicationConfig.Admin.APIKey` |
| `HL_CERT_DIR` | Sets both `ServerCertPath` and `ServerKeyPath` to `{dir}/server.crt` / `{dir}/server.key` |
| `HL_INFERENCE_TOKEN` | Used for seeding soulbitscloud provider config |

Additionally, cloud mode **forces** these changes:
- `LogFile = false` (no log files — use stdout for container logging)
- `UseHarmonyCloud = false` (auth is handled by the cloud backend)
- Headless operation (no Wails GUI)

### How soulbits-cloud-backend Spawns Harmony-Link (Reference Pattern)

In `soulbits-cloud-backend/cmd/session-broker/warmpool/docker.go:227-300`:

```go
env := []string{
    "CLOUD_MODE=true",
    fmt.Sprintf("HL_GENERAL_PORT=%d", session.DefaultHarmonyLinkPort),     // 28080
    fmt.Sprintf("HL_WSS_PORT=%d", session.DefaultHarmonyLinkWSSPort),      // 28443
    fmt.Sprintf("HL_ADMIN_PORT=%d", session.DefaultHarmonyLinkAdminPort),  // 28081
    fmt.Sprintf("HL_INFERENCE_TOKEN=%s", input.InferenceToken),
    fmt.Sprintf("HL_DATA_DIR=/sessions/data/"),
    "HL_DATABASE_FILENAME=data.sqlite",
    "HL_DATABASE_ENCRYPTION=false",
}
// Image: input.Images.HarmonyLink ("soulbits/harmony-link:latest")
// Entrypoint overridden: ["/bin/sh", "-c", "mkdir -p /sessions/data && exec /app/harmony-link"]
// Cmd: ["disable-gui"]
// Healthcheck: ["CMD", "curl", "-f", "http://localhost:28080/health"]
// Ports: 28080, 28443, 28081 exposed (dynamic host port mapping)
```

Session config struct at `pkg/session/session.go:18-28` defines these constants:
```go
const DefaultHarmonyLinkPort = 28080
const DefaultHarmonyLinkWSSPort = 28443
const DefaultHarmonyLinkAdminPort = 28081
```

This is the canonical env var set to use. For the harmony-ai-app's E2E (which runs harmony-link as a standalone compose service), we use the same env vars.

### Database

- **SQLite only.** Uses `github.com/mattn/go-sqlite3` (CGO). No Postgres support.
- Migrations are custom (not `golang-migrate`), using embedded `.sql` files via `//go:embed database/migrations/*.sql`.
- Migration runner: `database/migrations.go` — runs numbered migrations from embedded directory.
- Default database file: `{dataDir}/data.sqlite` (e.g., `./data/data.sqlite`).
- WAL mode is enabled by default for concurrency.
- Encryption is supported (optional), using a hex-encoded 256-bit key.
- On first boot with an empty database, creates default entities: "Claire" (AI) and "user" (human).

### Entry Points and CLI

- **main.go**: `C:\Users\sge20\go\src\github.com\harmony-ai-solutions\harmony-link-private\main.go` — calls `cmd.Execute()`
- **Default subcommand**: `run` (when no subcommand given, `root.go:47-52` prepends `run` to args)
- **Subcommands**: `run` (default), `version`, `encrypt-db`, `decrypt-db`
- **No existing `dump-schema` command** — Phase 5-2's proposed addition is genuinely new work.
- The `run` command flow: `initConfig()` → `setupLogging()` → `setupDatabase()` (runs migrations) → `eventServer.Start()` → `mgmtServer.Start()`

### Scripts

- Only `build_macos.sh` and `build_linux.sh` exist in the repo root. No `scripts/` directory at all.
- No cert generation shell scripts exist (it's all done in Go).

## Prerequisites

- Phase 5-2 complete (the `dump-schema` command in the Go repo — this is *genuinely new work* that doesn't exist yet).
- **No new Docker infrastructure needed.** The published production image is reused as-is.
- Access to `harmony-link-private` (same developer) — only relevant for Phase 5-2's new `cmd/dump-schema`.

## Implementation Steps

### 1. Use the published image as-is — no Dockerfile changes

**The production image already runs headless by default.** Its `Dockerfile` ends with:

```dockerfile
ENTRYPOINT ["/app/harmony-link"]
CMD ["disable-gui"]
```

`disable-gui` is the default `CMD`, so the same image the community uses for the desktop app also runs as a pure headless server. The Wails-related `apk` packages (`gtk+3.0`, `webkit2gtk-4.1`) bloat the image slightly but do not affect headless operation. **Do not introduce a separate `Dockerfile.e2e`** — it would diverge from the production image the team already publishes and tests against, and would require ongoing sync work.

**Reference image:**

- Docker Hub (public, no auth): `harmonyai/harmony-link:latest`
- ECR mirror (used by `soulbits-cloud-backend`): `soulbits/harmony-link:latest`
- Sync workflow: `.github/workflows/mirror-harmony-link.yml` in `soulbits-cloud-backend` runs daily at 06:00 UTC

For local development, the team can either pull from Docker Hub or build locally from `harmony-link-private/Dockerfile.build`. For CI, pulling from Docker Hub is preferred (no build step in the harmony-ai-app pipeline).

### 2. No cert-generation script needed

**Already handled in Go code** (`auth/cert_manager.go`): on first startup, if the cert file doesn't exist, a 4096-bit RSA self-signed cert is generated automatically. The cert covers `localhost` and `127.0.0.1` SANs.

The container healthcheck uses **plain HTTP** (port 28080), so the cert is not on the critical path for container readiness. WSS connections from the RN app (port 28443) will hit the self-signed cert and need to handle trust at the app layer — see Phase 6-4 for the app-side story.

### 3. Configure via `HL_*` env vars (no config.json needed)

The image's config system supports two configuration modes:

- **Non-cloud mode**: env vars prefixed `HARMONY_LINK_`, config loaded from `config.json` on disk.
- **Cloud mode** (set `CLOUD_MODE=true`): env vars prefixed `HL_*`, applied as overrides. This is the mode `soulbits-cloud-backend` uses for its E2E.

**Recommended approach: cloud mode + env vars only.** No config.json file mount needed. The compose file passes everything via the environment:

```yaml
# In e2e/docker-compose.yml (Phase 6-1)
services:
  harmony-link:
    image: harmonyai/harmony-link:latest   # public Docker Hub
    # OR for parity with soulbits-cloud-backend:
    # image: soulbits/harmony-link:latest
    environment:
      CLOUD_MODE: "true"
      HL_GENERAL_PORT: "28080"             # HTTP/WS (healthcheck, plain)
      HL_WSS_PORT: "28443"                 # WSS/TLS (app sync)
      HL_ADMIN_PORT: "28081"               # admin API
      HL_DATA_DIR: "/data"
      HL_DATABASE_FILENAME: "data.sqlite"
      HL_DATABASE_ENCRYPTION: "false"
      HL_INFERENCE_TOKEN: "e2e-test-token"  # any non-empty value
      # HL_ADMIN_API_KEY: "e2e-admin"      # if admin API is exercised
    volumes:
      - harmony-link-data:/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:28080/health"]
      interval: 5s
      timeout: 3s
      retries: 12
      start_period: 10s
    ports:
      - "28080:28080"
      - "28443:28443"
```

This mirrors the `runHarmonyLinkContainer()` pattern at `soulbits-cloud-backend/cmd/session-broker/warmpool/docker.go:227-300`.

**Why no config.json file?** Two reasons:
1. The `soulbits-cloud-backend` reference pattern doesn't use one — pure env vars work fine in cloud mode.
2. Without a config file, harmony-link logs `WARNING: Config file not found` (root.go line 119) on startup. In cloud mode this warning is benign — env vars fully populate the config. The 10-second delayed shutdown only triggers in non-cloud mode when critical config is missing.

If the warning noise bothers anyone, mount a minimal `config.json` containing `{}` (empty object) — Viper will accept it and apply env var overrides on top. But this is purely cosmetic.

### 4. `/health` endpoint — use as-is

**Already exists** at `eventserver/request.go:42-50`, returns `{"status":"ok"}` with HTTP 200. The HTTP server only starts listening after `setupDatabase()` (which runs migrations) completes, so the implicit readiness guarantee is sufficient — when `/health` responds, the DB is migrated.

The soulbits-cloud-backend healthcheck (`curl -f http://localhost:28080/health`) relies on this same implicit guarantee. **No changes needed for E2E.**

If a stricter readiness check is desired later (e.g., verify WSS listener is bound), it's a ~10-line addition to `eventserver/server.go`. Not blocking for Phase 6.

### 5. Smoke test (validates the published image works for E2E)

```bash
docker run --rm -p 28080:28080 -p 28443:28443 \
  -e CLOUD_MODE=true \
  -e HL_DATA_DIR=/data \
  -e HL_DATABASE_FILENAME=data.sqlite \
  -e HL_DATABASE_ENCRYPTION=false \
  -e HL_INFERENCE_TOKEN=e2e-test \
  harmonyai/harmony-link:latest

# In another terminal:
curl -f http://localhost:28080/health
# Expected: {"status":"ok"}

# Verify WSS port is up (will use the auto-generated self-signed cert):
curl -k https://localhost:28443/health
# Expected: {"status":"ok"} (same handler on both servers)
```

If both curl commands succeed, the image is ready for the Phase 6-1 Compose stack. No image build, no Dockerfile changes, no config file creation.

## Files to Create (in `harmony-link-private`)

**None.** The published production image is reused as-is.

The only new Go-side work for the broader test overhaul is in Phase 5-2 (`cmd/dump-schema`), which is unrelated to E2E container setup.

## Files that DO NOT need to be created (already exist)

- **`Dockerfile`** — Production image already runs headless via `CMD ["disable-gui"]`. The same image is used for both desktop and server deployments. **Do not introduce a separate `Dockerfile.e2e`** — it would diverge from the published image and require ongoing sync.
- **`scripts/generate-e2e-certs.sh`** — Not needed. Cert generation is built into Go code in `auth/cert_manager.go`.
- **`/health` endpoint** — Already exists in `eventserver/request.go:42-50`.
- **`Dockerfile.build`** — Multi-stage CI build pipeline is operational.
- **`configs/e2e.json`** — Not strictly needed. Cloud mode (`CLOUD_MODE=true`) + `HL_*` env vars fully populate the config. A `WARNING: Config file not found` log line appears in cloud mode but is benign (env vars take over).
- **`docker-compose.yml`** — Already exists in `harmony-link-private` (partially commented out). The harmony-ai-app side will define its own compose stack in `e2e/docker-compose.yml` (Phase 6-1), referencing the published image.

## Files to Modify (in `harmony-link-private`)

**None required for Phase 6.**

Optional future improvements (not blocking):
- `eventserver/server.go` — add readiness flag for stricter healthcheck (~10 LoC)
- `auth/cert_manager.go` — accept additional SANs via env var for hostname-verified WSS (~30 min)

## Validation

- [ ] `docker pull harmonyai/harmony-link:latest` succeeds (no auth needed)
- [ ] Container starts with `CLOUD_MODE=true` + `HL_*` env vars and `GET /health` returns `{"status":"ok"}` within 5 seconds
- [ ] WSS endpoint (port 28443) accepts TLS connections with the auto-generated self-signed cert
- [ ] Container healthcheck passes (`docker inspect` shows `"Health": "healthy"`)
- [ ] Console logs show `CLOUD_MODE enabled — applying environment variable overrides`
- [ ] Database initializes with default "Claire" entity (verifies migration + seed data run)
- [ ] Container is reachable from another container on the same Docker network via hostname

## Open Questions to Resolve During Implementation

- **`docker pull` from Docker Hub vs. mirror to ECR?** Pulling from Docker Hub is simplest for harmony-ai-app's CI (no AWS auth needed). If Docker Hub rate limits become an issue, mirror to the GitHub Container Registry or use the existing `soulbits/harmony-link` ECR mirror (requires AWS auth in CI).
- **Should we add extra SANs to the self-signed cert for Docker hostnames?** The healthcheck uses plain HTTP (port 28080), so this is not blocking. The RN app connects via WSS (port 28443) and will need to handle self-signed certs regardless (Phase 6-4). Ship with `localhost` / `127.0.0.1` SANs (current behavior). Add Docker service name SANs only if a specific test requires hostname-verified WSS.
- **Should the E2E seed test data?** The default database bootstraps a "Claire" entity and "user" entity on first run. If specific test characters are needed (Phase 6-5 happy-path flow looks for "E2E Test Character"), either:
  - (a) Mount a pre-seeded `data.sqlite` file as a volume, OR
  - (b) Use the admin API (port 28081) after startup to inject fixtures, OR
  - (c) Adapt the test flows to look for "Claire" instead of a custom fixture.
  Option (c) is simplest. (a) is most isolated. (b) requires admin API client code in the test harness.

## Estimated Effort

**1–2 hours** (down from the originally estimated 1–2 days).

There is essentially nothing to build — only configuration work in the harmony-ai-app's `docker-compose.yml` (Phase 6-1). The remaining time is for the smoke test validation and tuning the env var set for the specific E2E scenarios.

The breakdown:
1. Pull the published image and run the smoke test (~15 min)
2. Define the harmony-link service block in Phase 6-1's compose file (~15 min)
3. Validate the full Phase 6-1 stack boots and the app reaches harmony-link (~30 min)
4. Tune env vars if specific scenarios need different config (~30 min)

## Cross-References

### Relevant soulbits-cloud-backend files (reference pattern)

| File | Relevance |
|------|-----------|
| `docker-compose.yml` | Line 224: `HARMONY_LINK_IMAGE=${HARMONY_LINK_IMAGE:-soulbits/harmony-link:latest}` — image reference pattern |
| `cmd/session-broker/warmpool/docker.go` | Lines 227-300: `runHarmonyLinkContainer()` — canonical env vars, entrypoint, healthcheck config |
| `cmd/session-broker/warmpool/warmpool.go` | Lines 229-230, 276-277, 332-333: Port constants usage |
| `pkg/session/session.go` | Lines 18-28: `DefaultHarmonyLinkPort=28080`, `DefaultHarmonyLinkWSSPort=28443`, `DefaultHarmonyLinkAdminPort=28081` |
| `pkg/session/ecs.go` | Lines 147-149: ECS task env var overrides for harmony-link |
| `tests/e2e/README.md` | Full E2E test documentation — session lifecycle, env vars, architecture |
| `tests/e2e/` (directory) | E2E test Go source (auth, session, inference, worker, etc.) |
| `.github/workflows/mirror-harmony-link.yml` | Daily mirror of `harmonyai/harmony-link` Docker Hub → `soulbits/harmony-link` ECR |
| `.github/workflows/deploy-dev.yml` | Build/deploy pipeline for all cloud services (not harmony-link itself) |

### Relevant harmony-link-private files

| File | Relevance |
|------|-----------|
| `Dockerfile` | Production Dockerfile — base image, ports, entrypoint |
| `Dockerfile.build` | Multi-stage CI Dockerfile — build process, Go version, deps |
| `docker-compose.yml` | Existing compose file (partially commented out) |
| `main.go` | Entry point — calls `cmd.Execute()` |
| `cmd/root.go` | Config initialization, Viper setup, env prefix `HARMONY_LINK_` |
| `cmd/run.go` | Server startup — logging, DB, event server, management server |
| `cmd/cloud_mode.go` | `HL_*` env var overrides when `CLOUD_MODE=true` |
| `cmd/cloud_reload.go` | Database reload watcher for cloud mode snapshots |
| `eventserver/server.go` | HTTP + WSS server setup, TLS init, cert manager init |
| `eventserver/request.go` | Lines 42-50: `/health` endpoint implementation |
| `auth/cert_manager.go` | Self-signed cert generation (Go code, no shell script) |
| `config/types.go` | Config struct definitions (`GeneralConfig`, `AdminConfig`) |
| `config/config.go` | `IsCloudMode()`, `ApplicationConfig` global, config update |
| `config/db/init.go` | DB initialization, default entity creation on empty DB |
| `database/connection.go` | SQLite init (CGO, WAL mode, migrations) |
| `database/migrations.go` | Custom migration runner (embedded SQL files) |
| `constants/constants.go` | `EnvPrefix = "HARMONY_LINK"`, app name/version |

### Relevant harmony-cloud-services files

| File | Relevance |
|------|-----------|
| `docker-compose.yml` | Cloud-service infrastructure (text-gen-webui, speech engine) — not directly relevant to E2E testing |

### Relevant other phase docs (test-framework-overhaul)

| Document | Relevance to Phase 6-2 |
|----------|----------------------|
| `5-2-GoSchemaDumpCommand.md` | Assumes `dump-schema` command doesn't exist — confirmed, this is genuinely new work |
| `6-1-DockerComposeStack.md` | Proposed `docker-compose.yml` references `harmony-link-private:e2e` — should align with actual image name and port conventions (28080/28443/28081, not 9443) |
| `6-4-SelfSignedTLSBootstrap.md` | Should reference that cert generation is already handled in Go code; the RN app's trust story should account for the Docker service hostname |

### Cross-repo inconsistencies to note

1. **soulbits-cloud-backend uses `soulbits/harmony-link:latest`** (ECR), while the plan assumes `harmony-link-private:e2e` (local build). For the harmony-ai-app E2E, a local build tag is appropriate for development, but the production E2E could pull from Docker Hub (`harmonyai/harmony-link`).

2. **soulbits-cloud-backend healthcheck uses plain HTTP** (`curl -f http://localhost:28080/health`), not HTTPS. The original plan assumed HTTPS healthchecks on port 9443. The real ports are 28080 (plain HTTP/WS) and 28443 (WSS/TLS).

3. **Config is JSON, not YAML** as assumed in the original plan. All config file references should use `.json` extension.

4. **No separate E2E Dockerfile is needed.** The production image runs headless by default via `CMD ["disable-gui"]`. The same published image (`harmonyai/harmony-link:latest`) is used for desktop app distribution, community self-hosting, soulbits-cloud-backend E2E, and harmony-ai-app E2E. The Wails-related `apk` packages (`gtk+3.0`, `webkit2gtk-4.1`) bloat the image slightly but do not affect headless operation. Introducing a `Dockerfile.e2e` would diverge from the production image and create ongoing sync work — avoid it.

5. **Database is always SQLite, with CGO required.** The production `Dockerfile.build` already uses `CGO_ENABLED=1`. The published image handles this correctly. No special handling needed for E2E.

---

## Post-plan updates (July 2026)

### Image name resolution

The "Cross-repo inconsistencies" note above speculated about `harmonyai/harmony-link`
(Docker Hub) vs `soulbits/harmony-link` (local build). **Resolution: use
`soulbits/harmony-link:latest`** — the developer's locally-built image from
`harmony-link-private/Dockerfile.build`. It's more recent than the Docker Hub
image and matches what the developer tests against.

The `harmonyai/harmony-link:latest` image still exists on Docker Hub (last
pushed Dec 2025) and is still pullable. But the E2E compose stack now uses
the local build for parity with the developer's testing setup.

Updated in `e2e/docker-compose.yml`:
```yaml
harmony-link:
  image: soulbits/harmony-link:latest
  pull_policy: never   # don't try to fetch from Docker Hub
```

### Cloud-mode auto-approval confirmed

Reading `harmony-link-private/eventserver/synchronization.go:260` confirms
the original plan's hope: when `CLOUD_MODE=true`, the server auto-approves
new devices during the handshake protocol (`isApproved = 1`). This is what
makes the `ConnectionStateManager.applyE2EOverride()` strategy work — see
Phase 4-1's "Production Override" section for the full flow.

### JWT in cloud-mode response is empty (by design)

`harmony-link-private/eventserver/synchronization_cloudmode_test.go:82-85`
verifies that the handshake response in cloud mode has empty JWT/cert/expiresAt
fields. The server generates a real JWT internally but doesn't send it in the
response (the conduct proxy handles user auth separately in production cloud
deployments).

For E2E this is fine — the client's `applyE2EOverride()` pre-seeds a placeholder
JWT that gets overwritten by `saveConnectionCredentials()` on handshake response.
Even though the response has empty JWT, the WSS connection succeeds because
`request.go:131` skips JWT validation in cloud mode.

### iOS exclusion (deferred)

iOS E2E on GHA is explicitly excluded for now. The `e2e-ios.yml` workflow file
exists but is not triggered. This is the final step once Android E2E is
validated end-to-end.
