# Phase 4-1: Documentation Update

## Objective

Update project documentation with download links, installation instructions, and changelog entries for the new CI/CD release pipeline.

## Repository

**harmony-ai-app** (current workspace)

## Files to Modify

### 1. `README.md`

Add a **Downloads** section near the top of the README (after the project description, before the technical details):

```markdown
## Downloads

Pre-built binaries are available for tagged releases:

| Platform | Download | Install Guide |
|----------|----------|---------------|
| Android | [Latest APK](https://soulbits-releases.s3.eu-central-1.amazonaws.com/app/LATEST/) | Enable "Install from unknown sources" → download → open |
| iOS | [Latest IPA](https://soulbits-releases.s3.eu-central-1.amazonaws.com/app/LATEST/) | Requires sideloading via [Sideloadly](https://sideloadly.io/) or [AltStore](https://altstore.io/) |

See [INSTALLATION.md](docs/INSTALLATION.md) for detailed instructions.
```

**Note**: The `LATEST` path above is a placeholder. If needed, add a small `latest` redirect object in S3, or link to a specific version page. Alternatively, just document the versioned URL pattern:

```
https://soulbits-releases.s3.eu-central-1.amazonaws.com/app/v{VERSION}/harmony-ai-app-v{VERSION}-android.apk
```

### 2. `docs/INSTALLATION.md` (new file)

Create a comprehensive installation guide:

```markdown
# Installation Guide

## Android

### Requirements
- Android 7.0 (API 24) or higher
- "Install from unknown sources" enabled in device settings

### Steps
1. Download the latest APK from the [releases page](https://github.com/harmony-ai-solutions/harmony-ai-app/tags)
2. Open the downloaded `.apk` file
3. Confirm installation when prompted
4. Open the app and configure your Harmony Link connection

### Updating
Download and install the new APK over the existing one. Your data is preserved.

## iOS (Sideloading)

> ⚠️ iOS installation requires sideloading tools. The app is provided as an unsigned IPA
> and must be signed with your Apple ID before installation.

### Requirements
- iOS 15.0 or higher
- A computer (Windows/Mac) with one of the sideloading tools below
- A free Apple ID

### Method 1: Sideloadly (Recommended)

1. Download and install [Sideloadly](https://sideloadly.io/) on your PC/Mac
2. Download the latest `.ipa` file from [releases](https://github.com/harmony-ai-solutions/harmony-ai-app/tags)
3. Open Sideloadly and drag the `.ipa` file into it
4. Enter your Apple ID when prompted
5. Click "Start" to sign and install the app
6. On your iOS device, go to Settings → General → VPN & Device Management
7. Trust the developer certificate associated with your Apple ID
8. Open the app and configure your Harmony Link connection

**Note**: Free Apple ID signing expires after 7 days. Re-sign weekly via Sideloadly.

### Method 2: AltStore

1. Install [AltStore](https://altstore.io/) on your iOS device (requires a PC/Mac on the same network)
2. Download the latest `.ipa` file
3. Open the `.ipa` file with AltStore
4. AltStore will sign and install the app
5. AltStore auto-refreshes the signing in the background (keep your PC/Mac running periodically)

### Updating
Download the new `.ipa` and reinstall via your sideloading tool. App data should be preserved.
```

### 3. `CHANGELOG.md`

Add an entry for the CI/CD pipeline:

```markdown
## [Unreleased]

### Added
- CI/CD release pipeline: automated APK and IPA builds on tagged releases
- Pre-built binaries available for public download via S3
- Android release signing with dedicated keystore
- Unsigned IPA for iOS sideloading via Sideloadly/AltStore
```

## Cross-Repo Dependency

⚠️ **Depends on Phase 3-1** — the download URLs should only be documented after the pipeline is verified working.

## Progress Checklist

- [ ] Add Downloads section to `README.md`
- [ ] Create `docs/INSTALLATION.md` with Android and iOS install guides
- [ ] Add changelog entry to `CHANGELOG.md`
- [ ] Verify download URLs are correct and publicly accessible
