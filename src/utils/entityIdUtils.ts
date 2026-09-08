/**
 * Entity ID derivation — the D2 id schema (app-side mirror of the engine's
 * `DeriveEntityID`, 2-1; pinned by the 6-1 §1 vectors).
 *
 * ```
 * id        := base "-" timestamp
 * base      := slug(displayName)
 * timestamp := YYYYMMDDHHMMSS in UTC (second precision)
 * ```
 *
 * Slug rule (operational spec = the 6-1 §1 vector table, which all seven
 * vectors pin): characters inside the VALID ID CHARSET `[A-Za-z0-9._-]` pass
 * through verbatim; every run of characters OUTSIDE it (spaces, punctuation
 * not in the charset, non-ASCII) collapses to a single "-"; leading/trailing
 * non-alphanumerics are trimmed; the base is capped at 48 chars; an empty
 * result falls back to "entity".
 *
 * NOTE: the prose in D2/2-1 ("every run of chars outside [A-Za-z0-9] →
 * single '-'") conflicts with the `a.b_c-d` vector, which pins `.` `_` `-`
 * as passthrough ("valid charset passthrough"). The vector table is the
 * binding spec — recorded as a resolved contradiction in the 2-2
 * implementation notes.
 *
 * The timestamp is ALWAYS formatted in UTC regardless of the local clock
 * (`getUTC*` getters) — a local-time-injected Date yields the same id as the
 * same UTC instant.
 */

const VALID_BASE_CHARSET = /[^A-Za-z0-9._-]+/g;
const EDGE_NON_ALNUM = /^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g;
const BASE_CAP = 48;
const EMPTY_BASE = 'entity';

/**
 * Slug a display name into the base component of a derived entity id.
 *
 *   slugifyEntityName("Isabella")     → "Isabella"
 *   slugifyEntityName("Isabella 2")   → "Isabella-2"
 *   slugifyEntityName("  Max  2 ")    → "Max-2"
 *   slugifyEntityName("«Zoë»!!")      → "Zo"
 *   slugifyEntityName("--__--")       → "entity"
 *   slugifyEntityName(60 × "A")       → "A" × 48
 *   slugifyEntityName("a.b_c-d")      → "a.b_c-d"
 */
export function slugifyEntityName(name: string): string {
  // Valid-charset chars pass through; every other run collapses to "-".
  const collapsed = name.replace(VALID_BASE_CHARSET, '-');
  // Trim leading/trailing non-alphanumerics (incl. collapsed separators).
  const trimmed = collapsed.replace(EDGE_NON_ALNUM, '');
  const capped = trimmed.slice(0, BASE_CAP);
  return capped === '' ? EMPTY_BASE : capped;
}

/** Format a Date as `YYYYMMDDHHMMSS` in UTC (second precision). */
export function formatUtcTimestamp(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    String(date.getUTCFullYear()) +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds())
  );
}

/**
 * Derive an entity id from a display name — the D2 schema, pure and
 * deterministic. `date` defaults to `new Date()` and is injectable for tests.
 *
 *   deriveEntityId("Isabella", 2026-09-05T12:35:14Z) → "Isabella-20260905123514"
 *   deriveEntityId("Isabella 2", …)                 → "Isabella-2-20260905123514"
 *   deriveEntityId("user", …)                       → "user-20260905123514"
 *     (derivation itself never rejects; reserved-name rejection lives in the
 *      mint seam — D33)
 */
export function deriveEntityId(name: string, date: Date = new Date()): string {
  const base = slugifyEntityName(name);
  return `${base}-${formatUtcTimestamp(date)}`;
}