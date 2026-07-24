# Phase 5-3: Schema Parity CI Gate

## Objective

Wire the RN and Go schema dumps together in CI so that any future drift is caught automatically. A PR that changes the schema on either side without the other side matching will fail CI.

## Context

After Phase 5-1 and 5-2, both repos can produce a normalized JSON schema dump. The next step is automation: in CI, dump both schemas, compare them, fail on diff. This is the "schema contract" between the two repos — replacing the current trust-the-comments system.

## Prerequisites

- Phase 5-1 complete (RN dump command exists, baseline `schema/rn-schema.json` committed).
- Phase 5-2 complete (Go dump command exists in `harmony-link-private`, baseline committed there).

## Implementation Steps

### 1. Decide on the diffing location

Two reasonable options:

**Option A: RN repo's CI fetches the Go repo and runs its dump**

```yaml
# .github/workflows/schema-parity.yml (in harmony-ai-app)
jobs:
  parity:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # Checkout the Go repo (requires GitHub token with read access)
      - uses: actions/checkout@v4
        with:
          repository: harmony-ai-solutions/harmony-link-private
          token: ${{ secrets.GITHUB_TOKEN }}  # or a PAT
          path: harmony-link
      - uses: actions/setup-go@v5
        with:
          go-version: '1.22'
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm
      - run: npm ci
      # Dump both schemas
      - run: npm run schema:dump -- --output rn-schema.json
      - run: cd harmony-link && go run ./cmd/dump-schema > ../go-schema.json
      # Diff
      - run: diff rn-schema.json go-schema.json
```

**Option B: Both repos commit their dumps; CI in each repo fetches the other's dump file**

```yaml
# .github/workflows/schema-parity.yml (in harmony-ai-app)
jobs:
  parity:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run schema:dump -- --output rn-schema.current.json
      # Fetch the Go repo's committed dump
      - run: |
          curl -fsSL -H "Authorization: token ${{ secrets.GITHUB_TOKEN }}" \
            https://raw.githubusercontent.com/harmony-ai-solutions/harmony-link-private/main/schema/go-schema.json \
            -o go-schema.json
      - run: diff rn-schema.current.json go-schema.json
```

**Recommendation**: Option A is more rigorous (re-runs the Go dump fresh, so it catches drift even if the committed Go dump is stale). Option B is simpler but trusts that the committed Go dump is current. Pick based on whether the Go team will reliably regenerate their dump on every PR.

### 2. Handle the comparison logic

Plain `diff` works but its output for JSON files can be noisy. A more readable comparison:

```python
#!/usr/bin/env python3
# scripts/compare-schemas.py
import json
import sys

rn_path, go_path = sys.argv[1], sys.argv[2]
with open(rn_path) as f: rn = json.load(f)
with open(go_path) as f: go = json.load(f)

rn_by_name = {f"{e['type']}:{e['name']}": e['sql'] for e in rn}
go_by_name = {f"{e['type']}:{e['name']}": e['sql'] for e in go}

rn_only = set(rn_by_name) - set(go_by_name)
go_only = set(go_by_name) - set(rn_by_name)
both = set(rn_by_name) & set(go_by_name)
different = {k for k in both if rn_by_name[k] != go_by_name[k]}

if rn_only or go_only or different:
    print("❌ Schema drift detected")
    if rn_only:
        print(f"\nRN-only entries ({len(rn_only)}):")
        for k in sorted(rn_only): print(f"  + {k}")
    if go_only:
        print(f"\nGo-only entries ({len(go_only)}):")
        for k in sorted(go_only): print(f"  + {k}")
    if different:
        print(f"\nEntries with different SQL ({len(different)}):")
        for k in sorted(different):
            print(f"  ~ {k}")
            print(f"      RN: {rn_by_name[k]}")
            print(f"      GO: {go_by_name[k]}")
    sys.exit(1)
else:
    print(f"✅ Schema parity confirmed ({len(both)} entries match)")
```

Or as a Node script if Python isn't preferred. Either way, the output should make drift obvious at a glance.

### 3. Add the workflow file

Create `.github/workflows/schema-parity.yml` in `harmony-ai-app`:

```yaml
name: Schema Parity

on:
  pull_request:
    paths:
      - 'src/database/migrations/**'
      - 'schema/**'
      - 'scripts/dump-schema.ts'
      - '.github/workflows/schema-parity.yml'
  workflow_dispatch:

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  parity:
    name: RN ↔ Harmony Link schema parity
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: Checkout RN app
        uses: actions/checkout@v4

      - name: Checkout Harmony Link (Go)
        uses: actions/checkout@v4
        with:
          repository: harmony-ai-solutions/harmony-link-private
          token: ${{ secrets.HARMONY_LINK_REPO_PAT }}
          path: harmony-link
          ref: main  # or match the branch the RN app currently targets

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm

      - name: Setup Go
        uses: actions/setup-go@v5
        with:
          go-version: '1.22'

      - name: Install RN dependencies
        run: npm ci

      - name: Install Go dependencies
        working-directory: harmony-link
        run: go mod download

      - name: Dump RN schema
        run: npm run schema:dump -- --output rn-schema.current.json

      - name: Dump Go schema
        working-directory: harmony-link
        run: go run ./cmd/dump-schema > ../go-schema.current.json

      - name: Compare schemas
        run: python3 scripts/compare-schemas.py rn-schema.current.json go-schema.current.json

      - name: Upload schemas on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: schema-diff
          path: |
            rn-schema.current.json
            go-schema.current.json
```

### 4. Add the required secret

The workflow needs `HARMONY_LINK_REPO_PAT` — a Personal Access Token (or GitHub App token) with read access to `harmony-link-private`. Create this in the repo's Settings → Secrets and Variables → Actions.

For tighter security, prefer a GitHub App over a PAT. Document the required scopes (`contents: read` on the private repo).

### 5. Add a commit-time check (optional)

If the team wants the parity gate to also fire when the Go repo changes (not just when the RN repo changes), add a `repository_dispatch` trigger or a Slack-integration webhook. This is more complex; defer unless needed.

A simpler approach: require the Go team to add a similar workflow to their repo that fetches the RN schema. Cross-validation on both sides.

### 6. Document the workflow

Update the repo's README or `docs/` to explain:

- What the parity gate checks
- How to interpret failures
- How to update the committed baseline schema dump if a change is intentional

Add a comment block to the workflow file:

```yaml
# This workflow compares the schema produced by the RN migrations against the
# schema produced by the Harmony Link Go migrations. They must match exactly
# because the two databases exchange data via bidirectional sync.
#
# To update the baseline when intentionally changing the schema:
#   1. Update migrations in BOTH repos
#   2. Regenerate: npm run schema:dump -- --output schema/rn-schema.json
#   3. Commit the updated baseline alongside the migration change
#   4. Coordinate with the Go team to update their baseline too
```

## Files to Create

- `.github/workflows/schema-parity.yml`
- `scripts/compare-schemas.py` (or `.js` if preferred)

## Files to Modify

- `schema/rn-schema.json` — regenerated when migrations change

## Validation

- [ ] Workflow runs to completion on a no-op PR
- [ ] Deliberate schema change in RN migrations causes the workflow to fail with a clear diff
- [ ] After updating both sides, workflow passes again
- [ ] Secret `HARMONY_LINK_REPO_PAT` configured with the minimal required scope
- [ ] README documents how to interpret failures and update baselines

## Open Questions to Resolve During Implementation

- **Is `harmony-link-private` on GitHub Enterprise, public GitHub, or self-hosted?** Affects how the checkout action authenticates.
- **Should the parity check pin to a specific Go repo ref, or always use `main`?** Pinning (e.g., to a release tag) is safer for release branches; `main` is fine for development.
- **What if the dump command isn't kept current on the Go side?** Since the same developer owns both repos, the risk is lower than in a multi-team setup — but a CI gate on the Go side (mirroring this one) would catch staleness. Add it to the Phase 8-2 backlog if it becomes an issue.
- **Should the gate also run on pushes to release tags (e.g., before a `v*` build)?** Yes — add `on.push.tags: ['v*']` so releases can't ship without parity. This connects to Phase 7-2.

## Estimated Effort

One day to wire up the workflow. Minimal coordination overhead — same developer owns both repos, so creating the PAT and confirming the dump command is stable is a self-service task.
