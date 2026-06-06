# Phase 2-1: Android Signing Config

## Objective

Update `android/app/build.gradle` to support reading the release signing keystore from environment variables, replacing the current hardcoded debug keystore for release builds.

## Repository

**harmony-ai-app** (current workspace)

## Reference Files

- `android/app/build.gradle` — current signing config (lines 57–72)
- `android/gradle.properties` — project-level Gradle properties
- Reference: [React Native Signed APK docs](https://reactnative.dev/docs/signed-apk-android)

## Background

The current release build type in `android/app/build.gradle` signs with the debug keystore:

```groovy
release {
    // Caution! In production, you need to generate your own keystore file.
    signingConfig signingConfigs.debug  // ← PLACEHOLDER
    minifyEnabled enableProguardInReleaseBuilds
    proguardFiles getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro"
}
```

This must be changed to use a proper release keystore loaded from environment variables or Gradle properties.

## Implementation

### 1. Modify `android/app/build.gradle`

Add a release signing config that reads from environment variables or Gradle properties:

```groovy
// Add after the existing debug signingConfigs block:

signingConfigs {
    debug {
        storeFile file('debug.keystore')
        storePassword 'android'
        keyAlias 'androiddebugkey'
        keyPassword 'android'
    }
    release {
        if (project.hasProperty('RELEASE_KEYSTORE_FILE')) {
            storeFile file(RELEASE_KEYSTORE_FILE)
            storePassword RELEASE_KEYSTORE_PASSWORD
            keyAlias RELEASE_KEY_ALIAS
            keyPassword RELEASE_KEY_PASSWORD
        }
    }
}
```

Then update the release build type to use it:

```groovy
buildTypes {
    debug {
        signingConfig signingConfigs.debug
    }
    release {
        signingConfig signingConfigs.release
        minifyEnabled enableProguardInReleaseBuilds
        proguardFiles getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro"
    }
}
```

**Important**: The `if (project.hasProperty('RELEASE_KEYSTORE_FILE'))` guard ensures that:
- Release builds **with** keystore properties → signed with the release keystore
- Release builds **without** keystore properties (local dev) → unsigned (will fail at install, which is correct behavior — forces developers to use debug builds)

### 2. Optionally add to `android/gradle.properties`

Add placeholder comments (not actual values — secrets go in CI only):

```properties
# Release signing config (set via CI environment or ~/.gradle/gradle.properties)
# RELEASE_KEYSTORE_FILE=/path/to/release.keystore
# RELEASE_KEYSTORE_PASSWORD=...
# RELEASE_KEY_ALIAS=...
# RELEASE_KEY_PASSWORD=...
```

## CI Integration (how the env vars get set)

In the GitHub Actions workflow (Phase 3), the keystore will be decoded from a base64 secret:

```yaml
- name: Decode release keystore
  run: |
    echo "${{ secrets.ANDROID_RELEASE_KEYSTORE_BASE64 }}" | base64 -d > android/app/release.keystore
    echo "RELEASE_KEYSTORE_FILE=release.keystore" >> $GITHUB_ENV
    echo "RELEASE_KEYSTORE_PASSWORD=${{ secrets.ANDROID_RELEASE_KEYSTORE_PASSWORD }}" >> $GITHUB_ENV
    echo "RELEASE_KEY_ALIAS=${{ secrets.ANDROID_RELEASE_KEY_ALIAS }}" >> $GITHUB_ENV
    echo "RELEASE_KEY_PASSWORD=${{ secrets.ANDROID_RELEASE_KEY_PASSWORD }}" >> $GITHUB_ENV
```

Gradle automatically picks up environment variables as project properties.

## Files to Modify

| File | Action | Description |
|------|--------|-------------|
| `android/app/build.gradle` | Modify | Add release signing config, update release build type |

## Progress Checklist

- [ ] Add `signingConfigs.release` block to `android/app/build.gradle`
- [ ] Update `buildTypes.release.signingConfig` to use `signingConfigs.release`
- [ ] Test local debug build still works (`./gradlew assembleDebug`)
- [ ] Verify release build fails gracefully without keystore (expected behavior)
