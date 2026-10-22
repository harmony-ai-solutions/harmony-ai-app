/**
 * engineVersionProbe — wires the LIVE engine-version probe into EngineService
 * (plan 7-10 §3).
 *
 * Kept in its own module because `EngineApiClient` imports `EngineService`
 * (`requireEngineConnection`); having `EngineService` import the client back
 * would create a load-time cycle. Instead EngineService exposes an injectable
 * probe and this module — imported once at app boot — installs the real one.
 * Unit tests import EngineService directly and never wire this, so no test
 * ever reaches the network.
 */

import { engineApiClient } from './EngineApiClient';
import { setEngineVersionProbe } from './EngineService';

let wired = false;

/** Install the live probe (idempotent). Call once during app boot. */
export function wireEngineVersionProbe(): void {
  if (wired) return;
  wired = true;
  setEngineVersionProbe(async () => (await engineApiClient.engineAppVersion()).appVersion);
}

/** Test-only: allow re-wiring. */
export function resetEngineVersionProbeWiringForTests(): void {
  wired = false;
}
