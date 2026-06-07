# Phase 3-1: Build Release Workflow

## Objective

Create the GitHub Actions workflow that builds Android APK and iOS IPA on tagged releases and uploads them to the `soulbits-releases` S3 bucket.

## Repository

**harmony-ai-app** (current workspace)

## Reference Files

- `harmony-link-private/.github/workflows/build.yml` — Harmony Link workflow (tag trigger pattern, VERSION extraction, AWS upload)
- `android/app/build.gradle` — Android build config (modified in Phase 2-1)
- `package.json` — Node dependencies and scripts

## Files to Create

### `.github/workflows/build-release.yml`

```yaml
name: Build Release

on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:
    inputs:
      version:
        description: 'Version number for the build'
        default: 'v0.0.0-dev'

jobs:
  # ──────────────────────────────────────────────
  # Job 1: Build Android APK
  # ──────────────────────────────────────────────
  build-android:
    name: Build Android APK
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v5

      - name: Setup Node.js
        uses: actions/setup-node@v5
        with:
          node-version: '20'
          cache: 'npm'

      - name: Setup JDK 17
        uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '17'

      - name: Install dependencies
        run: npm ci

      - name: Set VERSION variable
        run: |
          INPUTS_VERSION='${{ github.event.inputs.version }}'
          if [[ "${GITHUB_REF}" == refs/tags/* ]]; then
            VERSION="${GITHUB_REF#refs/tags/}"
          elif [[ "${GITHUB_EVENT_NAME}" == 'workflow_dispatch' && -n "${INPUTS_VERSION}" ]]; then
            VERSION="${INPUTS_VERSION}"
          else
            VERSION="v0.0.0-dev"
          fi
          echo "VERSION=${VERSION}" >> $GITHUB_ENV

      - name: Decode release keystore
        run: |
          echo "${{ secrets.ANDROID_RELEASE_KEYSTORE_BASE64 }}" | base64 -d > android/app/release.keystore

      - name: Build release APK
        working-directory: android
        env:
          RELEASE_KEYSTORE_FILE: release.keystore
          RELEASE_KEYSTORE_PASSWORD: ${{ secrets.ANDROID_RELEASE_KEYSTORE_PASSWORD }}
          RELEASE_KEY_ALIAS: ${{ secrets.ANDROID_RELEASE_KEY_ALIAS }}
          RELEASE_KEY_PASSWORD: ${{ secrets.ANDROID_RELEASE_KEY_PASSWORD }}
        run: |
          # Update versionName in build.gradle
          sed -i "s/versionName \"[^\"]*\"/versionName \"${VERSION}\"/" app/build.gradle
          ./gradlew assembleRelease

      - name: Configure AWS Credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_S3_UPLOAD_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_S3_UPLOAD_SECRET_ACCESS_KEY }}
          aws-region: eu-central-1

      - name: Upload APK to S3
        run: |
          APK_PATH="android/app/build/outputs/apk/release/app-release.apk"
          S3_PATH="s3://soulbits-releases/app/${VERSION}/harmony-ai-app-${VERSION}-android.apk"
          echo "Uploading ${APK_PATH} to ${S3_PATH}"
          aws s3 cp "${APK_PATH}" "${S3_PATH}"

      - name: Print download URL
        run: |
          echo "✅ APK uploaded successfully!"
          echo "📥 Download URL: https://soulbits-releases.s3.eu-central-1.amazonaws.com/app/${VERSION}/harmony-ai-app-${VERSION}-android.apk"

  # ──────────────────────────────────────────────
  # Job 2: Build iOS IPA (unsigned, for sideloading)
  # ──────────────────────────────────────────────
  build-ios:
    name: Build iOS IPA
    runs-on: macos-14

    steps:
      - name: Checkout code
        uses: actions/checkout@v5

      - name: Setup Node.js
        uses: actions/setup-node@v5
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Install CocoaPods
        run: |
          cd ios
          pod install

      - name: Set VERSION variable
        run: |
          INPUTS_VERSION='${{ github.event.inputs.version }}'
          if [[ "${GITHUB_REF}" == refs/tags/* ]]; then
            VERSION="${GITHUB_REF#refs/tags/}"
          elif [[ "${GITHUB_EVENT_NAME}" == 'workflow_dispatch' && -n "${INPUTS_VERSION}" ]]; then
            VERSION="${INPUTS_VERSION}"
          else
            VERSION="v0.0.0-dev"
          fi
          echo "VERSION=${VERSION}" >> $GITHUB_ENV

      - name: Build unsigned iOS app
        working-directory: ios
        run: |
          xcodebuild \
            -workspace HarmonyAIChat.xcworkspace \
            -scheme HarmonyAIChat \
            -sdk iphoneos \
            -configuration Release \
            CODE_SIGNING_ALLOWED=NO \
            CODE_SIGNING_REQUIRED=NO \
            CODE_SIGN_IDENTITY="" \
            -derivedDataPath build \
            clean archive \
            -archivePath build/HarmonyAIChat.xcarchive

      - name: Package unsigned IPA
        run: |
          chmod +x scripts/package-ios-ipa.sh
          ./scripts/package-ios-ipa.sh \
            ios/build/HarmonyAIChat.xcarchive/Products/Applications/HarmonyAIChat.app \
            harmony-ai-app-${VERSION}-ios.ipa

      - name: Configure AWS Credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_S3_UPLOAD_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_S3_UPLOAD_SECRET_ACCESS_KEY }}
          aws-region: eu-central-1

      - name: Upload IPA to S3
        run: |
          S3_PATH="s3://soulbits-releases/app/${VERSION}/harmony-ai-app-${VERSION}-ios.ipa"
          echo "Uploading IPA to ${S3_PATH}"
          aws s3 cp "harmony-ai-app-${VERSION}-ios.ipa" "${S3_PATH}"

      - name: Print download URL
        run: |
          echo "✅ IPA uploaded successfully!"
          echo "📥 Download URL: https://soulbits-releases.s3.eu-central-1.amazonaws.com/app/${VERSION}/harmony-ai-app-${VERSION}-ios.ipa"
```

## Key Design Decisions

- **Separate jobs** for Android and iOS — they can run in parallel and have independent failure modes
- **macos-14 runner** for iOS — required for Xcode (ubuntu can't build iOS)
- **Version from tag** — follows Harmony Link's pattern; falls back to `workflow_dispatch` input or `v0.0.0-dev`
- **`sed` for version injection** — updates `versionName` in `build.gradle` before building
- **Unsigned IPA** — `CODE_SIGNING_ALLOWED=NO` produces an unsigned build suitable for sideloading
- **Region `eu-central-1`** — consistent with soulbits-cloud-backend infrastructure

## Cross-Repo Dependencies

⚠️ **Depends on**:
- Phase 1-3: AWS credentials must exist as GitHub secrets
- Phase 2-1: `build.gradle` must have release signing config
- Phase 2-2: Release keystore must be stored as GitHub secrets
- Phase 3-2: `scripts/package-ios-ipa.sh` must exist

## Testing

1. **Manual test** with `workflow_dispatch`:
   - Go to Actions → Build Release → Run workflow → set version `v0.0.0-test`
   - Verify both jobs complete
   - Verify APK and IPA appear at `s3://soulbits-releases/app/v0.0.0-test/`
2. **Tag test**: Push a test tag and verify the tag-triggered flow works

## Progress Checklist

- [ ] Create `.github/workflows/build-release.yml`
- [ ] Test with `workflow_dispatch` using `v0.0.0-test`
- [ ] Verify APK is signed correctly (check APK signature on download)
- [ ] Verify IPA is a valid unsigned archive
- [ ] Verify both artifacts are downloadable from S3 public URL
