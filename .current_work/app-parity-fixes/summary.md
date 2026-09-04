# App ↔ Engine Parity Wave (persona handling)

Date: 2026-09-04 (post engine/FE session on `feat/engine-track-phase2`)
Branch: `senju-design-updates-rebase` — nothing pushed.

## Trigger

Read-only parity review (ui-ux-expert) of the app vs engine + engine FE after the
engine-side persona-card waves (`be1fa62`, `1cedcc3`, `28847da`) and the
id/alias-hardening session (`eb1124e`, `08ccdf4`, `783105f`, `7a81fe1`, `ed517ea`).
Review verdict: 11 capability groups already at parity (alignment wave intact);
gaps concentrated in ghost-id handling, conflict messaging, AI-create semantics,
and one affordance.

## Decisions (user)

- **Batch C ruling:** "Create AI from existing card" becomes a **LIVE LINK**
  (shared character profile) like the engine — the app's fork behavior for that
  entry point is retired. V3 field-fidelity fix became moot (no fork path left).
- Batches A, B, C, D all approved.

## Batches → commits

| Batch | Scope | Commit |
|---|---|---|
| A | Ghost-aware id probe/resolution + persona-create compensation (`entityIdExists`, `resolveNextEntityIdCopy`, CharacterChatService wiring) | `4622210` |
| — | `duplicateAIPartner` repository helper (engine `ed517ea` parity) | `1b3d359` |
| D.1 | Persona-owner EXISTS subqueries filter deleted owners | `df1f6bf` |
| A-fix | `resolveNextEntityIdCopy` verbatim-first ordering (engine `ResolveEntityID` parity; found auditing agent-1 against real engine reference after its "reference not found" deviation) | `d1006e0` |
| C | Live-link rewiring + fork retirement + shared-card hint | `f39de6c` |
| B | `personaAliasConflict` wiring, ghost-aware create id + sharpened UNIQUE catch, ChatList chat-open alert | `5023e78` |
| C/D.2 | One-click Duplicate AI + shared-card/persona-owned hints | `54e903a` |

## Gates (final tree, verified twice — agent + orchestrator)

- `tsc --noEmit` → 0
- unit: 125 suites / **1108 tests** pass
- integration: 11 suites / 52 pass + 1 known skip
- Known flakes (`compat/nodeSide.test.ts`, `nodeDatabase.smoke`) proven isolated-green.

## Notes / carry-overs

- Engine reference repos are **local-only** (`feat/engine-track-phase2` never
  pushed). Subagents must read them at their absolute paths, never via origin.
- `resolveNextEntityIdCopy` emits `"<base> <N>"` (space, RN naming) where the
  engine emits `base-N` (dash) — intentional per-surface convention; ids and
  aliases may diverge by design (engine parity).
- `duplicateAIPartner` falls back to `source.id` as alias base when the source
  alias is empty (engine leaves it empty) — accepted minor deviation for RN
  display.
- Open question (deferred): space-containing persona entity ids round-tripping
  engine sync — verify before ever normalizing id charsets.
- Deferred ledger unchanged: `sweepLegacyEntityPrefs` / `LEGACY_REPLY_MODE_PREFIX`
  cleanup (2026-09-07-week).
