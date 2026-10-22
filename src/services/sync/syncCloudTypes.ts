/**
 * syncCloudTypes — the pairing-payload parser (plan 7-3; **parser v2** — plan 7-15).
 *
 * Two QR payloads reach the phone and both flow through this module:
 *
 *  1. **Cloud** (portal + `POST /api/sync/pairing/cloud`) — two shapes:
 *
 *     the pinned **legacy** shape:
 *
 *       { "relay_url": "wss://…/v1/sync/ws", "pairing_token": "…", "account_hint": "…" }
 *
 *     and the **cloud QR payload v3** the desktop mints (2026-10-22 incident
 *     fix — the pairing binding is a (user, dataset) invite, so the QR now
 *     names the dataset the phone joins):
 *
 *       { "v": 1, "kind": "soulbits-cloud", "relay_url": "wss://…/v1/sync/ws",
 *         "pairing_token": "…", "account_hint": "<full email>",
 *         "dataset_id": "<account user id uuid>" }
 *
 *     `dataset_id` is OPTIONAL in both shapes (older codes omit it and the
 *     phone falls back to whatever dataset the engine already holds).
 *
 *     `pairing_token` is a short-lived, single-use credential the engine presents
 *     on its first relay connect (7-1 consume). `account_hint` identifies the
 *     signed-in account the code was minted for; the app verifies it matches the
 *     current session before applying the code.
 *
 *  2. **LAN** (desktop engine, `POST /api/sync/pairing/lan`) — plan 7-15:
 *
 *       { "v": 1, "kind": "soulbits-lan", "ws": "192.168.1.10:28080",
 *         "wss"?: "…:28443", "mode": "secure | insecure-ssl | unencrypted",
 *         "fingerprint"?: "sha256:AB:…", "dataset_id": "…", "name": "Studio-PC",
 *         "secret": "…single-use, 5-min TTL…", "ttl": 300,
 *         "enrollment"?: { "relay_url": "wss://…", "grant": "…", "account_hint": "u***@…" } }
 *
 *     `wss` + `fingerprint` are omitted when the engine has no TLS endpoint;
 *     `enrollment` is present only when the desktop is signed in and a fresh
 *     single-use grant was minted alongside the secret.
 *
 * {@link parseSyncPairingPayloadV2} discriminates by `kind`; the legacy
 * {@link parseSyncPairingPayload} is retained (cloud-only) and delegates to v2 so
 * existing consumers/tests keep working unchanged.
 */

/** The decoded **cloud** pairing payload (QR or manual paste). */
export interface SyncPairingPayload {
  relay_url: string;
  pairing_token: string;
  account_hint: string;
  /**
   * The dataset (account user id) the pairing binding joins — present in the
   * desktop-minted cloud QR payload v3 (2026-10-22); optional in the legacy
   * portal shape. The phone carries it into the engine config PUT verbatim.
   */
  dataset_id?: string;
}

/** The delegated-enrollment block of a LAN payload (plan 7-15 E2). */
export interface LanEnrollment {
  /** The cloud sync-relay WS endpoint (`wss://…/v1/sync/ws`). */
  relay_url: string;
  /** A short-lived, single-use enrollment grant to exchange for a session. */
  grant: string;
  /** The desktop's MASKED signed-in account hint (e.g. `u***@example.com`). */
  account_hint: string;
}

/** The decoded **LAN** pairing payload (parser v2, plan 7-15). */
export interface LanSyncPairingPayload {
  /** Payload format version (currently `1`). */
  v: number;
  kind: 'soulbits-lan';
  /** Plaintext WS endpoint `host:port` (the pairing handshake + unencrypted mode). */
  ws: string;
  /** WSS endpoint `host:port`; omitted when the engine has no TLS endpoint. */
  wss?: string;
  /** Best available transport security (`secure` | `insecure-ssl` | `unencrypted`). */
  mode: string;
  /** The engine's WSS certificate fingerprint (`sha256:AB:…`) to pin; omitted with `wss`. */
  fingerprint?: string;
  dataset_id: string;
  /** The engine's device display name. */
  name: string;
  /** A single-use pairing secret (5-minute TTL) for auto-approval. */
  secret: string;
  /** The secret TTL in seconds (300). */
  ttl: number;
  /** Present only when the desktop is signed in. */
  enrollment?: LanEnrollment;
}

/** A parsed pairing code, discriminated by target transport. */
export type ParsedPairingPayload =
  | { kind: 'cloud'; payload: SyncPairingPayload }
  | { kind: 'lan'; payload: LanSyncPairingPayload };

/** Thrown when a scanned/pasted pairing code cannot be parsed or is incomplete. */
export class SyncPairingParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncPairingParseError';
  }
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** Decode the raw scanned/pasted string into a plain object (JSON or query-style). */
function coerceObject(text: string): Record<string, unknown> {
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
      throw new SyncPairingParseError('pairing code is not a JSON object');
    } catch (e) {
      if (e instanceof SyncPairingParseError) throw e;
      throw new SyncPairingParseError('pairing code is not valid JSON');
    }
  }
  if (text.includes('=')) {
    // Query-style fallback: relay_url=…&pairing_token=…&account_hint=…
    const query = text.startsWith('?') ? text.slice(1) : text;
    const obj: Record<string, unknown> = {};
    for (const pair of query.split('&')) {
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      const key = decodeURIComponent(pair.slice(0, eq));
      const value = decodeURIComponent(pair.slice(eq + 1));
      obj[key] = value;
    }
    return obj;
  }
  throw new SyncPairingParseError('unrecognized pairing code format');
}

function parseCloudPayload(obj: Record<string, unknown>): SyncPairingPayload {
  const relay_url = asString(obj.relay_url);
  const pairing_token = asString(obj.pairing_token);
  const account_hint = asString(obj.account_hint);

  if (!relay_url || !pairing_token) {
    throw new SyncPairingParseError('pairing code is missing relay_url or pairing_token');
  }

  const payload: SyncPairingPayload = { relay_url, pairing_token, account_hint };
  // Cloud QR payload v3 (2026-10-22): optional in both the v3 and legacy shapes.
  const dataset_id = asString(obj.dataset_id);
  if (dataset_id) payload.dataset_id = dataset_id;
  return payload;
}

/** Validate + project the optional `enrollment` block (tolerant: dropped if unusable). */
function parseLanEnrollment(raw: unknown): LanEnrollment | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const relay_url = asString(o.relay_url);
  const grant = asString(o.grant);
  if (!relay_url || !grant) return null;
  return { relay_url, grant, account_hint: asString(o.account_hint) };
}

function parseLanPayload(obj: Record<string, unknown>): LanSyncPairingPayload {
  const v = Number(obj.v);
  if (v !== 1) {
    throw new SyncPairingParseError(`unsupported LAN pairing payload version (v=${String(obj.v)})`);
  }

  const ws = asString(obj.ws);
  const mode = asString(obj.mode);
  const dataset_id = asString(obj.dataset_id);
  const name = asString(obj.name);
  const secret = asString(obj.secret);
  if (!ws || !mode || !dataset_id || !name || !secret) {
    throw new SyncPairingParseError('LAN pairing payload is missing required fields');
  }

  const ttlRaw = Number(obj.ttl);
  const payload: LanSyncPairingPayload = {
    v: 1,
    kind: 'soulbits-lan',
    ws,
    mode,
    dataset_id,
    name,
    secret,
    ttl: Number.isFinite(ttlRaw) ? ttlRaw : 0,
  };

  const wss = asString(obj.wss);
  if (wss) payload.wss = wss;
  const fingerprint = asString(obj.fingerprint);
  if (fingerprint) payload.fingerprint = fingerprint;
  const enrollment = parseLanEnrollment(obj.enrollment);
  if (enrollment) payload.enrollment = enrollment;

  return payload;
}

/**
 * Parse a pairing code into a discriminated {@link ParsedPairingPayload}
 * (cloud vs LAN) — **parser v2** (plan 7-15), extended for the **cloud QR
 * payload v3** (2026-10-22). Accepts the canonical JSON object as a string
 * (what the QR encodes) or a `key=value` query-style string for the cloud
 * fallback. Discrimination:
 *
 *   - `kind: "soulbits-lan"` → the LAN payload (unchanged, plan 7-15);
 *   - `kind: "soulbits-cloud"` (v=1) → the desktop-minted cloud QR v3 — only
 *     v1 exists, a future version is rejected loudly rather than mis-parsed;
 *   - no `kind` → the legacy cloud shape (both keep `dataset_id` optional).
 *
 * Throws {@link SyncPairingParseError} when a required field is missing or
 * the payload is unrecognized.
 */
export function parseSyncPairingPayloadV2(raw: string): ParsedPairingPayload {
  const text = (raw ?? '').trim();
  if (!text) {
    throw new SyncPairingParseError('empty pairing code');
  }

  const obj = coerceObject(text);

  const kind = asString(obj.kind);
  if (kind === 'soulbits-lan') {
    return { kind: 'lan', payload: parseLanPayload(obj) };
  }
  if (kind === 'soulbits-cloud') {
    const v = Number(obj.v);
    if (v !== 1) {
      throw new SyncPairingParseError(
        `unsupported cloud pairing payload version (v=${String(obj.v)})`,
      );
    }
    return { kind: 'cloud', payload: parseCloudPayload(obj) };
  }
  return { kind: 'cloud', payload: parseCloudPayload(obj) };
}

/**
 * Parse a **cloud** pairing code into {@link SyncPairingPayload} (the legacy
 * 7-3 entry point — kept for existing consumers). Delegates to
 * {@link parseSyncPairingPayloadV2} and rejects a LAN payload (which has its own,
 * separate flow), so the two payload families can never be silently conflated.
 */
export function parseSyncPairingPayload(raw: string): SyncPairingPayload {
  const route = parseSyncPairingPayloadV2(raw);
  if (route.kind !== 'cloud') {
    throw new SyncPairingParseError('this is a LAN pairing payload, not a cloud pairing code');
  }
  return route.payload;
}

/**
 * Whether a payload's `account_hint` matches the signed-in account. A blank hint
 * (some codes may omit it) is treated as "no constraint" so pairing still works;
 * a non-blank hint that differs is a hard mismatch (the code was minted for a
 * different account).
 */
export function accountHintMatches(hint: string, signedInIdentifiers: string[]): boolean {
  const wanted = asString(hint).toLowerCase();
  if (!wanted) return true;
  return signedInIdentifiers.some(id => asString(id).toLowerCase() === wanted);
}

/**
 * Whether a (possibly **masked**) account hint matches a signed-in account —
 * used by the LAN enrollment intake (plan 7-15), whose `account_hint` is masked
 * (`u***@example.com`) rather than the full email the cloud QR carries.
 *
 *  - blank hint → `true` (unconstrained);
 *  - no `*` → exact match ({@link accountHintMatches});
 *  - masked → conservative prefix+suffix match: an identifier matches only when
 *    it starts with the text before the first `*` AND ends with the text after
 *    the last `*` (case-insensitive). This can under-match (a genuine match is
 *    treated as "different"), which is the safe direction for a "shall I reuse
 *    this account?" prompt.
 */
export function maskedAccountHintMatches(hint: string, signedInIdentifiers: string[]): boolean {
  const wanted = asString(hint).toLowerCase();
  if (!wanted) return true;
  if (!wanted.includes('*')) {
    return accountHintMatches(wanted, signedInIdentifiers);
  }

  const prefix = wanted.slice(0, wanted.indexOf('*'));
  const suffix = wanted.slice(wanted.lastIndexOf('*') + 1);

  return signedInIdentifiers.some(rawId => {
    const id = asString(rawId).toLowerCase();
    if (!id) return false;
    if (id.length < prefix.length + suffix.length) return false;
    return id.startsWith(prefix) && id.endsWith(suffix);
  });
}
