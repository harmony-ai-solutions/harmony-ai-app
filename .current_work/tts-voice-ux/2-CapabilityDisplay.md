# Phase 2: Capability Display (TTS config card)

## Objective

Show the user WHAT their selected voice can do — cues / tones / breaks, each
with its mode and vocabulary size — directly in the TTS config card. Replace
the Chatterbox-only flat tag pills with a kinded "Voice expression" block.

Depends on: Phase 1 (`getAudioTagCapabilities`).

## Context (verified)

- `ProviderSlotSection.tsx:1223-1266` renders "Chatterbox Expressivity &
  Prosody" + "Paralinguistic Tags (supported inline in utterances)" pills,
  gated on `hasChatterbox` (exaggeration / cfg_weight params). EL v3/v4 (63
  derived tags) show NOTHING; Chatterbox base/multilingual show a stale 5-tag
  fallback (deleted in Phase 1).
- `speechOptions` there comes from `resolveEffectiveSpeechOptions(selectedModel,
  currentModelId, state.providerType)` (`:428-431`), where `selectedModel` may
  be a LIVE descriptor without `audio_tags`. Use the Phase-1 catalog lookup by
  `state.providerType` + `currentModelId` instead; `catalog` is already in
  scope (`:383`).
- Engine semantics to communicate:
  - `open` — arbitrary nonverbal/delivery spans accepted (EL v3/v4).
  - `closed` — fixed whitelist only (Chatterbox Turbo).
  - `none` — no tags; delivery guides are STRIPPED, never spoken aloud
    (EL v2 family officially speaks delivery guides aloud — a warning here is
    valuable).
- Badges already exist in the file (`renderCardBadge`, `metaBadge` styles) and
  can be reused with tone variants (purple accent, cyan, muted warning).

## Design

A collapsible "Voice expression" block under the model field:

```
Voice expression                         [engine-seeded ▾]
┌──────────────┬──────────────┬──────────────┐
│ Cues · 12    │ Tones · 48   │ Breaks · 3   │
│ [OPEN]       │ [OPEN]       │ [OPEN]       │
└──────────────┴──────────────┴──────────────┘
Audio tags are translated at synthesis — chat text always uses *asterisks*.
```

States:
- **EL v3/v4** — 3 kind cards (OPEN), 63 total. Counts from vocabulary lengths.
- **Chatterbox Turbo** — Cues 9 / Tones 10 (CLOSED), no breaks card (or a
  dimmed "—" card), note "fixed token set".
- **No block / all none** — single muted row: "No audio tags on this model.
  Delivery guides are stripped, never read aloud." No pills, no pickers.
- **Old engine (no `audio_tags`)** — if the flat `paralinguistic_tags` list is
  non-empty, show a single legacy "Supported tags · N" row (no kinds); else the
  none-state. Clearly marked "basic metadata — update engine for details".

A tappable kind card can open the corresponding picker section (Phase 3) from
the config card, but v1 may keep it informational only — decide during
implementation; prefer informational + one "Try in test studio" link to the
test block to avoid duplicated picker logic.

## Steps

1. In `renderCapabilityContent` (TTS branch), resolve
   `capabilities = getAudioTagCapabilities(catalog, state.providerType, currentModelId)`.
2. Add `renderVoiceExpression()` producing the block above; insert after the
   model field / embedding notice, before voice pickers (position 2b).
3. Remove the `paralinguisticTags` pills section (`:1249-1264`) and the
   `paralinguisticTags` const; keep the Chatterbox prosody sliders (4b) intact.
4. Reuse `styles.metaBadge`, `styles.tagPill`, `styles.prosodyBlock`; add a
   `styles.kindGrid` (auto-fit columns, matching `threeColRow` conventions).
5. Accessibility: each card gets `accessibilityRole="text"` + a label like
   "Cues, open, 12 tags"; the none-state gets a `testID="tts-no-audio-tags"`.
6. i18n keys (Phase 7): `voiceExpressionTitle`, `tagKindCues`, `tagKindTones`,
   `tagKindBreaks`, `tagModeOpen`, `tagModeClosed`, `tagModeNone`,
   `audioTagsNoneHint`, `audioTagsLegacyHint`, `audioTagsBoundaryHint`.

## Files

- `src/components/config/ProviderSlotSection.tsx`
- `src/components/config/__tests__/ProviderSlotSection.test.tsx`
- `src/components/config/__tests__/ttsVoiceOptions.test.ts` (if affected)

## Tests

- EL v3 model → 3 OPEN cards, counts 12/48/3, no legacy pills.
- Turbo → CLOSED cues/tones, no breaks card.
- `chatterbox_multilingual` / `eleven_multilingual_v2` → none-state, no pills.
- Old-engine fixture (flat tags only) → legacy row, no fabricated kinds.
- Live-model descriptor without `audio_tags` → still resolves via catalog.
- RNTL v14: `render`/`fireEvent` are Promises; judge by "Test Suites: N passed".

## Checklist

- [ ] Kinded "Voice expression" block renders for tagged models
- [ ] None-state + v2 warning renders for tag-free models
- [ ] Chatterbox-only pills removed; prosody sliders untouched
- [ ] Live/catalog resolution works through Phase-1 accessor
- [ ] Tests above pass; nothing committed
