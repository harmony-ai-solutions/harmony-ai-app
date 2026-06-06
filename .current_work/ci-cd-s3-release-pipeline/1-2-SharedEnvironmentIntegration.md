# Phase 1-2: Shared Environment Integration

## Objective

Integrate the `s3-releases` module into the shared tofu environment so that `tofu apply` creates the `soulbits-releases` bucket.

## Repository

**soulbits-cloud-backend** (`c:/Users/sge20/go/src/github.com/harmony-ai-solutions/soulbits-cloud-backend`)

## Reference Files

- `infrastructure/tofu/environments/shared/main.tf` — current shared environment (ECR + OIDC provider)
- `infrastructure/tofu/environments/shared/outputs.tf` — current outputs (ECR repos + OIDC ARN)

## Files to Modify

### 1. `infrastructure/tofu/environments/shared/main.tf`

Add the s3-releases module instantiation after the existing OIDC provider resource:

```hcl
# ── Centralized Release Distribution Bucket ──
# Shared S3 bucket for public distribution of Harmony AI binaries.
# Used by harmony-ai-app (APK/IPA) and harmony-link (Windows/Linux binaries).

module "s3_releases" {
  source = "../../modules/s3-releases"
  region = var.aws_region
}
```

### 2. `infrastructure/tofu/environments/shared/outputs.tf`

Add outputs for the s3-releases bucket:

```hcl
# ── Release Distribution Bucket ──
output "releases_bucket_name" {
  description = "Name of the centralized releases S3 bucket"
  value       = module.s3_releases.bucket_name
}

output "releases_bucket_arn" {
  description = "ARN of the centralized releases S3 bucket"
  value       = module.s3_releases.bucket_arn
}

output "releases_base_url" {
  description = "Base HTTPS URL for downloading releases"
  value       = module.s3_releases.base_url
}
```

## Deployment Steps

After modifying the files:

1. `cd infrastructure/tofu/environments/shared`
2. `tofu init` — initialize the new module
3. `tofu plan` — verify the bucket will be created correctly
4. `tofu apply` — create the bucket

**Verification**: After apply, confirm the bucket exists:
```bash
aws s3 ls s3://soulbits-releases/ --region eu-central-1
```

Expected: empty listing (no objects yet, but bucket should exist and be accessible).

## Progress Checklist

- [ ] Add `module "s3_releases"` to `environments/shared/main.tf`
- [ ] Add bucket outputs to `environments/shared/outputs.tf`
- [ ] Run `tofu init` in shared environment
- [ ] Run `tofu plan` and review changes
- [ ] Run `tofu apply` to create the bucket
- [ ] Verify bucket exists via AWS CLI
