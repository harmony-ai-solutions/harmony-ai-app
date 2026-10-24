# Participant Broadcast Layer + Session Utterance Recording

Status: design approved 2026-10-24 — ready for implementation planning.

**Problem:** Each entity owns its own POV copy of interactions and messages (by design — individual memories/experiences). AI entities get theirs via cognition. The user's persona entity has no cognition (STT/VAD only), so nobody authors its POV copy since the app-local-DB direct-inserts were removed (embedded-engine refactor `1bf877a`, 2026-10-14). Result: the phone chat UI reads the frozen user-POV window — new messages and AI responses invisible despite full engine-side processing.

## Decisions (2026-10-24, owner)

- Management contract **stays 1.9.0** — the additive nullable `origin_message_id` field is approved.
- **Multi-device single-active-chat assumption accepted for v1** (same assumption AI response generation already makes). Hardening deferred.
- **Engine-side fan-out stays rejected** — it would move visibility policy into the engine core, violating the plugin-owns-routing principle.

## Design principles

1. **Routing lives app/plugin-side.** Which events may reach which entities is a plugin concern (game environments gate visibility). The phone app ships the trivial policy: a Chatroom — broadcast to all participants of the current interaction.
2. **Entity sessions are the only writers of their entity's POV.** No app-side SQL or management-API message writes — this replaces the removed direct-insert hack with the same pipeline everything else uses.
3. **Receiving behavior is capability-driven, uniform:** a broadcast utterance reaching an entity session → cognition present → inject into the cognition pipeline (unchanged behavior); cognition absent (user persona) → record the own-POV copy.
4. **Idempotency by origin message id.** Relays and sync echoes must never duplicate rows.

## Components

### A. App — Participant Broadcast (`EntitySessionService` extension)

- **Outgoing:** `sendTextMessage` / `sendCombinedMessage` currently broadcast to *partner* connections only (`EntitySessionService.ts:1293-1312`). Change: route via a policy → ChatroomPolicy sends to **all participant sessions of the current interaction**, including the user's own session. Claire's socket feeds cognition (unchanged); the user socket feeds the new recorder (B).
- **Incoming:** `handleIncomingMessage` (`:2260-2293`), after emitting `message:received`, relays the same ENTITY_UTTERANCE payload to every *other* local participant session (notably the user session). Emit the UI event keyed by the **user-POV interaction id** so the ChatDetail guard (`ChatDetailScreen.tsx:1089-1099`) passes — this fixes live updates too, not just refresh.
- **Policy seam (future-proofing):** `routeOutgoing(event, participants) → SessionIds` / `routeIncoming(event, originSession, participants) → SessionIds`. Phone ships ChatroomPolicy (all participants); game plugins override with visibility rules.
- **Relay readiness:** events can arrive before a participant session finished INIT (greeting pending events drain ~500ms after INIT responses). The relay queues per-session until that session's `started` event, then flushes.
- **Pending reconciliation:** unchanged — the post-send re-read now finds the persisted user-POV row, so optimistic rows reconcile normally.

### B. Engine — Session Utterance Recorder (`eventserver`)

- At the incoming-utterance routing point: when ENTITY_UTTERANCE arrives on a session whose entity has **no cognition module**, persist the own-POV copy:
  - `EntityID` = session entity (e.g. `user`), `SenderEntityID` = `utterance.EntityId`, `InteractionID` = the session's already-resolved interaction (from INIT_ENTITY / resume — do NOT re-resolve).
  - Content / message_type / audio mime + duration extracted from the utterance payload (share the extraction helper with cognition's incoming path, `cognition.go:795-861`). Preserve `message_type` exactly — greetings rely on it (see Greeting findings).
  - Audio blobs: take from the payload; if absent, copy from the origin row via origin id (same DB).
- **Idempotent:** skip when a row with `(interaction_id, origin_message_id)` exists. The wire already carries the needed id (client-minted for user sends; engine-minted `MessageID` for AI responses and greetings).
- **No echo:** the recorder never re-emits ENTITY_UTTERANCE to the session (no loops).
- **Cognition sessions are untouched** — the recorder is strictly the no-cognition fallback; AI entities keep recording via cognition as today.
- The write goes through the normal DB handle → captured by the changeset store → synced like any other row.

### C. Data model / wire

- Migration 56: `conversation_messages.origin_message_id TEXT NULL` + unique index on `(interaction_id, origin_message_id)`.
- `ConversationMessageSync` gains the nullable field — additive; contract stays 1.9.0 (approved).
- No new event types — reuse ENTITY_UTTERANCE / UTTERANCE_COMBINED.
- Optional phase 2: `origin_device` in the payload for diagnostics and multi-device reasoning.

### D. POV backfill (phase 2, engine-side)

App-relay has a durability hole: if the app process dies before pending events are delivered (the engine dies with it — buffers are in-memory), the relay never runs and the user-POV copy is never written. Add a reconciler that compares character-POV rows vs user-POV rows per active interaction and backfills missing copies (idempotent by origin id; historical rows without origin ids need a sender+content+time-window heuristic — scope to recent/active conversations). This also repairs the data written since the refactor.

## Greeting findings (investigated 2026-10-24 — RESOLVED)

- **Relay covers greetings for free.** `DeliverGreeting` (`eventserver/session.go:616`) persists the character-POV row (`message_type="greeting"`) and emits it as **ENTITY_UTTERANCE** with `MessageType: "greeting"` and the engine-minted `MessageID`, queued through the entity pending-event buffer so it lands after the INIT response. Same event type the relay hooks — no separate mechanism needed; the recorder persists the user-POV greeting copy with the type preserved.
- **Greetings are currently invisible in new chats** — same POV bug: the greeting swiper reads `message_type === 'greeting'` from the read path (`ChatDetailScreen.tsx:2555-2604`), which queries the user-POV window; the row only exists under the character POV. This design repairs greeting display as a side effect.
- **Stale comment to clean up:** `session.go:651` (D-35) claims "the app persists the live row itself" — obsolete since the app-DB removal; the app has no greeting write path anymore. Update the comment during implementation.

## Considered alternative: engine-side fan-out

The engine could broadcast utterances to all local participant sessions itself (no app relay). Pros: no backgrounding/durability hole, desktop inherits for free. Cons: moves visibility policy into engine core, violating principle 1. **Decision: rejected** (owner-confirmed 2026-10-24); the backfill reconciler covers the durability hole.

## Edge cases

1. **App backgrounded at response time** (the exact incident-log scenario): pending events deliver on resume → relay runs then → user-POV copy lands late but before the user reads it. Acceptable for v1.
2. **Multi-device simultaneous chat:** both devices relay → two user-POV rows in different POV interactions. v1 assumes single-active-device. Hardening: origin-id idempotency + interaction convergence via existing gap-threshold/sync.
3. **Sync echoes:** peer chat fan-out re-emits synced rows to the app; if the app relays those back, the recorder's origin-id idempotency makes it a no-op. No double rows.
4. **Edits / reactions:** phase 2 — map via `origin_message_id` (cross-POV id mapping is fiddly; defer).
5. **Greetings:** covered by the relay (see findings above); relay-readiness queue handles the INIT-order race.

## Steps

- [ ] Engine: migration 56 (`origin_message_id` + unique index)
- [ ] Engine: Session Utterance Recorder (persist, audio, idempotency, no-echo, message_type preservation) wired into the no-cognition branch of utterance routing
- [ ] Engine: tests — persist/idempotent/no-cognition-only/audio-copy/greeting-type; cognition sessions unaffected; conformance fixtures for the new nullable field
- [ ] Engine: update stale D-35 comment (`session.go:651`)
- [ ] App: Participant Broadcast policy seam + ChatroomPolicy; outgoing broadcast incl. own session; incoming relay in handleIncomingMessage with queue-until-started; user-POV-keyed UI event
- [ ] App: tests — relay unit tests (incl. greeting relay + queued flush); ChatDetail e2e: send → visible live + after refresh; AI response → visible both ways; new chat → greeting visible + swiper fires
- [ ] On-device acceptance: the POV discriminator (`GET /api/entities/user/...` vs `/api/entities/Claire-…/.../messages`) returns identical live windows
- [ ] Phase 2: POV backfill reconciler; edits/reactions; `origin_device`

## Repos / order

Engine (harmony-link-private, `fix/desktop-sync`) first — the recorder is inert without the app relay, safe to ship ahead. Then app (harmony-ai-app, `main`). No backend changes; client repos untouched.
