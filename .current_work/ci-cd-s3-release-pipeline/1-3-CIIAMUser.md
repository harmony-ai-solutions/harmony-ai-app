# Phase 1-3: CI IAM User and Policy

## Objective

Create an IAM user with scoped S3 write permissions for GitHub Actions CI/CD pipelines to upload release artifacts to the `soulbits-releases` bucket.

## Repository

**soulbits-cloud-backend** (`c:/Users/sge20/go/src/github.com/harmony-ai-solutions/soulbits-cloud-backend`)

## Context

The Harmony AI App and Harmony Link are in separate GitHub repositories from soulbits-cloud-backend. The existing `iam-ci` module uses OIDC trust policies scoped to the soulbits-cloud-backend repo specifically. Creating a new OIDC-trusted role per external repo adds complexity, so we use **static AWS credentials** (consistent with Harmony Link's current approach) as the initial strategy.

The IAM user should be reusable — both the `harmony-ai-app` and `harmony-link-private` repos will use these credentials.

## Implementation Options

### Option A: Add to tofu (recommended for auditability)

Create a new tofu resource in the shared environment:

```hcl
# ── CI User for Release Uploads ──
# IAM user for GitHub Actions workflows to upload release artifacts.
# Used by harmony-ai-app and harmony-link-private repos.

resource "aws_iam_user" "ci_releases" {
  name = "ci-releases-uploader"

  tags = {
    Name        = "ci-releases-uploader"
    Purpose     = "Upload release artifacts from GitHub Actions"
    ManagedBy   = "terraform"
  }
}

resource "aws_iam_user_policy" "ci_releases_upload" {
  name = "ci-releases-upload-policy"
  user = aws_iam_user.ci_releases.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject"
        ]
        Resource = [
          "${module.s3_releases.bucket_arn}/app/*",
          "${module.s3_releases.bucket_arn}/engine/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "s3:ListBucket"
        ]
        Resource = [module.s3_releases.bucket_arn]
        Condition = {
          StringLike = {
            "s3:prefix" = ["app/*", "engine/*"]
          }
        }
      }
    ]
  })
}
```

### Option B: Create manually via AWS Console

If tofu is not immediately accessible, create the IAM user manually with the policy above. Document the manual step here and add to tofu later.

## Post-Creation Steps

1. Generate access keys for the IAM user:
   ```bash
   aws iam create-access-key --user-name ci-releases-uploader
   ```
2. Store the credentials securely — they will be added as GitHub secrets in both:
   - `harmony-ai-app` repo → `AWS_S3_UPLOAD_ACCESS_KEY_ID` / `AWS_S3_UPLOAD_SECRET_ACCESS_KEY`
   - `harmony-link-private` repo → same secrets (replacing existing ones when migrating from `harmony-ai-releases`)
3. Verify the user can write to the bucket:
   ```bash
   aws s3 cp test-file.txt s3://soulbits-releases/app/test-file.txt
   ```

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `infrastructure/tofu/environments/shared/main.tf` | Modify | Add IAM user and policy resources |

## Progress Checklist

- [ ] Add IAM user and policy to shared environment (or create via AWS Console)
- [ ] Run `tofu plan` + `tofu apply` (if using tofu)
- [ ] Generate access keys for the CI user
- [ ] Test upload access with a test file
- [ ] Securely store the access key ID and secret for GitHub secrets configuration
