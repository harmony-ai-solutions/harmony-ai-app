/**
 * RN-side adapter compatibility test runner.
 *
 * This module is a **stub** — it requires a booted React Native environment
 * (Android emulator or device) to actually run. The test executes the same
 * query corpus from queries.ts through the production ReactNativeDatabase
 * adapter and logs pass/fail results.
 *
 * TODO: Resurrect this once a booted RN environment is available for testing.
 * The Phase 1-2 deletion removed the original run-all-tests.ts framework;
 * this is a minimal replacement scoped specifically to adapter compatibility.
 *
 * @returns A promise that resolves when all compatibility tests complete.
 */
import {queryCases} from './queries';

/**
 * Run all adapter compatibility tests against the production
 * ReactNativeDatabase adapter. Requires a booted RN environment.
 *
 * Currently unimplemented — throws a descriptive error.
 */
export async function runRnSideCompatibilityTests(): Promise<void> {
  // Placeholder: iterate queryCases, run each through getDatabase(),
  // log results. The Node side (nodeSide.test.ts) covers correctness;
  // the RN side catches adapter-specific divergences in number binding,
  // BLOB representation, etc.
  throw new Error(
    'Not implemented — requires booted RN environment. ' +
      'Run nodeSide.test.ts in Jest for Node-side coverage. ' +
      `Query corpus has ${queryCases.length} cases.`,
  );
}
