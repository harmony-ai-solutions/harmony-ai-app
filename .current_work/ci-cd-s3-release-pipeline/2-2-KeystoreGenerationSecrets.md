# Phase 2-2: Keystore Generation and GitHub Secrets

## Objective

Generate a release keystore for the Harmony AI App and configure it as GitHub repository secrets for CI/CD use.

## Repository

**harmony-ai-app** (current workspace) — for keystore generation
**GitHub** — for secret configuration

## Prerequisites

- Java JDK installed (for `keytool` command)
- Access to the `harmony-ai-app` GitHub repository settings

## Implementation

### 1. Generate the Release Keystore

Run the following command (one-time operation):

```bash
keytool -genkeypair -v \
  -keystore harmony-ai-app-release.keystore \
  -alias harmony-ai-app \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -storepass <CHOOSE_STRONG_PASSWORD> \
  -keypass <CHOOSE_STRONG_PASSWORD> \
  -dname "CN=Harmony AI Solutions, O=Harmony AI Solutions, L=Berlin, ST=Berlin, C=DE"
```

**Notes**:
- `validity 10000` = ~27 years (well beyond any practical concern)
- Use the same password for both `storepass` and `keypass` for simplicity
- Store the keystore file in a secure location (NOT in the git repo — it's already in `.gitignore`)
- Record the passwords securely (password manager, etc.)

### 2. Base64-encode the Keystore

```bash
# Linux/macOS:
base64 -i harmony-ai-app-release.keystore -w 0

# Windows (PowerShell):
[Convert]::ToBase64String([IO.File]::ReadAllBytes("harmony-ai-app-release.keystore"))
```

Copy the entire base64 output string — this will be stored as a GitHub secret.

### 3. Add GitHub Secrets

Navigate to the `harmony-ai-app` GitHub repo → Settings → Secrets and variables → Actions → New repository secret:

| Secret Name | Value |
|-------------|-------|
| `ANDROID_RELEASE_KEYSTORE_BASE64` | The base64-encoded keystore from step 2 |
| `ANDROID_RELEASE_KEYSTORE_PASSWORD` | The `storepass` you chose in step 1 |
| `ANDROID_RELEASE_KEY_ALIAS` | `harmony-ai-app` |
| `ANDROID_RELEASE_KEY_PASSWORD` | The `keypass` you chose in step 1 |

### 4. Add AWS Secrets (from Phase 1-3)

Also add the AWS credentials generated during IAM user creation:

| Secret Name | Value |
|-------------|-------|
| `AWS_S3_UPLOAD_ACCESS_KEY_ID` | Access key ID from Phase 1-3 |
| `AWS_S3_UPLOAD_SECRET_ACCESS_KEY` | Secret access key from Phase 1-3 |

## Security Notes

- The keystore file should **never** be committed to git. Ensure `*.keystore` is in `.gitignore`
- The base64 secret is equivalent to the keystore file — protect it equally
- If the keystore is ever compromised, a new one must be generated and all users must uninstall/reinstall the app
- Consider storing a backup of the keystore in a secure offline location

## Cross-Repo Dependency

⚠️ **Depends on Phase 1-3** — AWS secrets can only be configured after the IAM user is created and access keys are generated.

## Progress Checklist

- [ ] Generate release keystore using `keytool`
- [ ] Base64-encode the keystore file
- [ ] Add `ANDROID_RELEASE_KEYSTORE_BASE64` secret to GitHub
- [ ] Add `ANDROID_RELEASE_KEYSTORE_PASSWORD` secret to GitHub
- [ ] Add `ANDROID_RELEASE_KEY_ALIAS` secret to GitHub
- [ ] Add `ANDROID_RELEASE_KEY_PASSWORD` secret to GitHub
- [ ] Add `AWS_S3_UPLOAD_ACCESS_KEY_ID` secret to GitHub
- [ ] Add `AWS_S3_UPLOAD_SECRET_ACCESS_KEY` secret to GitHub
- [ ] Store keystore backup in a secure offline location
