/**
 * semver — a tiny, dependency-free semver parser + comparator (plan 7-10 §3/§4).
 *
 * The engine advertises its version as `v0.3.0-dev` (`constants.AppVersion`);
 * release manifests advertise `v0.3.2`; the app's own version comes from
 * `DeviceInfo.getVersion()` (`1.4.0` / `1.0-dev`). All three need the SAME
 * normalization + precedence rules so "is this newer?" answers agree:
 *
 *   - a leading `v`/`V` is stripped ({@link normalizeVersion});
 *   - `MAJOR.MINOR` and `MAJOR.MINOR.PATCH` both parse (missing patch = 0) —
 *     mirrors {@link parseContractVersion} in `engineContract.ts`;
 *   - **prerelease** precedence follows semver §11: `0.3.0-dev` < `0.3.0`.
 *
 * No network, no RN: pure and total, so it runs in the fast `unit` jest project.
 */

/** A parsed version. `prerelease` is the dotted identifiers after `-` ([] when absent). */
export interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  /** Dotted prerelease identifiers, e.g. `dev` → `['dev']`, `rc.1` → `['rc', '1']`. */
  prerelease: string[];
  /** The original (un-normalized) input, for diagnostics. */
  raw: string;
}

/** Strip surrounding whitespace and a leading `v`/`V`. */
export function normalizeVersion(version: string): string {
  return String(version ?? '').trim().replace(/^v/i, '');
}

/**
 * Parse `[v]MAJOR.MINOR[.PATCH][-prerelease][+build]`; returns null when the
 * string is not a version. Build metadata (`+...`) is accepted and ignored.
 */
export function parseSemver(version: string): ParsedSemver | null {
  const v = normalizeVersion(version);
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(v);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3] ?? 0),
    prerelease: match[4] ? match[4].split('.') : [],
    raw: version,
  };
}

/**
 * semver precedence: returns `-1` (a < b), `0` (equal) or `1` (a > b), or `null`
 * when either input is unparseable.
 */
export function compareSemver(a: string, b: string): number | null {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return null;

  for (const key of ['major', 'minor', 'patch'] as const) {
    if (pa[key] !== pb[key]) return pa[key] < pb[key] ? -1 : 1;
  }

  // Numeric core equal → prerelease decides (semver §11.3/§11.4):
  //   a version WITH a prerelease has LOWER precedence than the release.
  if (pa.prerelease.length === 0 && pb.prerelease.length === 0) return 0;
  if (pa.prerelease.length === 0) return 1;
  if (pb.prerelease.length === 0) return -1;

  const len = Math.max(pa.prerelease.length, pb.prerelease.length);
  for (let i = 0; i < len; i += 1) {
    const x = pa.prerelease[i];
    const y = pb.prerelease[i];
    if (x === undefined) return -1; // fewer fields → lower precedence
    if (y === undefined) return 1;
    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);
    if (xNumeric && yNumeric) {
      const nx = Number(x);
      const ny = Number(y);
      if (nx !== ny) return nx < ny ? -1 : 1;
    } else if (xNumeric) {
      return -1; // numeric identifiers always sort below alphanumeric
    } else if (yNumeric) {
      return 1;
    } else if (x !== y) {
      return x < y ? -1 : 1; // ASCII lexical
    }
  }
  return 0;
}

/**
 * True when `a` is STRICTLY newer than `b`. False when equal OR when either
 * version is unparseable (callers treat an unknown version as "don't nag").
 */
export function isNewerVersion(a: string, b: string): boolean {
  return compareSemver(a, b) === 1;
}
