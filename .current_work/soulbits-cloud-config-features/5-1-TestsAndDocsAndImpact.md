# Phase 5-1: Tests + Impact Analysis + Docs/Changelog/Memory-Bank

## Objective

Close out the work: add unit tests for the pure logic (parser, mapper, model
mapping), run GitNexus impact analysis and `detect_changes` before commit, and
update user-facing documentation, the changelog, and the memory bank.

## Testing strategy

Reference: `.planning/codebase/TESTING.md` and [`docs/TESTING.md`](../../docs/TESTING.md).
The DB-suite worker-isolation note (`--maxWorkers=16` for unit suites) applies —
run `npm run test:unit`.

### Unit tests to add (pure logic, no DB/RN)

- `src/utils/charactercard/__tests__/jsonParser.test.ts`
  - V2 card parses; V3 parses; V1 coerced to V2; bad JSON throws typed error.
- `src/utils/charactercard/__tests__/pngParser.test.ts`
  - A tiny synthetic PNG with a `tEXt`/`chara` base64 chunk extracts correctly;
    non-card PNG throws; truncated PNG throws.
- `src/utils/charactercard/__tests__/mapper.test.ts`
  - Asserts `base_prompt = system_prompt`, formatted `backstory`
    ("CHARACTER LORE:"), formatted `example_dialogues`, defaults
    (`typing_speed_wpm=60`, `audio_response_chance_percent=50`), and name-required throw.
- `src/constants/__tests__/soulbitsModels.test.ts`
  - Each module type maps to the expected `ModelsQuery`; fallback arrays present.
- `src/services/cloud/__tests__/soulbitsModelsCatalog.test.ts` (mock the client)
  - Live success → `source: 'live'` + cache hit on second call within TTL;
    client throw → `source: 'fallback'` returns static list.

### Build/manual verification (deferred to user per workspace rules)

- Do **not** build the project during implementation. The user runs the build +
  on-device verification after the task.
- Manual flows to verify after build:
  - Soulbits Cloud endpoint prefill (beta/prod/self-hosted matrix from 2-1).
  - Model dropdown loads live catalog for each module type; offline fallback;
    custom override persists.
  - `FormField` select dropdown works for existing select fields.

## GitNexus (mandatory per AGENTS.md)

- Run `gitnexus_impact({ target, direction: 'upstream' })` for each touched
  symbol before editing (call out in each phase). Symbols of note:
  `FormField`, `handleProviderSwitch`, `loadConfig`, `renderInlineProviderFields`,
  `CharactersScreen`.
- If the index is stale, run `npx gitnexus analyze` first.
- Before commit: run `gitnexus_detect_changes()` and confirm only the expected
  files/flows are affected.

## Documentation updates

- [`docs/CLOUD-CONNECTION.md`](../../docs/CLOUD-CONNECTION.md) — note the
  cloud-aware endpoint prefill + live model catalog.
- [`README.md`](../../README.md) — add "Import character cards (PNG/JSON)" to
  capabilities if a features list exists.
- [`CHANGELOG.md`](../../CHANGELOG.md) — user-facing entries (no internal symbol
  names):
  - Soulbits Cloud: auto-fill the inference endpoint (beta URL in beta builds)
    when connected.
  - Soulbits Cloud: model picker pre-filtered by module type (live catalog).
  - Characters: import Tavern Cards from PNG or JSON.

## Memory bank update (per workspace-rules)

- Update `memory-bank/activeContext.toon` (primary `.toon` first, then `.md`) and
  `memory-bank/progress.toon` with a dated entry summarizing the three features,
  key files, and the parser/mapper port provenance (from harmony-link-private).
- Note the new `src/utils/charactercard/` package, the
  `src/services/cloud/soulbitsModelsCatalog.ts` service, and the
  `src/constants/soulbitsModels.ts` mapping.

## Progress checklist

- [ ] Unit tests added (parser, mapper, mapping, catalog) — `npm run test:unit` green
- [ ] GitNexus impact run for each touched symbol (no unacknowledged HIGH/CRITICAL)
- [ ] `gitnexus_detect_changes()` run pre-commit; scope as expected
- [ ] CHANGELOG / README / docs updated (user-facing wording)
- [ ] Memory bank (`.toon` then `.md`) + changelog of touched repos updated
