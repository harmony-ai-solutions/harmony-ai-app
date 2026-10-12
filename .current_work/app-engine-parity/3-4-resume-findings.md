# 3-4 Resume — Engine-Contract Findings (working notes)

> Generated while resuming 3-4 (relink + flag flip + atomic deletion). The prior
> manifest's §0 named two gaps (provider writes; D-35). This resume verifies the
> NOW-CLOSED engine routes against the live engine (`harmony-link-private`
> branch `feat/app-engine-parity`, READ-ONLY) and records the *additional*
> contract mismatches discovered, because they change what "complete the relink"
> actually means.

## A. Provider config writes — CLOSED, contract-clean ✅

`management/routes_providers.go` (`handleCreateProvider` / `handleUpdateProvider`
/ `handleDeleteProvider`) + `management/server.go:209-211`:

- `POST /api/providers` body `{provider, config}` → 201 `{provider, config}` (engine mints the id; `config.id` carries it).
- `PUT /api/providers/:id` body `{config}` (partial merge) → 200 `{provider, config}` | 404 `{error:"provider config not found"}`.
- `DELETE /api/providers/:id` → 200 `{status}` | 409 `{error:"provider_in_use"}` | 404.

The app's 16 provider models (`src/database/models.ts`) are field-for-field the
engine's `*ProviderConfigSync` wire models (snake_case; only `created_at`/
`updated_at` omitted app-side, `deleted_at` coerced). **No mapper needed.**

`isXProviderConfigInUse` has no read endpoint; the delete route's 409 is the
authoritative in-use guard (owner ruling: "surface engine 409s"). The helper is
only ever called by the repo's own `deleteXProviderConfig`, so the adapter can
surface the 409 and keep the helper as a best-effort derived scan.

## B. Stats — CLOSED, contract-clean ✅

`GET /api/stats/characters` (`management/routes_stats.go`) →
`{ "stats": { "<entity_id>": { "likes": int, "chats": int }, ... } }`.
`getCharacterStats(entityId)` = `res.stats[id] ?? {likes:0, chats:0}`. Faithful.

## C. KNOT — engine mints entity ids; app mints client-side ❌ (needs design)

`POST /api/entities` (`management/routes_entities.go:202-317`) **rejects** any
request carrying `id` or `alias` with 400 (`"id and alias are server-assigned at
creation"`); the id is derived server-side from `name` via
`controllers.DeriveEntityID(name, Now())`. There is **no explicit-id mode** and
**no "derive my id" endpoint**.

The app's five creation seams do the opposite: they call
`mintEntityId(name)` (a DB-backed derivation) and pass the pre-minted `id`
**plus** `alias` into `createEntity({id, alias, ...})`, then reuse that `id` for
the module-mapping create, navigation, and profile linkage
(`CreateAIScreen.tsx:1104-1267`, `CharacterChatService.ts:222-231`,
`PersonaEditScreen` via `createUserPersona`, `AIProfileScreen` via
`duplicateAIPartner`). Because the engine's timestamp is `Now()` at engine time,
the engine's id can never equal the app's pre-minted id.

**Consequence:** repointing `createEntity` requires rewriting every create seam
+ screen to a *create-then-read-returned-id* model, not a mechanical swap.
`mintEntityId`/`mintPersonaIdentity` have no engine equivalent that returns an id
without creating — the owner ruling's explicit halt clause ("halt if an app
helper has no engine equivalent semantics") applies. `duplicateAIPartner` **is**
a clean wrapper (`POST /api/entities/:id/duplicate` → `{id, alias, ...}`).

## D. KNOT — engine mints character-profile ids ❌ (needs design)

`POST /api/character-profiles` (`routes_character_profiles.go:62-80`) ignores any
client `id` and always sets `profile.ID = uuid.New().String()`. The app passes a
client uuid (`CreateAIScreen.tsx:1126`) and reuses it for images + entity linkage.
Same create-then-read-id rewrite as §C.

## E. KNOT — module-config wire shape mismatch ❌ (latent 3-2 defect)

The engine's module-config reads/writes use a **composite** shape:
`config.BackendConfig = { id, name, provider, <providerType>: {...}, ... }`
(one nested field per provider family; `config/types.go:650-664`;
`controllers/module_controller.go` `LoadBackendModuleConfig` inlines the resolved
provider config). The app's models are **flat**
(`BackendConfig = {id, name, provider, provider_config_id, deleted_at}`,
`models.ts:346-352`). The existing 3-2 read adapter
(`services/engine/repositories/modules.ts`) passes the engine's composite through
with `as T` — **type-lying**; `provider_config_id` is absent so the module-config
edit UI would lose its provider selection. The module-config write body is
`{name, config}` (nested), not the app's flat model. Repointing needs a real
mapper both ways; `provider_config_id` must be read from the nested provider
config's `id`.

## F. KNOT — character image writes are multipart ❌ (mechanical but real)

`POST /api/character-profiles/:id/images` is `multipart/form-data`
(`c.FormFile("file")`, `routes_character_profiles.go:352-398`), not base64 JSON.
`PUT .../images/:image_id` takes only `{description, display_order}`;
`is_primary` rides the dedicated `PUT .../images/:image_id/set-primary` route;
create always sets `is_primary=false`. The app's `createCharacterImage` takes
base64 + `is_primary`. Adapter must build multipart bodies and issue the
set-primary follow-up.

## G. KNOT — D-35 message authorship redesign ❌ (behavioral)

Per the owner ruling, send = WS event + in-memory pending row, engine authors the
row, reconcile on read/echo. Today `EntitySessionService` (a) creates a local row
with an app UUIDv7 on every send (`:1145/:1291/:1407`), (b) ingests incoming
utterances into a local row with a fresh app UUID (`:2174-2252`), (c) patches
local rows for STT/edit events (`:1629/:2152`). Removing the mirror + the
app-authored ids changes send/echo/pending semantics and touches
`ChatDetailScreen`'s message loading. Not a mechanical repoint.

## H. Deletion blast radius

`SyncConnectionContext.tsx` is 1346 lines and is the sync/cloud-session hub;
`SyncService.ts` 2321; `EntitySessionService.ts` 2031. Deleting the sync/cloud
stack rewires these plus `DatabaseContext`, `AuthContext`, `AppNavigator`, the
auth/setup/settings screens, the cloud components and `WalletService`, and
repoints ~40 UI test suites' `jest.mock('.../database/repositories/*')` paths
(those module paths vanish with the deletion).

---

## Verdict

The **contract-clean** relink is mechanical and safe to land now. The
**entity/profile/module/persona write** relink and **D-35** are design-level
rewrites (§C–§G) that change create/authoring behaviour and touch screens +
tests; the deletion (§H) is not safe until they are done.

### Landed this pass (tsc 0; unit-tested)
- **Provider writes** (§A) — `services/engine/repositories/providers.ts`:
  16 types × create/update/delete/in-use + `updateAllSoulbitsCloudApiKeys`;
  `EngineApiClient.createProvider/updateProvider/deleteProvider`; seam-delegated.
- **Character stats** (§B) — `characters.getCharacterStats` over
  `GET /api/stats/characters`; seam-delegated.
- **Entity module mappings** — `entities.getEntityModuleMapping` (derived from
  the entity config's resolved `modules`) + `createEntityModuleMapping` /
  `updateEntityModuleMapping` / `createOrUpdateEntityModuleMapping` over
  `PUT /api/entities/:id/mappings`; seam-delegated.
- Tests: `engineRepositories.test.ts` 31 → 38 (+7).

### NOT landed (BLOCKED — design decisions, not engine routes)
- Entity / character-profile / persona **create** relink (§C, §D) — requires the
  create-then-read-id rewrite across `CreateAIScreen`, `CharacterChatService`,
  `CharacterCardImportService`, `createUserPersona`/`fromCard`, `AIProfileScreen`.
- Module-config **write** relink + composite/flat mapper (§E).
- Character **image** multipart writes (§F).
- **D-35** (§G).
- Flag flip + TS-stack deletion (§H) — unsafe until the above are done and
  device-verified.

The flag stays **default-OFF** (SQLite authoritative) so the tree remains
coherent: the new adapters are available on the API path but not exercised until
the relink completes — per the 3-4 halt protocol ("a fully-relinked tree +
manifest + untorn UI beats a half-deletion").
