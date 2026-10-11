# Phase 6-2 — Cloud: S3 Snapshot Plane + DEK Infra Retirement (& GDPR Purge Rework)

> **Repo:** `soulbits-cloud-backend` (+ app contract changes)
> **Assessment basis:** the snapshot plane + per-user DEK infrastructure were the backup mechanic of the removed in-cloud session feature — **the reason 2-6 exists**. With user-owned-storage backups live, the operator no longer stores any user database data.
> **Depends on:** **6-1** (no more writers/readers of the plane) + **2-6 verified on devices** (its replacement). This is the phase that makes "the cloud stores no user data" literally true.

## Objective

Delete the S3 snapshot plane, the per-user DEK key infrastructure, and rework GDPR account deletion to the new reality: account deletion = account rows + billing + push tokens + the 2-6 W1 escrow key; user-owned-storage backups are the user's to delete (the app offers that in the deletion flow).

## Deletion scope (delete outright)

- **Snapshot plane:** `pkg/session/s3.go` (trio upload/download, versioned delete), `pkg/session/snapshot_rag.go` (RAG `{userID}/rag/*` — new home is the 2-6 artifact; engine rebuild-if-absent stays as fallback), `pkg/session/keyinject.go` (`SE_DATABASE_ENCRYPTION*` env injection)
- **Key infra:** `pkg/keystore/` (entire package — KMS-envelope DEK store in Postgres `users.db_encryption_key_encrypted`; **no non-session consumer exists**), `db/migrations/000021` column drop (new down-migration)
- **IaC:** `infrastructure/tofu/modules/s3/` (`soulbits-sessions-{env}` bucket — versioned), `infrastructure/tofu/modules/kms/` `db_encryption` CMK + alias (keep the PASETO key's Secrets Manager usage — auth-plane, unrelated)
- **GDPR purge path:** `cmd/session-broker/handlers/datapurge.go` + `datapurge_sweeper.go` + `pkg/session/datapurge.go` (die with 6-1's broker — listed here because their contract is rewritten below)

## Rework: account deletion (the sole surviving consumer)

- Today: `cmd/auth-service/handlers/accountpurge.go` + `account.go` delegate to broker `POST /v1/session/data/delete` (destroys S3 objects all-versions + DEK + live session + due beats) with a retry/`snapshot_busy`/409 + status-polling contract the app's purge UI consumes.
- New contract (PASETO-authenticated, no broker): delete account rows + subscriptions/coins + `device_push_tokens` + **W1 escrow key** (2-5 endpoint) + inference quotas. No async states — synchronous best-effort with typed errors. Before deletion, the app offers "delete your backup from <target>" using its stored target credentials (2-6 orchestrator).
- App-side: purge card in `SyncSettingsScreen` + `CloudPurgeBanner`/provisioning overlay remnants reworked to the sync contract (or deleted if 3-4 already removed them); `soulbitsClient` purge sub-API updated with the client regen.
- E2E: `tests/e2e/account_security.go` S3-prefix assertions replaced (assert escrow key dropped + account rows gone); `session_data_purge.go`, `lifecycle_helpers.go` (DEK fixtures), `cloud_per_run_user.go` (S3 prefix cleanup) deleted/reworked; `tests/e2e/main.go` `CLOUD_SESSIONS_BUCKET` requirement removed.

## Bucket teardown (irreversible — explicit runbook)

The sessions bucket is **versioned**: `tofu destroy` of the S3 module does not purge objects. Sequence: (1) verify zero plane consumers (grep + 30-day access logs on the bucket); (2) run an explicit all-versions-and-delete-markers purge job (one-off script under `scripts/`, reviewed like code — this is the GDPR "permanently deletes every version" promise being kept); (3) empty-bucket verification; (4) destroy bucket + KMS key (observe the KMS waiting period); (5) record completion in ops docs.

## Implementation steps

1. Rework account deletion (server + app contract + tests) — can land before any deletion, behind the new endpoint shape.
2. Delete plane code + keystore + migration 000021 drop; green build/tests.
3. IaC: remove s3/kms modules from the graph (bucket still standing); deploy workflows updated.
4. Bucket purge runbook executed (dev first, then prod); destroy resources; ops record.
5. Docs: `docs/cloud-data-deletion.md` rewritten to the new model; `docs/first-rollout.md`, memory banks.

## Verification gates

- `go build/vet/test ./...` green; grep gates: no `soulbits-sessions`, no `pkg/keystore`, no `db_encryption_key` references
- Account-deletion E2E green in the new shape (escrow drop + rows gone; backup deletion offered app-side)
- Bucket empty + destroyed (prod evidence in ops log); KMS key scheduled/deleted
- Cloud stores zero user-database bytes — asserted by review + bucket teardown

## Risks & rollback

- **Bucket purge is irreversible** — verify no consumer (incl. support/legal e-discovery needs) before running; snapshot the object inventory to cold storage only if legally required (then that copy's retention needs a named owner)
- Deleting the DEK column while any legacy snapshot still exists → by ruling there is no legacy fleet; dev fixtures die with the e2e rework
- App purge-contract mismatch during the transition → land server + app in one coupled PR set (pre-launch: no version skew exists)

## Progress checklist

- [ ] Account-deletion rework (server + app + tests) merged
- [ ] Plane code + keystore + column drop merged
- [ ] IaC graph updated; workflows green
- [ ] Bucket purge executed + resources destroyed (dev, prod)
- [ ] Docs/memory banks updated
