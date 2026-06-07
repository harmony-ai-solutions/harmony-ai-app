# Phase 3-2: iOS IPA Packaging Script

## Objective

Create a shell script that packages an unsigned `.app` bundle into a valid `.ipa` file for sideloading distribution.

## Repository

**harmony-ai-app** (current workspace)

## Background

iOS apps are distributed as `.ipa` files (iPhone Application Archive). An IPA is simply a ZIP archive with a specific directory structure:

```
Payload/
  └── HarmonyAIChat.app/    ← the compiled app bundle
```

When `xcodebuild` produces an unsigned build via `CODE_SIGNING_ALLOWED=NO`, the output is a `.app` bundle inside an `.xcarchive`. This script extracts the `.app` and packages it into a valid `.ipa`.

## Files to Create

### `scripts/package-ios-ipa.sh`

```bash
#!/bin/bash
# Package an unsigned .app bundle into an .ipa file for sideloading.
#
# Usage: ./scripts/package-ios-ipa.sh <path-to-app-bundle> <output-ipa-path>
#
# Example:
#   ./scripts/package-ios-ipa.sh \
#     ios/build/HarmonyAIChat.xcarchive/Products/Applications/HarmonyAIChat.app \
#     harmony-ai-app-v0.1.0-ios.ipa

set -euo pipefail

APP_PATH="${1:?Error: Missing .app bundle path argument}"
IPA_PATH="${2:?Error: Missing output .ipa path argument}"

if [ ! -d "$APP_PATH" ]; then
    echo "Error: App bundle not found at $APP_PATH"
    exit 1
fi

# Create a temporary directory for the IPA payload
TMP_DIR=$(mktemp -d)
trap "rm -rf $TMP_DIR" EXIT

# Create the Payload directory structure
mkdir -p "$TMP_DIR/Payload"

# Copy the .app bundle into Payload/
cp -r "$APP_PATH" "$TMP_DIR/Payload/"

# Create the .ipa (ZIP archive with .ipa extension)
cd "$TMP_DIR"
zip -r "$IPA_PATH" Payload/

echo "✅ IPA created: $IPA_PATH"
echo "   Size: $(du -h "$IPA_PATH" | cut -f1)"
```

## Usage in CI

Called by the GitHub Actions workflow (Phase 3-1):

```yaml
- name: Package unsigned IPA
  run: |
    chmod +x scripts/package-ios-ipa.sh
    ./scripts/package-ios-ipa.sh \
      ios/build/HarmonyAIChat.xcarchive/Products/Applications/HarmonyAIChat.app \
      harmony-ai-app-${VERSION}-ios.ipa
```

## Notes

- The script uses `mktemp -d` with a `trap` for cleanup — no leftover temp files
- The `zip` command must be run from inside the temp directory to get the correct archive structure (Payload/ as root)
- The resulting `.ipa` is valid for sideloading with Sideloadly, AltStore, etc.
- Users will need to re-sign the IPA with their own Apple ID via the sideloading tool

## Progress Checklist

- [ ] Create `scripts/package-ios-ipa.sh`
- [ ] Make script executable (`chmod +x`)
- [ ] Test script locally if a macOS environment is available
- [ ] Verify the IPA structure: `unzip -l harmony-ai-app-*-ios.ipa` should show `Payload/HarmonyAIChat.app/`
