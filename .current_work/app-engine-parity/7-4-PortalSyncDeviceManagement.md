# Phase 7-4 — Portal + Auth-Service: Cloud Sync Device Management

> **Repo:** `soulbits-cloud-backend` (`portal/` + `cmd/auth-service` pairing endpoints + relay admin hooks)
> **Created:** 2026-10-12 (Phase 7)
> **Depends on:** 7-1 (relay service + pairing-token consume contract) — build on the **existing** device surface: `portal/src/services/deviceService.ts`, `portal/src/components/profile/DeviceList.tsx`, `portal/src/pages/auth/DeviceApprovePage.tsx`, auth-service `/v1/devices` routes + `user_devices` registry

## Objective

Make the portal the management home for cloud sync: see your devices and their sync state, approve a new device's sync pairing (with QR display), revoke devices (kick + key rotation), and see relay buffer/quota usage. Extends the existing device screens rather than adding a parallel concept.

## Design

### 1. Auth-service endpoints (PASETO-authenticated, REST per repo conventions)

- `POST /v1/devices/sync-pairing` — mint short-lived pairing token for the signed-in user's new device (returns `{pairing_token, relay_url, expires_at}`); one active token per user, re-mint invalidates.
- `GET /v1/sync/devices` — sync-group view: devices with `dataset_id`, relay connection state (from the relay's status API — internal service call), last-seen, buffered bytes.
- `POST /v1/sync/devices/{device_id}/revoke-sync` — kick from relay + mark rotation-pending (the actual key rotation is engine/portal-driven per 7-2; this sets the flag the escrow re-wrap flow consumes). Full device revoke (existing `DELETE /v1/devices/{id}`) additionally implies sync revoke.
- `GET /v1/sync/usage` — buffer bytes + quota + backup storage usage (relay/S3 figures, internal calls) for the profile usage widget.
- Extend the `user_devices`/device registry rows with sync attributes (`dataset_id`, `sync_joined_at`, `last_sync_seen`) — forward migration, next free number.

### 2. Portal UI

- **DeviceList extension:** per-device sync badge (syncing / offline-buffered / revoked), dataset grouping ("Sync group: N devices"), sync revoke action with rotation warning copy.
- **New SyncSection (profile):** "Cloud sync" card — pairing QR **display** (encodes `{relay_url, pairing_token, account_hint}` — generate locally with a QR lib per portal conventions, e.g. `qrcode.react` if present, else minimal addition), manual pairing-code copy button with countdown TTL, buffer/quota usage bar, "Reset sync key" (danger, confirm) driving the 7-2 rotation flow via escrow re-wrap.
- **DeviceApprovePage:** no change (email/approve flow is device *authorization*; sync pairing is separate and QR-driven) — verify no copy implies otherwise.

### 3. Relay admin hooks (internal, service-to-service)

Status/introspection endpoints the auth-service calls (connections, buffered bytes, kick) — internal auth per repo pattern (same mechanism inference-gateway/subscription-service use); never ALB-public.

## Implementation steps

1. Migration (sync attributes) + auth-service endpoints + tests.
2. Internal relay status/kick wiring.
3. Portal DeviceList extension + SyncSection (QR display, usage, rotation).
4. openapi + portal tests (vitest per portal conventions) + docs.

## Verification gates

- `go build ./...`, `go vet ./...`, `go test ./...` green; portal `npm run build` + `npm test` green; openapi parses.

## Owner ops gates

- Staging walkthrough: mint QR → phone (7-3) scans → portal shows syncing → revoke → kick + rotation drill.

## Progress checklist

- [ ] Migration + auth-service endpoints + tests
- [ ] Relay internal wiring
- [ ] DeviceList extension + SyncSection + QR
- [ ] openapi/docs/tests
- [ ] Owner ops walkthrough
