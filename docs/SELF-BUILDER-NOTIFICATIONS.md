# Self-Builder Guide — Direct Push Notifications (Topology A)

This guide is for people who run their **own** Soulbits Engine (typically the
desktop engine) paired directly with a **sideloaded** app build, **without** a
Soulbits Cloud account, and who want the engine to push a real notification to
the phone when a companion messages them while the app is in the background.

This is the **custom-FCM path** described in plan 7-12 §3/§5 (topology A). It is
a first-class, supported setup — the Soulbits Cloud relay is the *convenience*
default for signed-in users, never a requirement. If you are signed in to
Soulbits Cloud you do **not** need this guide: the relay handles delivery
through our Firebase project.

> **Owner-gated steps.** Building for iOS and swapping the real Firebase
> configuration are owner/host actions (they need macOS, `pod install`, and your
> own Firebase project). They are documented here as steps to perform, not as
> things the app already does.

## How the pieces fit

```
Desktop Soulbits Engine ── LAN session (INIT_ENTITY carries push_token) ──► Sideloaded app
        │  outreach, no active session
        └─ FCM push (your Firebase project, SE_FCM_* service account) ──────► phone notification
```

- The app sends its **FCM registration token** to the engine it holds a direct
  session with (in the `INIT_ENTITY` session params, `push_token`). It is sent
  **only** to that engine — never anywhere else.
- When outreach is generated with no live session, the engine pushes through
  **your** Firebase project using its `SE_FCM_*` service-account credentials.
- The push carries the outreach `message_id`, so the app de-duplicates it
  against its other surfaces (see *Behaviour* below).
- **Receiving** a push requires the Firebase SDK to be **compiled into the app
  build**. The SDK's client-side registration is what makes the engine's FCM
  send addressable at all.

## Prerequisites

1. **Your own Firebase project**, with an Android app (`google-services.json`)
   and, for iOS, an iOS app (`GoogleService-Info.plist`) registered.
2. **The engine's Firebase service-account credentials must belong to the SAME
   project as the app build's config.** This is the one hard rule: an engine
   pushing through project *A* can only be received by an app built against
   project *A*. Configure the desktop engine's `SE_FCM_*` service-account
   credentials for the project whose client config you are about to compile in.
3. For iOS: the project must have the **APNs auth key** uploaded (FCM delivers
   to iOS via APNs).
4. A macOS host with CocoaPods for the iOS build.

## Steps

### Android

1. Replace the build's Firebase client config with your own project's file:

   ```
   android/app/google-services.json   ← your project's file
   ```

   (Official builds ship the Soulbits project's placeholder config; a
   self-build replaces it. A build that still carries the placeholder will not
   receive pushes — the runtime guards keep it from crashing, but `getToken()`
   rejects against the dummy project and the app falls back to the native
   token.)

2. Build and install the sideload variant as usual (`assembleDevDebug` /
   `assembleDevRelease`). The `google-services` Gradle plugin is already
   applied; no other Gradle change is needed.

### iOS

1. Replace the build's Firebase client config:

   ```
   ios/HarmonyAIChat/GoogleService-Info.plist   ← your project's file
   ```

2. **Add the replaced `GoogleService-Info.plist` to the Xcode target's
   "Copy Bundle Resources" phase.** A swap that leaves the file out of the
   target will build but never initialise Firebase — the config simply will not
   be in the app bundle.

3. On macOS, run `pod install` (the `@react-native-firebase/app` +
   `@react-native-firebase/messaging` pods are already declared), then build
   from the workspace.

### Engine

Point the desktop engine at the **same** Firebase project:

- Provide the project's service-account JSON via the engine's `SE_FCM_*`
  credentials (the engine's FCM notifier activates when they are present).
- No app or engine code change is required — this is configuration only.

## Behaviour

- **Receiving needs the SDK compiled in.** A build without the Firebase SDK (or
  with a placeholder config) will not receive engine pushes; it degrades to the
  native token seam and simply gets no direct push. Nothing else breaks.
- **Every push carries the outreach `message_id`** (the engine-local shape has
  it top-level as `data.message_id`; the cloud-relay shape carries it inside the
  opaque `data.payload` as `messageId`). The app records it in a shared
  short-window de-dupe store, so the same outreach arriving via an engine push,
  a relay push, a wake relay or the engine events stream is surfaced **once**.
- **Android 13+ requires the notification permission grant.** The app requests
  `POST_NOTIFICATIONS` (through the same permission surface as other platforms);
  if the user denies it, no banner is shown until it is granted in system
  settings.
- **Foreground arrivals are suppressed.** When the app is open, the OS banner is
  not raised; the message surfaces in-app instead.

## Limitations

- **Relay pushes stack rather than collapse per entity** (a consequence of the
  cloud-blindness fence — the cloud forwards the opaque payload untouched and
  keeps only its coarse per-user cap). If you mix the direct engine push with the
  cloud relay on one device, near-simultaneous pushes for the same message are
  collapsed by the app's `message_id` de-dupe, but distinct messages are not
  coalesced per entity by the cloud.
- **Official builds ship the Soulbits Firebase project config.** Self-builds
  replace it with their own; if the app's project and the engine's `SE_FCM_*`
  project differ, pushes will not arrive.
- Raw APNs tokens are no longer registered anywhere; the FCM registration token
  (from the SDK) is the single push token on both platforms.
