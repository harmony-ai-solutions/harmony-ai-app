#!/usr/bin/env node
/**
 * check-engine-contract.mjs — cross-repo engine-contract drift check (task 5-1).
 *
 * Compares the app's `ENGINE_CONTRACT_VERSION`
 * (`src/services/engine/engineContract.ts`) with the engine repo's
 * `docs/api/management/openapi.yaml` `info.version`. The engine repo is private,
 * so CI runs this only when the `HARMONY_LINK_REPO_PAT` secret is available (see
 * `.github/workflows/test.yml`, job `contract-drift`); locally, point it at a
 * checkout.
 *
 * Usage:
 *   node scripts/check-engine-contract.mjs                       # print the app version
 *   node scripts/check-engine-contract.mjs --engine-repo <path>  # drift check vs engine openapi
 *   node scripts/check-engine-contract.mjs --engine-fixtures <path>  # drift check vs the engine-side canonical fixtures
 *   node scripts/check-engine-contract.mjs --artifact-version 1.0.0  # artifact-pinning check
 *
 * Exit codes: 0 = ok / no comparison requested; 1 = drift or an older artifact.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function readAppContractVersion() {
  const src = readFileSync(join(repoRoot, 'src/services/engine/engineContract.ts'), 'utf8');
  const match = /export const ENGINE_CONTRACT_VERSION = '([^']+)'/.exec(src);
  if (!match) {
    throw new Error('could not find ENGINE_CONTRACT_VERSION in engineContract.ts');
  }
  return match[1];
}

function readEngineOpenApiVersion(engineRepo) {
  const yaml = readFileSync(join(engineRepo, 'docs/api/management/openapi.yaml'), 'utf8').replace(
    /\r\n/g,
    '\n',
  );
  // `info:` block's `version:` line (top-level info.version in the openapi).
  const infoBlock = /^info:\n((?:[ \t]+.*\n)*)/m.exec(yaml);
  if (!infoBlock) throw new Error('no `info:` block in openapi.yaml');
  const match = /^[ \t]+version:[ \t]*([^\s#]+)/m.exec(infoBlock[1]);
  if (!match) throw new Error('no `info.version` in openapi.yaml');
  return match[1];
}

// The endpoint ids the app declares in REQUIRED_ENGINE_ENDPOINTS.
function readAppEndpointIds() {
  const src = readFileSync(join(repoRoot, 'src/services/engine/engineContract.ts'), 'utf8');
  const ids = [...src.matchAll(/\bid:\s*'([^']+)'/g)].map((m) => m[1]);
  return ids;
}

// The fixture keys the app declares in CONTRACT_FIXTURES.
function readAppFixtureKeys() {
  const src = readFileSync(
    join(repoRoot, 'src/services/engine/__fixtures__/managementContract.fixtures.ts'),
    'utf8',
  );
  const start = src.indexOf('export const CONTRACT_FIXTURES');
  if (start < 0) throw new Error('no CONTRACT_FIXTURES export in managementContract.fixtures.ts');
  const block = src.slice(start);
  const end = block.indexOf('\n};');
  const body = end >= 0 ? block.slice(0, end) : block;
  return [...body.matchAll(/^\s{2}([A-Za-z0-9_]+):/gm)].map((m) => m[1]);
}

// Compare two string sets and return a human-readable diff summary (empty = equal).
function diffSets(label, got, want) {
  const a = [...got].sort();
  const b = [...want].sort();
  const missing = b.filter((x) => !a.includes(x));
  const extra = a.filter((x) => !b.includes(x));
  if (missing.length === 0 && extra.length === 0) return '';
  const parts = [];
  if (missing.length) parts.push(`missing ${label}: ${missing.join(', ')}`);
  if (extra.length) parts.push(`unexpected ${label}: ${extra.join(', ')}`);
  return parts.join('; ');
}

// Verify the app's endpoint manifest + fixture key set against the engine-side
// canonical fixtures file (the pinned path the CI job fetches).
function compareEngineFixtures(fixturesPath, appVersion) {
  const canonical = JSON.parse(readFileSync(fixturesPath, 'utf8'));
  let failed = false;

  if (canonical.contractVersion !== appVersion) {
    console.error(
      `✗ canonical fixtures contractVersion ${canonical.contractVersion} != app ENGINE_CONTRACT_VERSION ${appVersion}`,
    );
    failed = true;
  } else {
    console.log(`✓ canonical fixtures contractVersion matches ${appVersion}`);
  }

  const engineEndpointIds = (canonical.endpoints ?? []).map((e) => e.id);
  const endpointDiff = diffSets(
    'engine endpoint ids',
    engineEndpointIds,
    readAppEndpointIds(),
  );
  if (endpointDiff) {
    console.error(`✗ endpoint manifest drift: ${endpointDiff}`);
    failed = true;
  } else {
    console.log(`✓ endpoint manifest matches (${engineEndpointIds.length} endpoints)`);
  }

  const engineFixtureKeys = Object.keys(canonical.fixtures ?? {});
  const fixtureDiff = diffSets('engine fixture keys', engineFixtureKeys, readAppFixtureKeys());
  if (fixtureDiff) {
    console.error(`✗ shared-fixture key drift: ${fixtureDiff}`);
    failed = true;
  } else {
    console.log(`✓ shared-fixture keys match (${engineFixtureKeys.length} fixtures)`);
  }

  return failed;
}

function parseVersion(v) {
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(String(v).trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null;
}

const appVersion = readAppContractVersion();
const artifactVersion = arg('--artifact-version');
const engineRepo = arg('--engine-repo');
const engineFixtures = arg('--engine-fixtures');

console.log(`App engine-contract version: ${appVersion}`);

if (artifactVersion) {
  const artifact = parseVersion(artifactVersion);
  const required = parseVersion(appVersion);
  if (!artifact || !required) {
    console.error(`✗ unparseable version (artifact="${artifactVersion}" required="${appVersion}")`);
    process.exit(1);
  }
  for (let i = 0; i < 3; i += 1) {
    if (artifact[i] > required[i]) break;
    if (artifact[i] < required[i]) {
      console.error(`✗ engine artifact ${artifactVersion} < required ${appVersion}`);
      process.exit(1);
    }
  }
  console.log(`✓ engine artifact ${artifactVersion} satisfies >= ${appVersion}`);
} else if (engineRepo || engineFixtures) {
  let failed = false;
  if (engineRepo) {
    const engineVersion = readEngineOpenApiVersion(engineRepo);
    console.log(`Engine openapi version:       ${engineVersion}`);
    if (engineVersion !== appVersion) {
      console.error(
        `✗ contract drift: engine openapi ${engineVersion} != app ENGINE_CONTRACT_VERSION ${appVersion}`,
      );
      failed = true;
    } else {
      console.log('✓ engine-contract versions match');
    }
  }
  if (engineFixtures) {
    // The pinned-path fetch of the engine-side canonical shared wire fixtures.
    if (compareEngineFixtures(engineFixtures, appVersion)) failed = true;
  }
  if (failed) process.exit(1);
} else {
  console.log('(no --engine-repo/--engine-fixtures/--artifact-version given — nothing to compare)');
}
