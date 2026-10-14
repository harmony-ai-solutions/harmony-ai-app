# Phase 7-14 — Distribution Variants: Store vs Full

> **Repos:** `harmony-ai-app` ONLY. Engine + cloud: **zero changes by design** (variant-agnostic).
> **Created:** 2026-10-14, triggered by the owner's product-model correction: two app versions —
> Store (Play/App Store, always-and-only Soulbits Cloud) and Sideload/Self-Built ("full release",
> cloud optional) — a distribution-variant axis the parity plan never encoded.
> **Depends on:** 7-13 F1 (engine start + cloud-token injection now unconditional — the store variant
> gets auto-provisioned soulbitscloud for free post-sign-in) · 7-12 §0 topology map (Play = B/C) ·
> the parity plan's "no forced gate" decision (revisited for store builds only).
> **STATUS: COMPLETE 2026-10-14 (V1→V4 sequential, all gates green: tsc 0 · jest 157 suites/1333 tests ·
> gradle devDebug/devStoreDebug/devRelease+E2E SUCCESS; engine + cloud zero changes; everything
> uncommitted).** Implementation record + 12 judgment calls + owner gates in the checklist section below.

## Owner rulings (2026-10-14)

1. **Launch gate (store): silent → forced wall.** One-tap/silent attempt first (Android: existing
   Google sign-in stack's silent path; iOS: SIWA auto-attempt), falling back to a full-screen,
   non-dismissible sign-in wall (Google + Apple buttons; OAuth account creation server-side as today).
2. **Non-cloud entities in store: visible but locked.** Greyed, neutral copy ("uses a provider not
   available in this build"), no new sessions; entities still sync and store everywhere.
3. **APP_VARIANT replaces + derives.** `APP_VARIANT` (`store`|`full`) is the single functional axis
   (new gradle dimension + iOS config); `APP_CHANNEL` derived from it (store → store-listing update
   behavior, full → APK self-update). `APP_ENV` (dev/prod) stays orthogonal.
4. **Store builds ship the embedded engine** — required: the phone's engine IS the sync endpoint for
   desktop/paired-device sync. The lock applies to provider configs, not engine presence.
5. **Store pairing scope: cloud relay only (B/C).** Direct-LAN QR pairing hidden in store builds.
6. **Purchases in store at launch: disabled.** Wallet top-up and marketplace buy actions hidden
   (balance visible, marketplace browsable). IAP is a separate future plan (the only ruling that
   would touch cloud).
7. **Config UI: filter-only.** Provider pickers collapse to soulbitscloud; screens/layout unchanged.
8. **Dispatch after rulings** (7-13 pattern; judgment calls reported at the end).

## Binding design rules

1. **Full variant = today's behavior, byte-for-byte.** All existing tests stay green unchanged
   (except tests that themselves reference channel/flag plumbing).
2. **Store gating is variant-scoped and runtime-only.** NEVER write the synced `is_disabled` flag —
   a store device must never disable entities on desktop/sideload devices.
3. **Zero steering.** No "download the full APK"/sideload CTAs anywhere in store builds
   (UpdateBanner, locked-entity copy, marketplace, everywhere).
4. **Engine + cloud stay variant-agnostic.** No changes in either repo this phase.
5. **Same application ids for both variants** (no suffixes): OAuth clients (google-services/
   Apple) are per-package, and existing installs must not be orphaned. Side-by-side store+full
   installs are a possible future config+console task, deferred.
6. **Self-built = full** (default when nothing store-specific is configured).
7. **Disambiguation (trap): `soulbitscloud` ≠ `soulvoice`.** `soulbitscloud` = the cloud provider
   (the ONLY one store builds offer). `soulvoice` = the external self-hosted speech engine provider
   (full-only). Never confuse the two strings.

## Pre-authorized judgment calls (owner may veto)

- **No update checks at all in store builds** (updater fully off; the listing owns updates) —
  `app/latest.json` has no store destination and checks-without-action are noise.
- **Silent path uses the EXISTING auth stack only** (Google silent sign-in on Android; SIWA
  auto-attempt on iOS if the current apple-auth lib supports it cleanly). No new native SDK
  migration (e.g. Credential Manager) this pass; the wall is the reliable floor.
- **Locked-entity styling is distinct from user-disabled styling** (lock icon + copy, not the
  plain disabled treatment) so users don't think they disabled it.
- **Dev-store builds keep the unsuffixed dev id** (rule 5 rationale; testing store-dev means
  temporarily replacing full-dev on a device).

## Work split (4 sequential agents, all app repo)

- **V1 · plumbing:** APP_VARIANT through Android (new flavor dimension, `missingDimensionStrategy`
  → full so `assembleDevDebug`/`assembleDevRelease` keep working) + iOS (mirror APP_ENV's
  mechanism) + JS (`src/config/appVariant.ts` with a test seam; derive APP_CHANNEL; updater off in
  store) + CI/scripts sweep. Gates: tsc, jest, gradle ×3 (devDebug, devStoreDebug,
  devRelease+E2E_DEBUG_SIGNING).
- **V2 · launch gate:** AuthGate (store && !authenticated → wall, no dismiss; sign-out returns to
  wall), silent-attempt-then-wall per ruling 1, navigation wiring, i18n en. Gates: tsc, jest
  (+gradle if native touched).
- **V3 · provider lock + entity gating + pairing scope:** variant-aware provider availability
  (soulbitscloud-only pickers; hide modules with no cloud option), entity-creation defaults,
  `variantEntityAccess` lock predicate (investigate the entity→module→provider-config model
  first), chat-list/detail/search/notification gating (visible-but-locked), DesktopSync direct-LAN
  path hidden in store. Gates: tsc, jest.
- **V4 · purchases + docs:** wallet/marketplace purchase actions hidden in store, steering sweep,
  INSTALLATION.md variants section, CHANGELOG, memory-bank touch per convention. Gates: tsc, jest.
- **Orchestrator:** this doc, summary.md, ticks, final report.

## Contracts

- Management contract **1.4.0** untouched; drift CLI untouched (no engine fixture changes).
- Auth server flows untouched (existing Google/Apple OAuth). Cloud repo untouched.

## Owner gates (after code lands)

- iOS store signing/provisioning; SIWA verification on a signed build (entitlement).
- Device drill: dev-store build end-to-end — gate → silent/wall → paired-device sync → locked
  entities (visible-locked, no notifications) → no purchase UI → no update banner → no steering.
- Store listings/submission when ready; IAP as its own future plan.

## Progress checklist

- [x] V1 plumbing: APP_VARIANT build matrix + config + channel derivation + updater gating
      (2026-10-14; all old build names byte-identical, `devStore`/`prodStore` flavors added; test seam
      `setAppVariantForTests`; baseline → 148/1274)
- [x] V2 launch gate: wall + silent attempt + navigation/i18n (AuthGate at navigator root; Android
      Google silent; iOS wall-only judgment call; cold-start-only silent; splash until decision settles;
      baseline → 151/1297)
- [x] V3 provider lock + entity gating + pairing scope (providerAvailability + entityAccess services;
      three-hop entity→module→provider model documented; computed lock, zero is_disabled writes; all 8
      module types have soulbitscloud → nothing hidden; LAN pairing hidden in store; baseline → 153/1321)
- [x] V4 purchase gating + docs + steering sweep (purchaseAccess service; wallet dropdown inert,
      marketplace acquire bar hidden, billing card hidden; EngineContractGate steering fixed to neutral
      caption; INSTALLATION variants section + CHANGELOG + memory-bank; final baseline **157 suites /
      1333 tests**)
- [x] Orchestrator: ticks + summary + final report

## Implementation record (2026-10-14)

All four tasks dispatched sequentially, gates green throughout (tsc 0 · jest 157/1333 · gradle
devDebug/devStoreDebug/devRelease+E2E all SUCCESS). Engine + cloud repos: **zero changes** (as designed).
Everything uncommitted (owner commits).

### Judgment calls (owner may veto)

1. **V1 — variant lives as extra flavors in the existing `environment` dimension** (`devStore`/`prodStore`),
   not a second dimension: AGP cannot default the app's own dimension, and a 2nd dimension would rename
   every variant. Old task names byte-identical; no applicationId changes.
2. **V1 — prod-full Android now derives channel `sideload`** (updater offered on prod sideload APKs),
   replacing the old `__DEV__` placeholder fallback. Deliberate, matches the full=sideload model.
3. **V1 — updater double-gated** (service never fetches + banner never renders in store); no store update
   checks at all (pre-authorized: no store destination exists in latest.json).
4. **V1 — pre-existing quirk documented, not fixed:** `APP_ENV` never actually reaches Android JS
   (Android's react-native-config reflects only BuildConfig fields; `cloud.ts` falls back to `__DEV__`).
   iOS/Metro reads the generated `.env` where APP_VARIANT (and APP_ENV) flow correctly.
5. **V2 — iOS is wall-only**: SIWA auto-attempt is not a silent primitive in the current apple-auth lib
   (performRequest always presents the system sheet) — pre-authorized fallback; Android silent via
   `GoogleSignin.signInSilently` into the existing `loginWithGoogle` path.
6. **V2 — silent attempt is cold-start-only** (consumed at first auth state after bootstrap): a later
   sign-out can never be silently undone; splash (not wall) shown while the launch decision settles.
7. **V2 — noted:** no sign-out UI exists in the app today; the gate is driven purely by auth status, so
   when sign-out UI arrives it lands on the wall automatically.
8. **V3 — lock predicate checks module-config provider TYPE availability**, not the existence of the
   nested provider-config row (would cost 16 extra reads per pass); missing module-config ids (unsynced)
   DO lock. Fail-open on transient repository errors; 10s TTL cache + explicit invalidation on config
   save/delete and mapping writes; full variant never fetches.
9. **V3 — `disabled`/empty provider slots don't lock** (an intentionally-off module is not a foreign
   provider); locked rows press-open their detail (which shows the lock banner); connection dot grey
   `offline` instead of perpetual amber.
10. **V4 — purchase gating shapes:** SoulBalanceDropdown badge becomes a non-interactive pill (balance
    visible); marketplace acquire bar + "buy once" hint hidden (free claims + owned states kept);
    Billing & Purchases settings card hidden entirely; `CREDITS_UPGRADE_URL` left as wire data (never
    rendered — grep-verified).
11. **V4 — EngineContractGate store copy is a neutral non-linked caption** ("Update the app from your
    app store to continue.") because no store-listing URL exists in config yet — upgrade to a real store
    deep-link when listing URLs land. This also fixed a latent steering violation (the old store-mode
    button opened the portal GitHub INSTALLATION.md).
12. **V4 — DesktopSyncScreen desktop-engine download row left as-is**: proven unreachable in store
    (its data comes only from the updater cache the store variant never populates), and it is desktop-
    engine acquisition, not app steering.

### Owner gates

- iOS store signing/provisioning; SIWA verification on a signed build (entitlement).
- Device drill on a `devStore` build end-to-end: gate (silent/wall) → paired-device cloud-relay sync →
  non-cloud entities visible-locked (no unread badges, no outreach notifications, neutral banner) →
  provider pickers soulbitscloud-only → wallet/marketplace purchase actions gone → no update banner →
  zero steering anywhere.
- Future: store-listing URLs in config (upgrade EngineContractGate caption to a real deep-link);
  CI store matrix entry (`variant: [full, store]`); IAP as its own plan; store submission.
