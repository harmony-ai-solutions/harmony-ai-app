/**
 * engineContract — the app-side engine management-API contract gate (task 5-1).
 *
 * ## Why this exists
 *
 * Phase 3-4 deleted the app's TS SQLite replica, its mirrored migrations and the
 * RN↔Go **schema-parity** tooling (`scripts/dump-schema.ts`,
 * `scripts/compare-schemas.py`, `scripts/parity-allowlist.json`,
 * `.github/workflows/schema-parity.yml`, the schema-parity test suites). With no
 * app-side schema left there is nothing to keep "in parity" — but the app is now
 * *more* coupled to the engine, not less: every read and write goes over the
 * embedded engine's management REST API (`EngineApiClient` + the 3-2 repository
 * adapters). The old parity gate is replaced by **engine-contract gates** that
 * cover the actual coupling surfaces (task 5-1):
 *
 *   1. **Contract version pinning** — {@link ENGINE_CONTRACT_VERSION} mirrors the
 *      engine repo's `docs/api/management/openapi.yaml` `info.version`; the app
 *      refuses to run against an engine artifact older than the contract it was
 *      written against ({@link checkContractVersion}).
 *   2. **Shared wire fixtures** — {@link REQUIRED_ENGINE_ENDPOINTS} + the golden
 *      fixtures in `__fixtures__/managementContract.fixtures.ts` are the single
 *      machine-checkable description of the wire surface; both the mappers and
 *      the transport smoke consume them (see `engineContractConformance.test.ts`
 *      and `engineLoopbackSmoke.test.ts`).
 *
 * ## Shared-fixture hosting
 *
 * The plan's design hosts the canonical fixtures in the engine repo and has the
 * app CI fetch a pinned path. The engine repo is a read-only reference in this
 * task, so the app **vendors** its copy under
 * `src/services/engine/__fixtures__/`; the engine-side canonical copy + the
 * cross-repo fetch are the orchestrator's to land (see
 * `docs/engine-contract-gates.md`). The vendored copy is what the app's tests
 * consume today, and it is typed as the wire DTOs, so `tsc --noEmit` already
 * fails if a fixture drifts from the app's declared DTO shape.
 *
 * No network, no engine binary: everything here is pure so it runs in the fast
 * `unit` jest project.
 */

/**
 * The engine management-API **contract version** this TS layer is written
 * against.
 *
 * MUST equal `info.version` in the engine repo's
 * `docs/api/management/openapi.yaml` (today: `1.2.0`). When the engine changes
 * the app-facing wire surface it bumps its openapi version and this constant is
 * bumped in the same coordinated change; the `engineContractConformance` canary
 * fails if only one side moves.
 *
 * 1.0.0 → 1.1.0 (plan 7-2/7-3): the relay transport + sync-group key lifecycle
 * moved the management openapi to 1.1.0. `SyncClientStatus`/`SyncClientConfig`
 * gained `transport`/`relay_*`/`device_id`/`dataset_id`/`group_join_pending`/
 * `sync_group`/`rotation_required`/`relay`, the state enum gained
 * `auth_needed`/`quota_exceeded`, and the `/api/sync/group/*` routes landed.
 *
 * 1.1.0 → 1.2.0 (plan 7-6): the `relay` block gained the tier-quota fields
 * `sync_buffer_mb`/`sync_devices`/`backup_storage_mb` (retained by the engine
 * from the relay welcome; `0` = unlimited) so the app can surface the limits
 * proactively.
 *
 * 1.2.0 → 1.3.0 (plan 7-8): `SyncClientStatus` gained `cognition_authority`
 * (`"local"` | device id | null — where cognition runs) and `narration_paused`
 * (the authority relay lease expired), so the desktop-sync status card and the
 * iOS wake/maintenance honest-limits surfaces can show them.
 *
 * 1.3.0 → 1.4.0 (plan 7-12): the outreach notification stream — a new
 * `GET /api/notifications/stream` management WebSocket (7-11 log-WS auth
 * pattern) carrying outreach/greeting events, plus the new
 * `outreachNotificationEvent` / `outreachNotificationLiveEvent` shared payload
 * fixtures. The WS is exercised by the app's outreach-notification client tests
 * (like the log stream, it is not a REST manifest entry).
 */
export const ENGINE_CONTRACT_VERSION = '1.4.0';

/** Outcome of a contract-version comparison. */
export interface ContractVersionCheck {
  ok: boolean;
  /** Human-readable explanation, present only when `ok` is false. */
  reason?: string;
}

/** A parsed `MAJOR.MINOR[.PATCH]` tuple (missing patch = 0), or null. */
export type ParsedContractVersion = readonly [number, number, number];

/** Parse a `MAJOR.MINOR[.PATCH]` version string; returns null when malformed. */
export function parseContractVersion(version: string): ParsedContractVersion | null {
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(String(version).trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

/**
 * The **embedding artifact pinning** gate (5-1 gate 3): the app requires an
 * engine artifact whose contract version is **greater than or equal to** the
 * version this TS layer is written against. A lower artifact version means the
 * app would call endpoints or read fields the engine does not serve, so the
 * build must fail rather than ship a mismatch.
 *
 * Returns `{ ok: true }` when the artifact satisfies the requirement, else
 * `{ ok: false, reason }`. Pure — the CI wrapper feeds it the engine artifact's
 * advertised version.
 */
export function checkContractVersion(
  artifactVersion: string,
  requiredVersion: string = ENGINE_CONTRACT_VERSION,
): ContractVersionCheck {
  const artifact = parseContractVersion(artifactVersion);
  if (!artifact) {
    return { ok: false, reason: `unparseable engine contract version "${artifactVersion}"` };
  }
  const required = parseContractVersion(requiredVersion);
  if (!required) {
    return { ok: false, reason: `unparseable required contract version "${requiredVersion}"` };
  }
  for (let i = 0; i < 3; i += 1) {
    if (artifact[i] > required[i]) return { ok: true };
    if (artifact[i] < required[i]) {
      return {
        ok: false,
        reason: `engine contract ${artifactVersion} < required ${requiredVersion}`,
      };
    }
  }
  return { ok: true };
}

/**
 * The **exact-equality drift canary** (5-1 verification gate): the vendored
 * shared fixtures advertise the contract version they were captured against;
 * this asserts it equals {@link ENGINE_CONTRACT_VERSION}. Bumping one side
 * without the other fails the `engineContractConformance` suite — the
 * "deliberate-drift canary" the plan calls for.
 */
export function checkContractVersionExact(
  fixtureVersion: string,
  requiredVersion: string = ENGINE_CONTRACT_VERSION,
): ContractVersionCheck {
  if (fixtureVersion === requiredVersion) return { ok: true };
  return {
    ok: false,
    reason: `shared-fixture contract version ${fixtureVersion} != ENGINE_CONTRACT_VERSION ${requiredVersion}`,
  };
}

/** One app-facing management endpoint the TS layer depends on. */
export interface ContractEndpoint {
  /** Stable id used to key the transport driver in the loopback smoke. */
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /**
   * Path template with `:param` placeholders — the same shape the engine's
   * `docs/api/management/openapi.yaml` uses. The loopback smoke compiles these
   * to matchers, so a client whose request path drifts from the manifest fails.
   */
  path: string;
  /** Key into `CONTRACT_FIXTURES` for the representative response body. */
  fixture: string;
  /** Which app surface consumes it (kept for reviewers). */
  note: string;
}

/**
 * The management-API surface the app's TS layer depends on — the machine-checkable
 * half of the contract. Every entry is exercised end-to-end over the loopback
 * transport by `engineLoopbackSmoke.test.ts` (mock server built FROM this list),
 * so a client path/verb change without a manifest update fails the suite.
 *
 * Grouped by the 3-1b consolidated surface: `/api/entities/*`, `/api/messages/*`,
 * `/api/character-profiles/*`, `/api/providers`, `/api/module-configs/*`,
 * `/api/sync/client*`, `/api/sync/group/*` (7-2), `/api/stats/*`, `/api/backup/*`.
 */
export const REQUIRED_ENGINE_ENDPOINTS: ContractEndpoint[] = [
  // ── Entity reads ────────────────────────────────────────────────────────
  {
    id: 'entities.list',
    method: 'GET',
    path: '/api/entities',
    fixture: 'entitiesMap',
    note: 'entity list (map keyed by id)',
  },
  {
    id: 'entities.get',
    method: 'GET',
    path: '/api/entities/:id',
    fixture: 'entityConfig',
    note: 'entity config read',
  },
  {
    id: 'entities.chatList',
    method: 'GET',
    path: '/api/entities/:id/chat-list',
    fixture: 'chatListPage',
    note: 'chat list (interactions repo)',
  },
  {
    id: 'entities.messages',
    method: 'GET',
    path: '/api/entities/:id/conversations/:participantKey/messages',
    fixture: 'messagesPage',
    note: 'message window (participant key is a path segment)',
  },
  {
    id: 'entities.interactions',
    method: 'GET',
    path: '/api/entities/:id/interactions',
    fixture: 'interactionsPage',
    note: 'interactions by scope',
  },
  {
    id: 'entities.emojiActions',
    method: 'GET',
    path: '/api/entities/:id/emoji-actions',
    fixture: 'emojiActions',
    note: 'emoji action reads',
  },
  {
    id: 'entities.emotion',
    method: 'GET',
    path: '/api/entities/:id/emotion',
    fixture: 'emotion',
    note: 'emotion state read',
  },
  {
    id: 'entities.memories',
    method: 'GET',
    path: '/api/entities/:id/memories',
    fixture: 'memoriesPage',
    note: 'memory reads',
  },

  // ── Message writes ──────────────────────────────────────────────────────
  {
    id: 'messages.patch',
    method: 'PATCH',
    path: '/api/messages/:id',
    fixture: 'statusOk',
    note: 'message edit/pin/react',
  },
  {
    id: 'messages.delete',
    method: 'DELETE',
    path: '/api/messages/:id',
    fixture: 'statusOk',
    note: 'message soft-delete',
  },

  // ── Character profiles ──────────────────────────────────────────────────
  {
    id: 'characterProfiles.list',
    method: 'GET',
    path: '/api/character-profiles',
    fixture: 'characterProfiles',
    note: 'character profile list',
  },
  {
    id: 'characterProfiles.get',
    method: 'GET',
    path: '/api/character-profiles/:id',
    fixture: 'characterProfile',
    note: 'character profile read',
  },
  {
    id: 'characterProfiles.images',
    method: 'GET',
    path: '/api/character-profiles/:id/images',
    fixture: 'characterImages',
    note: 'character image metadata list',
  },
  {
    id: 'characterProfiles.favorite',
    method: 'PUT',
    path: '/api/character-profiles/:id/favorite',
    fixture: 'favoriteToggle',
    note: 'favorite bit toggle (3-1b)',
  },

  // ── Config reads/writes ─────────────────────────────────────────────────
  {
    id: 'moduleConfigs.list',
    method: 'GET',
    path: '/api/module-configs/:module',
    fixture: 'moduleConfigList',
    note: 'module config list (schema-driven forms)',
  },
  {
    id: 'providers.list',
    method: 'GET',
    path: '/api/providers',
    fixture: 'providerList',
    note: 'provider config list',
  },
  {
    id: 'providers.create',
    method: 'POST',
    path: '/api/providers',
    fixture: 'providerWrite',
    note: 'provider config create (3-4 follow-up)',
  },

  // ── Sync client runtime (3-5) ───────────────────────────────────────────
  {
    id: 'syncClient.status',
    method: 'GET',
    path: '/api/sync/client/status',
    fixture: 'syncClientStatus',
    note: 'desktop-sync client status',
  },

  // ── Sync-group key lifecycle (7-2, consumed by 7-3) ─────────────────────
  {
    id: 'syncGroup.keyStatus',
    method: 'GET',
    path: '/api/sync/group/key-status',
    fixture: 'syncGroupKeyStatus',
    note: 'sync-group key state (never key material)',
  },
  {
    id: 'syncGroup.init',
    method: 'POST',
    path: '/api/sync/group/init',
    fixture: 'syncGroupKeyStatus',
    note: 'mint the group key (create sync group)',
  },
  {
    id: 'syncGroup.import',
    method: 'POST',
    path: '/api/sync/group/import',
    fixture: 'syncGroupKeyStatus',
    note: 'install an escrowed group key (join)',
  },
  {
    id: 'syncGroup.rotate',
    method: 'POST',
    path: '/api/sync/group/rotate',
    fixture: 'syncGroupKeyStatus',
    note: 'rotate the group key (reset sync key)',
  },
  {
    id: 'syncGroup.rotationRequired',
    method: 'POST',
    path: '/api/sync/group/rotation-required',
    fixture: 'syncGroupKeyStatus',
    note: 'relay the portal rotation-required flag',
  },

  // ── Cross-entity stats (3-4 follow-up) ──────────────────────────────────
  {
    id: 'stats.characters',
    method: 'GET',
    path: '/api/stats/characters',
    fixture: 'characterStats',
    note: 'per-entity likes/chats',
  },

  // ── Backup & restore (2-6) ──────────────────────────────────────────────
  {
    id: 'backup.dataVersion',
    method: 'GET',
    path: '/api/backup/data-version',
    fixture: 'dataVersion',
    note: 'skip-if-unchanged marker',
  },
  {
    id: 'backup.targets',
    method: 'GET',
    path: '/api/backup/targets',
    fixture: 'backupTargets',
    note: 'selectable target types',
  },

  // ── Engine logs (plan 7-11) ─────────────────────────────────────────────
  // The Dev-Tools log surface, re-scoped to the loopback token (paths
  // unchanged). Read + verbosity control; the WS stream is exercised
  // separately by EngineLogStream's tests (it is not a REST manifest entry).
  {
    id: 'engineLogs.list',
    method: 'GET',
    path: '/api/development/logs',
    fixture: 'engineLogsPage',
    note: 'ring-buffer log query (filters + pagination)',
  },
  {
    id: 'engineLogs.count',
    method: 'GET',
    path: '/api/development/logs/count',
    fixture: 'engineLogCount',
    note: 'visible ring-buffer entry count',
  },
  {
    id: 'engineLogs.components',
    method: 'GET',
    path: '/api/development/logs/components',
    fixture: 'engineLogComponents',
    note: 'unique component names',
  },
  {
    id: 'engineLogs.entities',
    method: 'GET',
    path: '/api/development/logs/entities',
    fixture: 'engineLogEntities',
    note: 'unique entity ids',
  },
  {
    id: 'engineLogs.promptTypes',
    method: 'GET',
    path: '/api/development/logs/prompt-types',
    fixture: 'engineLogPromptTypes',
    note: 'unique prompt types',
  },
  {
    id: 'engineLogs.getLevels',
    method: 'GET',
    path: '/api/development/logs/level',
    fixture: 'engineLogLevels',
    note: 'runtime verbosity config read',
  },
  {
    id: 'engineLogs.setLevels',
    method: 'PUT',
    path: '/api/development/logs/level',
    fixture: 'engineLogLevelOk',
    note: 'runtime verbosity config write',
  },
];
