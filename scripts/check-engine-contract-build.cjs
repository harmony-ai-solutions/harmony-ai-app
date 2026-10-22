#!/usr/bin/env node
/**
 * scripts/check-engine-contract-build.cjs
 *
 * BUILD-TIME engine management-contract gate (hard fail).
 *
 * WHY: the embedded Soulbits Engine only updates WITH the app, so a runtime
 * contract mismatch is not a user-remediable condition — it is a BUILD defect.
 * Instead of a runtime "engine update required" card, this script enforces the
 * invariant where it belongs: at build time.
 *
 * WHAT: the app's `ENGINE_CONTRACT_VERSION`
 * (`src/services/engine/engineContract.ts`) MUST equal the engine checkout's
 * `docs/api/management/openapi.yaml` `info.version`. It delegates the actual
 * comparison to `scripts/check-engine-contract.mjs` so the drift logic has a
 * single source of truth.
 *
 * ENGINE REPO RESOLUTION (first match wins) — same as build-engine-sidecar.cjs
 * so `npm run android` needs no extra configuration:
 *   1. --engine-repo=<path>
 *   2. $SOULBITS_ENGINE_REPO  /  $ENGINE_REPO
 *   3. sibling checkout `../harmony-link-private` (relative to this repo)
 *
 * WHEN THE ENGINE CHECKOUT IS ABSENT (app-only CI without the private engine,
 * e.g. no `HARMONY_LINK_REPO_PAT`) the check is SKIPPED with a warning —
 * mirroring the existing optional `contract-drift` CI job.
 *
 * EXIT CODE
 *   0  versions match, OR the engine checkout is absent (skip + warn)
 *   1  engine checkout present but the contract versions DRIFT (fails the build)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const APP_ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const quiet = argv.includes('--quiet');
const repoFlag = argv.find((a) => a.startsWith('--engine-repo='));
const repoOverride = repoFlag ? repoFlag.slice('--engine-repo='.length) : null;

function log(...args) {
  if (!quiet) console.log('[contract]', ...args);
}
function warn(...args) {
  console.warn('[contract]', ...args);
}

function resolveEngineRepo() {
  const candidates = [
    repoOverride,
    process.env.SOULBITS_ENGINE_REPO,
    process.env.ENGINE_REPO,
    path.resolve(APP_ROOT, '..', 'harmony-link-private'),
  ].filter(Boolean);

  for (const c of candidates) {
    const abs = path.resolve(c);
    if (
      fs.existsSync(path.join(abs, 'docs', 'api', 'management', 'openapi.yaml')) ||
      fs.existsSync(path.join(abs, 'go.mod'))
    ) {
      return abs;
    }
  }
  return null;
}

function main() {
  const engineRepo = resolveEngineRepo();
  if (!engineRepo) {
    warn(
      'engine checkout not found — skipping the build-time contract check. ' +
        'Set SOULBITS_ENGINE_REPO (or pass --engine-repo=<path>) to enforce it.',
    );
    return 0;
  }

  const openapi = path.join(engineRepo, 'docs', 'api', 'management', 'openapi.yaml');
  if (!fs.existsSync(openapi)) {
    warn(
      `engine checkout ${engineRepo} has no docs/api/management/openapi.yaml — skipping the contract check.`,
    );
    return 0;
  }

  const checker = path.join(APP_ROOT, 'scripts', 'check-engine-contract.mjs');
  log(`engine repo: ${engineRepo}`);
  // NOTE: check-engine-contract.mjs parses `--engine-repo <path>` as TWO args
  // (indexOf + next), not the `--engine-repo=<path>` form — pass them separately.
  const res = spawnSync(process.execPath, [checker, '--engine-repo', engineRepo], {
    stdio: 'inherit',
    cwd: APP_ROOT,
  });

  if (res.status !== 0) {
    console.error(
      '[contract] ✗ app ENGINE_CONTRACT_VERSION does not match the embedded engine — ' +
        'a mismatched embedded engine is a build defect. Bump both sides in the same ' +
        'change (app src/services/engine/engineContract.ts AND engine ' +
        'docs/api/management/openapi.yaml), or rebuild the engine checkout.',
    );
    return 1;
  }
  return 0;
}

process.exit(main());
