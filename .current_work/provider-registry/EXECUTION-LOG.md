# Provider Registry — Execution Log

Orchestrated run started 2026-10-18 (owner go). Model: two serial chains in
parallel (A1); code-expert subagents implement, never commit; main session
gates + commits per phase. Contract: plan.md (R1–R12, A1–A11) + summary.md.

Legend: ⏳ running · ✅ committed · ⏸ paused/blocked · ⬜ queued

## Pre-tasks
- ✅ R-AUDIO → research/ollama-audio.md (2026-10-18). Verdict: Ollama audio = **STT only** (`POST /v1/audio/transcriptions`, multipart, experimental, server ≥ v0.20.0, text-only response, gemma4 e2b/e4b/12b); **no TTS, no VAD** (stock Ollama). 4-8 implements stt-experimental only; 6-5 adds ollama to transcription picker (labeled experimental), NOT tts/VAD. 7 unknowns flagged for live probes.
- ✅ R-MD → research/modelsdev-catalog.md (2026-10-18). MIT corroborated (`github.com/anomalyco/models.dev`, LICENSE (c) 2025, covers code+data; attribution header in 5-2). Schema: flat provider map, 232 providers / 9,048 models; `temperature` bool = gated-emission signal; voice/STT absent from api.json (stays hand-curated); snapshot-at-release pinning + go:embed. Gates 5-2 codegen.

## Engine chain (harmony-link-private, serial)
- ⏳ 1-1 competitor removal · ⬜ 3-1 · ⬜ 3-2 · ⬜ 3-3 · ⬜ 4-1..4-13 · ⬜ 5-1 · ⬜ 5-2

## App chain (harmony-ai-app, serial; 6-1 holds for engine 3-2+5-1)
- ✅ 1-2 competitor removal — 12 files, −701 lines; 13-member ProviderConfig union; 10 picker types; tsc+jest green (1490/1490)
- ⏳ 2-1 model catalog + pickers · ⬜ 2-2 · ⬜ 6-1..6-5

## Release
- ⬜ 7-1 docs + dev-channel release (after both chains)

## Event log
- 2026-10-18: wave 1 dispatched — R-AUDIO, R-MD, engine 1-1, app 1-2.
