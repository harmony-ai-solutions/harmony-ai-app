#!/usr/bin/env python3
"""
Schema parity comparison script.

Compares two normalized JSON schema dumps (RN vs Go) and reports
divergences. Exits 0 if schemas match, 1 if any divergence is found.

Usage:
    python scripts/compare-schemas.py <rn-path> <go-path>

Input format (both files):
    [
      {"type": "table|index|trigger|view", "name": "...", "sql": "..."},
      ...
    ]

Exit codes:
    0 — schemas are identical
    1 — at least one divergence found
"""

import json
import sys


def load_schema(path: str) -> dict:
    """Load a schema JSON file and index by '{type}:{name}'."""
    with open(path) as f:
        entries = json.load(f)
    indexed = {}
    for e in entries:
        key = f"{e['type']}:{e['name']}"
        indexed[key] = e['sql']
    return indexed


def compare(rn_path: str, go_path: str) -> int:
    rn = load_schema(rn_path)
    go = load_schema(go_path)

    rn_keys = set(rn)
    go_keys = set(go)
    common = rn_keys & go_keys

    rn_only = rn_keys - go_keys
    go_only = go_keys - rn_keys
    different_sql = {k for k in common if rn[k] != go[k]}

    exit_code = 0

    if rn_only:
        exit_code = 1
        print(f"\nRN-only entries ({len(rn_only)}):")
        for k in sorted(rn_only):
            print(f"  + {k}")
            print(f"    SQL: {rn[k]}")

    if go_only:
        exit_code = 1
        print(f"\nGo-only entries ({len(go_only)}):")
        for k in sorted(go_only):
            print(f"  + {k}")
            print(f"    SQL: {go[k]}")

    if different_sql:
        exit_code = 1
        print(f"\nEntries with different SQL ({len(different_sql)}):")
        for k in sorted(different_sql):
            rn_sql = rn[k]
            go_sql = go[k]
            print(f"\n  === {k} ===")
            print(f"  RN: {rn_sql}")
            print(f"  Go: {go_sql}")
            # Highlight the actual diff character by character
            if len(rn_sql) < 200 and len(go_sql) < 200:
                for i, (rc, gc) in enumerate(zip(rn_sql, go_sql)):
                    if rc != gc:
                        print(f"       First diff at position {i}: RN={repr(rc)} Go={repr(gc)}")
                        break
                if len(rn_sql) != len(go_sql):
                    print(f"       Length mismatch: RN={len(rn_sql)} Go={len(go_sql)}")

    matching = len(common) - len(different_sql)
    print(f"\nSummary:")
    print(f"  Total RN entries: {len(rn)}")
    print(f"  Total Go entries: {len(go)}")
    print(f"  Matching:         {matching}")
    print(f"  RN-only:          {len(rn_only)}")
    print(f"  Go-only:          {len(go_only)}")
    print(f"  Different SQL:    {len(different_sql)}")

    if exit_code == 0:
        print(f"\n✓ Schema parity confirmed ({matching} entries match)")
    else:
        print(f"\n✗ Schema drift detected")

    return exit_code


def main():
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <rn-schema.json> <go-schema.json>", file=sys.stderr)
        sys.exit(2)

    sys.exit(compare(sys.argv[1], sys.argv[2]))


if __name__ == "__main__":
    main()
