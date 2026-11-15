# Phase 1-3 — Engine session-aware seam (module call sites)

**Repo:** `harmony-link-private` · **Objective:** give providers a per-entity stable
session id, deterministically derived so OpenCode's routing + prompt cache stay warm
across engine restarts.

## Steps

1. `providers/registry.go` (or a small new `providers/session.go`) — add the optional
   interface next to `AsyncMessageProvider` / `Disconnectable`:
   ```go
   // SessionAwareProvider receives a stable per-conversation session id.
   // Providers route it into request headers (e.g. x-opencode-session).
   type SessionAwareProvider interface {
       SetSessionID(sessionID string)
   }
   ```
2. Call sites — each chat-family module, right after `FromConfig` in
   `InitBackendClient()`-equivalents (same pattern as the `AsyncMessageProvider`
   assertion that follows):
   - `modules/backend.go` (~line 95)
   - `modules/cognition.go` (~line 199)
   - `modules/movement.go` (~line 137)
   - `modules/vision.go` (~line 133)

   ```go
   if sa, ok := p.(providers.SessionAwareProvider); ok {
       sa.SetSessionID(fmt.Sprintf("soulbits-%s-%s", entityId, <moduleType>))
   }
   ```
   `entityId` is already a parameter of every module `Init`. Keep the format stable —
   it IS the cache key OpenCode sees. (entityId is a UUID → no PII leakage.)
3. `providers/opencodego.go` — `SetSessionID` stores the value; `requestOptions()`
   emits it. Empty session (shouldn't happen via modules; possible on verify/probe
   paths) → emit a fallback `soulbits-verify` so the header is always present.

## Notes

- Lifecycle/session-resume re-`Init` regenerates the same id → no cache churn.
- The seam is deliberately provider-agnostic — a future decision client
  (4-1) reuses it unchanged.

## Checklist

- [ ] `SessionAwareProvider` interface
- [ ] 4 module call sites (backend, cognition, movement, vision)
- [ ] opencodego stores + emits session; fallback when unset
- [ ] Unit test: two `Init`s of the same entity produce identical headers
