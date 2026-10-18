# models.dev — schema + license addendum (pre-task R-MD for 5-2)

Research date: 2026-10-18 (all fetches live same day). Feeds
`5-2-CapabilityCatalogAndGatedEmission.md` step 1. Docs-only; no code changed.

Snapshot pinned for this analysis: `https://models.dev/api.json`
- 5,803,041 bytes · 232 providers · 9,048 model entries
- `ETag: "972fcd439f52094c1579e5c8c51f6308"` · `Cache-Control: public, max-age=0, must-revalidate` (Cloudflare-fronted)
- Newest `release_date` in snapshot: 2026-10-17 (data is ≈1 day fresh)

---

## 1. Summary + license verdict

**License verdict: MIT — CORROBORATED.** ✅

- The real source repository is **`github.com/anomalyco/models.dev`**
  (default branch `dev`). The site header still links
  `github.com/sst/models.dev`, which GitHub **redirects** to
  `anomalyco/models.dev` — SST (sst.dev) is the original maintainer org,
  now under the Anomaly org; README: *"Models.dev is created by the
  maintainers of SST"* and *"We also use it internally in opencode"*.
  The guess `sanjay0sk/models-dev` is wrong; discard it.
- The repo **root `LICENSE`** (fetched from
  `raw.githubusercontent.com/anomalyco/models.dev/dev/LICENSE`) reads:

  > MIT License
  >
  > Copyright (c) 2025 models.dev
  >
  > Permission is hereby granted, free of charge, to any person obtaining a copy
  > of this software and associated documentation files (the "Software"), to deal
  > in the Software without restriction, including without limitation the rights
  > to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  > copies of the Software, and to permit persons to whom the Software is
  > furnished to do so, subject to the following conditions:
  >
  > The above copyright notice and this permission notice shall be included in all
  > copies or substantial portions of the Software.

  followed by the standard MIT "AS IS" no-warranty paragraph. GitHub's
  license detector sidebar agrees: "MIT license". 7.3k stars, 1.8k forks,
  12,532 commits — actively maintained.

- **Data vs code:** the database is *in-repo* as TOML files
  (`providers/*/models/*.toml`, `models/<lab>/<model>.toml`), generated to
  the published JSON. One MIT license covers code + data compilation
  together. Per 5-2 step 2, the generated catalog carries an attribution
  header (source URL + "MIT, Copyright (c) 2025 models.dev" + snapshot
  date) — that satisfies the notice condition. See §5 for the
  trademark/logos nuance.

- **Provenance:** community-contributed (PRs) with a CI schema-validation
  action; primary maintainer is the SST/opencode crew. Facts ultimately
  originate in provider docs/pricing pages — models.dev aggregates them.

**Bottom line for 5-2:** MIT + snapshot-at-release-time + attribution
header is cleared. No blocker.

---

## 2. Schema reference (`api.json`)

### 2.1 Top-level shape

A single flat JSON **object keyed by provider id** → provider object
(`"deepinfra": {…}`). No envelope/metadata. 232 keys in the snapshot.

```jsonc
{
  "<provider-id>": {
    "id": "anthropic",            // == map key
    "name": "Anthropic",          // display name                    (232/232)
    "npm": "@ai-sdk/anthropic",   // AI SDK package                  (232/232)
    "env": ["ANTHROPIC_API_KEY"], // auth env var names              (232/232)
    "doc": "https://…",           // provider docs URL               (232/232)
    "api": "https://…/v1",        // OpenAI-compatible base URL      (207/232; required when npm=@ai-sdk/openai-compatible)
    "models": { "<model-id>": {…} } // map; key == model.id
  }
}
```

No other provider-level fields exist. 193 providers use
`npm = "@ai-sdk/openai-compatible"` (all carry `api`).

### 2.2 Per-model fields (presence out of 9,048 in snapshot)

| Field | Type | Presence | Notes |
|---|---|---|---|
| `id` | string | all | wire model id (may contain `/` on relays, e.g. `deepseek/deepseek-v4.1-flash`) |
| `name` | string | all | display name → our label |
| `description` | string | all | one-liner (marketing-ish) |
| `family` | string | 8,326 | e.g. `claude-sonnet`, `gpt-sol` |
| `attachment` | bool | all | file attachments accepted |
| `reasoning` | bool | all | chain-of-thought capable |
| `reasoning_options` | array | 6,751 | `{type:"effort", values:[…]}` (4,398), `{type:"toggle"}` (1,416), `{type:"budget_tokens", min:1024}` (603); **can be `[]`** (seen on xai grok-4.20-0309-reasoning) |
| `tool_call` | bool | all | tool/function calling |
| `structured_output` | bool | 6,430 | dedicated structured-output feature |
| `temperature` | bool | 8,497 | **"supports temperature control"** — `false` on GPT-6.x/5.6, Claude 5.x, Grok 4.5+ ⇒ exactly the 5-2 gated-emission signal (SYNTHESIS §4). Absent on ~550 entries ⇒ treat as *unknown*, not false |
| `knowledge` | string | 4,775 | knowledge cutoff, `YYYY-MM` or `YYYY-MM-DD` |
| `release_date` / `last_updated` | string | all | `YYYY-MM-DD` |
| `open_weights` | bool | all | weights public |
| `status` | string | 378 | `deprecated` (299) / `beta` (78) / `alpha` (1) |
| `type` | string | 7 | specialized (e.g. `video`, embedding/reranker on relays); omitted by default — `?type=all` includes everything |
| `modalities.input` / `.output` | string[] | all | values seen: `text`, `image`, `audio`, `video`, `pdf` |
| `limit.context` | int | all | tokens |
| `limit.input` | int | 1,601 | tokens (optional; e.g. gpt-6.1-sol 922,000) |
| `limit.output` | int | all | tokens (**`0` on image models** — guard divide-by-zero) |
| `cost.input` / `.output` | number | 8,593 | USD per 1M tokens |
| `cost.cache_read` / `.cache_write` | number | 5,934 / 1,946 | per 1M |
| `cost.reasoning` | number | 160 | per 1M reasoning tokens |
| `cost.input_audio` / `.output_audio` | number | 142 / 16 | separate audio billing |
| `cost.tiers` | array | 666 | `[{input, output, cache_read…, tier:{type:"context", size:272000}}]` — generalized banded pricing |
| `cost.context_over_200k` | object | 547 | legacy duplicate of a single context tier — prefer `tiers` when both appear (gpt-6.1-sol carries both, identical values) |
| `interleaved` | bool \| obj | 1,402 | `true` (112) or `{field:"reasoning_content"|"reasoning_details"}` (1,290) — interleaved-thinking wire field |
| `canonical_model_id` | string | 6,166 | `lab/model-id` of the originating model (from `base_model`) — cross-provider dedup key |
| `provider` | object | 540 | per-model serving overrides: `npm` (451), `api` (372), `shape` (59: `"responses"` \| `"completions"`), `body` (experimental modes) |
| `experimental.modes` | object | 101 | e.g. gpt-6.1-sol `fast`/`pro`/`ultrafast` with `cost` + `provider.body` overrides (`service_tier`) |

`provider.shape` is a **wire-protocol hint** (OpenAI Responses vs Chat
Completions) but only 59 models carry it (infer, azure, sakana…) — far too
sparse to *be* our wire-name table; treat as corroboration only (see §4).

### 2.3 Real trimmed example — `anthropic` (2 of 17 models)

```jsonc
{
  "anthropic": {
    "id": "anthropic",
    "env": ["ANTHROPIC_API_KEY"],
    "npm": "@ai-sdk/anthropic",
    "name": "Anthropic",
    "doc": "https://docs.anthropic.com/en/docs/about-claude/models",
    "models": {
      "claude-sonnet-5-5": {
        "id": "claude-sonnet-5-5",
        "name": "Claude Sonnet 5.5",
        "description": "Fast Claude model for everyday coding, agents, and knowledge work",
        "family": "claude-sonnet",
        "attachment": true,
        "reasoning": true,
        "reasoning_options": [
          { "type": "effort", "values": ["low", "medium", "high", "xhigh", "max"] }
        ],
        "tool_call": true,
        "structured_output": true,
        "temperature": false,
        "knowledge": "2026-06",
        "release_date": "2026-09-28",
        "last_updated": "2026-09-28",
        "modalities": { "input": ["text", "image", "pdf"], "output": ["text"] },
        "open_weights": false,
        "limit": { "context": 1000000, "output": 128000 },
        "cost": { "input": 2, "output": 10, "cache_read": 0.1, "cache_write": 2.5 },
        "canonical_model_id": "anthropic/claude-sonnet-5-5"
      },
      "claude-sonnet-4-6": {          // older gen: temp still accepted, budget_tokens present
        "id": "claude-sonnet-4-6",
        "name": "Claude Sonnet 4.6",
        "family": "claude-sonnet",
        "attachment": true, "reasoning": true,
        "reasoning_options": [
          { "type": "effort", "values": ["low", "medium", "high", "max"] },
          { "type": "budget_tokens", "min": 1024 }
        ],
        "tool_call": true, "structured_output": true, "temperature": true,
        "knowledge": "2025-08-31",
        "release_date": "2026-02-17", "last_updated": "2026-03-13",
        "modalities": { "input": ["text", "image", "pdf"], "output": ["text"] },
        "open_weights": false,
        "limit": { "context": 1000000, "output": 128000 },
        "cost": { "input": 3, "output": 15, "cache_read": 0.3, "cache_write": 3.75 }
      }
    }
  }
}
```

### 2.4 Sibling endpoints

| URL | Size | Shape |
|---|---|---|
| `/api.json[?type=all]` | 5.8 MB | provider→models (above). Default **omits specialized types**; `type=all` is the complete catalog — **use `?type=all` and filter ourselves** |
| `/models.json` | 470 KB | 553 entries keyed `lab/model-id`; provider-agnostic facts only (no pricing/limits-per-provider): name, family, modalities, limit defaults, reasoning/tool_call/temperature, open_weights, weights links, benchmarks |
| `/catalog.json` | 6.3 MB | `{providers: {…api.json…}, models: {…models.json…}}` in one response |
| `/model-schema.json` | 384 KB | JSON Schema (draft 2020-12, `$defs`) — machine-checkable contract for the above |
| `/logos/{provider}.svg` | — | logos (**not needed; skip — trademark, §5**) |

Upstream source of truth is TOML in the repo; JSON is generated. For
diff-stable pinning we snapshot the JSON, not the repo.

---

## 3. Coverage check (snapshot 2026-10-18)

| Provider key | Models | Deprecated | npm | Freshness spot-check |
|---|---|---|---|---|
| `openai` | 53 | 12 | `@ai-sdk/openai` | `gpt-6.1-sol` rel 2026-09-29 ✓; gpt-5.6 family, gpt-image-2/2.5-era ids, `text-embedding-3-*`, realtime-2.1 ✓ |
| `anthropic` | 17 | 0 | `@ai-sdk/anthropic` | `claude-haiku-5-5` rel 2026-10-07 ✓; sonnet/opus/fable 5.x, mythos-5 present ✓ |
| `google` | 40 | 1 | `@ai-sdk/google` | `gemini-4-argon` rel 2026-10-13 ✓; 3.8/3.7/3.6 flash, image models, `gemini-embedding-2` ✓ |
| `xai` | 13 | 0 | `@ai-sdk/xai` | `grok-4.7` rel 2026-09-21 ✓ with effort enum `[low, medium, high, xhigh]`; `grok-2-image` correctly absent (retired — matches SYNTHESIS fix #5) |
| `openrouter` | 390 | 0 | `@openrouter/ai-sdk-provider` + `api` | rel 2026-10-17 entries ✓; long-tail incl. `:free` variants. (We treat openrouter live-authoritative anyway — catalog rows not required) |
| `mistral` | 42 | 22 | `@ai-sdk/mistral` | `mistral-large-4` rel 2026-10-06 ✓; `zai-glm-5-3`/`glm-5-2` hosted models; 22 deprecated (devstral/pixtral/nemo lineage) — **richest deprecation signal of the six** |
| openaicompatible base data | 193 providers with `npm=@ai-sdk/openai-compatible` (+`api` base URL); 207/232 providers carry `api` | — | — | this is the family-signature base data for the openai-compatible ecosystem (research/openaicompatible-ecosystem.md §4-§5) |

**Stale/missing entries spotted (matters for our modules):**

1. **First-party voice/STT gap:** `whisper-1` absent everywhere (correct —
   retired); `gpt-realtime-whisper` and `grok-voice-stt/tts-1.0` exist on
   the site and in `models.json`, but in `api.json` they appear **only
   under relay providers** (`vercel`, `zenmux`) — the first-party
   `openai`/`xai` provider maps don't list them. ⇒ Do **not** source our
   STT/TTS module data from models.dev first-party entries.
2. `gpt-image-1` and 11 other openai ids correctly carry
   `status:"deprecated"` (gpt-3.5-turbo, gpt-4, gpt-4-turbo, o1, o1-pro,
   o3-mini, o4-mini, gpt-4o-2024-05-13, gpt-4.1-nano,
   gpt-5.2/5.3-chat-latest) — filter on `status` at codegen.
3. Image/video models have `limit.context`/`limit.output` = `0` — not a
   bug, but must not be emitted as a real context value.
4. `?type=all` vs default changed nothing for our six (verified identical
   id sets) but does matter for relay embedding/reranker entries — use
   `type=all` upstream and filter locally so nothing silently disappears
   if a first-party model gets typed later.

Verdict: coverage is **good and current** (flagships land within ~1 day of
release). Deprecation metadata is the standout feature for 5-2's merge
(`live > catalog > user` + provenance chips).

---

## 4. Codegen guidance for 5-2

### 4.1 Mapping `api.json` → engine `ModelInfo`

| models.dev | ModelInfo / catalog field | Transform notes |
|---|---|---|
| `models` map key == `id` | `id` | direct |
| `name` | label / display name | direct |
| `limit.context` | `context` | keep 0 as "unknown", never as a limit |
| `limit.output` | output limit | same 0-guard |
| `modalities.input/output` | `modalities` | map `text/image/audio/video` → our enum; **`pdf` is an input-attachment modality, fold into attachment/vision, not a new modality** |
| `attachment` | capabilities.attachment | |
| `tool_call` | capabilities.tools | |
| `structured_output` | capabilities.structured | absent ⇒ unknown |
| `reasoning` + `reasoning_options` | capabilities.reasoning + param enums | `effort.values` → `reasoning_effort` enum gating (xai `xhigh` vs anthropic `xhigh,max` vs grok-4.3 `none,…`!); `budget_tokens.min` → thinking-budget floor; `toggle` → boolean thinking switch |
| `temperature` | temperature-accepts flag | **the** gated-emission input; absent (~550) ⇒ *unknown* → keep emitting (do not suppress on missing data) |
| `cost.input/output/cache_read/cache_write` | price | USD/1M; keep `tiers` array if we ever show banded pricing; ignore `context_over_200k` (legacy dup of `tiers`) |
| `status` | lifecycle | `deprecated`/`beta`/`alpha` → drop from Tier-2 picker or badge |
| `knowledge`, `release_date`, `last_updated` | provenance/UI hints | |
| `canonical_model_id` | family-signature grouping key | dedups relay mirrors onto the lab model |
| `interleaved.field` | wire hint | `reasoning_content` vs `reasoning_details` for interleaved-thinking parsing |
| `provider.shape` / `provider.npm` / `provider.api` | wire hints only | 59 models carry `shape` — **too sparse to be the wire-name table**. 5-2 step 4 keeps the catalog JSON authoritative for the *capability→wire-field* mapping, but that table must be seeded from our curated research (SYNTHESIS §3), with models.dev `shape` as corroboration where present |
| provider `env`/`api` | not needed in catalog | config-layer concern, already ours |

### 4.2 Filtering (Tier-2 = long tail beyond curated Tier-1)

- Providers: exactly our first-party six (`openai, anthropic, google, xai,
  mistral` for catalog rows; `openrouter` stays live-authoritative — no
  rows) + the openai-compatible **family-signature** input (193
  `@ai-sdk/openai-compatible` providers feed signature tables, not rows).
- Row filter: drop `status:"deprecated"`; drop `type`-specialized entries
  we can't serve; keep embeddings/images with modality-aware handling.
- Tier-1 models (curated, hand-maintained) keep precedence — catalog never
  overrides Tier-1 or live data (merge order per 5-2 step 5).

### 4.3 Versioning / pinning strategy

- Fetch **once per release** into `tools/gen-model-catalog/input/` and
  commit the snapshot (or the filtered subset + SHA-256 of the full file).
  Record in the generated header: source URL, fetch date
  (2026-10-18-style), byte size, and ETag
  (`"972fcd439f52094c1579e5c8c51f6308"` for this snapshot) for quick
  drift detection. ETag is a hash (md5-shaped) and changes on every data
  deploy — perfect cheap pin.
- Deterministic output: sort providers/models by id; stable JSON field
  order from our Go structs; golden-file test = same input → same bytes.
- Schema-drift tolerance: decode with unknown-field-ignoring structs; the
  upstream publishes `/model-schema.json` — optionally assert required
  fields at codegen time so drift **fails the build**, never runtime.

### 4.4 Offline safety

- models.dev is touched **only** by the codegen step (developer/CI machine
  with network). Engine builds consume the committed, generated artifact
  via `go:embed` — zero runtime dependency, no egress, works air-gapped.
- The snapshot file lives under the tools tree (build-tagged/excluded from
  `./...` per 5-2), not in the embedded output; only the trimmed catalog
  is embedded.
- No secrets, no auth, no PII in the data — pure public catalog facts.

---

## 5. Caveats

1. **Crowd-sourced data.** Community PRs (12.5k commits) with CI schema
   validation — schema is enforced, *values* are not. Pricing is the most
   volatile field; capability booleans (e.g. `temperature`) occasionally
   lag provider announcements. Treat catalog as `known` provenance, never
   above `live`/Tier-1. Corroborate anything user-facing-critical.
2. **License of DATA vs CODE.** Single MIT for the repo covers both code
   and the data compilation; facts themselves aren't copyrightable, so MIT
   on the compilation is maximally permissive. **Logos are provider
   trademarks** — we take no `/logos/*.svg`, so no trademark exposure.
   Attribution header (§1) satisfies the MIT notice condition.
3. **Rate limits:** none published; responses are
   `Cache-Control: public, max-age=0, must-revalidate` behind Cloudflare
   (CF-Cache-Status: HIT observed). One fetch per release + the occasional
   manual refresh is comfortably polite; never fetch from runtime.
4. **Fields of varying reliability:** `description` (marketing prose),
   `knowledge` (4775/9048 populated), `temperature` (absent on ~550),
   `provider.shape` (59 models), `cost.tiers` vs
   `cost.context_over_200k` duplication, `reasoning_options: []` empties,
   0-valued limits on non-text models. Codegen must handle all of these
   explicitly (see §4.1 notes).
5. **Coverage holes:** first-party voice/STT absent (§3 item 1) — STT/TTS
   module data stays hand-curated. `openrouter` deprecation not modeled
   (0 flagged) — fine, we read theirs live.
6. **Freshness:** continuously deployed (entries land ~1 day after
   release) — a snapshot is a *point-in-time* view; by the time we ship,
   flagships may have moved. Release-time refresh + live-merge precedence
   covers this.

---

## 6. Sources (all accessed 2026-10-18)

- `https://models.dev/api.json` — snapshot analyzed (5,803,041 bytes, ETag `"972fcd439f52094c1579e5c8c51f6308"`)
- `https://models.dev/api.json?type=all` — diffed vs default (identical for our six providers)
- `https://models.dev/models.json` — 553 canonical entries; shape verified
- `https://models.dev/catalog.json`, `https://models.dev/model-schema.json` — shape verified
- `https://models.dev/` — site (canonical-model index, provider/labs pages)
- `https://github.com/anomalyco/models.dev` — source repo (README: API docs, TOML contribution model, schema reference); redirects from `github.com/sst/models.dev`
- `https://raw.githubusercontent.com/anomalyco/models.dev/dev/LICENSE` — MIT license text quoted in §1
