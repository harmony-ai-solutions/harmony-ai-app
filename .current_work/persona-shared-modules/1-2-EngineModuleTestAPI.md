# 1-2 — Engine: Module Test API — **REMOVED (superseded)**

> **Status: REMOVED by user correction 2026-09-02.** The management server is NOT reachable via cloud — the app must never call it for feature traffic. The intended transport is the **eventserver protocol** with existing STT/TTS events (see 1-3 for the transient debug session type; 2-2/2-3 rewritten accordingly).
>
> Commit `490cca2` (the `/api/modules/test/*` endpoints + tests) is to be DELETED in phase 1-3. This document is retained for plan history only — do not implement anything from it.
