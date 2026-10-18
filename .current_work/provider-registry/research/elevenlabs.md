# ElevenLabs — Provider Research (Soulbits Provider Registry)

**Provider:** ElevenLabs
**API host:** `api.elevenlabs.io`
**Research date:** 2026-10-18
**Author:** provider-registry research subagent (read-only)
**Engine repo:** `harmony-link-private` — facts marked **[engine-code]** are read from the live Go client.
**App repo:** `harmony-ai-app`

Sources are cited inline as `[src: URL]`. All external claims come from official ElevenLabs docs unless explicitly labelled otherwise (community/help-centre sources are labelled).

---

## 0. TL;DR for the workstream

| Need | Answer |
|------|--------|
| Cheapest side-effect-free key check | `GET /v1/user` (or `GET /v1/user/subscription` if you want plan/quota UI data). Both are free, read-only, no character consumption. |
| TTS model list | `GET /v1/models` (filter `can_do_text_to_speech == true`). |
| Voice list (the real "model picker" for TTS) | `GET /v2/voices` (paginated, filtered). The engine currently calls the **legacy** `GET /v1/voices` **[engine-code]**. |
| Capability source | **Live `GET /v1/models`** for model gating (`can_use_style`, `can_use_speaker_boost`, `can_do_text_to_speech`, `maximum_text_length_per_request`); the docs' per-model param matrix is **not** exposed as machine-readable data, so embed a small catalog + refine from `/v1/models`. |
| Voices in the catalog? | **No.** Voices are per-account (personal/cloned/workspace) + shared library. Always live, never seeded. |
| Key format | Header `xi-api-key: <key>`; keys now start with `sk_` (community-observed) **[src: community]**. |

---

## 1. API basics

### 1.1 Base URL and data-residency hosts
- Default production base: `https://api.elevenlabs.io` **[src: https://elevenlabs.io/docs/api-reference/authentication]**
- Regional hosts exist (multi-region residency):
  - `https://api.us.elevenlabs.io` (US)
  - `https://api.eu.residency.elevenlabs.io` (EU)
  - `https://api.in.residency.elevenlabs.io` (India)
  - `https://api.sg.residency.elevenlabs.io` (Singapore)
  **[src: https://elevenlabs.io/docs/api-reference/models/list]** (server list shown on every API-reference page)
- **Engine client:** hard-codes `https://api.elevenlabs.io/v1` in the vendored SDK (`elevenlabsBaseURL = "https://api.elevenlabs.io/v1"`) — no regional override. **[engine-code: `github.com/haguro/elevenlabs-go@v0.2.4/client.go:19`]**

### 1.2 Authentication
- Every request must send the key in the **`xi-api-key`** HTTP header:
  ```bash
  curl 'https://api.elevenlabs.io/v1/models' \
    -H 'Content-Type: application/json' \
    -H 'xi-api-key: $ELEVENLABS_API_KEY'
  ```
  **[src: https://elevenlabs.io/docs/api-reference/authentication]**
- **Engine client:** sets `xi-api-key` on every request, but only if the key is non-empty (`if c.apiKey != ""`). Also always adds `Accept: */*` and `Content-Type: application/json`, even on GETs. **[engine-code: `client.go:92-98`]**

### 1.3 Key format and creation
- Keys are created in the dashboard under **Developers → API Keys** (personal) or **Workspace settings → Service Accounts** (service-account keys). **[src: https://elevenlabs.io/docs/overview/administration/workspaces/api-keys]**
- Two key types:
  - **User API keys** — tied to a person; can be given an expiry (15 min … 30 days, or Never). **[src: same]**
  - **Service account API keys** — tied to a service account; do not expire; recommended for backend/production. **[src: same]**
- **Format:** keys now begin with the prefix **`sk_`**; the legacy `key_id` (the shorter identifier shown next to a key) is **not** accepted as a credential. This is community-observed (the official auth page does not state the prefix). **[src: https://www.reddit.com/r/ElevenLabs/comments/1vgybun/ ; https://forum.convai.com/t/elevenlabs-new-api-key-sk-update/6466]**
- Key restrictions that matter for a "test key" button:
  1. **Scope restriction** — a key can be limited to a subset of endpoints.
  2. **Credit quota** — a per-key custom credit limit.
  3. **IP allowlisting** — requests from non-allowlisted IPs are rejected with **`403`**. **[src: https://elevenlabs.io/docs/overview/administration/workspaces/api-keys]**
- Expired user keys are rejected with **`401`**. **[src: same]**
- Keys leaked to a public GitHub repo are auto-disabled (`disable_reason: exposed_publicly`). **[src: same]**

### 1.4 API versioning (important)
- Versioning is **per-endpoint in the path**, not a global header: `/v1/...` is the norm; `/v2/...` exists where the contract changed. There is **no** version header.
- **Mixed current versions in use:**
  - `GET /v1/models`, `GET /v1/user`, `GET /v1/user/subscription`, `POST /v1/text-to-speech/{voice_id}` → **v1**.
  - `GET /v2/voices` → **v2** (the current canonical voices-list endpoint). **[src: https://elevenlabs.io/docs/api-reference/voices/search]**
  - Legacy `GET /v1/voices` still exists (see §3) but is deprecated in favour of `/v2/voices`. **[src: community — https://jv.wordpress.com/plugins/ls-ai-provider-for-elevenlabs/ ("migrate from the deprecated /v1/voices endpoint to /v2/voices with full pagination")]**
- ElevenLabs maintains a **breaking-changes policy**: endpoints may be marked deprecated, but outright removal will not happen without outreach to affected users. **[src: https://elevenlabs.io/docs/eleven-api/resources/breaking-changes-policy]**

---

## 2. Key validation

### 2.1 Recommended verify call
**Use `GET https://api.elevenlabs.io/v1/user`** — read-only, side-effect-free, consumes **no** characters, returns the user + nested subscription object. **[src: https://elevenlabs.io/docs/api-reference/user/get]**

If the UI wants richer billing/quota fields (invoices, overage, billing period, coupons), use **`GET https://api.elevenlabs.io/v1/user/subscription`** instead. **[src: https://elevenlabs.io/docs/api-reference/user/subscription/get]**

> Note: `GET /v1/models` also verifies a key and is side-effect-free, but returns no account data, so `/v1/user` is strictly better for the "test key" button (it doubles as a "connected as…" panel).

### 2.2 Expected 2xx shape
`GET /v1/user` → `200` with a JSON object (abridged):
```json
{
  "user_id": "1234567890",
  "workspace_id": "0987654321",
  "subscription": {
    "tier": "starter",
    "character_count": 17231,
    "character_limit": 100000,
    "status": "active",
    "next_character_count_reset_unix": 1738356858,
    "currency": "usd",
    "billing_period": "monthly_period",
    "voice_slots_used": 1,
    "voice_limit": 120,
    "can_use_instant_voice_cloning": true,
    "can_use_professional_voice_cloning": true
  },
  "is_onboarding_completed": true,
  "created_at": 1753999199,
  "seat_type": "workspace_member",
  "first_name": "John"
}
```
**[src: https://elevenlabs.io/docs/api-reference/user/get]**

**Subscription fields useful for the UI:**
- `tier` (string, e.g. `free`, `starter`, `creator`, `pro`, `scale_2024_08_10`, `business`, `enterprise`, `trial` — see the tier enum in the subscription docs)
- `character_count` / `character_limit` → **quota bar** (used vs. allowance this period)
- `status` enum: `trialing | active | incomplete | past_due | free | free_disabled`
- `next_character_count_reset_unix` → "resets on …"
- `can_use_instant_voice_cloning` / `can_use_professional_voice_cloning` → feature gating in the voice picker
- `voice_limit`, `voice_slots_used`, `professional_voice_limit`
- `currency`, `billing_period`, `character_refresh_period`
**[src: https://elevenlabs.io/docs/api-reference/user/get ; https://elevenlabs.io/docs/api-reference/user/subscription/get]**

### 2.3 Exact failure signals
All errors return a JSON body with a `detail` object. **[src: https://elevenlabs.io/docs/eleven-api/resources/errors]**

| HTTP | `detail.type` | Meaning | Body `code` examples |
|------|---------------|---------|----------------------|
| **401** | `authentication_error` | Invalid/missing/expired key | `invalid_api_key`, `missing_api_key`, `unauthorized`, `sign_in_required`, `invalid_authorization_header` |
| **402** | `payment_required` | Insufficient credits / payment needed | `insufficient_credits` |
| **403** | `authorization_error` | Valid key but **not permitted** (scope, plan, or **IP not allowlisted**) | `forbidden`, `insufficient_permissions`, `workspace_access_denied`, `feature_not_available`, `subscription_required`, `voice_access_denied`, `model_access_denied` |
| **429** | `rate_limit_error` | Too many requests **or** concurrency limit hit | `rate_limit_exceeded`, `concurrent_limit_exceeded`, `system_busy` |
| 400 | `validation_error` / `invalid_request` | Bad params | `invalid_parameters`, `bad_request`, `malformed_json`, … |
| 500 / 503 | `internal_error` / `service_unavailable` | Server-side | `internal_error`, `service_unavailable`, `maintenance` |
**[src: https://elevenlabs.io/docs/eleven-api/resources/errors]**

Error envelope shape:
```json
{
  "detail": {
    "type": "authentication_error",
    "code": "invalid_api_key",
    "message": "The provided API key is invalid.",
    "status": "invalid_api_key",        // legacy field, ignore
    "request_id": "3c807fc4c3a1705f9638ecc764a91c01",
    "param": "keyterms"                  // present for validation errors
  }
}
```
**[src: https://elevenlabs.io/docs/eleven-api/resources/errors]**

**Semantics to encode in the UI:**
- **401 → "Key is invalid / expired"** (hard fail, ask user to re-paste).
- **403 → "Key is valid but blocked"** — most commonly IP allowlisting, or a scope/quota restriction on the key. **Do not** report this as "invalid key". A `403` on a *validation* call while other calls succeed is the signature of IP allowlisting. **[src: https://elevenlabs.io/docs/overview/administration/workspaces/api-keys]**
- **402 → "Key valid, out of credits"** (valid key, actionable billing message).
- **429 → transient**; implement exponential backoff and retry. **[src: https://elevenlabs.io/docs/eleven-api/resources/errors]**
- **422** uses a *different* envelope: `{"detail": [{"loc": [...], "msg": "...", "type": "..."}]}` (a **list**, not an object). **[src: same]**

### 2.4 Quota implications
- `GET /v1/user`, `GET /v1/user/subscription`, `GET /v1/models`, `GET /v1/voices`, `GET /v2/voices` are **metadata reads** and consume **no characters/credits**. Only TTS/STT/music generation consumes credits. **[src: https://elevenlabs.io/docs/api-reference/models/list + /text-to-speech/convert]**
- There is no documented dedicated "validate key" endpoint; the metadata GETs are the intended way. **[src: inference from the API reference — no such endpoint listed]**

### 2.5 Engine client behaviour today **[engine-code]**
`ValidateConfig()` calls `GetVoices()` (i.e. `GET /v1/voices`) and returns its error:
```go
func (e *ElevenLabsProvider) ValidateConfig() error {
    if e.client == nil { if err := e.ConnectToBackend(); err != nil { return err } }
    _, err := e.client.GetVoices()   // GET /v1/voices
    return err
}
```
**[engine-code: `providers/elevenlabs.go:70-78`]**

Problems for the "test key" feature:
1. It uses the **heaviest** possible metadata call (returns *all* voices) rather than `/v1/user`; it also returns **no** plan/quota data for the UI.
2. The vendored SDK (`haguro/elevenlabs-go@v0.2.4`) collapses the rich error envelope:
   - Only `400` and `401` → `APIError{detail:{status,message,additional_info}}`.
   - `422` → `ValidationError{detail:[{loc,msg,type}]}`.
   - **Everything else (incl. 402, 403, 429) → a generic string** `"unexpected HTTP status \"403 Forbidden\" returned from server"`, with the JSON body **discarded**. **[engine-code: `client.go:113-134`]**
   So today the engine **cannot** distinguish "invalid key (401)" from "blocked (403)" from "rate limited (429)" from "out of credits (402)". This must be fixed for the verify feature (see §8).

---

## 3. Model + voice listing

### 3.1 Models — `GET /v1/models`
Returns a JSON **array** of `ModelResponseModel`. **[src: https://elevenlabs.io/docs/api-reference/models/list]**

Fields (current):
| Field | Type | Notes |
|-------|------|-------|
| `model_id` | string | e.g. `eleven_multilingual_v2`, `eleven_v3`, `eleven_flash_v2_5` |
| `name` | string | display name |
| `description` | string | |
| `can_be_finetuned` | bool | |
| `can_do_text_to_speech` | bool | **use to filter the TTS model picker** |
| `can_do_voice_conversion` | bool | STS capability |
| `can_use_style` | bool | **gate the `style` param** |
| `can_use_speaker_boost` | bool | **gate `use_speaker_boost`** |
| `serves_pro_voices` | bool | |
| `token_cost_factor` | double | legacy cost factor |
| `requires_alpha_access` | bool | hide if true |
| `maximum_text_length_per_request` | int | **current** per-request char limit |
| `languages` | list of `{language_id, name}` | |
| `model_rates` | `{character_cost_multiplier, cost_discount_multiplier}` | cost multiplier |
| `concurrency_group` | string | |
| `max_characters_request_free_user` | int | **DEPRECATED** — "Not enforced; use `maximum_text_length_per_request`" |
| `max_characters_request_subscribed_user` | int | **DEPRECATED** — same |
**[src: https://elevenlabs.io/docs/api-reference/models/list]**

> **No pagination / no query params** on `/v1/models` — it returns the full list. **[src: same]**

**Engine client:** has `GetModels()` in the vendored SDK (`GET /models` → `[]Model`) but **the provider never calls it**. The vendored `Model` struct is missing the newer fields (`maximum_text_length_per_request`, `model_rates`, `concurrency_group`) and still exposes the deprecated `MaxCharactersRequestFreeUser/SubscribedUser`. **[engine-code: `client.go:245-258`, `models.go:18-33`]**

### 3.2 Voices — `GET /v2/voices` (current) vs `GET /v1/voices` (legacy)
**Current canonical endpoint:** `GET https://api.elevenlabs.io/v2/voices` — "all available voices for a user with search, filtering and pagination." **[src: https://elevenlabs.io/docs/api-reference/voices/search]**

**Query params (v2):** `next_page_token`, `page_size` (default 10, **max 100**), `search`, `sort` (`created_at_unix` | `name`), `sort_direction`, `voice_type` (`personal|community|default|workspace|non-default|non-community|saved`), `category` (`premade|cloned|generated|professional`), `fine_tuning_state`, `collection_id`, `gender`, `age`, `language[]`, `accent`, `use_cases[]`, `min_notice_period_days`, `include_custom_rates`, `include_live_moderated`, `high_quality`, `include_total_count`, `voice_ids[]` (max 100). **[src: same]**

**Response (v2):**
```json
{ "voices": [ VoiceResponseModel, ... ], "has_more": true, "total_count": 12, "next_page_token": "..." }
```
**Pagination:** use **`has_more` + `next_page_token`** — the docs explicitly warn *not* to rely on `total_count` (it is a live snapshot and costs performance to compute). **[src: same]**

**Voice object fields (v2, abridged):** `voice_id`, `name`, `category` (`generated|cloned|premade|professional|famous|high_quality`), `labels` (map), `description`, `preview_url`, `available_for_tiers[]`, `settings` (`{stability, use_speaker_boost, similarity_boost, style, speed}`), `sharing`, `high_quality_base_model_ids[]`, `verified_languages[]` (`{language, model_id, accent, locale, preview_url}`), `collection_ids[]`, `safety_control` (`NONE|BAN|CAPTCHA|ENTERPRISE_BAN|ENTERPRISE_CAPTCHA`), `voice_verification` (`requires_verification`, `is_verified`, …), `is_owner`, `is_legacy`, `is_mixed`, `created_at_unix`, `favorited_at_unix`, `is_bookmarked`, `recording_quality` (`studio|good|ok|poor|bad`), `labelling_status` (`in_review|review_complete`), `fine_tuning`. **[src: same]**

**Legacy `GET /v1/voices`:** returns `{"voices":[...]}` with a smaller object (no pagination, no filters). It is the endpoint used by the vendored SDK and the engine today, and is deprecated in favour of `/v2/voices`. Community migration notes confirm the deprecation. **[engine-code: `client.go:263-276`] [src: community — https://jv.wordpress.com/plugins/ls-ai-provider-for-elevenlabs/ ; https://tonsofskills.com/skills/elevenlabs-upgrade-migration/]**

**Other voice endpoints:**
- `GET /v1/voices/{voice_id}` — single voice metadata (supports `?with_settings=true`). **[src: https://elevenlabs.io/docs/api-reference/voices/get]**
- `GET /v1/shared-voices` — the **Voice Library** (community-shared voices), paginated via `page`/`page_size` (default 30, max 100), returns `LibraryVoiceResponseModel` with `public_owner_id`, `accent/gender/age/descriptive/use_case`, `usage_character_count_*`, `cloned_by_count`, `free_users_allowed`, `live_moderation_enabled`, `featured`, `preview_url`, `rate`/`fiat_rate`. **[src: https://elevenlabs.io/docs/api-reference/voices/voice-library/get-shared]**
- `GET /v1/voices/settings/default` and `GET /v1/voices/{voice_id}/settings` — default/per-voice settings. **[engine-code: SDK `client.go:281-314`; not separately re-verified against docs]**

**Shared vs library vs account voices:**
- `GET /v2/voices` → voices **available to the account** (default/premade + cloned + generated + workspace + community voices the user saved).
- `GET /v1/shared-voices` → the **public Voice Library** catalogue (browse/borrow), filtered by `category` restricted to `professional|famous|high_quality`. **[src: both pages above]**
- Voice Library is **not available via API to free-tier users**. **[src: https://elevenlabs.io/docs/overview/capabilities/text-to-speech]**

**Engine client:** `GetVoices()` hits the **legacy** `GET /v1/voices` and returns `[]Voice` (the old shape). The vendored `Voice` struct lacks `verified_languages`, `is_owner`, `is_legacy`, `safety_control`, `settings.speed`, etc. **[engine-code: `client.go:263-276`, `models.go:49-62`]**

---

## 4. Per-model parameter support

### 4.1 Universal TTS request params (`POST /v1/text-to-speech/{voice_id}`)
Body: `text` (**required**), `model_id` (default **`eleven_multilingual_v2`**), `voice_settings`, `language_code`, `pronunciation_dictionary_locators[]`, `seed`, `previous_text`, `next_text`, `previous_request_ids[]`, `next_request_ids[]`, `use_pvc_as_ivc`, `apply_text_normalization` (`auto|on|off`), `apply_language_text_normalization`, `audio_effects`.
Query: `enable_logging` (default true; `false` = Zero Retention, Enterprise only), `output_format` (default `mp3_44100_128`), `optimize_streaming_latency` (**DEPRECATED**).
**[src: https://elevenlabs.io/docs/api-reference/text-to-speech/convert]**

### 4.2 `voice_settings` (the object the engine uses)
| Wire name | Type | Default | Range | Model gating |
|-----------|------|---------|-------|--------------|
| `stability` | double | 0.5 | 0.0–1.0 | universal (v4 uses only this + similarity) |
| `similarity_boost` | double | 0.75 | 0.0–1.0 | universal |
| `style` | double | 0.0 | 0.0–1.0 | **v2/v3 only — NOT supported on Eleven v4** |
| `use_speaker_boost` | bool | true | — | gated by model `can_use_speaker_boost`; Flash models ignore some settings for speed |
| `speed` | double | 1.0 | **0.25–4.0** REST (Agents 0.7–1.2) | **v2/v3 only — NOT supported on Eleven v4; NOT available for Eleven v3?** see note |
**[src: https://github.com/elevenlabs/skills/blob/main/text-to-speech/references/voice-settings.md ; https://elevenlabs.io/docs/api-reference/text-to-speech/convert]**

> **Speed nuance:** the official skills reference says speed is *"Not supported on Eleven v4"*, while the product guide page says *"Speed is not available for the Eleven v3 model."* Read together: **speed is a v2-family feature**; treat it as model-gated and prefer the `/v1/models` capability flags + a conservative allow-list. **[src: https://elevenlabs.io/docs/eleven-creative/playground/text-to-speech ; https://github.com/elevenlabs/skills/.../voice-settings.md]**

### 4.3 Other model-gated params
- `language_code` (ISO 639-1): **"not supported for multilingual_v2 models"**; if the model doesn't support the code it is ignored. **[src: .../text-to-speech/convert]**
- `apply_text_normalization`: for **Flash v2.5** it is **Enterprise-only** ("By default, normalization is disabled for Flash v2.5 … Enterprise customers can enable …"). **[src: https://elevenlabs.io/docs/overview/models]**
- `apply_language_text_normalization`: "Currently only supported for Japanese", can heavily increase latency. **[src: .../text-to-speech/convert]**
- `enable_logging=false` (Zero Retention): **Enterprise customers only**. **[src: .../text-to-speech/convert]**
- `optimize_streaming_latency`: **DEPRECATED** (still accepted as a no-op in Agents TTS settings as of the 2026-07-13 changelog). **[src: .../text-to-speech/convert ; https://elevenlabs.io/docs/changelog/2026/7/13]**
- `output_format` tier gates: MP3 192 kbps needs **Creator+**; PCM/WAV 44.1 kHz needs **Pro+**. **[src: .../text-to-speech/convert]**

### 4.4 Model-family differences (TTS)
- **Eleven v4 / v4 Turbo** — highest quality/expressiveness; 90+ languages; 10,000-char limit; **only `stability` + `similarity_boost`** are honoured (control emotion with *audio tags* and punctuation; **no `style`, no `speed`, no SSML**). `eleven_v4` is exposed via the **Text to Dialogue API** (`/v1/text-to-dialogue`) for multi-speaker dialogue; single-speaker TTS works via `/v1/text-to-speech` (the official skills examples call `text_to_speech.convert` with `model_id="eleven_v4"`). `eleven_v4_turbo` is served via the Text to Dialogue WebSocket. **[src: https://elevenlabs.io/docs/overview/models ; https://github.com/elevenlabs/skills/.../voice-settings.md]**
- **Eleven v3 / v3 Conversational** — 70+ languages; 5,000-char limit; expressive; **audio tags**; multi-speaker via Text to Dialogue. **[src: https://elevenlabs.io/docs/overview/models]**
- **Eleven Multilingual v2** — 29 languages; 10,000-char limit; most stable for long-form; **`language_code` not supported**; better at number normalization. **[src: same]**
- **Eleven Flash v2.5** — 32 languages; 40,000-char limit; ~75 ms latency; ~50% cheaper per char; numbers not normalized by default (Enterprise can set `apply_text_normalization=on`). **[src: same]**
- **Eleven Flash v2** — English-only; 30,000-char limit. **[src: same]**
- **`eleven_turbo_v2_5` / `eleven_turbo_v2`** — **deprecated** (use Flash equivalents). **[src: same]**
- **`eleven_monolingual_v1` / `eleven_multilingual_v1`** — **removed July 9, 2026**. **[src: https://elevenlabs.io/docs/changelog/2026/6/8]**

### 4.5 Where param support is documented
- Per-param semantics: the **Create speech** API reference. **[src: .../text-to-speech/convert]**
- Per-model feature bullets + char limits + languages: the **Models** overview. **[src: https://elevenlabs.io/docs/overview/models]**
- Per-model *machine-readable* gating flags: **`GET /v1/models`** (`can_use_style`, `can_use_speaker_boost`, `can_do_text_to_speech`, `maximum_text_length_per_request`). **[src: .../models/list]**
- There is **no** official JSON/CSV "parameter support matrix" endpoint — the docs table is prose only.

---

## 5. Param name mapping

### 5.1 Wire names (request body)
- `text`, `model_id`, `voice_settings.{stability, similarity_boost, style, use_speaker_boost, speed}`, `language_code`, `seed`, `previous_text`, `next_text`, `previous_request_ids`, `next_request_ids`, `apply_text_normalization`, `apply_language_text_normalization`, `use_pvc_as_ivc`, `audio_effects`, `pronunciation_dictionary_locators`.
- Query: `output_format`, `enable_logging`, `optimize_streaming_latency` (deprecated).
**[src: https://elevenlabs.io/docs/api-reference/text-to-speech/convert]**

### 5.2 Our engine client's mapping today **[engine-code]**
- Config struct (`config/types.go:460-468`):
  ```go
  type ElevenlabsConfig struct {
      ApiKey          string  `json:"apikey"`
      VoiceId         string  `json:"voiceid"`
      ModelId         string  `json:"modelid"`
      Stability       float32 `json:"stability"`
      SimilarityBoost float32 `json:"similarityboost"`
      Style           float32 `json:"style,omitempty"`
      SpeakerBoost    bool    `json:"speakerboost,omitempty"`
  }
  ```
- SDK `VoiceSettings` marshals to **`{stability, similarity_boost, style, use_speaker_boost}`** (Go field `SpeakerBoost` → JSON `use_speaker_boost`). **Correct wire names.** **[engine-code: `models.go:64-69`]**
- SDK `TextToSpeechRequest` marshals to `{text, model_id(omitempty), voice_settings(omitempty)}`. **[engine-code: `models.go:35-39`]**
- DB mapper round-trips the same four settings (`provider_mapper.go:132-155`).

### 5.3 Gaps / deprecations to fix
| Concern | Today | Should be |
|---------|-------|-----------|
| `style` sent unconditionally | Engine always includes `style` (omitempty, so 0 is dropped) | Gate by `can_use_style` from `/v1/models` (v4 rejects/ignores it) |
| `use_speaker_boost` sent unconditionally | Engine always includes it (omitempty, `false` dropped; default true) | Gate by `can_use_speaker_boost` |
| `speed` | **Not modelled at all** | Add; gate to v2-family models |
| `language_code` | **Not modelled** | Add; skip for `eleven_multilingual_v2` |
| `previous_text`/`next_text` | **Not modelled** | Add for chunk stitching |
| `output_format` | **Not used** (SDK QueryFunc exists) | Add as a config field (query param) |
| `apply_text_normalization` | **Not modelled** | Add (Enterprise-only on Flash) |
| `seed` | **Not modelled** | Optional |
| `enable_logging` | **Not modelled** | Optional (Enterprise ZRM) |
| `optimize_streaming_latency` | SDK exposes it; provider doesn't use it | **Do not add** — deprecated |
| v3 audio tags | No support | Out of scope for param mapping; note it as the v3/v4 expressivity mechanism |

---

## 6. Quirks

### 6.1 Error taxonomy
- Single envelope `{"detail": {...}}` for most errors; **422 uses `{"detail": [ ... ]}`** (list). **[src: https://elevenlabs.io/docs/eleven-api/resources/errors]**
- Full type→status map: `validation_error`/`invalid_request`→400, `authentication_error`→401, `payment_required`→402, `authorization_error`→403, `not_found`→404, `conflict`→409, `rate_limit_error`→429, `internal_error`→500, `service_unavailable`→503. **[src: same]**
- `status` inside `detail` is a **legacy** field — use `code`. **[src: same]**
- `param` identifies the offending field on validation errors. **[src: same]**

### 6.2 Character / credit quota semantics
- Characters (credits) are consumed **only** by generation (TTS/STT/music). Metadata reads are free. **[src: /models/list, /text-to-speech/convert]**
- Quota is per billing period; `character_count` vs `character_limit` from `/v1/user`. **[src: /user/get]**
- Overages: `can_extend_character_limit` / `max_credit_limit_extension` ("unlimited" = no cap, `0` = usage-based billing disabled). **[src: /user/subscription/get]**
- Insufficient credits → **402 `insufficient_credits`** (older docs also reference `quota_exceeded` on 400/401). **[src: /errors ; https://elevenlabs.io/docs/help-center/technical/api-error-code-400-or-401]**
- Higher output bitrates/sample rates require paid tiers (Creator+/Pro+). **[src: /text-to-speech/convert]**

### 6.3 Voice consent / licensing
- `sharing` on a voice carries `financial_rewards_enabled`, `free_users_allowed`, `live_moderation_enabled`, `rate`/`fiat_rate`, `notice_period`, `review_status` (`not_requested|pending|declined|allowed|allowed_with_changes`), `enabled_in_library`, `voice_mixing_allowed`. **[src: /voices/search]**
- `safety_control`: `NONE | BAN | CAPTCHA | ENTERPRISE_BAN | ENTERPRISE_CAPTCHA` — voices can be gated behind captcha/ban. **[src: same]**
- `voice_verification.requires_verification` / `is_verified` — PVC voices may require verification. **[src: same]**
- Shared-voice custom rates (`rate`, `fiat_rate` = USD/1000 credits) affect cost; filter with `include_custom_rates`. **[src: /voices/voice-library/get-shared]**
- Voice Library not available to free-tier API users. **[src: /overview/capabilities/text-to-speech]**

### 6.4 Region blocking / residency
- Five server hosts (global/US/EU/India/Singapore). A key may be bound to a residency; use the matching host. **[src: /models/list server block]**
- IP allowlisting on a key → non-allowlisted IPs get **403**. **[src: /administration/workspaces/api-keys]**

### 6.5 Rate limits / concurrency on validation calls
- **429** = either request rate limit (`rate_limit_exceeded`) or concurrency (`concurrent_limit_exceeded`) or `system_busy`. Use exponential backoff. **[src: /errors ; https://elevenlabs.io/blog/ai-rate-limiting-for-voice]**
- Concurrency limits are **plan-based** (Free Multilingual v2 = 2, Flash = 4, … Enterprise elevated) and tracked via response headers `current-concurrent-requests` / `maximum-concurrent-requests`. **[src: https://elevenlabs.io/docs/overview/models]**
- Metadata GETs (`/v1/user`, `/v1/models`, `/v2/voices`) are cheap and are not the concurrency-limited generation path, but they still count as API requests — don't hammer them; the "test key" button should be user-triggered and/or cached.
- Help-centre note: 429 has two meanings (rate vs concurrency). **[src: https://help.elevenlabs.io/hc/en-us/articles/19571824571921-API-Error-Code-429]**

---

## 7. Catalog seed table

### 7.1 Model lineup (as of 2026-10-18)

**Text-to-Speech (TTS) — usable via `POST /v1/text-to-speech/{voice_id}`:**
| `model_id` | Cap | Languages | Max chars/req | Notable params | Notes |
|------------|-----|-----------|---------------|----------------|-------|
| `eleven_v4` | TTS (+ Text-to-Dialogue multi-speaker) | 90+ | 10,000 | `stability`, `similarity_boost` only; audio tags; no style/speed/SSML | Flagship; best quality/cloning |
| `eleven_v4_turbo` | TTS realtime | 90+ | ~10,000 | audio tags; realtime | Served via Text to Dialogue WebSocket; ~100 ms |
| `eleven_v3` | TTS (+ multi-speaker) | 70+ | 5,000 | audio tags; expressive | Previous-gen flagship |
| `eleven_v3_conversational` | TTS realtime | 70+ | 5,000 | audio tags | ~280 ms; TDD WebSocket |
| `eleven_multilingual_v2` | TTS | 29 | 10,000 | `stability`, `similarity_boost`, `style`, `use_speaker_boost`; **no `language_code`** | Most stable long-form; **API default model** |
| `eleven_flash_v2_5` | TTS realtime | 32 | 40,000 | `apply_text_normalization` (Enterprise); speed settings partly ignored | ~75 ms; ~50% cheaper |
| `eleven_flash_v2` | TTS realtime | 1 (en) | 30,000 | — | ~75 ms; English-only |
| `eleven_turbo_v2_5` | TTS realtime | 32 | — | — | **DEPRECATED** → use `eleven_flash_v2_5` |
| `eleven_turbo_v2` | TTS realtime | 1 (en) | — | — | **DEPRECATED** → use `eleven_flash_v2` |
| `eleven_multilingual_v1`, `eleven_monolingual_v1` | TTS | — | 10,000 | — | **REMOVED 2026-07-09** |

**Speech-to-Text (STT):**
| `model_id` | Cap | Languages | Notes |
|------------|-----|-----------|-------|
| `scribe_v2` | STT (batch) | 90+ | diarization, entity detection, keyterms |
| `scribe_v2_realtime` | STT (streaming) | 90+ | ~150 ms; VAD |
| `scribe_v2_medical` | STT (batch, clinical) | 90+ | HIPAA-eligible with BAA + ZRM |
| `scribe_v1` | STT | 90+ | **DEPRECATED** → `scribe_v2` |

**Other model families (not TTS-picker relevant, listed for completeness):**
| `model_id` | Cap |
|------------|-----|
| `eleven_multilingual_sts_v2`, `eleven_english_sts_v2` | Speech-to-Speech (voice changer) |
| `eleven_ttv_v3`, `eleven_multilingual_ttv_v2` | Text-to-Voice (voice design) |
| `eleven_text_to_sound_v2` | Sound effects |
| `music_v2_5`, `music_v2`, `music_v1` | Music generation |
| (Agents LLMs) | via `GET /v1/convai/llm` — separate "List LLMs" endpoint |

**[src: https://elevenlabs.io/docs/overview/models ; https://elevenlabs.io/docs/changelog/2026/6/8 ; https://elevenlabs.io/docs/api-reference/llm/list]**

**Character limits (official table):** `eleven_v4` 10,000 · `eleven_v3` 5,000 · `eleven_flash_v2_5` 40,000 · `eleven_flash_v2` 30,000 · `eleven_multilingual_v2` 10,000 · `eleven_multilingual_v1` 10,000 · `eleven_english_sts_v2` 10,000. **[src: https://elevenlabs.io/docs/overview/models]**

> **Seed-table guidance:** treat this table as a *fallback/offline* seed. The authoritative, always-current source is **live `GET /v1/models`** — filter `can_do_text_to_speech`, honour `requires_alpha_access`, read `maximum_text_length_per_request` and `can_use_style`/`can_use_speaker_boost`. Do **not** rely on the deprecated `max_characters_request_*` fields.

### 7.2 Voice-listing strategy
- **Voices are per-account and must be fetched live — never catalogued.** They include the user's cloned/generated voices, workspace voices, saved community voices, and premade defaults; the set differs per API key. **[src: https://elevenlabs.io/docs/api-reference/voices/search]**
- For the **TTS "model picker"**, the voice list *is* the user-facing model choice. Fetch with `GET /v2/voices?page_size=100`, follow `has_more`/`next_page_token`, and optionally filter `voice_type`/`category`.
- The public **Voice Library** (`GET /v1/shared-voices`) is a separate browse/borrow flow and is unavailable to free-tier API users. **[src: https://elevenlabs.io/docs/api-reference/voices/voice-library/get-shared ; https://elevenlabs.io/docs/overview/capabilities/text-to-speech]**

---

## 8. Recommendations

### 8.1 Exact verify call
Use **`GET https://api.elevenlabs.io/v1/user`** with header `xi-api-key: <key>`.
- `200` → key valid; surface `subscription.tier`, `character_count`/`character_limit`, `status`, `next_character_count_reset_unix`, cloning flags.
- `401` (`authentication_error`) → invalid/expired key.
- `402` (`payment_required`) → valid key, no credits.
- `403` (`authorization_error`) → valid key but blocked (IP allowlist / scope / plan). **Do not label "invalid".**
- `429` (`rate_limit_error`) → transient; backoff+retry.
- If you only need plan/quota detail (no user/seat data), `GET /v1/user/subscription` is an equally cheap alternative.

### 8.2 Exact models + voices calls
- **Models:** `GET https://api.elevenlabs.io/v1/models` → filter `can_do_text_to_speech == true && !requires_alpha_access`; use `model_id`, `name`, `description`, `maximum_text_length_per_request`, `can_use_style`, `can_use_speaker_boost`, `languages`.
- **Voices:** `GET https://api.elevenlabs.io/v2/voices?page_size=100` → paginate via `has_more`/`next_page_token`; map `voice_id`, `name`, `category`, `labels`, `preview_url`, `verified_languages`, `settings`, `is_owner`.
- **Voice preview audio:** `preview_url` on each voice (no extra API call).
- **Do not** keep using `GET /v1/voices` for new work — migrate to `/v2/voices`.

### 8.3 Capability-source verdict
- **Primary:** live `GET /v1/models` flags. It is the only machine-readable, always-current capability source and it already encodes the two most important gates (`can_use_style`, `can_use_speaker_boost`) plus `maximum_text_length_per_request`.
- **Secondary (embedded catalog):** a small seed table (this §7) for offline/optimistic UI and for params the API does not flag (`language_code` unsupported on multilingual v2; `speed` v2-only; `apply_text_normalization` Enterprise-only on Flash; `enable_logging=false` Enterprise-only; audio-tags/SSML per family).
- **Not viable:** scraping the docs table at runtime (prose, no stable schema). Do not treat the docs prose as the runtime source of truth.

### 8.4 Engine client notes (what our client does right / wrong)
**Right:**
- Wire names for `voice_settings` are correct (`stability`, `similarity_boost`, `style`, `use_speaker_boost`). **[engine-code]**
- Base URL and `xi-api-key` header are correct. **[engine-code]**
- `GetModels`/`GetUser`/`GetSubscription` exist in the vendored SDK and can be wired in with minimal effort. **[engine-code]**

**Wrong / missing (fix before shipping the three features):**
1. **`ValidateConfig` uses `GetVoices()` (legacy `/v1/voices`)** — should call `GET /v1/user` (or `/v1/user/subscription`) instead; gives plan/quota UI data and is lighter. **[engine-code: `elevenlabs.go:70-78`]**
2. **Error fidelity is lost by the vendored SDK.** Only 400/401/422 are parsed; 402/403/429 collapse to a generic `"unexpected HTTP status"` string with the body discarded, so the UI cannot show "invalid key" vs "blocked" vs "rate limited". **Recommendation:** implement key validation (and ideally all provider calls) with a thin native HTTP client that parses the full `{"detail":{type,code,message,request_id,param}}` envelope, or bump/replace the SDK. **[engine-code: `client.go:113-134`]**
3. **Stale error structs.** `APIError.Detail` only models `{status, message, additional_info}`; current API adds `type`, `code`, `request_id`, `param`. (The `message` field still maps, so messages survive; the discriminators do not.) **[engine-code: `errors.go:11-20`]**
4. **Voice listing uses the deprecated endpoint and an incomplete struct** — migrate to `/v2/voices` and extend the `Voice` model with `verified_languages`, `is_owner`, `is_legacy`, `safety_control`, `settings.speed`. **[engine-code: `client.go:263-276`, `models.go:49-62`]**
5. **Model listing unused & struct stale** — wire in `GetModels` and read `maximum_text_length_per_request` + capability flags; drop the deprecated `max_characters_request_*`. **[engine-code: `models.go:18-33`]**
6. **Params are sent unconditionally.** `style`/`use_speaker_boost` should be gated by `/v1/models` capability flags; `speed`, `language_code`, `previous_text`/`next_text`, `output_format`, `apply_text_normalization`, `seed`, `enable_logging` are not modelled at all. Add a capability-aware settings layer (see §5.3). **[engine-code: `elevenlabs.go:53-58`, `config/types.go:460-468`]**
7. **No regional host support** — the SDK hard-codes `api.elevenlabs.io`. If EU/US/India/Singapore residency is needed, the base URL must become configurable. **[engine-code: `client.go:19`]**

---

## Appendix A — Source URLs
- Auth: https://elevenlabs.io/docs/api-reference/authentication
- Get user: https://elevenlabs.io/docs/api-reference/user/get
- Get subscription: https://elevenlabs.io/docs/api-reference/user/subscription/get
- List models: https://elevenlabs.io/docs/api-reference/models/list
- List voices (v2): https://elevenlabs.io/docs/api-reference/voices/search
- List shared voices: https://elevenlabs.io/docs/api-reference/voices/voice-library/get-shared
- Get voice: https://elevenlabs.io/docs/api-reference/voices/get
- Create speech: https://elevenlabs.io/docs/api-reference/text-to-speech/convert
- Errors: https://elevenlabs.io/docs/eleven-api/resources/errors
- Models overview: https://elevenlabs.io/docs/overview/models
- TTS capability: https://elevenlabs.io/docs/overview/capabilities/text-to-speech
- TTS product guide (speed/v3): https://elevenlabs.io/docs/eleven-creative/playground/text-to-speech
- API keys: https://elevenlabs.io/docs/overview/administration/workspaces/api-keys
- Breaking changes policy: https://elevenlabs.io/docs/eleven-api/resources/breaking-changes-policy
- Changelog (v1 model removal): https://elevenlabs.io/docs/changelog/2026/6/8
- Changelog (optimize_streaming_latency deprecation): https://elevenlabs.io/docs/changelog/2026/7/13
- Changelog (voices list changes): https://elevenlabs.io/docs/changelog/2026/6/15
- Official skills repo — voice settings: https://github.com/elevenlabs/skills/blob/main/text-to-speech/references/voice-settings.md
- Rate limiting blog: https://elevenlabs.io/blog/ai-rate-limiting-for-voice
- Help centre 429: https://help.elevenlabs.io/hc/en-us/articles/19571824571921-API-Error-Code-429
- Help centre 400/401: https://elevenlabs.io/docs/help-center/technical/api-error-code-400-or-401
- Community (key `sk_` prefix): https://www.reddit.com/r/ElevenLabs/comments/1vgybun/ ; https://forum.convai.com/t/elevenlabs-new-api-key-sk-update/6466
- Community (v1/voices → v2/voices migration): https://jv.wordpress.com/plugins/ls-ai-provider-for-elevenlabs/ ; https://tonsofskills.com/skills/elevenlabs-upgrade-migration/

## Appendix B — Engine-code references
- `providers/elevenlabs.go` — `ValidateConfig` (70-78), `FromConfig` (45-60), `RenderSpeech` (84-105)
- `config/types.go` — `ElevenlabsConfig` (460-468)
- `database/controllers/provider_mapper.go` — `extractElevenlabsToModel`/`loadElevenlabsFromModel` (132-155)
- Vendored SDK `github.com/haguro/elevenlabs-go@v0.2.4`:
  - `client.go` — base URL (19), `doRequest` error handling (84-138), `TextToSpeech` (210-221), `GetModels` (245-258), `GetVoices` (263-276), `GetUser` (552-565), `GetSubscription` (531-544), QueryFuncs (140-200)
  - `models.go` — `Model` (18-33), `TextToSpeechRequest` (35-39), `Voice` (49-62), `VoiceSettings` (64-69), `Subscription` (186-205), `User` (212-219)
  - `errors.go` — `APIError` (11-20), `ValidationError` (27-42)
