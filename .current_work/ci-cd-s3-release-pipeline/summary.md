# CI/CD S3 Release Pipeline — Implementation Plan

## Overview

Implement a GitHub Actions workflow that builds tagged versions of the Harmony AI App (Android APK + iOS IPA) and pushes the binaries to a new centralized S3 bucket (`soulbits-releases`). The bucket is managed via tofu in the soulbits-cloud-backend shared infrastructure and uses path-based separation (`app/`, `engine/`) for multi-project support.

**Cross-repository**: This plan spans two repositories:
- **soulbits-cloud-backend** — tofu infrastructure (Phase 1)
- **harmony-ai-app** — build pipeline, signing config, and documentation (Phases 2–4)

## Key Design Decisions

- **S3 bucket**: New tofu-managed `soulbits-releases` in shared infrastructure (replaces ad-hoc `harmony-ai-releases`)
- **iOS**: Unsigned IPA for sideloading via Sideloadly/AltStore (no Apple Developer Program needed initially)
- **Android**: Release keystore for proper APK signing (replaces debug keystore placeholder)
- **AWS auth**: Static credentials (consistent with existing Harmony Link pattern); OIDC as future improvement
- **Trigger**: Tag-based (`v*`) + manual `workflow_dispatch` (same pattern as Harmony Link)

## Phases

- **Phase 1: Tofu Infrastructure** — Create S3 bucket module, integrate into shared environment, create CI IAM user
- **Phase 2: Android Signing Setup** — Configure Gradle for env-based signing, generate keystore, set up GitHub secrets
- **Phase 3: GitHub Actions Workflow** — Create build-release.yml with Android + iOS jobs, IPA packaging script
- **Phase 4: Documentation** — Update README, create installation guide, update changelog

## S3 Path Structure

```
s3://soulbits-releases/
├── app/                              ← Harmony AI App
│   └── v0.1.0/
│       ├── harmony-ai-app-v0.1.0-android.apk
│       └── harmony-ai-app-v0.1.0-ios.ipa
├── engine/                           ← Harmony Link (future migration target)
│   └── v0.5.0/
│       ├── harmony-link-v0.5.0_windows_amd64.zip
│       └── harmony-link-v0.5.0_linux_amd64.zip
```

## Codebase Mapping References

- `.planning/codebase/ARCHITECTURE.md` — consulted for build system and project structure
- `.planning/codebase/CONVENTIONS.md` — consulted for coding patterns and file organization

## Implementation Status

Track the completion of each phase as implementation progresses:

- [ ] **Phase 1: Tofu Infrastructure** (soulbits-cloud-backend repo)
  - [ ] S3 Releases Tofu Module ([1-1-S3ReleasesTofuModule.md](1-1-S3ReleasesTofuModule.md))
  - [ ] Shared Environment Integration ([1-2-SharedEnvironmentIntegration.md](1-2-SharedEnvironmentIntegration.md))
  - [ ] CI IAM User and Policy ([1-3-CIIAMUser.md](1-3-CIIAMUser.md))
- [ ] **Phase 2: Android Signing Setup** (harmony-ai-app repo)
  - [ ] Android Signing Config ([2-1-AndroidSigningConfig.md](2-1-AndroidSigningConfig.md))
  - [ ] Keystore Generation and GitHub Secrets ([2-2-KeystoreGenerationSecrets.md](2-2-KeystoreGenerationSecrets.md))
- [ ] **Phase 3: GitHub Actions Workflow** (harmony-ai-app repo)
  - [ ] Build Release Workflow ([3-1-BuildReleaseWorkflow.md](3-1-BuildReleaseWorkflow.md))
  - [ ] iOS IPA Packaging Script ([3-2-IOSIPAPackagingScript.md](3-2-IOSIPAPackagingScript.md))
- [ ] **Phase 4: Documentation** (harmony-ai-app repo)
  - [ ] Documentation Update ([4-1-DocumentationUpdate.md](4-1-DocumentationUpdate.md))

## Future Considerations

1. **Harmony Link migration**: Update Harmony Link's `build.yml` to push to `s3://soulbits-releases/engine/`
2. **OIDC authentication**: Replace static AWS credentials with per-repo OIDC-trusted IAM roles
3. **Apple Developer Program**: Upgrade iOS builds to signed IPA + TestFlight distribution
4. **AAB builds**: Add Android App Bundle support for Google Play Store
5. **Checksums**: Generate SHA256 checksums alongside binaries for integrity verification
