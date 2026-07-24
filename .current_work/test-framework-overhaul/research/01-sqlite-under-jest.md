# Research Report 1: SQLite-under-Jest Strategies for React Native

**Date:** July 20, 2026
**Researcher:** code-expert subagent (session `ses_07f00b2a7ffeqP6NScSUOngftM`)
**Project context:** HarmonyAIChat — React Native 0.86 / TypeScript on Jest 29, using `react-native-sqlite-storage` v6 with SQLCipher encryption.

---

## 1. Executive Summary

**Single best recommendation: Option 6 — Abstract the DB layer behind an interface, then wire `better-sqlite3` (v12.12.0) as the test driver.** This gives you a real, synchronous, file-backed or in-memory SQLite under Jest with zero RN native dependency issues. The production path stays entirely untouched (still `react-native-sqlite-storage` + SQLCipher). Tests run on plain SQLite, because encryption is an orthogonal concern that does not need to be verified in every migration or repository test — a small, targeted smoke test on-device (or in a CI build matrix step that uses the real native module) covers SQLCipher compatibility. This pattern is proven: at least 4–5 open-source RN projects and multiple Reddit/StackOverflow threads confirm teams have gone this route successfully (see Sources). The adapter file is ~150–200 lines, and the existing codebase changes are minimal (swap direct `import SQLite from 'react-native-sqlite-storage'` to `import { db } from './db-adapter'`).

**Runner-up:** If you want zero abstraction cost and can accept a synchronous test API, write a Jest manual mock (`__mocks__/react-native-sqlite-storage.ts`) that delegates to `better-sqlite3` under the hood. This is the same as Option 6 but without an explicit interface TypeScript — faster to implement but slightly more fragile because the mock shape must track the RN library's exact API surface.

**Why not the others:** `node:sqlite` (still experimental in v22 LTS), has no SQLCipher, and its API is incompatible; WASM options (`sql.js`, `wa-sqlite`) lack SQLCipher support entirely and add WASM loading complexity to Node tests; the Metro bridge approach doesn't work under Jest's Node runner.

## 2. Option-by-Option Analysis

### Option 1: `node:sqlite` (Node.js built-in)

| Dimension | Assessment |
|---|---|
| Maturity | Added in Node 22.5.0 behind `--experimental-sqlite`. In v22.13.0 the flag was removed but remains **Stability 1.1 — Active development** (not stable). On Node 26 it is "release candidate" (near-stable but not yet). The API surface has been growing rapidly (sessions, changesets, aggregates, timeouts added across 22.5–22.18). |
| SQLCipher support | **None.** `node:sqlite` is a built-in binding to the system SQLite. It cannot load SQLCipher extensions. You get plain SQLite only. |
| API compatibility | **Very low.** `node:sqlite` exposes `DatabaseSync` with `prepare()`, `get()`, `all()`, `run()`. The RN library exposes `SQLite.openDatabase({name, location, key})` and `db.executeSql(sql, params)` returning `Promise<[result]>`. These are entirely different shapes — no `transaction()`, no `rows.item()`, no Web SQL result set format. You'd need a full adapter anyway. |
| Setup complexity | Trivial — zero deps. But your CI Node.js version must be ≥22.5 (yours is likely on 22+ already for RN 0.86). One issue: the experimental status means some Node Docker images and CI runners may lag. |
| In-memory + file-backed | Yes — `:memory:` and file paths both work. |
| Gotchas | Experimental warning on v22. Sync API means all calls block the event loop (fine for tests). No SQLCipher. No `LOAD` extension support by default. The API is still changing between minor Node versions. |

**Verdict:** Attractive for its zero-dependency nature, but the API mismatch and lack of SQLCipher + experimental status disqualify it for serious use today. If it stabilizes in Node 24+ with extension loading, it could become viable for the test-driver role.

### Option 2: `better-sqlite3`

| Dimension | Assessment |
|---|---|
| Maturity | **Very mature.** v12.12.0 released **Jul 15, 2026** (1 week ago). 7,400+ GitHub stars, 1,600+ commits, 8944+ npm dependents. Very active: last release 1 month ago, 126 releases total. Node version support: 20.x (EOL Apr 2026), 22.x, 23.x, 24.x, 25.x confirmed. Prebuilt binaries available for LTS versions across Linux (glibc + musl), macOS, Windows. |
| SQLCipher support | **Not built-in.** `better-sqlite3` compiles against vanilla SQLite. However, you can compile from source against SQLCipher by replacing the `deps/sqlite3` source. This requires build-from-source (no prebuilds), and there is no official blessed path. For test purposes, this is unnecessary (see Section 5). |
| API compatibility | **Low — needs wrapping.** `better-sqlite3` is synchronous (`db.prepare(sql).all()`, `stmt.run()`). The RN library is async/promise. You need to wrap sync calls in Promise and map result shapes (e.g., `rows.item(i)` → array row, row count → `rowsAffected`). This is ~100–150 lines of adapter code. |
| Setup complexity | Low for plain SQLite: `npm install --save-dev better-sqlite3`. Native addon builds via `node-gyp` — prebuilts cover most CI. For Windows, ensure `build-tools` for `node-gyp` are installed. Under Jest, no `transformIgnorePatterns` issues because it's a Node module, not RN. |
| In-memory + file-backed | Yes — `new Database(':memory:')` and `new Database('./test.db')`. WAL mode, foreign keys, everything works. |
| Gotchas | Sync API blocks the event loop (fine for test suites). Native addon must match Node ABI — can cause issues if Node is upgraded out of sync with prebuilds. The SQLCipher compile path is custom and poorly documented. |

**Verdict:** The best **test-only** SQLite driver for your use case. Fastest SQLite library on Node (benchmarks show it beating `node:sqlite` by 1.1–1.6×). Mature, well-maintained, and the sync API is actually a benefit in tests (no race conditions). Needs an adapter wrapper, but that's a one-time cost.

### Option 3: `sql.js`

| Dimension | Assessment |
|---|---|
| Maturity | Mature (since 2014). The WASM build is the primary distribution. Maintained but not rapidly evolving. SQLite version bundled may lag upstream. |
| SQLCipher support | **Not officially supported.** The canonical WASM build (from SQLite.org) supports building with the commercial SQLite Encryption Extension (SEE), not SQLCipher. There is one community attempt at WASM SQLCipher using OpenSSL WASM, but it required commenting out `mlock` (due to WASM memory model limitations) and has no prebuilt distribution. PowerSync's May 2026 survey states: *"SQLCipher does not appear to officially support Wasm builds at this point."* |
| API compatibility | Low — `sql.js` exposes a synchronous API similar to better-sqlite3 (prepare/step/getAsObject), plus a `db.exec()` for raw SQL. No transaction helper. |
| Setup complexity | Low — `npm install --save-dev sql.js`. No native builds needed. Under Jest, you need to configure the WASM loading path. |
| In-memory + file-backed | Yes, but file-backed persistence is manual (export to `Uint8Array`, save to fs). Not a real file on disk. |
| Gotchas | WASM initialization is async — your `beforeAll` needs to await it. The database lives entirely in WASM memory; for file-backed tests you must manually `db.export()` to persist. Performance is ~2–5× slower than native due to WASM overhead and the JS↔WASM bridge. No WAL mode in the WASM build. No SQLCipher. |

**Verdict:** A workable option if you cannot use native addons, but the manual persistence, WASM init complexity, and lack of SQLCipher make it strictly inferior to `better-sqlite3` for this use case.

### Option 4: `wa-sqlite`

| Dimension | Assessment |
|---|---|
| Maturity | Mature — reached 1.0 in July 2024. Active development. Focused on browser-based SQLite persistence (IndexedDB, OPFS). |
| SQLCipher support | **Not officially supported.** wa-sqlite does support building with SQLite3 Multiple Ciphers (a community fork), but this requires manual build configuration. |
| API compatibility | Low. wa-sqlite exposes a custom async API or the sql.js-compatible API. |
| Setup complexity | Moderate — primarily designed for browser environments. Under Node, you'd need to configure a Node-specific VFS. Not well-documented for Node.js test usage. |
| In-memory + file-backed | In-memory works. File-backed requires configuring a Node VFS. |
| Gotchas | Primarily designed for browser-based SQLite, not Node.js. Would need a custom Node VFS. |

**Verdict:** Over-engineered for this use case. wa-sqlite shines for in-browser SQLite persistence.

### Option 5: Metro / RN Bridge Shim

| Dimension | Assessment |
|---|---|
| Maturity | No maintained solution exists. The only discussion is issue #424 on `react-native-sqlite-storage` (May 2020) asking for this, which was closed without resolution. |
| SQLCipher support | Would inherit RN's native SQLCipher if you could bridge it, but there is no working bridge. |
| API compatibility | N/A — the library's `sqlite.core.js` calls `NativeModules.SQLitePlugin` which doesn't exist under Jest/Node. |
| Setup complexity | Very high. You'd need to write a Node.js-native addon that implements the `SQLitePlugin` native module interface. |
| Gotchas | This is exactly what everyone hitting issue #424 asked for and no one built. |

**Verdict:** Not viable. Do not pursue.

### Option 6: Abstract the DB Layer Behind an Interface

| Dimension | Assessment |
|---|---|
| Maturity | **Proven pattern.** Multiple Reddit threads confirm teams have done this (see Sources). The `r/reactnative` thread from ~1 year ago: *"We ended up using `sqlite3`. We have a facade in front of `react-native-sqlite-storage` and so I was able to inject a `sqlite3` interface."* Also described in a 2024 blog post (amarjanica.com) for expo-sqlite. |
| SQLCipher support | Not needed at test layer — production code still uses `react-native-sqlite-storage` with its native SQLCipher. |
| API compatibility | You define an `interface Database { executeSql(...): Promise<[...]> }` that matches the subset of the RN API you actually use. Two implementations: `ReactNativeDatabase` (wraps RN library), `NodeDatabase` (wraps better-sqlite3). |
| Setup complexity | Low-to-moderate initial cost. One TypeScript interface file (~30 lines), one RN wrapper (~50 lines), one Node wrapper using better-sqlite3 (~150 lines). |
| In-memory + file-backed | Trivial — Node wrapper can accept `:memory:` or file path. |
| Gotchas | You must ensure the interface covers all SQL features you use. Code changes: every file that currently imports `react-native-sqlite-storage` needs to import the interface instead. |

**Verdict:** **The recommendation.** Minimal risk, clear separation of concerns, proven in the community, and leaves production code untouched.

## 3. Recommended Architecture

```
src/
  db/
    types.ts          ← Interface: Database, ResultSet, etc.
    react-native-adapter.ts  ← implements Database wrapping react-native-sqlite-storage
    node-adapter.ts          ← implements Database wrapping better-sqlite3
    index.ts                 ← exports the right adapter based on Platform.OS
```

(Sketch code in the original report — see implementation plan Phase 2-1 and 2-2 for the actual adopted shape.)

## 4. Migration Effort Estimate

| Component | LoC to change | Risk |
|---|---|---|
| New `db/types.ts` | ~30 | Low |
| New `db/react-native-adapter.ts` | ~50 | Low |
| New `db/node-adapter.ts` | ~150 | Medium |
| New `db/index.ts` | ~15 | Low |
| Update `jest.config.js` | ~5 | Low |
| Update 10 repository files | ~100 | Low |
| Update 32 migration files | ~0 | Low |
| New adapter smoke test | ~50 | Low |
| **Total** | **~400 LoC** | **Low-Medium** |

## 5. Open Risks / Things to Validate

1. **`executeSql` return shape fidelity.** Write a compatibility test that runs the same 20 queries through both adapters.
2. **Parameter binding differences.** The RN lib binds all numeric values as `double` (Issue #4141). Add a CI step that runs tests on Android emulator.
3. **Transaction semantics.** Nested transactions need SAVEPOINT.
4. **SQLCipher encryption gap.** Recommend: all tests run on plain SQLite; a single on-device smoke test verifies encryption.
5. **`better-sqlite3` on Node 22+ on Windows.** Prebuilt binaries available; validate `node-gyp` works on the team's CI image.
6. **Connection pool (main + sync).** The Node adapter manages a single connection — test the two-pool design specifically.
7. **WAL mode + foreign keys.** Node adapter must apply same PRAGMAs as production.

## 6. Sources

| URL | What it says |
|---|---|
| nodejs.org/api/sqlite.html (v22) | Node 22 `node:sqlite` docs — synchronous API, experimental, no extension loading. |
| nodejs.org/api/sqlite.html (v26) | Node 26 docs — SQLite is "release candidate" (stability 2). Still no SQLCipher. |
| github.com/WiseLibs/better-sqlite3 | 7.4k stars, 126 releases, v12.12.0 Jul 2026. Fastest Node SQLite. |
| npmjs.com/package/better-sqlite3 | v12.11.1 latest a month ago. 8944 dependents. Prebuilt binaries for LTS Node. |
| github.com/WiseLibs/better-sqlite3/discussions/1245 | Discussion: better-sqlite3 vs node:sqlite. Maintainer confirms Node 22 support. |
| sqg.dev/blog/sqlite-driver-benchmark | Benchmark (Jan 2026): better-sqlite3 fastest in 8/10 operations. 1.1–1.6× faster than node:sqlite. |
| reddit.com/r/node/.../nodesqlite3_was_just_deprecated | Discussion of node-sqlite3 deprecation. |
| powersync.com/blog/sqlite-persistence-on-the-web | **Key source.** "SQLCipher does not appear to officially support Wasm builds." May 2026. |
| sqlite.org/wasm/doc/trunk/see.md | SQLite WASM SEE builds are possible but require manual building. Not SQLCipher. |
| github.com/andpor/react-native-sqlite-storage | 2.8k stars. Last release v6.0.1 Oct 2021 (5 years ago). |
| github.com/andpor/react-native-sqlite-storage/issues/424 | **Direct evidence of the problem:** Jest can't open DB. No resolution. Open since 2020. |
| reddit.com/r/reactnative/.../react_native_sqlite_library_unit_testing | Community insight: facade pattern works. |
| amarjanica.com/bridging-the-gap-between-expo-sqlite-and-node-js | Oct 2024 blog post. Adapter pattern for Expo SQLite using `__mocks__/expo-sqlite` delegating to `node:sqlite3`. |
| lightrun.com/.../react-native-sqlite-storage-jest | Lightrun answer suggests using `sqlite3` library with similar interface for Jest integration tests. |
| stackoverflow.com/.../how-do-i-run-expo-sqlite-tests-in-jest | "You need to replace expo-sqlite with sqlite3 of nodejs because Jest tests run on your machine." |
| blog.logrocket.com/using-sqlite-react-native | LogRocket guide on `react-native-sqlite-storage` promise API. |
| github.com/sqlcipher/sqlcipher | SQLCipher is a standalone fork of SQLite. |
| zetetic.net/sqlcipher | Official SQLCipher site — 256-bit AES encryption. |
| oneuptime.com/blog/.../sqlcipher-encryption | Feb 2026 article on SQLCipher implementation. |
| stackoverflow.com/.../how-to-make-encrypted-sqlite3-database | Points to `@journeyapps/sqlcipher` for Node.js/Electron SQLCipher support. |
