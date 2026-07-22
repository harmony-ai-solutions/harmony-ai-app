# Research Report 4: Jest vs Vitest for React Native (Mid-2026)

**Date:** July 20, 2026
**Researcher:** code-expert subagent (session `ses_07f0073f0ffeHGvC8wgnKqvCEG`)
**Project context:** HarmonyAIChat — React Native 0.86 / TypeScript 5.8 on Jest 29 with `react-native` preset.

---

## 1. Executive Summary

**Recommendation: Stay on Jest — but modernize aggressively to Jest 30 + `@react-native/jest-preset`.**

In mid-2026, Jest remains the canonical, zero-friction test runner for React Native 0.86. The RN team explicitly ships and tests against Jest — `@react-native/jest-preset` was extracted as a first-class package in RN 0.85 (April 2026), and RN 0.86 (June 2026) has zero breaking changes. Vitest is dramatically faster for web projects (5-28x on benchmarks) and has a promising RN plugin (`vitest-native`), but that plugin is **beta software** — it passes ~85% of react-native-paper's suite with no source changes, but the remaining 15% require test rewrites, and no production RN app has publicly documented a full migration. For a team about to layer on significant new test infrastructure, the last thing you need is a test-runner migration creating uncertainty. **Modernize Jest now, evaluate Vitest in 12 months.**

## 2. Current State of Jest for RN (Mid-2026)

### Version & Release Cadence

| Metric | Data |
|---|---|
| Current stable | **Jest 30.4.2** (latest as of June 2026) |
| Jest 30 shipped | **June 4, 2025** — first major release since Jest 29 (August 2022) |
| Release frequency | Jest team committed to faster major releases going forward |
| npm downloads | ~30 million weekly |

The 3-year gap between 29 and 30 was acknowledged as "too long" by the maintainers.

### What Jest 30 Brought

- **37% faster test runs** on a large TypeScript client+server app (1350s → 850s server; 49s → 44s client)
- **77% lower peak memory** (7.8 GB → 1.8 GB on the server suite)
- **Bundled packages** — each Jest package is now a single file
- **ESM improvements** — ESM wrappers, `import.meta.*`, `.mts`/`.cts` by default
- **New resolver** — `unrs-resolver` for faster module resolution
- **jsdom 26** (was 21)
- **New APIs** — `expect.arrayOf()`, `jest.advanceTimersToNextFrame()`, configurable test retries, `using` keyword for spies
- **Globals cleanup** — automatic GC between test files

Happo.io reported 50% speedup (14min → 9min) after Jest 30 + open handle cleanup.

### RN 0.85 / 0.86 Fit

React Native 0.85 (April 2026) extracted the Jest preset from core `react-native` into a dedicated package: **`@react-native/jest-preset`**. The migration is a one-line config change:

```diff
- preset: 'react-native',
+ preset: '@react-native/jest-preset',
```

React Native 0.86 (June 2026) has **zero user-facing breaking changes** and continues to ship with Jest as the default test runner.

### New Architecture / Fabric / TurboModules

Jest + the RN preset runs **real React Native JavaScript** in Node.js. It mocks the native boundary but runs real RN Js. Applies equally to old architecture and New Architecture code. **No additional Jest configuration needed for New Architecture code.**

### `react-test-renderer` Deprecation & RNTL

`react-test-renderer` is **officially deprecated** as of React 19 (2024). The React team explicitly recommends `@testing-library/react-native` (RNTL).

- **RNTL v14** removes the `react-test-renderer` dependency entirely, replacing it with standalone `test-renderer`.
- Callstack built a new test renderer operating on host components only.
- RNTL v13+ supports React 19 concurrent features that `react-test-renderer` can't.

### Maintenance Signals

Jest was transferred from Meta to the **OpenJS Foundation** in May 2022. Community-driven since.

### Jest Downsides for RN in 2026

- **Still Babel-bound** for RN projects — `@react-native/babel-preset`, ~10-100x slower than esbuild for TS/JSX
- **transformIgnorePatterns maintenance** — the endless regex
- **No native ESM** — still requires `--experimental-vm-modules` or Babel transforms
- **Cold start** slower than Vitest

## 3. Current State of Vitest for RN (Mid-2026)

### Version & Release Cadence

| Metric | Data |
|---|---|
| Current stable | **Vitest 4.1.2** (March 2026) |
| Vitest 4.0 shipped | Late 2025 — Browser mode graduated to stable |
| Vitest 3 shipped | Early 2025 — redesigned public API |
| npm downloads | ~20 million weekly (up from ~5M in 2024) |

### The RN Story: Three Projects, One Viable

1. **`vitest-community/vitest-react-native`** (by sheremet-va) — Now **unmaintained**.
2. **`@srsholmes/vitest-react-native`** — Minimal traction.
3. **`vitest-native`** (by danfry1, 2025-2026) — **The current viable option.** Beta stage, actively maintained.

### vitest-native Deep Dive

Two engines:
- **`engine: 'native'`** (default) — Real RN JavaScript, mocks only native boundary. Needs `@react-native/babel-preset`.
- **`engine: 'mock'`** — Zero-dependency pure-JS reimplementation. No Babel needed.

**API coverage:** 82/82 stable RN public exports as of RN 0.84.

**Real-world validation:**
- react-native-paper: 625/734 tests pass (~85%) under native engine
- Obytes Expo template: 34/40 (~85%)
- Rocket.Chat: tested locally

**The `jest-compat` layer:** installs a `jest` global backed by Vitest's `vi`, rewrites `jest.mock()` to hoisted `vi.mock()`, shims `@jest/globals`.

**Honest disclaimer from docs:** *"It is not primarily a speed play — choose it for the fidelity option and DX, not raw speed."*

### What Does NOT Work (Yet)

- **`vitest-native` is beta** — APIs may shift before 1.0
- **No production RN app has publicly documented a full Jest→Vitest migration**
- Some test patterns break — deep `jest.mock('react-native/…')` of Appearance/Dimensions need rewrites
- Community skepticism — Reddit threads from early 2026 include complaints
- No RN-specific Vitest documentation; RN team doesn't test against Vitest

### Vitest Mobile (Discussion Only)

GitHub discussion `vitest-dev/vitest#10160` proposed **Vitest Mobile** — boot a full emulator/simulator. **Remains a discussion only** as of mid-2026.

## 4. Side-by-Side Comparison Table

| Dimension | Jest 30 + `@react-native/jest-preset` | Vitest 4 + `vitest-native` |
|---|---|---|
| **RN team support** | ✅ First-class. Official preset extracted in RN 0.85. | ❌ Community-only. `vitest-native` is beta. |
| **Cold start (500 TS tests)** | ~44s client; 30%+ faster than Jest 29 | ~38s on web; **NOT faster for RN** per maintainer |
| **Watch mode** | Git-diff-based, ~8.4s re-run | Vite module graph, ~0.3s on web |
| **ESM support** | Partial via Babel | **Native** via Vite |
| **Native module mocking** | `jest.mock()` works, huge ecosystem | `vi.mock()` same surface; auto-mocks for 82/82 RN exports |
| **RN preset quality** | ✅ Mature. Stable across RN 0.71–0.86. | ⚠️ Beta. 85% pass rate. |
| **Debugging** | `node --inspect`, IDE integrations | Vitest UI, `node --inspect`, Playwright traces |
| **Parallelism** | Workers, mature for 10K+ suites | Threads/forks/vmThreads |
| **Snapshot** | Identical format | Compatible with Jest format |
| **Coverage** | Istanbul (slower) | v8 (2-3x faster) or Istanbul |
| **TypeScript** | `ts-jest` (slow) or `babel-jest` (fast) | **Native** via esbuild — 10-100x faster |
| **transformIgnorePatterns** | **Required** | Not needed for `engine: 'mock'`. Still needed for `engine: 'native'`. |
| **Migration cost** | Low (Jest 29→30 is mechanical) | Medium-High |

## 5. Migration Cost Analysis

### If Staying on Jest: Modernization Checklist (1-2 days)

1. Upgrade Jest 29 → 30
2. Switch to `@react-native/jest-preset`
3. Migrate off `react-test-renderer` to RNTL
4. Optional: `@swc/jest` for faster transforms

### If Migrating to Vitest (1-2 weeks for ~500 tests)

| Step | Effort |
|---|---|
| Install deps | 30 min |
| Create `vitest.config.ts` | 1 hour |
| Add `jest-compat` setup | 30 min |
| Mechanical rewrite (codemod) | Most files unchanged |
| Handle broken tests (~15%) | 2-5 days |
| Native lib mocks | 1 day |
| Snapshot re-recording | 1-2 hours |
| CI pipeline | 2 hours |

**Things that would break:**
- `jest.mock('react-native', ...)` for specific internals
- `jest.spyOn(View.prototype, ...)`
- `jest.requireActual` / `jest.requireMock` edge cases
- Custom Jest transformers
- CI tooling parsing Jest output

**No codemods exist** for Jest→Vitest migration in the RN space.

### Public Migration Stories

**No production React Native apps have publicly documented a full Jest→Vitest migration as of mid-2026.**

## 6. Other Contenders

### Bun Test
**Not realistic for RN in 2026.** Bun cannot run React Native's native modules. Bun issue #123 ("react-native support") remains open.

### Mocha / node:test / uvu
None have RN-specific support. **Not recommended.**

### Deno
No RN support. Incompatible.

## 7. Final Recommendation With Conditions

### ✅ Stay on Jest if:

- Adding significant new test infrastructure NOW
- Want RN team's official path
- Team already productive with Jest
- CI times acceptable

**Immediate actions:**
1. Upgrade Jest 29 → 30
2. Switch to `@react-native/jest-preset`
3. Migrate off `react-test-renderer` to RNTL

### 🔄 Migrate to Vitest if:

- Starting a greenfield RN project
- CI costs dominated by test runtime
- Already using Vitest for web/server in same repo
- Willing to be beta adopter of `vitest-native`

### The Honest Take

For HarmonyAIChat — **staying on Jest is the correct call for 2026**. Modernize to Jest 30 + `@react-native/jest-preset` now. Put a calendar reminder for **Q3 2027** to re-evaluate Vitest.

Jest 30 closed the most painful gaps (memory, cold start, ESM). Team's energy better spent building new test infrastructure than fighting a test runner migration for marginal RN-specific gains.

## 8. Sources

| URL | Summary |
|---|---|
| jestjs.io/blog/2025/06/04/jest-30 | Official Jest 30 announcement |
| jestjs.io/docs/upgrading-to-jest30 | Jest 29→30 migration guide |
| jestjs.io/docs/tutorial-react-native | Jest's official RN tutorial |
| npmjs.com/package/jest | Latest version 30.4.2 |
| reactnative.dev/blog/2026/04/07/react-native-0.85 | RN 0.85 — Jest preset extracted |
| reactnative.dev/blog/2026/06/11/react-native-0.86 | RN 0.86 — zero breaking changes |
| github.com/expo/expo/issues/47435 | Expo SDK 57 peer-dep conflict |
| reactnativerelay.com/article/complete-guide-testing-react-native-apps-2026... | Comprehensive RN testing guide 2026 |
| drizz.dev/post/react-native-testing | react-test-renderer deprecated, RNTL v14 |
| react.dev/warnings/react-test-renderer | Official React notice |
| github.com/callstack/react-native-testing-library/discussions/1698 | RNTL v13/v14 roadmap |
| github.com/danfry1/vitest-native | Beta Vitest plugin for RN |
| danfry1.github.io/vitest-native/ | Documentation |
| danfry1.github.io/vitest-native/guide/comparison | Honest comparison with Jest |
| danfry1.github.io/vitest-native/api/coverage | 82/82 stable RN exports |
| danfry1.github.io/vitest-native/guide/jest-compat | jest-compat layer |
| github.com/vitest-dev/vitest/discussions/10160 | Vitest Mobile proposal |
| vitest.dev/blog/vitest-4 | Vitest 4.0 announcement |
| vitest.dev/blog/vitest-4-1.html | Vitest 4.1 |
| github.com/sheremet-va/vitest-react-native | Original plugin (unmaintained) |
| reddit.com/r/expo/comments/1iyzm6k/ | Difficulty integrating RNTL with Vitest |
| reddit.com/r/reactnative/comments/1u7csn5/ | vitest-native announcement |
| qaskills.sh/blog/vitest-vs-jest-2026 | "Probably not yet in 2026" |
| pkgpulse.com/guides/vitest-3-vs-jest-30-2026 | Comparison with benchmarks |
| dev.to/dataformathub/vitest-vs-jest-30... | Vitest 4.0 browser mode |
| tech-insider.org/vitest-vs-jest-2026-2/ | ~20M weekly Vitest, ~30M Jest |
| getautonoma.com/blog/jest-vs-vitest-2026 | "Harder question: is Vitest faster for you" |
| engineering.fb.com/2022/05/11/open-source/jest-openjs-foundation/ | Meta transferring Jest to OpenJS |
| thenewstack.io/jest-metas-javascript-testing-framework-joins-openjs/ | March 2026 recap |
| github.com/oven-sh/bun/issues/123 | Bun RN support unresolved |
| microsoft.github.io/rnx-kit/docs/tools/jest-preset | Microsoft RNX Kit alternative preset |
| docs.expo.dev/develop/unit-testing/ | jest-expo preset |
