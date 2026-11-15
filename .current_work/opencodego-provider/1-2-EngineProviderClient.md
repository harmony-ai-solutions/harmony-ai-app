# Phase 1-2 — Engine provider client (chat capability + headers/session/UA)

**Repo:** `harmony-link-private` · **Objective:** `providers/opencodego.go` as a
**capability shell** (Jev-ready per summary.md), chat-capability client inside.

## Endpoints & constants (verified against opencode.ai/docs/console/go, 2026-11-15)

- Chat base (default): `https://opencode.ai/inference/go/openai/v1`
- Models list: `https://opencode.ai/inference/go/v1/models` — ⚠ **different prefix**
  (no `/openai` segment). Keep both as constants; account `base_url` (if set) overrides
  the *root* `https://opencode.ai/inference/go` and both paths derive from it.
- Headers on every request: `Authorization: Bearer <key>`,
  `x-opencode-session: <session id>`, `User-Agent: SoulbitsEngine/<engine version>`.
  UA exact string = owner sign-off item (version plumbing: `constants.AppName`-adjacent
  version used by `management` for `/public/appname`).

## Structure (the Jev-ready shell)

```go
type OpenCodeGoProvider struct {
    // Capability shell — service-level concerns only.
    apiKey   string
    baseURL  string        // resolved root
    session  string        // set via SetSessionID (phase 1-3)
    client   openaigo.Client // chat capability
    connected bool
    // capability fields (model, sampling, …) as in OpenAICompatibleProviderConfig
}

// requestOptions owns auth + session + UA (+ base URL) — ONE builder, reused by every
// future capability client (decision/jev) verbatim.
func (p *OpenCodeGoProvider) requestOptions() []option.RequestOption
```

- Implement the `Provider` interface (`Name() → "opencodego"`, `ConnectToBackend`,
  `IsConnected`, `FromConfig`, `FromJSON`, `ValidateConfig`) and the chat capability
  interfaces used by modules: `backend.Client` (`SendUserMessage`,
  `SendComplexPromptSync`, …) + vision `AnalyzeImage(s)` — mirror
  `providers/openaicompatible.go` for the emission path (`buildParams` →
  `common.Emit`), `SendUserMessage`, `GetChatHistory` (nil), `AnalyzeImage(s)`,
  `AllowsCustomPrompting`, `SetSystemPrompt`, `SetDynamicStopTokens`,
  `SetDynamicMaxTokens`. Share code by copying the compatible provider's helpers or
  extracting small shared helpers — do NOT embed `OpenAICompatibleProvider` publicly in
  a way that leaks fingerprinting/auth-style behavior.
- **No fingerprinting, no basic auth, no auth-style hint.** Bearer only.
- `ValidateConfig()` ("Test key"): `GET <models URL>` with the standard headers →
  2xx `valid`; 401 `invalid`; 403 → `scope_limited` (free-tier-only key or
  workspace region/privacy gate — carry a helpful detail string); 429 → `throttled`;
  transport → `unreachable`. Reuse `common.Verify*` taxonomy (see
  `routes_provider_probe.go` + `common.VerifyResult`).
- `ListModels`: `GET <models URL>` → `[]common.ModelInfo` (map OpenAI-style list;
  no fingerprint tree). This automatically powers the app's "Fetch from provider".
- Response extras (`opencode.allowance`, `opencode.tokens`) are ignored in v1 —
  follow-up only.

## Files

- `providers/opencodego.go` (new) · test `providers/opencodego_test.go` (phase 1-5)

## Acceptance

- httptest server asserts on every chat + models request: Bearer token,
  `x-opencode-session`, `User-Agent` prefix `SoulbitsEngine/`.
- Verify classification matrix above covered by table test.

## Checklist

- [ ] Constants (chat base, models path, UA builder)
- [ ] Shell struct + `requestOptions()`
- [ ] Chat capability methods (emit via `common.Emit`, openai wire table)
- [ ] `ValidateConfig` matrix (valid/invalid/scope_limited/throttled/unreachable)
- [ ] `ListModels` live discovery
- [ ] Registry factory (see 1-4)
