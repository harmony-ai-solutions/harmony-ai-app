#!/usr/bin/env node
/**
 * scripts/build-engine-sidecar.cjs
 *
 * Provision Soulbits Engine (`libengine.so`) for local Android app builds so
 * that a plain `npm run android` needs no extra flags.
 *
 * WHAT IT DOES
 *   1. Resolves the engine repo (harmony-link-private).
 *   2. Ensures the per-ABI NDK sidecar artifacts exist and are FRESH — it
 *      cross-compiles via the engine's own `build_sidecar_android.ps1` (Windows)
 *      / `build_sidecar_android.sh` (unix) ONLY when an artifact is missing or
 *      older than the engine's Go sources. Otherwise it is a fast no-op.
 *   3. Copies `build/android/<abi>/libengine.so` into
 *      `android/app/src/main/jniLibs/<android-abi>/libengine.so`, which the
 *      Gradle `vendorEngineSidecar` task ([build.gradle]) then picks up (it
 *      skips when the file is already present).
 *
 * The subsequent `react-native run-android` (the `android` npm script) builds,
 * installs and starts Metro — so the only developer entry point is
 * `npm run android` (or `npm run android-prod`).
 *
 * ENGINE REPO RESOLUTION (first match wins)
 *   1. --engine-repo=<path>
 *   2. $SOULBITS_ENGINE_REPO  /  $ENGINE_REPO
 *   3. sibling checkout `../harmony-link-private` (relative to this repo)
 *
 * OVERRIDES
 *   ENGINE_SIDECAR_REBUILD=1   force a rebuild even when artifacts look fresh
 *   --force                    same as ENGINE_SIDECAR_REBUILD=1
 *   --quiet                    suppress progress output
 *   -PENGINE_SIDECAR_STRICT=true (gradle flag, also read here) makes a build
 *                              failure FATAL instead of a warning — so CI-style
 *                              strict builds never silently ship engine-less.
 *
 * EXIT CODE
 *   0 on success AND on a non-fatal failure (missing engine repo / build error)
 *     — vendoring is best-effort so an engine-less ABI still builds. Non-zero
 *     only when STRICT is set and the engine could not be provisioned.
 *
 * WHY A SCRIPT (not a gradle default): the engine repo path is a machine-local
 * fact; not hardcoding it keeps the app repo portable. Engine artifact sources
 * are documented in the app's build notes / engine docs/Sidecar-Deployment.md.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const APP_ROOT = path.resolve(__dirname, '..');
const ENGINE_BIN_NAMES = ['libengine.so'];
// engine artifact dir  →  Android jniLibs ABI dir
const ABI_MAP = [
  { engine: 'arm64', android: 'arm64-v8a', goarch: 'arm64', triple: 'aarch64-linux-android' },
  { engine: 'x86_64', android: 'x86_64', goarch: 'amd64', triple: 'x86_64-linux-android' },
];
// Directories under the engine repo that never affect the compiled sidecar.
const IGNORED_DIRS = new Set([
  '.git', 'vendor', 'build', 'node_modules', 'frontend', 'dist',
  '.planning', '.current_work', '.claude', '.roo', '.github',
  'memory-bank', 'docs', 'release_notes', 'coverage', 'plans',
]);
const SOURCE_EXT = new Set(['.go', '.c', '.h', '.cc', '.cpp', '.cxx', '.s', '.S', '.m']);
const SOURCE_NAMES = new Set(['go.mod', 'go.sum']);

// ── CLI / env ────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const quiet = argv.includes('--quiet');
const force = argv.includes('--force') || envTruthy(process.env.ENGINE_SIDECAR_REBUILD);
const strict = envTruthy(process.env.ENGINE_SIDECAR_STRICT);
const repoFlag = argv.find((a) => a.startsWith('--engine-repo='));
const repoOverride = repoFlag ? repoFlag.slice('--engine-repo='.length) : null;

function log(...args) {
  if (!quiet) console.log('[engine]', ...args);
}
function warn(...args) {
  console.warn('[engine]', ...args);
}
function envTruthy(v) {
  return v === '1' || String(v).toLowerCase() === 'true';
}
function isWindows() {
  return process.platform === 'win32';
}

// ── resolve the engine repo ────────────────────────────────────────────────
function resolveEngineRepo() {
  const candidates = [
    repoOverride,
    process.env.SOULBITS_ENGINE_REPO,
    process.env.ENGINE_REPO,
    path.resolve(APP_ROOT, '..', 'harmony-link-private'),
  ].filter(Boolean);

  for (const c of candidates) {
    const abs = path.resolve(c);
    if (fs.existsSync(path.join(abs, 'go.mod')) || fs.existsSync(path.join(abs, 'cmd', 'engine-sidecar'))) {
      return abs;
    }
  }
  return null;
}

// ── freshness check ────────────────────────────────────────────────────────
function newestSourceMtimeMs(root) {
  let newest = 0;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (IGNORED_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        stack.push(path.join(dir, e.name));
      } else if (e.isFile()) {
        const ext = path.extname(e.name);
        if (!SOURCE_EXT.has(ext) && !SOURCE_NAMES.has(e.name)) continue;
        try {
          const m = fs.statSync(path.join(dir, e.name)).mtimeMs;
          if (m > newest) newest = m;
        } catch {
          /* ignore */
        }
      }
    }
  }
  return newest;
}

/**
 * Is the built binary at `binPath` up to date with the engine sources?
 * Returns { fresh: boolean, reason: string }.
 */
function isArtifactFresh(binPath, engineRoot) {
  if (!fs.existsSync(binPath)) {
    return { fresh: false, reason: 'missing' };
  }
  let binM;
  try {
    binM = fs.statSync(binPath).mtimeMs;
  } catch {
    return { fresh: false, reason: 'unreadable' };
  }
  const newest = newestSourceMtimeMs(engineRoot);
  if (newest > binM) {
    return { fresh: false, reason: 'sources changed' };
  }
  return { fresh: true, reason: 'up to date' };
}

// ── build (delegates to the engine's own scripts) ──────────────────────────
function findNdk() {
  const explicit = process.env.ANDROID_NDK_HOME || process.env.ANDROID_NDK_ROOT;
  if (explicit && fs.existsSync(explicit)) return explicit;
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (sdk && fs.existsSync(path.join(sdk, 'ndk'))) {
    const dirs = fs
      .readdirSync(path.join(sdk, 'ndk'))
      .filter((d) => fs.existsSync(path.join(sdk, 'ndk', d)))
      .sort();
    if (dirs.length) return path.join(sdk, 'ndk', dirs[dirs.length - 1]);
  }
  return null;
}

function hostTag() {
  if (isWindows()) return 'windows-x86_64';
  if (process.platform === 'darwin') return 'darwin-x86_64';
  return 'linux-x86_64';
}

/** Fallback cross-compile loop if the engine ships no build script. */
function buildWithNdk(engineRoot) {
  const ndk = findNdk();
  if (!ndk) {
    warn('Android NDK not found (set ANDROID_NDK_HOME / ANDROID_HOME); cannot build the engine.');
    return false;
  }
  const toolchain = path.join(ndk, 'toolchains', 'llvm', 'prebuilt', hostTag());
  const api = process.env.ANDROID_API || '24';
  const binext = isWindows() ? '.cmd' : '';
  const outRoot = path.join(engineRoot, 'build', 'android');

  for (const abi of ABI_MAP) {
    const cc = path.join(toolchain, 'bin', `${abi.triple}${api}-clang${binext}`);
    if (!fs.existsSync(cc)) {
      warn(`NDK compiler not found: ${cc}`);
      return false;
    }
    const outDir = path.join(outRoot, abi.engine);
    fs.mkdirSync(outDir, { recursive: true });
    log(`compiling engine-sidecar for android/${abi.goarch} (${abi.engine})…`);
    const res = spawnSync('go', ['build', '-mod=vendor', '-ldflags=-w -s', '-o', path.join(outDir, 'libengine.so'), './cmd/engine-sidecar'], {
      cwd: engineRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        CGO_ENABLED: '1',
        GOOS: 'android',
        GOARCH: abi.goarch,
        CC: cc,
        CXX: `${cc}++`,
        AR: path.join(toolchain, 'bin', isWindows() ? 'llvm-ar.exe' : 'llvm-ar'),
        CGO_CFLAGS: `${process.env.CGO_CFLAGS || ''} -DSQLITE_ENABLE_SESSION -DSQLITE_ENABLE_PREUPDATE_HOOK`.trim(),
      },
    });
    if (res.status !== 0) {
      warn(`engine build failed for ${abi.engine} (exit ${res.status}).`);
      return false;
    }
  }
  return true;
}

/** Build via the engine's own helper scripts (preferred; they set CGO_CFLAGS). */
function buildEngine(engineRoot) {
  const sh = path.join(engineRoot, 'build_sidecar_android.sh');
  const ps1 = path.join(engineRoot, 'build_sidecar_android.ps1');

  if (isWindows() && fs.existsSync(ps1)) {
    log('building engine sidecar via build_sidecar_android.ps1 …');
    const res = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1],
      { cwd: engineRoot, stdio: 'inherit' },
    );
    return res.status === 0;
  }
  if (fs.existsSync(sh)) {
    log('building engine sidecar via build_sidecar_android.sh …');
    const res = spawnSync('bash', [sh], { cwd: engineRoot, stdio: 'inherit' });
    if (res.status === 0) return true;
    warn('build_sidecar_android.sh failed; trying the NDK fallback …');
  } else if (fs.existsSync(ps1)) {
    log('building engine sidecar via build_sidecar_android.ps1 …');
    const res = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1],
      { cwd: engineRoot, stdio: 'inherit' },
    );
    return res.status === 0;
  }
  return buildWithNdk(engineRoot);
}

// ── vendor the artifacts into the app ──────────────────────────────────────
function vendor(engineRoot) {
  const jniRoot = path.join(APP_ROOT, 'android', 'app', 'src', 'main', 'jniLibs');
  let ok = true;
  for (const abi of ABI_MAP) {
    const src = path.join(engineRoot, 'build', 'android', abi.engine, 'libengine.so');
    if (!fs.existsSync(src) || fs.statSync(src).size === 0) {
      warn(`engine artifact missing: ${src} (engine will be unavailable on ${abi.android}).`);
      ok = false;
      continue;
    }
    const destDir = path.join(jniRoot, abi.android);
    const dest = path.join(destDir, 'libengine.so');
    fs.mkdirSync(destDir, { recursive: true });
    const srcM = fs.statSync(src).mtimeMs;
    const destM = fs.existsSync(dest) ? fs.statSync(dest).mtimeMs : 0;
    const size = fs.statSync(src).size;
    if (destM >= srcM && fs.existsSync(dest) && fs.statSync(dest).size === size) {
      log(`${abi.android}: already vendored (${Math.round(size / 1048576)} MB).`);
      continue;
    }
    fs.copyFileSync(src, dest);
    log(`${abi.android}: vendored libengine.so (${Math.round(size / 1048576)} MB).`);
  }
  return ok;
}

// ── main ───────────────────────────────────────────────────────────────────
function main() {
  const engineRoot = resolveEngineRepo();
  if (!engineRoot) {
    warn(
      'engine repo not found. Set HARMONY_ENGINE_REPO (or pass --engine-repo=<path>) so the ' +
        'embedded engine can be provisioned; continuing without it (engine unavailable).',
    );
    return strict ? 1 : 0;
  }
  log(`engine repo: ${engineRoot}`);

  const armBin = path.join(engineRoot, 'build', 'android', 'arm64', 'libengine.so');

  let needBuild = force;
  if (!needBuild && ENGINE_BIN_NAMES.length) {
    const fresh = isArtifactFresh(armBin, engineRoot);
    log(`arm64 artifact ${fresh.fresh ? 'is fresh' : `stale (${fresh.reason})`}.`);
    needBuild = !fresh.fresh;
  }

  if (needBuild) {
    const built = buildEngine(engineRoot);
    if (!built) {
      warn('engine build did not complete; continuing (engine may be unavailable).');
      if (strict) return 1;
    }
  } else if (!force) {
    log('engine sidecar is up to date — skipping rebuild (set ENGINE_SIDECAR_REBUILD=1 to force).');
  }

  const ok = vendor(engineRoot);
  if (!ok && strict) return 1;
  return 0;
}

process.exit(main());
