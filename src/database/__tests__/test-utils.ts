/**
 * Test Framework Types and Helpers
 */

import {clearDatabaseData} from '../connection';

/**
 * Result of a single test case
 */
export interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration?: number;
}

/**
 * Wrapper to run a test case and capture its result
 */
export async function runTest(
  name: string,
  testFn: () => Promise<void>
): Promise<TestResult> {
  const startTime = Date.now();
  try {
    await testFn();
    return {
      name,
      passed: true,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      name,
      passed: false,
      error: (error as Error).message || String(error),
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Wrapper to run a test case with automatic database cleanup
 */
export async function runTestWithCleanup(
  name: string,
  testFn: () => Promise<void>
): Promise<TestResult> {
  const result = await runTest(name, testFn);

  // Always cleanup after test, even if it failed
  try {
    await clearDatabaseData(true);
  } catch (error) {
    console.error(`[Test Cleanup] Failed to cleanup after "${name}":`, error);
  }

  return result;
}
