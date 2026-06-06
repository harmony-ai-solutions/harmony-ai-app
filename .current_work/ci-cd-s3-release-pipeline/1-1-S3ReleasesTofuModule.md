# Phase 1-1: S3 Releases Tofu Module

## Objective

Create a reusable tofu module for the `soulbits-releases` S3 bucket. This bucket will serve as the centralized release distribution point for all Harmony AI projects (App, Link, and future projects).

## Repository

**soulbits-cloud-backend** (`c:/Users/sge20/go/src/github.com/harmony-ai-solutions/soulbits-cloud-backend`)

## Reference Files

Study the existing S3 module pattern before implementing:
- `infrastructure/tofu/modules/s3-worker-binaries/main.tf` — closest reference (public read bucket with lifecycle rules)
- `infrastructure/tofu/modules/s3-worker-binaries/variables.tf` — variable pattern
- `infrastructure/tofu/modules/s3-worker-binaries/outputs.tf` — output pattern

## Files to Create

### 1. `infrastructure/tofu/modules/s3-releases/main.tf`

Create the following resources:

```hcl
# S3 Bucket for Centralized Release Distribution
# Public read access for app binaries (APK, IPA, etc.) and engine binaries.
# Objects are accessible via direct HTTPS URL without AWS credentials.

resource "aws_s3_bucket" "releases" {
  bucket = "soulbits-releases"

  tags = {
    Name        = "soulbits-releases"
    Environment = "shared"
    ManagedBy   = "terraform"
  }
}

resource "aws_s3_bucket_versioning" "releases" {
  bucket = aws_s3_bucket.releases.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "releases" {
  bucket = aws_s3_bucket.releases.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Allow public read access to release objects (not listing)
resource "aws_s3_bucket_public_access_block" "releases" {
  bucket = aws_s3_bucket.releases.id

  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}

resource "aws_s3_bucket_policy" "releases_public_read" {
  bucket = aws_s3_bucket.releases.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "PublicReadGetObject"
        Effect    = "Allow"
        Principal = "*"
        Action    = "s3:GetObject"
        Resource = [
          "${aws_s3_bucket.releases.arn}/app/*",
          "${aws_s3_bucket.releases.arn}/engine/*"
        ]
      }
    ]
  })

  depends_on = [aws_s3_bucket_public_access_block.releases]
}

# Lifecycle: keep only last 90 days of non-current versions to control costs
resource "aws_s3_bucket_lifecycle_configuration" "releases" {
  bucket = aws_s3_bucket.releases.id

  rule {
    id     = "cleanup-old-versions"
    status = "Enabled"

    noncurrent_version_expiration {
      noncurrent_days = 90
    }

    filter {}
  }
}
```

### 2. `infrastructure/tofu/modules/s3-releases/variables.tf`

```hcl
variable "region" {
  description = "AWS region for the bucket"
  type        = string
  default     = "eu-central-1"
}
```

Note: Unlike `s3-worker-binaries`, this module does NOT take `name` or `environment` variables since the bucket name is fixed as `soulbits-releases` (shared, not environment-specific).

### 3. `infrastructure/tofu/modules/s3-releases/outputs.tf`

```hcl
output "bucket_name" {
  description = "Name of the releases S3 bucket"
  value       = aws_s3_bucket.releases.id
}

output "bucket_arn" {
  description = "ARN of the releases S3 bucket"
  value       = aws_s3_bucket.releases.arn
}

output "base_url" {
  description = "Base HTTPS URL for downloading releases"
  value       = "https://${aws_s3_bucket.releases.id}.s3.${var.region}.amazonaws.com"
}
```

## Key Design Decisions

- **Fixed bucket name** `soulbits-releases` — this is a shared resource, not per-environment
- **Public read on `app/*` and `engine/*`** — covers both Harmony AI App and Harmony Link (future migration)
- **90-day non-current version cleanup** — longer retention than worker binaries (30 days) since release artifacts are more valuable
- **No `name`/`environment` variables** — bucket is environment-agnostic (shared infra)
- **Region** defaults to `eu-central-1` (consistent with soulbits-cloud-backend infra)

## Progress Checklist

- [ ] Create `infrastructure/tofu/modules/s3-releases/main.tf`
- [ ] Create `infrastructure/tofu/modules/s3-releases/variables.tf`
- [ ] Create `infrastructure/tofu/modules/s3-releases/outputs.tf`
