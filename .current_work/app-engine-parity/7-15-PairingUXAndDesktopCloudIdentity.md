# Phase 7-15 — Pairing UX Revival + Desktop Cloud Identity

> **Repos:** app + engine (incl. nested Wails frontend) + cloud — first 4-repo phase since 7-13.
> **Created:** 2026-10-15. **Trigger:** owner review of commit `1bf877a` (app): the new
> DesktopSyncScreen regressed three things the deleted ConnectionSetupScreen / product intent had —
> (1) the implicit security-mode check became an expert form, (2) QR pairing exists only phone-side
> and only for portal-minted cloud codes, (3) no credential sharing / auto-approval exists, and the
> desktop engine cannot sign into Soulbits Cloud at all (`config/types.go:103` — "NO cloud/PASETO
> configuration here… the engine never does Soulbits auth" — now superseded for the DESKTOP boot
> path; the embedded sidecar keeps the app-injection model).
> **Depends on:** 7-14 (variant gating — LAN is full-variant-only; store pins relay), 7-3 (cloud
> pairing payload + portal mint), 2-4/7-1 (syncclient + pairing tokens), 2026-10-12 camera-kit ruling.

## Owner rulings (2026-10-15)

1. **LAN connect UX: QR-first.** The LAN QR carries address+mode+fingerprint; the manual form
   collapses under an "Advanced" disclosure (no probe rebuild — nobody types addresses anymore).
2. **LAN QR payload: full.** ws + wss addresses, best security mode, cert fingerprint, dataset id,
   desktop device name, and a short-lived single-use pairing secret for auto-approval.
3. **Auto-approval: QR = consent.** Single-use secret (5-min TTL) authorizes the presenting device
   once; desktop shows a "Device X paired" toast. Displaying the QR is the authorization gesture.
4. **Credential sharing: delegated enrollment.** Desktop (authorized device) mints a short-lived,
   single-use enrollment grant via the cloud; the phone exchanges it for its OWN device-scoped
   session over the LAN pairing. No shared secret, per-device revocation. Scope: full-variant
   phones; store phones keep the OAuth wall. Cloud-backend work included.
5. **Desktop cloud sign-in: browser OAuth + loopback.** Engine starts a localhost loopback listener,
   opens the system browser, completes OAuth, stores the desktop's cloud session.
6. **Desktop Pair UI: one modal, segmented [Local network | Soulbits Cloud]** — cloud tab disabled
   with a sign-in hint when unauthenticated; one large QR, countdown ring for TTL, regenerate
   button, desktop name + security badge beneath. Phone gets a matching confirmation sheet.
7. **Unencrypted LAN stays first-class** — all three modes equal citizens in the picker, no nudge.
8. **One 7-15 phase** across all repos (sequential per repo, parallel only across disjoint repos).

## Binding wire contracts (verbatim — agents must not diverge)

**LAN QR payload** (desktop → phone, versioned, phone-side parser v2):
```json
{
  "v": 1,
  "kind": "soulbits-lan",
  "ws": "192.168.1.10:28080",
  "wss": "192.168.1.10:28443",
  "mode": "secure | insecure-ssl | unencrypted",
  "fingerprint": "sha256:AB:CD:…",
  "dataset_id": "…",
  "name": "Studio-PC",
  "secret": "…128-bit+ single-use, 5-min TTL…",
  "ttl": 300,
  "enrollment": {
    "relay_url": "wss://cloud…/v1/sync/ws",
    "grant": "…single-use enrollment grant…",
    "account_hint": "a***@example.com"
  }
}
```
(`wss`/`fingerprint` omitted when the engine has no TLS; `enrollment` present ONLY when the desktop
is signed in and the grant was freshly minted with the secret.)

**Cloud QR** (engine-minted must be IDENTICAL to the portal shape the phone already parses —
`src/services/sync/syncCloudTypes.ts`):
```json
{ "relay_url": "wss://…/v1/sync/ws", "pairing_token": "…", "account_hint": "…" }
```

**Engine management additions** (sketch — final shapes within contract **1.5.0**):
- `POST /api/sync/pairing/lan` → LAN payload above (enumerates LAN IPv4s, mints secret, includes
  enrollment block when signed in)
- `GET /api/cloud/account` → `{ signed_in, account_hint, email? }`
- `POST /api/cloud/signin/start` → `{ url }` (loopback listener + state + PKCE)
- `POST /api/cloud/signin/signout`
- syncclient config additions: `lan_pairing_secret` (transient — cleared after first successful
  dial) and `peer_fingerprint` (persisted TOFU pin, enforced on WSS dials)

**Cloud additions** (migration `000040`, append-only):
- `POST /v1/devices/enrollment-grants` (account auth + authorized device) → `{ grant, expires_in }`
- `POST /v1/auth/device/enroll` `{ grant, device_id, device_name }` → device-scoped session;
  registers the device authorized (the desktop vouched)

## Binding design rules

1. **Security invariants:** secrets/grants ≥128-bit random, SHA-256-at-rest, 5-min TTL,
   single-use; auto-approval ONLY via a valid secret (log the approval source); fingerprint pin
   enforced on WSS dials when configured. Unencrypted stays first-class (ruling 7) — the secret may
   travel cleartext there; single-use + TTL + same-LAN threat model is the accepted mitigation,
   documented in `docs/CONNECTION-SECURITY.md`.
2. **Enrolled devices are full devices** (they may themselves mint grants/tokens) — known property,
   documented, revisitable later.
3. **Store variant:** LAN payloads are REJECTED by the phone with clear copy (no LAN in store);
   cloud QR path unchanged (same shape as portal codes).
4. **Embedded sidecar unchanged:** the app keeps injecting relay tokens into the embedded engine
   (7-13 F1 model). Only the DESKTOP engine gains first-party cloud identity.
5. **Management contract 1.4.0 → 1.5.0** once for the whole phase (E1 establishes, E2 extends);
   app lockstep + drift CLI green in A.
6. **Everything uncommitted** (owner commits). Migration discipline: cloud `000040` append-only,
   never renumber. e2e `approve-pending-devices.sh` manual path stays intact.

## Work split

- **C (cloud):** enrollment grants — migration `000040`, mint/exchange endpoints, tests, docs
  (sync-and-escrow-mechanics.md, openapi), CHANGELOG. Gates: go build/vet/test (+ migration
  up/down/up on local Postgres).
- **E1 (engine):** LAN pairing — TLS/cert investigation (auto self-signed generation added if
  missing — pre-authorized), LAN-address enumeration, `POST /api/sync/pairing/lan`, secret
  registry, syncclient `lan_pairing_secret`/`peer_fingerprint` + dial presentation + authority-side
  validate-and-auto-approve, contract 1.5.0 + fixtures, CHANGELOG. Gates: go build/vet/test with
  CGO flags.
- **E2 (engine, after E1):** desktop cloud identity — loopback OAuth (Google first; Apple deferred,
  owner gate), account session persistence, sign-in/status/signout endpoints, mint calls (existing
  pairing-token endpoint + new enrollment-grant endpoint) feeding the QR composition, fixtures
  extension within 1.5.0. Gates: go build/vet/test with CGO flags.
- **W (Wails frontend, nested repo, after E2):** sign-in UI + account status, Pair modal (segmented,
  QR render — lib is a judgment call, countdown ring, regenerate, name + security badge), paired-
  device toast, i18n en. Gates: frontend build/lint per repo scripts.
- **A (app, after E1+E2):** parser v2 (discriminated union; old cloud shape = cloud kind),
  scan routing + store-variant LAN rejection, confirmation sheet (name/mode/fingerprint/account
  hint/enrollment offer), config patch (addresses+mode+fingerprint+secret), manual LAN form →
  Advanced disclosure, enrollment intake for signed-out full phones, contract 1.5.0 lockstep +
  drift CLI green, CONNECTION-SECURITY/CHANGELOG/i18n, tests. Gates: tsc + jest (+gradle only if
  native touched — not expected).
- **Orchestrator:** this doc, summary, ticks, final report.

## Pre-authorized judgment calls (owner may veto)

- Engine auto-generates a self-signed cert on first WSS use if no cert story exists today
  (zero-config QR goal); halt if that balloons.
- Desktop sign-in ships Google-only initially (Apple-on-desktop deferred — needs provider console
  work; owner gate).
- Loopback port is ephemeral + state/PKCE; redirect-URI registration in the OAuth console is an
  owner gate either way.
- QR rendering library in Wails chosen by W (small, maintained, no heavyweight deps).
- Phone confirmation sheet offers enrollment ONLY when signed out (full variant) or account-mismatch
  is warned; signed-in-matching just pairs.

## Owner gates (after code lands)

- ~~OAuth console: allow the loopback redirect URI~~ **OBSOLETE (correction round)** — no Google
  console work at all: the engine signs in through the portal, whose login methods are already
  configured server-side.
- Apple sign-in on desktop: moot for the engine (the portal offers Apple already; the engine never
  sees the provider).
- Device drill: desktop sign-in (Settings → Sign in → browser → portal login → Allow → engine flips
  to Ready) → Pair modal → phone scans LAN QR → confirmation → auto-approve toast on desktop →
  signed-out full phone enrolls via desktop's account → relay sync green; unencrypted path
  spot-check; store phone rejects LAN QR with clear copy.
- Review + commit accumulated uncommitted work across all repos.

## Progress checklist

- [x] C cloud enrollment grants — migration `000040` (real-Postgres up-chain 1→40 + down/up verified),
      `POST /v1/devices/enrollment-grants` (interactive PASETO only; API keys refused) +
      `POST /v1/auth/device/enroll` (grant → device session, device row authorized, `TokenResponse`
      shape); 12 tests; openapi + mechanics-doc §8 + api-usage + CHANGELOG.
- [x] E1 engine LAN pairing — cert story already auto-self-signed RSA-4096 (stable, persisted; only a
      fingerprint accessor added); `POST /api/sync/pairing/lan` (fresh secret per call, LAN-IP
      enumeration, best-mode advertising); `pairing_secret` rides the existing `HANDSHAKE_REQUEST`;
      authority validates + auto-approves (single-use, TTL, logs QR source; manual path intact);
      syncclient `peer_fingerprint` (fail-closed pin on all TLS dials) + `lan_pairing_secret`
      (write-only, cleared after first accept); contract **1.4.0 → 1.5.0** + fixtures.
- [x] E2 engine desktop cloud identity — `cloudauth/` package: loopback OAuth (`127.0.0.1:<ephemeral>`,
      state+PKCE), code→session delegated to cloud `/v1/auth/google/web` (no client secret on desktop),
      full device-auth mirror (register → email code → verify) with `POST /api/cloud/signin/device/verify`;
      `GET /api/cloud/account`, `signin/start`, `signout`; `POST /api/sync/pairing/cloud` (exact portal
      shape); LAN payload extended with `enrollment` block when signed in; config `cloud_account` block
      (tokens persisted, redacted on every read) + `SE_CLOUD_BASE_URL`/`SE_CLOUD_RELAY_URL`/
      `SE_GOOGLE_CLIENT_ID`; fixtures extended within 1.5.0.
- [x] W Wails Pair modal + sign-in UI — `react-qr-code@2.2.0` (zero-dep, offline SVG); segmented
      [Local network | Soulbits Cloud] modal with countdown ring + regenerate + security badge;
      cloud tab gated on sign-in AND device authorization (check-email/code-entry state); CloudAccountCard
      in Settings; paired-device toast via approval-watcher seen-set diff (+ new toast infra — the app
      had none); en i18n; vite build green.
- [x] A app scan/confirm/enroll UX — parser v2 discriminated union (cloud back-compat; `soulbits-lan`
      validated); scan routing + store-variant LAN rejection; `LanPairingConfirmSheet` (name/mode/short
      fingerprint/enrollment offer); ONE config patch (`peer_fingerprint` + `lan_pairing_secret` +
      addresses + mode); `AuthService.enrollDevice` reusing the login token path; manual LAN inputs
      collapsed under Advanced (Connect stays; 3 modes equal); contract 1.5.0 lockstep (39/43) + drift
      CLI green; CONNECTION-SECURITY/CHANGELOG/i18n/docs; **158 suites / 1373 tests** (baseline 157/1333).
- [x] Orchestrator ticks + summary + final report

## Implementation record (2026-10-15)

Gates: cloud `go build/vet/test` 0 (+ real-Postgres migration verification) · engine `go build/vet/test`
0 with CGO flags (E1, E2) · frontend `npm run build` 0 (no lint script exists) · app tsc 0, jest
158/1373, drift CLI green at 1.5.0. Everything uncommitted across all repos.

### Judgment calls (owner may veto)

1. **C:** enrollment mint refuses API keys (interactive PASETO only) — harder than the sync-pairing
   precedent, deliberate (a grant authorizes a durable device).
2. **C:** `platform` optional on enroll (default `android`) because the signed-out phone has no
   server-side platform; `device_name` is display/log-only (no column).
3. **E1:** pairing-secret consume happens only when it actually approves a still-unapproved device —
   an already-approved device doesn't burn the QR.
4. **E1:** a valid secret RE-approves pending or previously rejected/revoked devices ("QR = fresh
   consent"); invalid/expired/replayed → unchanged manual pending path.
5. **E1:** `peer_fingerprint` pins the leaf-cert SHA-256 on BOTH TLS modes (stronger than CA verify);
   LAN `mode:"secure"` means fingerprint-pinned (the auto cert's SANs are localhost-only, so CA/hostname
   verify over a LAN IP is not usable — pinned trust is the honest label).
6. **E2:** code→session exchange is delegated to the cloud's existing `/v1/auth/google/web` — the
   desktop holds only the public client id; the cloud keeps the confidential-client secret.
7. **E2:** desktop device authorization mirrors the phone flow verbatim — the desktop's own sign-in
   includes the emailed code/approval-link step (`device/verify` + status polling). Cloud policy could
   later relax this for desktops; surfaced to W's UI either way.
8. **E2:** `account_hint` masked everywhere except the cloud QR (full email — portal parity +
   `accountHintMatches`).
9. **W:** `react-qr-code@2.2.0` (pure-SVG, zero runtime deps, fully offline).
10. **W:** toast infrastructure added (the desktop app had no toast primitive); paired-device toasts
    diff `GET /api/sync/devices` against a silently-seeded persisted seen-set (no re-toast storms).
11. **A:** drift CLI equality forced declaring the 6 desktop-side 1.5.0 routes in the app manifest —
    each got a real `EngineApiClient` method + loopback driver so the driver gate stays meaningful.
12. **A:** enrollment hint matching is conservative prefix+suffix on the masked `u***@…` (under-matches
    rather than over-matches).
13. **A:** two existing tests updated for the 1.4.0→1.5.0 literal (conformance gate + diagnostics).

### ⚠ Cloud repo state discrepancy (owner must resolve)

The cloud checkout does **not** contain the 7-13 F2 work: the tree was clean before today's C task,
the highest committed migration is `000038`, and no `000039` / soulvoice-catalog rename exists on any
branch (recent history: portal i18n + docs commits). C correctly kept `000040` (no collision either
way). **Action needed:** confirm where F2's uncommitted cloud work (migration `000039`
model_tier_access rename, gateway/portal/deploy renames) went — committed elsewhere, deliberately
discarded, or lost. If lost, it must be redone before the soulvoice catalog rename is live.

## Correction round (2026-10-15/16): portal-mediated sign-in

The original E2 design misconceived the engine as a **direct Google OAuth client** (needing
`SE_GOOGLE_CLIENT_ID` + a loopback redirect). Owner correction: **Soulbits Cloud is the identity
provider** — the portal already owns full identity (email/password + Google/Apple server-side), so
the engine just sends the user to the portal. **Rulings: poll-only handoff (no loopback at all);
Allow = authorized (portal login + Allow registers the device authorized — the emailed-code step
applies to phones only).**

### Rework record (all gates green, uncommitted)

- **C2 (cloud):** migration `000041` `device_connect_sessions`; `POST /v1/devices/connect-session`
  (public, IP-limited → `{connect_id, session_secret, connect_url, expires_in:600}`),
  `GET …/{id}` (Bearer session_secret; approved returns the token pair **exactly once**, then
  consumed), `GET …/{id}/meta` (portal page), `POST …/{id}/approve` (portal PASETO, API keys
  refused; upserts device `authorized=true`, issues + binds the pair AES-256-GCM-encrypted).
  Portal page `/connect?request=…` (ProtectedRoute, preserves query through login; en/de/ar);
  `connect_url` = `PORTAL_BASE_URL + /connect?request=…`. 19 handler tests; go 0; portal build 0;
  migration verified up/down/up on real Postgres.
- **E2b (engine):** `cloudauth/oauth.go` DELETED (loopback, PKCE, Google consent, `/v1/auth/google/web`
  exchange, device register→email-code→verify); replaced by `cloudauth/connect.go` — start creates
  a connect session (connect_id+secret **in memory only**, never persisted/echoed), polls every
  2.5s, redeems once, `GET /v1/auth/me` for identity. `POST /api/cloud/signin/device/verify`
  endpoint removed; `SE_GOOGLE_CLIENT_ID` + config field removed; account-status shape byte-stable
  (`device_authorization_pending` now means "portal sign-in in progress"). go build/vet/test 0 (CGO).
- **W2 (frontend):** code-entry UI removed; waiting state "Finish signing in in your browser"
  (spinner + poll flip); cloud tab now selectable while signed out (sign-in CTA lives there; mint
  gating unchanged `signed_in && device_authorized`); dead keys pruned; build 0.
- **A2 (app):** contract lockstep — `cloud.deviceVerify` removed from manifest + driver + fixtures
  (**38 endpoints / 43 fixtures**, version stays 1.5.0); tsc 0; jest **158/1372** (one fewer = the
  removed parametrized driver case); drift CLI green.

### Correction-round judgment calls (owner may veto)

1. **C2:** token pair stored **encrypted-at-rest** (AES-256-GCM, key = SHA-256 of a domain-separated
   constant ‖ the PASETO key — deterministic for multi-instance ALB + restarts; a DB-only read
   cannot recover a session); tokens deleted on redeem; expired rows pruned on create.
2. **C2:** redeem is two statements — PostgreSQL `RETURNING` yields post-update values, so claiming
   and clearing are separated (caught a would-be NULL-return bug).
3. **C2:** approve is idempotent (re-click harmless); `platform` defaults `web` (user_devices CHECK).
4. **E2b:** sign-in failures surface only via account status (`signed_in:false, pending:false`) —
   no error field, keeping the response shape byte-stable for the frontend.
5. **E2b:** transient poll errors retry until the 10-min TTL; upstream create failure → 502.
6. **W2:** cloud tab reachable while signed out (the waiting state and sign-in CTA live there);
   QR minting still requires signed-in + authorized.
7. **A2:** the manifest shrank within 1.5.0 (39→38) — recorded in the contract history comment.
