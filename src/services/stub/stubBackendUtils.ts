/**
 * stubBackendUtils — shared latency + deterministic transient-failure helpers
 * for the in-memory stub backends (marketplace / wallet / social).
 *
 * Design decisions:
 *   - `simulateLatency()` gives every stub operation a realistic ~300 ms
 *     round-trip (with ±100 ms jitter) so the UI behaves like it does against
 *     a network backend. Tests `jest.mock` this module to make latency
 *     instant and to drive `simulateTransientFailure` deterministically.
 *   - `simulateTransientFailure()` is SEEDED: the roll is derived from the
 *     caller-provided key via a stable string hash, so the same operation
 *     key always fails the same way. That makes honest-error paths (delist /
 *     publish) reproducible in tests without flakiness, while still allowing
 *     a real failure rate in production builds (stubs ship in ALL builds per
 *     O5 — errors must surface as errors, never fake success).
 */

/** Nominal artificial latency for one stub backend operation (ms). */
export const DEFAULT_LATENCY_MS = 300;
/** Uniform jitter applied on top of the nominal latency (ms, ±). */
export const LATENCY_JITTER_MS = 100;

/**
 * Sleep for ~`baseMs` (± jitter). Resolves `void` — stub operations await
 * this before touching their in-memory store to mimic a network round-trip.
 */
export async function simulateLatency(
  baseMs: number = DEFAULT_LATENCY_MS,
): Promise<void> {
  const jitter = (Math.random() * 2 - 1) * LATENCY_JITTER_MS;
  const delay = Math.max(0, Math.round(baseMs + jitter));
  await new Promise<void>(resolve => setTimeout(resolve, delay));
}

/** FNV-1a 32-bit string hash — stable across runs and platforms. */
function hashString(input: string): number {
  let hash = 0x811c9dc5; // FNV-1a offset basis
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Deterministic transient-failure roll for a stub backend operation.
 *
 * Returns `true` when the seeded roll for `key` falls below `failRate`, i.e.
 * the operation "fails" (the caller then throws an honest error instead of
 * fabricating success). The same `key` + `failRate` always yields the same
 * result — tests use a fixed key/rate or `jest.mock` this module to force
 * failures deterministically.
 *
 * @param key      Stable operation key (e.g. `delist:${listingId}`).
 * @param failRate Probability of failure in [0, 1].
 */
export function simulateTransientFailure(key: string, failRate: number): boolean {
  if (failRate <= 0) return false;
  if (failRate >= 1) return true;
  const roll = hashString(key) / 0xffffffff;
  return roll < failRate;
}