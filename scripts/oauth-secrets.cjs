#!/usr/bin/env node
/**
 * scripts/oauth-secrets.cjs
 *
 * Environment-aware GCP OAuth client secret loader.
 *
 * Reads the Google OAuth client secret JSON for a given environment
 * (`dev` | `prod`) and derives the build-time configuration consumed by
 * react-native-config (iOS + Metro) and the Android Gradle productFlavors.
 *
 * WHY:
 *   - The `client_secret_*.json` files downloaded from Google Cloud Console
 *     are NEVER committed (see .gitignore `client_secret_*.json`).
 *   - Different environments use different OAuth client IDs, so the Web /
 *     OAuth Client ID injected at build time must match the active flavour.
 *   - Previously GOOGLE_WEB_CLIENT_ID was hardcoded in tracked files
 *     (.env, android/gradle.properties). This loader removes that need.
 *
 * OUTPUT (all gitignored — see .gitignore):
 *   - .env                                  → derived root env (iOS + Metro)
 *   - android/gradle-secrets.<env>.properties → Android flavor values
 *
 * USAGE:
 *   node scripts/oauth-secrets.cjs dev                 # load dev secrets
 *   node scripts/oauth-secrets.cjs prod                # load prod secrets
 *   node scripts/oauth-secrets.cjs dev --file=/abs/path/client_secret_x.json
 *   node scripts/oauth-secrets.cjs dev --print         # print resolved client_id only
 *   node scripts/oauth-secrets.cjs dev --if-missing-ok # exit 0 + warn when absent
 *
 * SEARCH ORDER (first match wins):
 *   1. --file=<path>
 *   2. secrets/<env>/client_secret_*.json
 *   3. secrets/client_secret_*.json
 *   4. repo root client_secret_*.json
 *   For `dev`, if exactly one candidate exists anywhere, it is used.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ENVS = ['dev', 'prod'];

// ── CLI parsing ─────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const env = args.find((a) => ENVS.includes(a)) || 'dev';
const fileFlag = args.find((a) => a.startsWith('--file='));
const explicitFile = fileFlag ? fileFlag.slice('--file='.length) : null;
const printOnly = args.includes('--print');
const ifMissingOk = args.includes('--if-missing-ok');
const quiet = args.includes('--quiet');

function log(msg) {
  if (!quiet) console.log(msg);
}

function warn(msg) {
  if (!quiet) console.warn(`⚠️  ${msg}`);
}

// ── Helpers ─────────────────────────────────────────────────────────────
function findCandidateFiles() {
  const candidates = [];
  const dirs = [
    path.join(ROOT, 'secrets', env),
    path.join(ROOT, 'secrets'),
    ROOT,
  ];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const entries = fs
      .readdirSync(dir)
      .filter(
        (f) =>
          f.startsWith('client_secret_') &&
          f.endsWith('.json') &&
          f !== '.gitignore',
      )
      .map((f) => path.join(dir, f));
    candidates.push(...entries);
  }
  return [...new Set(candidates)];
}

function readClientId(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(`Unable to read ${file}: ${err.message}`);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${file} is not valid JSON: ${err.message}`);
  }

  // Google Cloud Console downloads come in a few shapes:
  //   {"web": {"client_id": ..., "client_secret": ...}}        → Web app (type 3)
  //   {"installed": {"client_id": ..., "client_secret": ...}} → Desktop/installed app
  //   {"android": {"client_id": ...}} / {"ios": {"client_id": ...}} → native app
  const section =
    data && (data.web || data.installed || data.android || data.ios);
  const clientId = section && section.client_id;
  const projectId = (data && data.project_id) || section?.project_id || '';
  const clientType = data && data.web ? 'web'
    : data && data.installed ? 'installed'
    : data && data.android ? 'android'
    : data && data.ios ? 'ios' : 'unknown';

  if (!clientId || typeof clientId !== 'string') {
    throw new Error(
      `${file} does not contain a recognizable client_id. Expected a ` +
        'Google Cloud OAuth client JSON (web | installed | android | ios).',
    );
  }

  return { clientId, projectId, clientType, data };
}

// ── Resolve the WEB client ID for a given environment ─────────────────
//
// GOOGLE_WEB_CLIENT_ID is passed to GoogleSignin.configure({ webClientId })
// on iOS for offline access (serverAuthCode → backend refresh token) and is
// the Web/OAuth client ID the SDK needs to mint an idToken.
//
// CRITICAL: An `installed` (Desktop) OAuth client's client_id CANNOT be used
// here — passing it makes the SDK return idToken=null after the user picks
// an email. The authoritative per-environment Web/OAuth client ID is the
// CLIENT_ID in the environment's iOS GoogleService-Info plist (that is the
// value the app already ships and whose reversed ID is registered as the
// CFBundleURLScheme). If the secret JSON has a `web` section, its client_id
// wins (it IS the Web client); otherwise we fall back to the plist value.
function resolveWebClientId(env, clientType, clientId, data) {
  if (clientType === 'web') return clientId;

  // Native/installed secret → read CLIENT_ID from the env's iOS plist.
  const plistPath =
    env === 'dev'
      ? path.join(ROOT, 'ios/HarmonyAIChat/GoogleService-Info-Dev.plist')
      : path.join(ROOT, 'ios/HarmonyAIChat/GoogleService-Info.plist');

  if (fs.existsSync(plistPath)) {
    const plist = fs.readFileSync(plistPath, 'utf8');
    const m = plist.match(/<key>CLIENT_ID<\/key>\s*<string>([^<]+)<\/string>/);
    if (m && m[1]) {
      warn(
        `Secret file is a "${clientType}" OAuth client — its client_id ` +
          'cannot be used as GOOGLE_WEB_CLIENT_ID (mobile SDK returns ' +
          'idToken=null). Using the Web/OAuth client ID from ' +
          `${path.relative(ROOT, plistPath)} instead.`,
      );
      return m[1];
    }
  }

  throw new Error(
    `Cannot resolve a Web/OAuth client ID for environment "${env}". ` +
      'Place a `web`-section client_secret JSON here, or ensure the iOS ' +
      'GoogleService-Info plist contains CLIENT_ID.',
  );
}

function readExistingEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return {};
  const out = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)$/);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].trim();
  }
  return out;
}

// ── Resolve the secret file ─────────────────────────────────────────────
function resolveSecretFile() {
  if (explicitFile) {
    const abs = path.isAbsolute(explicitFile)
      ? explicitFile
      : path.resolve(ROOT, explicitFile);
    if (!fs.existsSync(abs)) {
      throw new Error(`--file not found: ${abs}`);
    }
    return abs;
  }

  const candidates = findCandidateFiles();
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  // Multiple candidates: pick the best match for the env.
  // A file living under secrets/<env>/ wins. Otherwise fall back to the
  // first one and warn (all envs share the same GCP project here).
  const envScoped = candidates.find((c) =>
    c.includes(path.join('secrets', env)),
  );
  const chosen = envScoped || candidates[0];
  if (!envScoped) {
    warn(
      `Multiple client_secret_*.json files found; using ${path.basename(chosen)} ` +
        '(place one under secrets/<env>/ to disambiguate).',
    );
  }
  return chosen;
}

// ── Main ────────────────────────────────────────────────────────────────
function main() {
  let file;
  try {
    file = resolveSecretFile();
  } catch (err) {
    if (ifMissingOk) {
      warn(err.message);
      process.exit(0);
    }
    console.error(`✖ ${err.message}`);
    process.exit(1);
  }

  if (!file) {
    const msg =
      `No client_secret_*.json found for environment "${env}".\n` +
      `  Download the OAuth client JSON from Google Cloud Console and save it as:\n` +
      `    secrets/${env}/client_secret_<client-id>.apps.googleusercontent.com.json\n` +
      `  (or anywhere matching client_secret_*.json — see .gitignore).\n` +
      `  Then re-run: npm run oauth:${env}`;
    if (ifMissingOk) {
      warn(msg);
      process.exit(0);
    }
    console.error(`✖ ${msg}`);
    process.exit(1);
  }

  let clientId;
  let projectId;
  let clientType;
  let secretData;
  try {
    ({ clientId, projectId, clientType, data: secretData } = readClientId(file));
  } catch (err) {
    if (ifMissingOk) {
      warn(err.message);
      process.exit(0);
    }
    console.error(`✖ ${err.message}`);
    process.exit(1);
  }

  // Resolve the Web/OAuth client ID (never the raw installed/desktop one).
  try {
    clientId = resolveWebClientId(env, clientType, clientId, secretData);
  } catch (err) {
    if (ifMissingOk) {
      warn(err.message);
      process.exit(0);
    }
    console.error(`✖ ${err.message}`);
    process.exit(1);
  }

  if (!clientId.endsWith('.apps.googleusercontent.com')) {
    warn(
      `client_id "${clientId}" does not look like a Google OAuth client ID ` +
        '(expected *.apps.googleusercontent.com).',
    );
  }

  if (printOnly) {
    process.stdout.write(`${clientId}\n`);
    return;
  }

  const isBeta = env === 'dev';
  const existing = readExistingEnv();
  const appleServicesId = existing.APPLE_SERVICES_ID || '';

  // ── 1. Derived root .env (iOS + Metro via react-native-config) ──────
  const envLines = [
    '# Generated by scripts/oauth-secrets.cjs — DO NOT EDIT, DO NOT COMMIT.',
    `# Source: ${path.relative(ROOT, file)}`,
    `APP_ENV=${env}`,
    `IS_BETA=${isBeta}`,
    `GOOGLE_WEB_CLIENT_ID=${clientId}`,
    `APPLE_SERVICES_ID=${appleServicesId}`,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(ROOT, '.env'), envLines);
  log(`✔ Wrote .env (APP_ENV=${env}, GOOGLE_WEB_CLIENT_ID=${clientId})`);

  // ── 2. Android flavor values ─────────────────────────────────────────
  const androidDir = path.join(ROOT, 'android');
  fs.mkdirSync(androidDir, { recursive: true });
  const gradleSecretsPath = path.join(
    androidDir,
    `gradle-secrets.${env}.properties`,
  );
  const gradleLines = [
    '# Generated by scripts/oauth-secrets.cjs — DO NOT EDIT, DO NOT COMMIT.',
    `# Source: ${path.relative(ROOT, file)}`,
    `GOOGLE_WEB_CLIENT_ID=${clientId}`,
    `APPLE_SERVICES_ID=${appleServicesId}`,
    '',
  ].join('\n');
  fs.writeFileSync(gradleSecretsPath, gradleLines);
  log(`✔ Wrote ${path.relative(ROOT, gradleSecretsPath)}`);

  log(
    `\nOAuth secrets loaded for "${env}" (${projectId || 'project unknown'}):\n` +
      `  client_id : ${clientId}\n` +
      `  source    : ${path.relative(ROOT, file)}`,
  );
  log(
    '\nNow build/run with the dev flavour (Android reads the gradle-secrets\n' +
      'file automatically; iOS/Metro read the generated .env).',
  );
}

main();
