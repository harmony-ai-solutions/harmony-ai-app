#!/usr/bin/env python3
"""
Schema parity comparison script.

Compares two normalized JSON schema dumps (RN vs Go) and reports
divergences. Divergences on the allowlist (scripts/parity-allowlist.json,
sibling of this script) are *sanctioned* intentional differences and are
reported as `[allowlisted]`; anything NOT on the allowlist is real drift and
fails the gate.

Gate semantics (exit 0 IFF both conditions hold):
  1. (actual divergence set − allowlist set) is EMPTY  — no un-allowlisted drift
  2. every allowlist entry still matches an ACTUAL divergence — no stale
     allowlist entries (a stale entry means a drift was reconciled but the
     allowlist was not cleaned up, which is itself a failure).

Allowlist policy (see scripts/parity-allowlist.json): entries may only be
REMOVED (as a drift is reconciled), never ADDED, without a senior-dev ruling.
The 4-2 additions are pre-sanctioned by the engine contract §9-A14.

Usage:
    python scripts/compare-schemas.py <rn-path> <go-path>

Input format (both files):
    [
      {"type": "table|index|trigger|view", "name": "...", "sql": "..."},
      ...
    ]

Exit codes:
    0 — divergence set ⊆ allowlist AND every allowlist entry matches a real divergence
    1 — un-allowlisted divergence(s) found OR stale allowlist entry/entries found
    2 — usage error / allowlist file missing / malformed allowlist
"""

import json
import os
import sys

ALLOWLIST_FILENAME = 'parity-allowlist.json'


def load_schema(path: str) -> dict:
    """Load a schema JSON file and index by '{type}:{name}'."""
    # utf-8-sig tolerates a UTF-8 BOM (PowerShell `>`/Set-Content hazard) while
    # still handling plain UTF-8. This keeps the comparator robust regardless of
    # how a dump/allowlist file was produced.
    with open(path, encoding='utf-8-sig') as f:
        entries = json.load(f)
    indexed = {}
    for e in entries:
        key = f"{e['type']}:{e['name']}"
        indexed[key] = {'sql': e['sql'], 'type': e['type'], 'name': e['name']}
    return indexed


def load_allowlist(script_dir: str) -> tuple:
    """Load the parity allowlist from the script's own directory.

    Returns (entries_by_key, version). Raises on missing/malformed file.
    """
    path = os.path.join(script_dir, ALLOWLIST_FILENAME)
    if not os.path.exists(path):
        raise FileNotFoundError(
            f"Allowlist not found: {path}. It must be rebuilt alongside this "
            f"script ({ALLOWLIST_FILENAME})."
        )
    with open(path, encoding='utf-8-sig') as f:
        data = json.load(f)
    if not isinstance(data, dict) or 'entries' not in data:
        raise ValueError(f"Allowlist {path} is malformed: expected {{'version', 'entries': [...]}}")
    entries = {}
    for e in data['entries']:
        if 'key' not in e or 'kind' not in e:
            raise ValueError(f"Allowlist entry missing 'key' or 'kind': {e}")
        entries[e['key']] = e
    return entries, data.get('version')


def divergence_kind(key: str, rn_only, go_only, different_sql) -> str | None:
    """Return the actual divergence category for a key, or None if not diverging."""
    if key in rn_only:
        return 'rn-only'
    if key in go_only:
        return 'go-only'
    if key in different_sql:
        return 'different-sql'
    return None


def describe_section(title, keys, sql_lookup, allowlist) -> None:
    """Print one divergence section, annotating allowlisted entries.

    sql_lookup is the schema dict to pull the SQL text from for this category
    (rn for RN-only, go for Go-only).
    """
    if not keys:
        return
    print(f"\n{title} ({len(keys)}):")
    for k in sorted(keys):
        entry = allowlist.get(k)
        if entry is not None:
            reason = entry.get('reason', '')
            print(f"  + {k}  [allowlisted]  ({entry.get('kind', '?')})")
            if reason:
                print(f"        reason: {reason}")
        else:
            print(f"  + {k}")
        print(f"    SQL: {sql_lookup[k]['sql']}")


def compare(rn_path: str, go_path: str, allowlist: dict, allowlist_version) -> int:
    rn = load_schema(rn_path)
    go = load_schema(go_path)

    rn_keys = set(rn)
    go_keys = set(go)
    common = rn_keys & go_keys

    rn_only = rn_keys - go_keys
    go_only = go_keys - rn_keys
    different_sql = {k for k in common if rn[k]['sql'] != go[k]['sql']}

    allowed_keys = set(allowlist.keys())
    all_divergences = rn_only | go_only | different_sql

    unallowed = all_divergences - allowed_keys
    stale = allowed_keys - all_divergences
    kind_mismatches = []
    for k in allowed_keys & all_divergences:
        actual = divergence_kind(k, rn_only, go_only, different_sql)
        if actual is not None and actual != allowlist[k].get('kind'):
            kind_mismatches.append((k, allowlist[k].get('kind'), actual))

    exit_code = 0
    if unallowed:
        exit_code = 1
    if stale:
        exit_code = 1

    # --- RN-only ---
    describe_section(f"RN-only entries", rn_only, rn, allowlist)
    # --- Go-only ---
    describe_section(f"Go-only entries", go_only, go, allowlist)
    # --- Different SQL ---
    if different_sql:
        print(f"\nEntries with different SQL ({len(different_sql)}):")
        for k in sorted(different_sql):
            rn_sql = rn[k]['sql']
            go_sql = go[k]['sql']
            entry = allowlist.get(k)
            tag = f"  [allowlisted]  ({entry.get('kind', '?')})" if entry is not None else ""
            print(f"\n  === {k} ==={tag}")
            print(f"  RN: {rn_sql}")
            print(f"  Go: {go_sql}")
            if entry is not None:
                print(f"  reason: {entry.get('reason', '')}")
            if len(rn_sql) < 400 and len(go_sql) < 400:
                for i, (rc, gc) in enumerate(zip(rn_sql, go_sql)):
                    if rc != gc:
                        print(f"       First diff at position {i}: RN={repr(rc)} Go={repr(gc)}")
                        break
                if len(rn_sql) != len(go_sql):
                    print(f"       Length mismatch: RN={len(rn_sql)} Go={len(go_sql)}")

    matching = len(common) - len(different_sql)
    allowlisted_total = len([k for k in all_divergences if k in allowed_keys])
    print(f"\nSummary:")
    print(f"  Total RN entries: {len(rn)}")
    print(f"  Total Go entries: {len(go)}")
    print(f"  Matching:         {matching}")
    print(f"  RN-only:          {len(rn_only)}  (allowlisted: {len([k for k in rn_only if k in allowed_keys])})")
    print(f"  Go-only:          {len(go_only)}  (allowlisted: {len([k for k in go_only if k in allowed_keys])})")
    print(f"  Different SQL:    {len(different_sql)}  (allowlisted: {len([k for k in different_sql if k in allowed_keys])})")
    print(f"  Allowlisted total: {allowlisted_total} / {len(allowed_keys)} entries (allowlist v{allowlist_version})")
    print(f"  Un-allowlisted divergences: {len(unallowed)}")
    print(f"  Stale allowlist entries:    {len(stale)}")

    if kind_mismatches:
        print(f"\nWARNING — allowlist kind mismatch(es) (informational, not a hard failure):")
        for k, declared, actual in kind_mismatches:
            print(f"  {k}: allowlist kind='{declared}' but actual category='{actual}'")

    if exit_code == 0:
        print(f"\n✓ Schema parity OK — every divergence is allowlisted"
              f" ({allowlisted_total} entries) and no allowlist entry is stale.")
    else:
        if unallowed:
            print(f"\n✗ Schema drift detected — {len(unallowed)} UNALLOWLISTED divergence(s):")
            for k in sorted(unallowed):
                print(f"    - {k}")
                print(f"      allow:  add to scripts/parity-allowlist.json ONLY with a senior-dev ruling")
                print(f"      fix:    reconcile the divergence (preferred)")
        if stale:
            print(f"\n✗ Stale allowlist entry/entries — {len(stale)} entry(ies) no longer"
                  f" correspond to a real divergence (reconciled or removed):")
            for k in sorted(stale):
                print(f"    - {k}  (delete from scripts/parity-allowlist.json)")

    return exit_code


def main():
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <rn-schema.json> <go-schema.json>", file=sys.stderr)
        sys.exit(2)

    script_dir = os.path.dirname(os.path.abspath(__file__))
    try:
        allowlist, version = load_allowlist(script_dir)
    except (FileNotFoundError, ValueError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(2)

    sys.exit(compare(sys.argv[1], sys.argv[2], allowlist, version))


if __name__ == "__main__":
    main()
