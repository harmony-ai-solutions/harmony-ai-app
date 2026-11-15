# Phase 2-1 — Tier-1 model catalog + capability tags

**Repo:** `harmony-link-private` · **Objective:** curated offline model metadata and
the chat/decision capability tag convention.

## Steps

1. `tools/gen-model-catalog` (see `providers/cataloggen/`) — add a Tier-1 curated
   `opencodego` provider section, then regenerate `providers/catalog_data.json`
   (release-time generation, `go:embed` — no runtime fetch; see `providers/catalog.go`
   header for the pipeline).
2. Model entries — ids verified from the Go endpoint table
   (opencode.ai/docs/console/go, 2026-11-15). Chat-completions ids:
   `glm-5.3-flash`, `glm-5.3`, `glm-5.2`, `kimi-k3.1-pro`, `kimi-k3`,
   `kimi-k2.7-code`, `longcat-2.0`, `deepseek-v4.1-flash`, `deepseek-v4-pro`,
   `mimo-v2.6-flash`, `mimo-v2.6-pro`, `mimo-v2.5`, `mimo-v2.5-pro`,
   `minimax-m3.1-flash`, `minimax-m3`, `muse-spark-1.3-contributor`,
   `muse-spark-1.2-contributor`, `qwen3.8-max`, `qwen3.8-flash`, `qwen3.7-plus`,
   `hy4`, `hy4-preview`, `hy3`, `step-5-preview`, `beam-free`,
   `iceman-contributor-free`, `longcat-2.5-free`, `grok-4.7`, `gpt-6-luna`,
   `gpt-5.6-luna`, `claude-haiku-5-5`, `gemini-4-argon`
   (Console translates dialects — ALL of these work over chat/completions).
   Per entry: `label`, `context`, `output_limit`, `param_support`, `modalities`,
   `status`.
3. **Capability tags (the decision-model preparation):** every entry carries
   `capabilities: ["chat"]`. Convention going forward: a future `jev-1.13` entry
   carries `capabilities: ["decision"]` (spec: 4-1). Module model slots filter on the
   tag; the implicit default filter is `chat`. No catalog schema change — uses the
   existing `CatalogModel.Capabilities` field.
4. **Privacy labeling:** entries for `muse-spark-1.3-contributor`,
   `muse-spark-1.2-contributor`, `iceman-contributor-free` get a label suffix or
   meta note "trains on your data"; `deepseek-v4.1-flash`, `deepseek-v4-pro`,
   `longcat-2.5-free` note "requires Global region in workspace privacy settings".
   (App picker surfaces labels; exact mechanism = whatever `CatalogModel.Label`/
   `Meta` already renders.)
5. Catalog `wire` mapping for `opencodego` = copy of the `openai` table (or alias it,
   per how `cataloggen` expresses shared tables).

## Acceptance

- `catalog_test.go` — opencodego section parses, every model tagged `chat`, wire table
  resolves temperature/top_p/max_tokens identically to openai.
- Offline engine (no network) still lists models with full metadata via Tier-1 merge.

## Checklist

- [ ] cataloggen Tier-1 source entries (32 models)
- [ ] `capabilities: ["chat"]` on all entries (+ convention doc note in catalog.go)
- [ ] Privacy/region labels on the flagged models
- [ ] Wire mapping = openai table
- [ ] Regenerated `catalog_data.json` + catalog tests green
