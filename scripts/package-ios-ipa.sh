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
