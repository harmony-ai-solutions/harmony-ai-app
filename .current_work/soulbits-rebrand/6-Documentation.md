# Phase 6: Documentation Update

> **Goal**: Update all documentation files referencing "Harmony Link" / "harmony-link" to the new naming.

## Files to Modify

| File | Changes |
|------|---------|
| `.github/workflows/build-release.yml` | Comment references to `harmony-link-private`, checkout path |
| `CONTRIBUTING.md:20` | Reference to `harmony-link-private` |
| `docs/CLOUD-CONNECTION.md:32,41,108` | Keychain service name `com.harmonyai.cloud.auth` → `com.soulbits.cloud.auth`, `harmony_jwt` → `soulbits_jwt` |
| `docs/future-work.md` | Multiple references to `harmony-link-private`, `soulbits/harmony-link:latest`, `harmony-link server`, `HL_` config refs |
| `docs/HARMONY-LINK-INTEGRATION.md` | Entire doc (title, URLs, diagrams) — this is a large doc |
| `docs/INSTALLATION.md:13-14` | Bundle ID comments `com.harmonyai.app` |
| `docs/RELEASE.md:103` | `HARMONY_LINK_REPO_PAT` secret name |
| `docs/schema-parity.md` | Path references to `harmony-link-private` |
| `docs/TESTING.md` | References to `harmony-link`, `harmonyai/harmony-link`, `soulbits/harmony-link` |
| `e2e/README.md` | Container names, image names, build commands |
| `e2e/.maestro/*.yaml` | References to `harmony-link` container/logs |

## Notes

- Many docs reference the GitHub repo at `github.com/harmony-ai-solutions/harmony-link-private` — this repo will be migrated to a new GitHub org (soulbitsai or similar) as part of the rebrand, so references to the current repo URL should also be updated to anticipate the new org.
- Doc references to `harmony-link` as a concept (the middleware product name) should be updated to `soulbits-engine` where appropriate.
- External URLs (youtrack, patreon, discord) should remain as-is.
