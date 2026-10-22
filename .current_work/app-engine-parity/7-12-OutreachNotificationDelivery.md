# Phase 7-12 — Outreach Notification Delivery Parity (sync-applied outreach, relay fallback, Android + desktop)

> **Repos:** `harmony-link-private` (engine) · `harmony-ai-app` (app) · `soulbits-cloud-backend` (cloud) ·
> optionally the nested `harmony-link-ui` desktop frontend (D3)
> **Created:** 2026-10-13 (owner question after the 7-6..7-11 review pass: "will push be sent when an entity
> messages the user and no frontend is open/focused, without a custom FCM token?")
> **Depends on:** 7-8 (`changesetstore.AddApplyObserver` seam) · 4-3/4-4 (iOS wake + `/v1/lifecycle/notify`
> relay) · 7-11 (loopback-token WS auth pattern + drift-CLI fixtures procedure) · 7-3 (contract bump
> procedure; current version **1.3.0**, this phase bumps → **1.4.0**)
> **STATUS: IMPLEMENTED 2026-10-13 (all 9 steps + 2 addenda, gates green, all uncommitted per standing
> rule) — remaining items are OWNER gates (below).**
> D1=**(b) Firebase SDK in app** · D2=**include now** · D3=**include now** · D4=**(a) flavor-gated Firebase
> SDK** · lock-screen preview=**show by default + user setting**. See the ruled slots below; §3 was
> rewritten around D1=b (cloud code change drops to zero; the Firebase story unifies D1/D2/D4).
> **Earlier amendment 2026-10-13 (owner review):** the custom-FCM path (desktop engine + sideloaded app, no
> Soulbits Cloud) is a **first-class requirement**, not a legacy leftover — §0 topology map + §5 direct mode
> added.

## Implementation record (2026-10-13 dispatch, 8 code-expert agents)

- **Engine (steps 1+2):** `notifications` package (fan-out hub) + `lifecycle/outreach_notify_observer.go`
  (mute/decay/greeting gates, watermark idempotency; observer fires on sync-apply; eventserver offline/beat
  path covers locally-generated-no-session) + `GET /api/notifications/stream` (7-11 auth matrix) + live
  `delivery:"live"` emission; contract **1.4.0** lockstep incl. app vendored fixtures; drift CLI green (33
  endpoints, 38 fixtures). Gates: go build/vet/test 0 with canonical CGO_CFLAGS.
- **App (steps 3+4):** `OutreachNotificationService` (events-WS, AppState policy, eligibility suppression) +
  iOS local posting + Android `NotificationsModule` + `notification_transport` & lock-screen settings (en) +
  shared `outreachDedupe`/`NotificationSettings`/`LocalNotifications` seams. 140 suites/1192 tests.
- **Frontend (step 8, D3):** Wails v2.13 runtime notifications — frontend-only (no engine/Go change; key risk
  resolved). Unfocused → OS notification; dedupe by message_id; build green.
- **App (steps 5+6):** wake-window relay of sync-applied outreach (persisted watermark + `SyncAppliedOutreachCollector`
  on the events WS; no replay API exists — verified); relay payload blob +`messageId`; transport gating
  (`auto`/`cloud` relay, `direct`/`off` skip — see judgment calls); `PushTokenStore` + `push_token` in
  INIT_ENTITY for engine-targeted sessions ONLY (never cloud-proxy). 145 suites/1234 tests.
- **App (step 7, D1=b/D2/D4):** `@react-native-firebase/app+messaging@26.4.0` (modular API — v26 removed the
  namespaced API; documented deviation), placeholder google-services.json/GoogleService-Info.plist (build
  green without real config), full runtime guarding (SDK-less builds degrade gracefully), SDK>native token
  precedence, GUL-swizzler wake coexistence verified (native wake path unchanged), foreground suppression +
  dedupe of both payload shapes. 146 suites/1264 tests.
- **Addendum (orchestrator-approved):** Android 13+ `POST_NOTIFICATIONS` parity — same settings-toggle
  trigger as iOS, same `requestAuthorization`/`getAuthorizationStatus` bridge surface. 146/1267 tests.
- **Engine addendum (resolved, no change):** §5's "engine push carries message_id" was already satisfied
  since commit `599e73f` (`push/payload.go:45` + tests) — agent correctly halted; closed as satisfied.
- **Docs (step 9):** CHANGELOGs (app + engine; the nested frontend has no changelog convention — its change
  recorded as an engine-changelog sub-bullet per the 6-4 precedent), `docs/INSTALLATION.md` 1.4.0,
  `docs/SELF-BUILDER-NOTIFICATIONS.md` (topology-A recipe incl. project-match contract), cloud
  `docs/lifecycle-plane-operations.md` FCM-token note, app memory-bank `.toon` updates.
- **Cloud: ZERO code changes** (orchestrator-verified against relay.go/notification.go/keepalive.go/resolver.go):
  relay forwards the opaque payload incl. `messageId` untouched; targets resolve `platform <> 'web'`; alert
  relays carry a visible notification block (Android killed-app auto-display); keepalive intentionally
  iOS-only. Known consequence: relay pushes stack (no collapse_key — deriving one would break the
  cloud-blindness fence).

### Judgment calls made during dispatch (owner may veto — all small, all isolated)
1. **Transport gating applies to the WHOLE wake relay** (batch-flag + sync-applied), not just the new path —
   §5's "off silences OS notifications everywhere" / "direct = engine-side FCM owns it" would be incoherent
   otherwise. One-line change if the owner wants the legacy batch relay exempt.
2. **Android POST_NOTIFICATIONS addendum** dispatched as mechanical iOS parity (same trigger, same bridge
   surface, no new UX) — it was a step-4 completeness gap: without it no Android 13+ notification displays.
3. **RNFB v26 modular API** instead of the doc's `messaging()` namespaced form (removed upstream in v26).
4. **Frontend changelog** recorded in the engine CHANGELOG (nested repo has none; 6-4 precedent).

## Objective

When an AI entity sends the user a message and **no frontend is focused**, the user should get a real
notification on the device they're actually holding — regardless of **which engine** generated the outreach
(authority desktop vs. local phone) and **without any user-configured FCM credentials**. Today this fails in
every multi-device configuration (see verified state 2/5/6/7). **Owner amendment (2026-10-13):** the relay is
the *convenience default for signed-in users* — it must NOT become the only path. Self-hosted users (desktop
engine + sideloaded app variant, directly synced, no cloud account) keep the **custom-FCM path** as a
first-class option (§5).

## §0 Topology & notification-path map (all App × Engine combinations)

```mermaid
flowchart TB
  subgraph TA ["A · Direct pair — no cloud account (sideload flavor only)"]
    A1["Desktop engine<br/>(Wails: engine + UI)"] -- "LAN WS sessions (INIT_ENTITY)" --> A2["Sideload app<br/>(phone-embedded engine idle/unused)"]
    A1 -- "outreach, no active session<br/>→ engine push via OWN Firebase (SE_FCM_*)" --> A2
    A1 -- "outreach, session live<br/>→ in-app only (+ desktop OS notif, D3)" --> A3["Desktop UI"]
    A2 -- "process alive (fg service)" --> A4["local notification"]
  end
  subgraph TB_ ["B · Cloud-sync pair — signed in (Play + sideload)"]
    B1["Desktop engine · authority"] <--> "E2E relay frames (blind)" --> B2["Phone-embedded engine"]
    B3["Desktop UI"] -- mgmt API --> B1
    B4["Phone app"] -- mgmt API + events WS --> B2
    B2 -- "outreach events (§1: beat OR sync-applied)" --> B4
    B4 -- "background & alive → local · wake window → relay push" --> B5["phone notification"]
  end
  subgraph TC ["C · Phone only — signed in"]
    C1["Embedded engine · authority"] --> C2["Phone app"]
    C3["Cloud keepalive / blind ticks"] -- "silent APNs wake" --> C2
    C2 -- "wake: batch + §1 events → relay" --> C4["visible push"]
  end
  subgraph TD ["D · Phone only — no cloud account"]
    D1["Embedded engine"] --> D2["Phone app"]
    D2 -- "alive only → local · killed → silent until open" --> D3["local notification"]
  end
```

| # | Devices | Flavor | Sync / pairing | Background notification transports |
|---|---------|--------|----------------|------------------------------------|
| A | Desktop + phone | **sideload only** | LAN direct (phone session lives on desktop engine) | **engine → own FCM** (custom, needs `SE_FCM_*` + token wiring §5); phone-local while alive |
| B | Desktop + phone | Play · sideload | cloud relay (one authority, 7-8) | §1/§2 events → local (alive) / relay push (wake); desktop OS notif when unfocused (D3) |
| C | Phone only | Play · sideload | cloud (backup + account) | wake → relay push; alive → local |
| D | Phone only | sideload | none | local only; killed app = silent |
| E | Desktop only | — | none | in-app; OS notification when unfocused (D3) |

Notes: the **Play flavor is restricted to B/C** (own backend only — no LAN pairing, no custom FCM). The
sideload flavor may run A, B, C or D. The same phone can move between topologies (e.g. paired at home on
LAN = A, out of the house signed in = B) — hence the transport-precedence rules in §5.

## Verified current state (2026-10-13 investigation — anchor before editing)

1. **Engine outreach notify is local-FCM-or-nothing.** `eventserver/session.go:505-541` (DeliverOutreach):
   active WS session → live delivery, **no push attempted** (by design); no session → persist + gates
   (Q8 muted, D-DENSITY-14 decay fail-closed) + `m.notifier.NotifyOutreach`. The notifier is `NoopNotifier`
   unless `SE_FCM_*`/config FCM creds exist (`cmd/run.go:411-419`, embedded: `enginehost/enginehost.go:516-524`
   — log line: *"push: FCM not configured — local push disabled (app relies on periodic sync)"*). FCM creds
   require a Firebase **service-account JSON** — shippable in no distributable (extractable secret), which is
   why the 4-4 relay is the operated default. For **self-hosted setups this path is intentional and stays**
   (§5). **The engine never calls the relay** (zero `lifecycle/notify` refs in the
   engine repo) — by 4-4 design ("the DEVICE decides"), but today only the *phone app* ever decides.
2. **Sync-applied outreach never notifies.** `changesetstore.Store` runs post-apply observers
   (`store.go:141-154`, dispatched at `apply.go:76`) — currently RAG re-index (`cmd/run.go:182`) and the 7-8
   CDC trigger (`cmd/run.go:221`). There is no outreach-notification observer, so outreach authored by a
   *remote* authority (the flagship 7-8 desktop-authority topology) applies silently; the phone surfaces it at
   next app open. This is the core gap.
3. **No engine→app event channel.** The management API has exactly one WS (`management/routes_logs_ws.go`,
   7-11: loopback-token auth) — everything else is REST polling. Nothing streams "outreach landed".
4. **iOS wake path works but only for locally-generated outreach.** `IOSLifecycleWakeHandler.ts:204-292`
   runs engine start → catch-up (applies pending authority changesets via the sync dial) → `lifecycle.batch`
   → `relayOutreach` (294-315) — driven **only** by batch-result flags (`outreachDueEntityIds`). Batch skipped
   as `not_authoritative` ⇒ zero relayed, even when the wake just applied desktop-authored outreach.
   `PushRelayClient.ts` (the app's only relay client) is referenced solely by the two iOS wake/maintenance
   orchestrators.
5. **Cloud sender is FCM-v1-only while the app registers raw APNs tokens.** App: native APNs token
   (`ios/Notifications/SoulbitsNotificationsModule.m`) → `DeviceAuthService.registerDevice({pushToken})` →
   `user_devices.push_token` (`push-service/resolver.go:33-37`, relay variant `relay.go:200` — platform
   CHECK-constrained `android|ios|web`). Sender: Firebase Admin SDK / mock / noop only (`sender.go:8-17`) —
   FCM v1 addresses **FCM registration tokens**, which require the Firebase SDK **client-side**; the app has
   none (no firebase dep in `package.json`). The 4-4 e2e proved the wire against the **mock** FCM server
   only. Real-device iOS delivery is therefore **unproven and, as wired, cannot work** (suspected gap —
   confirm at the first staging push round-trip drill).
6. **Android has no notification surface at all.** No Firebase SDK, no `FirebaseMessagingService` (native
   services: ChatBubble, EngineSidecar, BackupHeadlessTask only), never registers a cloud token
   (`registerIOSLifecycleBridge` is iOS-only), never calls the relay, never posts OS notifications
   (`NotificationService.registerPushToken` is a documented in-memory no-op; `SoulbitsNotifications` JS
   surface is permission-only). In-app UI only; killed app = nothing until next open.
7. **Desktop never notifies.** Engine: local FCM requires per-install service-account creds (dead end for
   operated builds, see 1). Wails frontend (nested `harmony-link-ui` checkout): zero `Notification` references — an
   open-but-unfocused desktop receives outreach "live" and renders nothing.
8. **The custom-FCM path is engine-complete but app-incomplete.** Engine side works: session-param token
   registration (`eventserver/eventprocessor.go:286-296` — `sessionParams.PushToken` + `DeviceID` →
   `device_push_tokens`), outreach push via the user's project. App side has two holes: (a) the RN app's
   `INIT_ENTITY` payload sends `device_type`/`device_id`/`device_platform` but **never `push_token`**
   (`EntitySessionService.ts:546-560`) — so the desktop engine's token table stays empty even in direct/LAN
   mode; a native token surfacing seam exists unused (`EngineEmbeddedModule.onPushToken` /
   `consumePendingPushToken`); (b) receiving pushes from a Firebase project requires the **Firebase SDK
   compiled in** (client-side FCM registration tokens — Android: `google-services.json`; iOS: SDK +
   APNs); the app has none (verified state 6), so a sideload build cannot currently *receive* engine pushes
   on either platform. The custom path therefore needs §5's app-side wiring + D4's build-support ruling.

## Design

### §1 Engine — outreach events: observer + eligibility gates + events WS

- **New third apply-observer** (`lifecycle/outreach_notify_observer.go`, wired in `cmd/run.go` beside the
  CDC trigger at `:221` AND in the `enginehost` embedded wiring): on applies that INSERT
  `conversation_messages` rows of type `outreach`/`greeting` into a non-disabled entity's interaction,
  evaluate **the same gates as the eventserver path** (Q8 muted target; `push.DecidePushEligibility` decay
  fail-closed — same store data, post-apply, so lastUserMessageAt/priorPushes are already synced), then emit.
  Gate rationale: notification fatigue + mute are **engine-authoritative per user** (D-35-era rulings); the
  receiving engine is the right decision point for sync-applied rows. The authority's *generation* gate is
  untouched (it decides whether outreach EXISTS; this decides whether it *pings*).
- **New management endpoint** `GET /api/notifications/stream` — a WS following the 7-11 logs-WS pattern
  verbatim: registered under the `mobileAuth` group (loopback token), desktop admin-key path also accepted,
  `token=` query param for the handshake, same reconnect/backoff contract. Event shape (loopback-only
  transport, so content is fine):
  `{type:"outreach"|"greeting", entity_id, entity_name, message_id, title, body_preview, created_at,
  eligibility:"eligible"|"muted"|"decay_suppressed"}` — the engine pre-renders title/preview (it holds the
  row; mirrors `composeOutreach`), so clients never need an extra fetch before notifying. Live-delivered
  outreach (eventserver step-2 path, session.go:476-489) ALSO emits into this stream tagged
  `delivery:"live"` so a connected-but-unfocused frontend can raise an OS notification (desktop D3) — the
  engine cannot know focus state; the client decides.
- **Contract: 1.3.0 → 1.4.0** (additive endpoint; openapi + canonical fixtures + app vendored fixtures +
  `ENGINE_CONTRACT_VERSION` in lockstep, drift CLI green; procedure per 7-3/7-6/7-8).

### §2 App — OutreachNotificationService (one subscription, three transport policies)

- New `src/services/notifications/OutreachNotificationService.ts`: subscribes to the events WS
  (injectable socket factory, `EngineLogStream.ts` pattern), reconnect w/ capped backoff, dies gracefully
  engine-less. Policy by `AppState`:
  - **Foreground:** in-app surfacing only (existing unread/badge behavior; no OS banner spam).
  - **Background, process alive (Android with sidecar service; iOS during a wake):** post a **local**
    notification — extend `ios/Notifications/SoulbitsNotificationsModule.m` with
    `UNUserNotificationCenter addNotificationRequest` (permission wrapper already exists), add a hand-rolled
    `android/.../notifications/NotificationsModule.kt` (NotificationManagerCompat, channels per entity) —
    **no new JS dependencies** (7-3/7-11 precedent would require a ruling otherwise; hand-rolled keeps it
    dep-free). Mute honored engine-side (events never arrive for muted entities) + client-side `is_muted`
    double-check for safety.
  - **iOS wake window:** the wake handler additionally feeds events received during the wake window into the
    existing `relayOutreach` (`PushRelayClient`) — covering **sync-applied** outreach at last (verified-state
    4). Relay stays the iOS background transport of record (OS-rendered, survives process death post-send;
    local-posting during wakes is a battery-flappy fallback only).
- **Android killed-app push: out of scope v1** (see D2).

### §3 Token model — Firebase SDK in the app (D1=b, ruled 2026-10-13)

**Ruled: the app integrates Firebase (`@react-native-firebase/app` + `messaging`); FCM registration tokens
replace raw APNs tokens everywhere; the cloud stays FCM-v1-only — zero cloud code change.**

- **Token acquisition & registration:** `messaging().getToken()` on both platforms → registered with the
  cloud via the existing `DeviceAuthService.registerDevice({pushToken})` → `user_devices.push_token`
  (resolver/keepalive/relay unchanged) → AND forwarded into the engine session params (§5) so a directly
  paired engine can register it in `device_push_tokens`. The existing raw-APNs registration flow
  (`IOSLifecycleBridge.defaultRegisterPushToken` fed by the native module) switches its token source to
  the SDK; the native raw-token seam (`EngineEmbeddedModule.onPushToken`) remains as fallback when Firebase
  is compiled out of a build.
- **iOS delivery:** FCM→APNs (the project carries the APNs auth key — existing owner gate "Firebase secret
  provisioning" now explicitly includes uploading the APNs key to the project). Silent `content-available`
  keepalives/blind-ticks keep working; the SDK's message handler routes them into the **existing native
  wake bridge** (wake entry point semantics unchanged — only the arrival path moves onto the SDK).
- **Android killed-app push (D2=include):** with the SDK present, the relay's existing FCM v1 android
  config (`notification.go`: `android.collapse_key` per entity, normal priority, 4-week TTL) auto-displays
  when the app is backgrounded/killed; foregrounded arrivals are suppressed in-app (dedupe with §2's local
  path via `message_id`). Android devices now register `platform='android'` rows with FCM tokens.
- **Flavor gating (D4=a):** official builds (Play + signed sideload) ship **our** Firebase config;
  self-builders swap in **their own** `google-services.json`/plist. **Self-builder contract:** the app
  build's Firebase project MUST match the desktop engine's `SE_FCM_*` project in topology A — documented
  in the recipe (step 9).
- **Why the owner chose (b) over the recommended cloud-APNs sender:** one transport end-to-end, the cloud
  repo untouched, and D2/D4 needed the client SDK anyway — the extra Google-on-iOS cost was accepted
  consciously.

### §4 Desktop — OS notifications when unfocused (D3)

- The Wails frontend subscribes to the same events WS (it already holds the desktop admin key) and raises an
  OS notification for `delivery:"live"` events when the window is unfocused. Mechanism decision during
  implementation (Wails runtime notification support vs. minimal tray/toast lib — no hard dependency choice
  now). **This is the only task touching the nested `harmony-link-ui` repo** (its first functional change
  this branch — the labeling sweep there remains separately deferred).

### §5 Direct mode & the custom-FCM path (self-hosted push, topology A — owner amendment 2026-10-13)

The relay is the **convenience default when signed in**; it is not a replacement for self-hosted push.
Users running the desktop engine **without** a Soulbits Cloud account, paired with a **sideloaded app
variant** over LAN, keep the engine-local FCM path end-to-end:

- **Engine (unchanged, first-class):** `SE_FCM_*`/config FCM creds → `FCMNotifier`; session-param token
  registration into `device_push_tokens`; outreach offline path with mute+decay gates. No behavioral change
  from this phase — nothing here may regress it (gate: existing push tests stay green).
- **App — close the wiring hole (verified state 8a):** when a push token is available (native seam
  `EngineEmbeddedModule.onPushToken` / `consumePendingPushToken` already exists), the RN app includes
  `push_token` in its `INIT_ENTITY` session params (same payload family as `device_id`/`device_platform`,
  `EntitySessionService.ts:546-560`) so the directly-connected engine can register it. Loopback/LAN only —
  the token goes to the engine the app has a session with, never anywhere else.
- **App — receiving (D4):** receiving from a Firebase project requires the SDK compiled into the build
  (client-side FCM token acquisition). Per D4 this is flavor-gated: sideload self-builds bring their own
  `google-services.json`/Firebase config; Play builds are unaffected. The same receiver machinery is what
  D2 would enable for Play killed-app push — the slots share their build plumbing, they differ only in
  whose Firebase project is compiled in.
- **Transport precedence & user choice (all topologies):** a single user-facing setting,
  `notification_transport: auto | direct | cloud | off` (default `auto`, stored per the app's existing
  settings conventions; surfaced in Settings → Notifications):
  - `auto` — engine-configured direct push wins for devices whose token that engine holds (topology A);
    otherwise cloud relay when signed in (B/C); otherwise local-only (D).
  - `direct` / `cloud` — pin one path (a signed-in self-hoster may still prefer their own Firebase);
    `off` silences OS notifications everywhere.
  - **Dedupe (required — doubles are possible in B when both paths are live):** every notification —
    engine-FCM push, relay push, and local post — carries `message_id`; clients collapse per
    `message_id` (Android notification tag / iOS `threadIdentifier` + client-side short-window check).
    Outreach events already carry `message_id` (§1 shape), and the relay payload convention
    (`{kind:"outreach", entityId}`) gains `messageId` alongside it — an additive, backward-compatible
    payload field on a device-authored opaque blob (cloud stays blind; no contract change).

### Fences (binding)

- **Cloud stays blind:** the relay keeps its coarse per-user cap; payloads stay device-authored + opaque;
  no message content, entity graph, or metadata beyond what 4-4 already allows server-side.
- **Gates stay engine-authoritative:** mute + decay evaluated on the engine that holds the synced store; the
  app only renders what arrives (plus a defensive client-side mute check).
- **The custom-FCM path is preserved, not deprecated:** the relay is an offer ("convenience when signed
  in"), never a requirement; engine-local FCM behavior and its tests must be untouched-or-extended only.
  The RN session `push_token` goes only to the engine the app holds a session with.
- No Firebase SDK, no new JS/RN dependencies anywhere without an explicit ruling (D1(b)/D4 would be that
  ruling; a flavor-gated SDK in sideload builds only is the D4 default proposal).
- The eventserver live path's semantics (session ⇒ no remote push) are unchanged — the new events stream
  adds client-side OS-notification capability, it does not re-enable engine→FCM on the live path.
- Relay **request** contract (`POST /v1/lifecycle/notify`) shape is frozen (4-4); the `messageId` addition
  lives inside the device-authored opaque payload (dedupe, §5), which the cloud cannot read — no contract
  change, no blindness change.

## Decision slots — ALL RULED 2026-10-13

- **D1 iOS token model (for the Soulbits relay): RULED (b) — Firebase SDK in app.** FCM registration
  tokens replace raw APNs tokens; cloud stays FCM-v1-only (zero cloud code change). See rewritten §3.
- **D2 Android killed-app push via OUR relay: RULED — include now.** FCM receiver machinery + cloud token
  registration land in this phase (§3 Android bullet).
- **D3 desktop OS notifications: RULED — include §4 now.** The nested `harmony-link-ui` repo gets its
  first functional change this branch (the deferred labeling sweep stays separate).
- **D4 custom-FCM app-side support (topology A receiving): RULED (a) — flavor-gated Firebase SDK.**
  Official builds ship our Firebase config; self-builds swap in their own — the recommended option, and
  now the same machinery D1(b)/D2 bring in anyway. Self-builder contract in §3.
- **Lock-screen preview (asked alongside): RULED — show preview by default + user setting.** New
  Settings → Notifications toggle "Hide content on lock screen" (default off = preview shown). The engine
  event keeps carrying `body_preview`; the CLIENT decides rendering — local notifications post generic
  text when enabled, and the on-device relay composer (`composeOutreach`) reads the same setting before
  sending an `alert`. No engine change.

## Implementation steps

1. Engine: outreach notify observer (gates + eligibility field) + `cmd/run.go` + `enginehost` wiring + tests
   (muted/decay-eligible/greeting/re-delivery idempotency — watermark pattern per the 7-8 CDC trigger).
2. Engine: `GET /api/notifications/stream` WS (mobileAuth + admin-key + `token=` matrix tests, 7-11 pattern)
   + live-path `delivery:"live"` emission; contract **1.4.0** lockstep (openapi, canonical fixtures, drift CLI).
3. App: `OutreachNotificationService` (WS client, AppState policy) + events-WS client (injectable factory).
4. App: iOS `SoulbitsNotificationsModule.m` local-notification posting + Android `NotificationsModule.kt`
   (+ package registration) + JS wrappers + `message_id` dedupe + `notification_transport` setting (UI +
   i18n) + lock-screen "hide content" toggle (preview vs generic text; §2/ruled preview question).
5. App: wake-handler extension — sync-applied outreach during wake windows relays via `PushRelayClient`
   (reuse `relayOutreach`; batch-flag path unchanged; payload gains `messageId`).
6. App §5: `push_token` in `INIT_ENTITY` session params (native seam `onPushToken`/`consumePendingPushToken`
   → session payload; LAN/loopback sessions only).
7. App: Firebase integration (D1=b + D2 + D4, §3): `@react-native-firebase/app+messaging` deps +
   flavor-gated config (official = our project; self-build = swapped) + token acquisition → cloud
   registration + engine session param + Android killed-app receiving w/ foreground dedupe + iOS wake
   routing onto the SDK's message handler.
8. Desktop (D3=ruled include): frontend events-WS subscription + unfocused OS notifications.
9. Docs + CHANGELOGs + memory-bank notes where they describe notification flow; cloud docs note (tokens are
   FCM registration tokens now — no cloud code change); 5-3 checklist gets the new device drills;
   self-builder recipe for topology A incl. the project-match contract (app Firebase project ≡ engine
   `SE_FCM_*` project).

## Files to create/modify (high-level)

- **Engine:** `lifecycle/outreach_notify_observer.go`(+test), `management/routes_notifications_ws.go`(+auth
  test), `cmd/run.go`, `enginehost/enginehost.go`, `eventserver/session.go` (live emission), openapi +
  canonical fixtures, CHANGELOG.
- **App:** `src/services/notifications/OutreachNotificationService.ts`(+test), events-WS client,
  `EngineApiClient` (events URL), `NotificationService` (local-posting seam), `EntitySessionService`
  (`push_token` session param), `EngineEmbeddedModule` (token seam reuse), settings screen + i18n (en,
  transport + lock-screen toggles), ios module, android module, Firebase integration (RNFB deps,
  `android/app/google-services.json` + `ios/GoogleService-Info.plist` flavor gating, token service,
  wake-handler routing, foreground dedupe), `IOSLifecycleWakeHandler` (wake relay extension), vendored
  fixtures + `ENGINE_CONTRACT_VERSION`, CHANGELOG.
- **Cloud:** NO code change (D1=b) — docs-only note that `user_devices.push_token` now holds FCM
  registration tokens.
- **Frontend (D3=ruled include):** events subscription + OS notification surface in the nested repo.

## Verification gates

- Engine (canonical env MANDATORY: `$env:CGO_CFLAGS='-DSQLITE_ENABLE_SESSION -DSQLITE_ENABLE_PREUPDATE_HOOK'`):
  `go build ./...`, `go vet ./...`, `go test ./...` exit 0; drift CLI green at 1.4.0.
- App: `npx.cmd tsc --noEmit` → 0; `npm.cmd run test` green (baseline 135 suites/1146 tests);
  `android\gradlew.bat assembleDevDebug` green (new module + RNFB autolink; `google-services` gradle
  plugin applies without breaking dev builds lacking a config — degrade gracefully).
- Cloud: no code change (D1=b) — no gates beyond the repo staying green as-is.
- Frontend (D3=ruled include): its build green (`npm run build` in `frontend/`).

## Owner gates (never agent-run)

- Firebase project config: **APNs auth key uploaded to OUR project** (FCM→APNs for iOS) + FCM v1
  service-account secret for push-service (extends the existing "Firebase secret provisioning" gate).
- `pod install` on macOS after the RNFB dependency (no CocoaPods on this host — blocks iOS builds).
- **Staging push round-trip drill** (already on the 5-3/7-x lists — now the D1=b verification): real-device
  iOS wake → relay → FCM → visible banner, AND Android killed-app → relay push auto-displayed.
- Device drills: Android background (service alive) local notification incl. mute suppression; desktop
  unfocused notification (D3); iOS killed-app next-wake relay for desktop-authored outreach; **topology A
  direct drill** (sideload build w/ own Firebase + desktop `SE_FCM_*` → engine push to phone; dedupe check
  when both transports are live); lock-screen toggle (preview ↔ generic) on both platforms.

## Progress checklist

- [x] 1. Engine outreach observer + wiring + tests
- [x] 2. Events WS + live emission + contract 1.4.0 lockstep
- [x] 3. App OutreachNotificationService + events client
- [x] 4. App local-notification surfaces (iOS extension + Android module) + dedupe + transport setting (+ Android 13+ POST_NOTIFICATIONS parity addendum)
- [x] 5. iOS wake relay extension for sync-applied outreach
- [x] 6. App §5: session `push_token` wiring
- [x] 7. App Firebase integration (D1=b/D2/D4: RNFB + flavor gating + tokens + Android receiving + wake routing)
- [x] 8. Desktop OS notifications (D3=ruled include)
- [x] 9. Docs, changelogs, memory banks, 5-3 drills, cloud docs note, self-builder recipe (project-match contract)
- [ ] Owner: Firebase/APNs project config · pod install · staging push round-trip · device drills (incl. topology A + lock-screen toggle)
