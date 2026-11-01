/**
 * SyncClientConfigApply — the ONE place this app assembles a
 * `PUT /api/sync/client` body (2026-11 desktop-sync engine-log fixes).
 *
 * The engine treats EVERY PUT as a config change: `syncclient.Manager.Apply`
 * validates + persists the merged block and then STOPS and RECREATES the live
 * sync client. Three field incidents shaped the rules below:
 *
 *  1. NO no-op PUTs. A pull-to-refresh / auto re-assert re-sent the same config
 *     and restarted the client for nothing (session churn, and one restart
 *     raced the pre-ledger seed staging so a phone uploaded its seed twice).
 *     → A PUT happens only for a real DIFF against the live
 *       `GET /api/sync/client/status`, or — on an EXPLICIT user action only —
 *       to repair a client the engine reports as stuck `stopped`. A refresh
 *       pass never repairs; the engine owns its own reconnect/backoff.
 *  2. ONE valid PUT. The engine rejects an invalid MERGED config with HTTP 400
 *     (`syncclient.ValidateConfig`, mirrored here by
 *     {@link validateMergedClientConfig}). Two real ways the old form reached
 *     that: `enabled:true` over `transport:lan` with an empty `peer_address`,
 *     and a leftover malformed LAN address merged into an otherwise valid
 *     relay config. The intent is validated LOCALLY first, so a doomed request
 *     (and the 400 + authority-bridge fallout behind it) is never sent.
 *  3. NO authority-flavoured fields, EVER. This app runs the CLIENT role: the
 *     desktop holds the cognition authority and its lease. Anything that makes
 *     the engine claim or hand over authority (`role`, authority/bridge
 *     switches — and the `POST /api/sync/client/yield` handover) is stripped
 *     here. A client-role engine that starts an authority relay bridge tries
 *     to claim a lease that is not its to take (observed 2026-10-31 right after
 *     the 400s), so the app side must stay clean regardless of the engine's
 *     own guard.
 *
 * The wire contract is read-only mirrored from the engine repo
 * (`syncclient/manager.go` — `ConfigPatch`, `ValidateConfig`, `ConfigView`;
 * `management/routes_sync_client.go` — the 400 on an invalid merged config).
 */

import { engineApiClient } from '../engine/EngineApiClient';
import type {
  SyncClientConfigDto,
  SyncClientConfigPatchDto,
  SyncClientStatusDto,
  SyncClientTransport,
} from '../engine/EngineApiClient';
import { createLogger } from '../../utils/logger';

const log = createLogger('[SyncClientConfig]');

// ── The phone's writable intent ─────────────────────────────────────────
// Exactly the fields a client-role phone may set (the engine's `ConfigPatch`
// minus every authority/role concept, which does not exist on the wire anyway).
export interface SyncClientIntent {
  enabled?: boolean;
  transport?: SyncClientTransport;
  peer_address?: string;
  peer_wss_address?: string;
  security_mode?: string;
  relay_url?: string;
  /**
   * The account relay bearer. Normally written ONLY by the verified
   * verify-before-PUT recovery (`services/sync/relayAuthRecovery`); a pairing
   * flow may inject the freshly fetched PASETO alongside the pairing token.
   * Never part of a refresh reconcile.
   */
  relay_token?: string;
  peer_fingerprint?: string;
  device_id?: string;
  dataset_id?: string;
  device_name?: string;
  /** Mark the engine as a JOINING member (driven by SyncGroupOrchestrator). */
  group_join_pending?: boolean;
  /** TRANSIENT: applied in-memory for the next relay connect, never persisted. */
  pairing_token?: string;
  /** TRANSIENT: one-time LAN pairing secret, cleared by the engine once used. */
  lan_pairing_secret?: string;
}

// ── Client-role hygiene (rule 3) ────────────────────────────────────────
/**
 * Field names that would ask a CLIENT-role engine to take or hand over
 * authority. None of them exist in `syncclient.ConfigPatch`; the list is
 * defence in depth so a future/loose call site cannot slip one in, and so the
 * phone path is provably free of authority intent.
 */
export const CLIENT_ROLE_FORBIDDEN_FIELDS = [
  'role',
  'authority',
  'authority_role',
  'authority_bridge',
  'authority_lease',
  'claim_authority',
  'local_authoritative',
  'cognition_authority',
  'bridge',
  'lease',
  'leader',
] as const;

/** Fields that are write-only/transient: always sent, never diffed. */
const TRANSIENT_FIELDS = ['pairing_token', 'lan_pairing_secret'] as const;

/**
 * Connectivity fields a REFRESH pass may reconcile, per transport. Deliberately
 * EXCLUDED from a refresh: `device_name`, `device_id`, `dataset_id`,
 * `group_join_pending` and every transient secret. Those are either cosmetic,
 * defaulted by the app from device info (so they would always "differ" on a
 * fresh install) or write-only — none of them justifies restarting the client
 * from a pull-to-refresh.
 */
const REFRESH_FIELDS_RELAY = ['enabled', 'transport', 'relay_url'] as const;
const REFRESH_FIELDS_LAN = [
  'enabled',
  'transport',
  'peer_address',
  'peer_wss_address',
  'security_mode',
] as const;

// ── Contract mirror (rule 2) ────────────────────────────────────────────
export type ClientConfigProblemCode =
  | 'invalid_transport'
  | 'invalid_security_mode'
  | 'peer_address_required'
  | 'relay_url_required'
  | 'invalid_host_port'
  | 'invalid_relay_url'
  | 'invalid_fingerprint';

export interface ClientConfigProblem {
  code: ClientConfigProblemCode;
  /** The engine's offending field (`relay_url`, `peer_address`, …). */
  field: string;
  /** The engine's own wording, for logs — never shown raw to the user. */
  message: string;
}

/** Mirrors `syncclient.ParseTransport`: empty defaults to `lan`. */
function normalizeTransport(raw: unknown): SyncClientTransport | null {
  const value = String(raw ?? '').trim().toLowerCase();
  if (value === '' || value === 'lan') return 'lan';
  if (value === 'relay') return 'relay';
  return null;
}

/** Mirrors `syncclient.ParseSecurityMode`: empty defaults to `unencrypted`. */
function isKnownSecurityMode(raw: unknown): boolean {
  const value = String(raw ?? '').trim().toLowerCase();
  return value === '' || value === 'secure' || value === 'insecure-ssl' || value === 'unencrypted';
}

/** Mirrors `validateHostPort` (host:port, numeric port in [1,65535]). */
function hostPortProblem(field: string, raw: string): string | null {
  const addr = raw.trim();
  const match = /^\[([^\]]+)\]:(\d{1,5})$/.exec(addr) ?? /^([^:]+):(\d{1,5})$/.exec(addr);
  if (!match) return `${field} must be host:port`;
  if (!match[1].trim()) return `${field} host is empty`;
  const port = Number(match[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return `${field} port must be in [1,65535]`;
  }
  return null;
}

/** Mirrors `validateRelayURL` (ws(s):// URL, or a bare host:port). */
function relayUrlProblem(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (!value.includes('://')) return hostPortProblem('relay_url', value);
  if (!value.startsWith('ws://') && !value.startsWith('wss://')) {
    return `relay_url must be a ws:// or wss:// URL (got "${value}")`;
  }
  return null;
}

/** Mirrors `pairing.NormalizeFingerprint` (canonical `sha256:AB:CD:…`). */
function fingerprintProblem(raw: string): string | null {
  let value = raw.trim();
  if (value.slice(0, 7).toLowerCase() === 'sha256:') value = value.slice(7);
  value = value.replace(/[: -]/g, '').toUpperCase();
  if (value.length !== 64) return `peer_fingerprint must be 64 hex digits (got ${value.length})`;
  if (!/^[0-9A-F]{64}$/.test(value)) return 'peer_fingerprint is not hex';
  return null;
}

/**
 * Validate the config the engine will ACTUALLY hold after the merge — the
 * engine validates the merged block, not the patch, so a stale field left
 * behind by a previous transport can fail an otherwise valid patch.
 */
export function validateMergedClientConfig(
  merged: Partial<SyncClientConfigDto> & SyncClientIntent,
): ClientConfigProblem | null {
  const transport = normalizeTransport(merged.transport);
  if (!transport) {
    return {
      code: 'invalid_transport',
      field: 'transport',
      message: 'syncclient: unknown transport (want lan | relay)',
    };
  }
  if (!isKnownSecurityMode(merged.security_mode)) {
    return {
      code: 'invalid_security_mode',
      field: 'security_mode',
      message: 'syncclient: unknown security mode (want secure | insecure-ssl | unencrypted)',
    };
  }
  const peerAddress = String(merged.peer_address ?? '');
  if (peerAddress.trim()) {
    const problem = hostPortProblem('peer_address', peerAddress);
    if (problem) return { code: 'invalid_host_port', field: 'peer_address', message: problem };
  }
  const peerWssAddress = String(merged.peer_wss_address ?? '');
  if (peerWssAddress.trim()) {
    const problem = hostPortProblem('peer_wss_address', peerWssAddress);
    if (problem) return { code: 'invalid_host_port', field: 'peer_wss_address', message: problem };
  }
  const relayUrl = String(merged.relay_url ?? '');
  if (relayUrl.trim()) {
    const problem = relayUrlProblem(relayUrl);
    if (problem) return { code: 'invalid_relay_url', field: 'relay_url', message: problem };
  }
  const fingerprint = String(merged.peer_fingerprint ?? '');
  if (fingerprint.trim()) {
    const problem = fingerprintProblem(fingerprint);
    if (problem) return { code: 'invalid_fingerprint', field: 'peer_fingerprint', message: problem };
  }
  if (merged.enabled) {
    if (transport === 'relay' && !relayUrl.trim()) {
      return {
        code: 'relay_url_required',
        field: 'relay_url',
        message: 'syncclient: relay_url is required when transport is relay',
      };
    }
    if (transport === 'lan' && !peerAddress.trim()) {
      return {
        code: 'peer_address_required',
        field: 'peer_address',
        message: 'syncclient: peer_address is required when enabled',
      };
    }
  }
  return null;
}

// ── Diffing (rule 1) ────────────────────────────────────────────────────
function isTransient(key: string): boolean {
  return (TRANSIENT_FIELDS as readonly string[]).includes(key);
}

/** The intent's own fields, transient secrets excluded (they never diff). */
function providedFields(intent: SyncClientIntent): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(intent)) {
    if (value === undefined || isTransient(key)) continue;
    out[key] = value;
  }
  return out;
}

function transientFields(intent: SyncClientIntent): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of TRANSIENT_FIELDS) {
    const value = (intent as Record<string, unknown>)[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function refreshFieldsFor(transport: SyncClientTransport): readonly string[] {
  return transport === 'relay' ? REFRESH_FIELDS_RELAY : REFRESH_FIELDS_LAN;
}

/**
 * True when the engine says the role is ENABLED but nothing live is running and
 * it has not reported why — the one state an explicit "Save & Connect" may
 * repair by re-asserting the persisted config. `awaiting_group_key` is a
 * truthful waiting state, not a stuck client.
 */
export function needsSyncClientRepair(status: SyncClientStatusDto): boolean {
  return (
    status.config?.enabled === true &&
    String(status.state) === 'stopped' &&
    (status.last_error ?? null) === null &&
    status.awaiting_group_key !== true
  );
}

/**
 * Drop any authority-flavoured key before it can reach the engine (rule 3).
 * Exported so the guard itself is testable.
 */
export function sanitizeClientPatch(
  patch: Record<string, unknown>,
): SyncClientConfigPatchDto {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if ((CLIENT_ROLE_FORBIDDEN_FIELDS as readonly string[]).includes(key)) {
      // Loud on purpose: no call site should ever ask a client-role engine to
      // take or hand over authority. The field is dropped, never sent.
      log.warn(`dropped authority-flavoured field "${key}" from a client-role patch`);
      continue;
    }
    out[key] = value;
  }
  return out as SyncClientConfigPatchDto;
}

// ── The one entry point ─────────────────────────────────────────────────
export type SyncClientApplyMode = 'apply' | 'refresh';

export interface SyncClientApplyDeps {
  getStatus?: () => Promise<SyncClientStatusDto>;
  update?: (patch: SyncClientConfigPatchDto) => Promise<SyncClientStatusDto>;
}

export type SyncClientApplyResult =
  | { action: 'unchanged'; status: SyncClientStatusDto }
  | { action: 'applied'; status: SyncClientStatusDto; patch: SyncClientConfigPatchDto; repair: boolean }
  | { action: 'invalid'; status: SyncClientStatusDto; problem: ClientConfigProblem }
  | { action: 'unavailable'; error: string }
  | { action: 'failed'; patch: SyncClientConfigPatchDto; error: string };

export interface SyncClientApplyOptions {
  /**
   * `apply`   — an explicit user action (toggle on/off, Save & Connect,
   *             pairing): diff everything the intent names, and re-assert the
   *             config once if the engine is stuck `stopped`.
   * `refresh` — a pull-to-refresh / focus poll: GET first, PUT only when the
   *             selected transport's CONNECTIVITY fields genuinely differ.
   *             Never repairs, never sends cosmetic fields.
   */
  mode?: SyncClientApplyMode;
  deps?: SyncClientApplyDeps;
}

/**
 * Read the live status, diff the intent against it, and PUT **only** when
 * something would actually change. One PUT at most, and never a payload the
 * engine's validation would reject.
 */
export async function applySyncClientConfig(
  intent: SyncClientIntent,
  options: SyncClientApplyOptions = {},
): Promise<SyncClientApplyResult> {
  const getStatus = options.deps?.getStatus ?? (() => engineApiClient.getSyncClientStatus());
  const update =
    options.deps?.update ?? ((patch: SyncClientConfigPatchDto) => engineApiClient.updateSyncClientConfig(patch));
  const mode: SyncClientApplyMode = options.mode ?? 'apply';

  let status: SyncClientStatusDto;
  try {
    status = await getStatus();
  } catch (e: any) {
    const error = e?.message ?? String(e);
    log.warn('status read failed:', error);
    return { action: 'unavailable', error };
  }

  const active = status.config;
  const provided = providedFields(intent);
  const merged = { ...active, ...provided } as Partial<SyncClientConfigDto> & SyncClientIntent;

  // Rule 2: validate what the ENGINE will hold, before anything is sent.
  const problem = validateMergedClientConfig(merged);
  if (problem) {
    log.warn(`config intent rejected locally (${problem.code}): ${problem.message}`);
    return { action: 'invalid', status, problem };
  }

  const transport = normalizeTransport(merged.transport) ?? 'lan';
  const allowed = mode === 'refresh' ? refreshFieldsFor(transport) : null;

  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(provided)) {
    if (allowed && !allowed.includes(key)) continue;
    if ((active as unknown as Record<string, unknown>)[key] !== value) patch[key] = value;
  }
  // Transient secrets (pairing token / LAN secret) always ride the next PUT —
  // they are in-memory handshakes, not persisted state to diff against.
  Object.assign(patch, transientFields(intent));

  let repair = false;
  if (Object.keys(patch).length === 0) {
    // Rule 1: nothing changed → NO PUT. A refresh NEVER repairs (the engine
    // owns reconnect/backoff; a PUT here is exactly the restart churn).
    if (mode === 'refresh' || merged.enabled === false || !needsSyncClientRepair(status)) {
      log.debug('no config diff — no PUT (the live client is left untouched)');
      return { action: 'unchanged', status };
    }
    repair = true;
    for (const key of refreshFieldsFor(transport)) {
      (patch as Record<string, unknown>)[key] = (merged as Record<string, unknown>)[key];
    }
  }

  const body = sanitizeClientPatch(patch);
  if (Object.keys(body).length === 0) {
    return { action: 'unchanged', status };
  }

  try {
    const next = await update(body);
    log.info(
      `${repair ? 'repaired' : 'applied'} sync-client config (${Object.keys(body).join(', ')})`,
    );
    return { action: 'applied', status: next, patch: body, repair };
  } catch (e: any) {
    const error = e?.message ?? String(e);
    log.error('sync-client config update failed:', error);
    return { action: 'failed', patch: body, error };
  }
}

/** Convenience wrapper for the refresh path (mode fixed to `refresh`). */
export function reconcileSyncClientConfig(
  intent: SyncClientIntent,
  deps?: SyncClientApplyDeps,
): Promise<SyncClientApplyResult> {
  return applySyncClientConfig(intent, { mode: 'refresh', deps });
}
