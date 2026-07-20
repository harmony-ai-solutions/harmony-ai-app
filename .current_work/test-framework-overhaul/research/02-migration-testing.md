# Research Report 2: DB Migration Testing & Schema Parity Strategy

**Date:** July 20, 2026
**Researcher:** code-expert subagent (session `ses_07f007401ffefdogh493R7J88n`)
**Project context:** HarmonyAIChat — 32 numbered migration files in `src/database/migrations/`, each mirroring a corresponding migration in the Go backend (`harmony-link-private`). Schema parity is enforced only by humans writing `// Mirrors Harmony Link migration XXXX` comments.

---

## 1. Executive Summary

Add two layers of automated schema verification immediately, then adopt a shared DDL source of truth over the next quarter.

**Layer 1 (this week):** A Jest test suite that runs all 32 migrations against an in-memory SQLite database (`better-sqlite3` or `sql.js`), captures the full schema via `sqlite_master`, normalizes it (sort, strip whitespace), and snapshots it. This catches missing tables, columns, indices, or triggers. A second test programmatically builds a DB at each version boundary (migrate to N, snapshot `sqlite_master`, compare to expected) to verify incremental upgrade paths.

**Layer 2 (this week):** A CI job that dumps the Go server's schema (via `sqlite3 .schema` on its test DB or migration output) and compares it to the RN snapshot hash — a cross-language parity gate. Start with a manual diff; iterate to a hashed comparison.

**Long-term (this quarter):** Extract the canonical schema into a shared descriptor — either SQL files vendored via a Git submodule / copy step, or a JSON Schema / Protobuf that generates both the Go migration DDL and the TypeScript migration DDL. Tools like Atlas (schema-as-code, hash-verified deployments) or sqitch (verify scripts per migration) formalize this pattern at the schema level.

## 2. The Parity Problem

### Why this is hard

The app ships **numbered SQL migration files** in TypeScript, each a string constant. The Go backend ships **independently-numbered SQL files** in a separate private repo. The comment `// Mirrors Harmony Link migration 000020` is the only enforcement mechanism. Failure modes include:

| Failure mode | Human detect? | Automated detect? | Severity |
|---|---|---|---|
| Column type mismatch (INTEGER vs BIGINT) | Hard to spot | Schema dump catches it | Data corruption on sync |
| Missing column | Visible at query time | Schema snapshot catches it | Runtime crash |
| Extra column in one side | Silent data loss | Schema diff catches it | Sync desync |
| FK constraint on one side only | Silent | Schema diff catches it | Orphaned rows |
| Index missing on one side | Performance issue | Schema snapshot catches it | Slow queries |
| Migration order mismatch (N vs N+1 swapped) | Nearly impossible | Roll-forward test catches it | Wrong schema applied |
| Renamed table/column | Comment drift | Schema snapshot catches it | Runtime crash |
| Default value difference | Hard to spot | `sqlite_master` SQL text comparison | Inconsistent behavior |

### Why comments aren't enough

- Comments rot. A developer adds a column to the Go migration but forgets to update the RN comment.
- No two developers verify the same "mirrors" annotation.
- CI has no way to reject a PR that says "mirrors 000025" but actually diverges.

## 3. Option-by-Option Analysis

### 3.1 Schema Snapshot Testing with Jest

After running all migrations against a clean in-memory SQLite DB, query `sqlite_master` to get the canonical schema, serialize it, and store as a Jest snapshot.

```typescript
test('all 32 migrations produce the expected schema', () => {
  const db = new Database(':memory:');
  runMigrations(db);
  const schema = normalizeSchema(db);
  db.close();
  expect(schema).toMatchSnapshot();
});
```

**Limitations:** Does not verify data-carrying migrations; snapshot diff noise if SQL formatting changes; does not verify Go parity on its own.

### 3.2 Schema Parity Testing Across Languages

**Approach A: Shared DDL file** — keep a single `schema.sql` in one repo, tracked as a submodule or copied into the other. Simple, boring, effective.

**Approach B: Declarative schema descriptor (Atlas HCL)** — Atlas (7k+ stars, Apache 2.0) defines desired state in HCL and diffs against current DB to generate versioned migrations. First-class SQLite support. CI commands: `migrate lint`, `migrate hash`, `schema inspect`.

**Approach C: Compare live schemas in CI** — build the Go DB, dump schema; build the TS DB, dump schema; diff them. Tools like `sqldiff`, `sqlite-schema-diff`, or `migra`.

### 3.3 Migration Roll-Forward Testing

For each version boundary N → N+1, verify that applying migrations 1..N then N+1 produces the correct incremental schema.

**Fixture-based** (checked-in `.sqlite` files at versions 5, 10, 15, 20, 25, 32) vs **Programmatic** (run migrations 1..N to build a DB at version N). Programmatic is preferred — SQLite on NVMe runs 32 migrations in milliseconds.

### 3.4 Existing Tools — State of Play (2026)

| Tool | Latest | SQLite | Test affordances | Notes |
|---|---|---|---|---|
| **Atlas** | v0.30+ | ✅ Full | `migrate lint`, `migrate hash`, `schema inspect` | Best-in-class for CI schema verification. |
| **Sqitch** | v1.5+ | ✅ Full | Built-in `verify/` scripts per change | Mature, Perl-based (heavy dep). |
| **Liquibase** | v4.30+ | ✅ | Diff changelog, rollback validation | Java-based, heavy for RN CI. |
| **Flyway** | v11+ | ✅ | Schema history, drift detection, `check` command | Owned by Redgate. `flyway check -changes` detects drift. |
| **Prisma Migrate** | v6/v7 | ✅ (partially) | Shadow DB for dev. No built-in test runner. | Prisma Next (2026) has TypeScript migrations. |
| **Drizzle Kit** | v1.0 | ✅ Full | `push`, `generate`, `migrate`, `check`, `up`, `export` | No built-in snapshot testing but pairs well with Jest. |
| **Knex** | v3 | ✅ | `migrate:latest` and `migrate:rollback` in tests | Simple, widely used. |
| **golang-migrate** | v4.18+ | ✅ via `sqlite3` driver | No built-in testing | Likely what the Go side uses. |
| **Goose** | v3.24+ | ✅ via `goose sqlite3` | No built-in testing | Go alternative. Supports `go:embed`. |
| **Bytebase** | v3+ | ❌ No SQLite | Drift detection, GitOps workflow | Server-side only. |

### 3.5 Schema Diffing Tools

| Tool | SQLite | CI fit | Use case |
|---|---|---|---|
| **sqldiff** (part of SQLite) | ✅ Native | ✅ Shell | Diff two `.db` files. |
| **sqlite-schema-diff** (npm) | ✅ | ✅ Node.js | Structured diff output. |
| **ATLAS `schema diff`** | ✅ | ✅ CLI | Can fail CI on divergence. |

### 3.6 Shared Source of Truth Pattern

Mature projects often vendored SQL files, schema defined in a neutral format (protobuf, HCL), or dual-generation from one ORM. **For HarmonyAIChat:** Vendored SQL files is the simplest, most transparent pattern.

## 4. Recommended Architecture

### Phase A — Immediate (this week)

- **A1. Migration Snapshot Test** — run migrations, snapshot `sqlite_master` (sorted, normalized).
- **A2. Incremental Upgrade Test** — verify every version boundary produces correct schema.
- **A3. Schema Dump Utility** — `src/database/dump-schema.ts`.
- **A4. Go-Side Schema Dump** — `harmony-link-private/cmd/dump-schema`.
- **A5. CI Parity Gate** — diff Go dump vs RN dump in CI.

### Phase B — Next month (schema contract)

- **B1. Extract Canonical Schema** — commit a `schema/schema.sql` to both repos; CI checks migrations produce it.
- **B2. Bilateral Parity Check** — same check on both sides.

### Phase C — Long term (this quarter)

- **C1. Shared Schema Package** — `@harmony-ai/schema` vendored in both repos.
- **C2. Atlas integration** — `migrate lint`, `migrate hash`.
- **C3. Idempotency tests** — running migrations twice produces same schema.
- **C4. Rollback tests** — `down` migrations produce previous version's schema.

## 5. Short-Term vs Long-Term Phasing

| Item | Effort | Timeline |
|---|---|---|
| A1: Snapshot test | 1-2 days | Week 1 |
| A2: Incremental upgrade test | 1 day | Week 1 |
| A3: Schema dump utility | 0.5 day | Week 1 |
| A4: Go-side schema dump | 1 day | Week 1 |
| A5: CI parity gate | 1 day | Week 2 |
| B1: Canonical schema extraction | 2-3 days | Week 3-4 |
| B2: Bilateral parity check | 1 day | Week 4 |
| C1: Shared schema package | 1-2 weeks | Month 2+ |
| C2: Atlas integration | 2-3 weeks | Month 2-3 |
| C3: Idempotency tests | 1 day | Month 2 |
| C4: Rollback tests | 2 days | Month 2 |

## 6. Open Risks / Things to Validate

1. Can `better-sqlite3` compile in the RN project's Node.js test environment?
2. Does the Go side use a different SQLite dialect? (FTS5, JSON1, compile-time options)
3. What about `PRAGMA` settings? Both sides must set identical pragmas.
4. Migration 000032 might not be the latest by read time — discover dynamically.
5. Do migrations include data changes (seed data)? Snapshot must capture data too.
6. Does the Go side run migrations in a transaction?
7. Submodule friction — consider a GitHub Actions step that fetches a single file from the other repo instead.
8. Atlas maturity for SQLite — run a spike.

## 7. Sources

| URL | One-line summary |
|---|---|
| stackoverflow.com: How to run expo-sqlite tests in Jest? | Adapter pattern: mock expo-sqlite with better-sqlite3. |
| blog.codemagic.io: How to test SQLite for React Native apps using Jest | node-sqlite3 in RN Jest tests with in-memory databases. |
| amarjanica.com: Bridging the Gap between Expo SQLite and Node.js | Complete setup for expo-sqlite migrations, adapter pattern. |
| jonathanclark.com: SQLite Performance & Scaling | JSON schema-driven SQLite migrations with SHA-256 hash-based change detection. |
| oracle.com: SQLite Schema Table | Official SQLite docs on `sqlite_master`. |
| atlasgo.io: Working with golang-migrate | Atlas generates auto-diffed versioned migrations. |
| atlasgo.io: SQLite Guide | Atlas's first-class SQLite support. |
| sqitch.org: SQLite Tutorial | Sqitch's verify scripts per change. |
| prisma.io/blog: TypeScript Migrations in Prisma Next (Apr 2026) | State-of-the-art 2026 migration UX. |
| prisma.io/blog: Rethinking Database Migrations (Mar 2026) | Design philosophy behind verified, idempotent migrations. |
| dbvis.com: Top Database CI/CD and Schema Change Tools in 2026 | Comparison of Liquibase, Flyway, Atlas, Bytebase, Prisma. |
| bytebase.com: What is Database Schema Drift? | Drift detection via dump-and-diff. |
| sqlc.dev | Go SQL code generation — `sqlc verify`. |
| gist.github: Testing TypeORM with Jest and SQLite | Knex + Jest + in-memory SQLite migration testing. |
| dev.to: Integration Testing with Jest, Knex and SQLite | Practical walkthrough. |
| drizzle.team: Migrations | Drizzle Kit's codebase-first migration workflow. |
| schemachange on GitHub | Lightweight Python migration tool (pattern illustration). |
| reddit.com: GoLang Migrations Best Practices | goose, golang-migrate, atlas, sql-migrate. |
| reddit.com: Which DB migration tool? | Comparison of Go migration tools. |
