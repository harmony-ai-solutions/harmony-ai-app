# Phase 2-2: Valkey Purge Flag + Lifecycle ZSET Cleanup Helpers

**Repo:** `C:\Users\sge20\go\src\github.com\harmony-ai-solutions\soulbits-cloud-backend`
**Files:** `pkg/valkey/valkey.go` (add `ZRem`), new `pkg/session/datapurge.go`, `pkg/session/datapurge_test.go`

## Objective

The purge state machine's Valkey primitives:

1. **Purge flag** — per-user JSON blob (`session:datadel:{userID}`) with TTL,
   written FIRST by the handler so every gate (connect, provisioning, worker,
   sweeper) can check it.
2. **Registry ZSET** — `session:datadel:registry` (score = start unix) so a
   restarting broker can FIND unfinished purges.
3. **Beat-chain removal** — remove all of a user's members from the
   `due:lifecycle` ZSET (members are JSON: `{"user_id":...,"entity_id":...,"op":...}`
   or the seed variant `{"user_id":...,"op":"seed"}`).

## Context

- `pkg/valkey/valkey.go` client already has: `SetRaw/GetRaw/DeleteRaw` (string
  keys with TTL), `ZAdd`, `ZRangeByScoreWithScores` (read-only), `ZPopMinByScore`,
  `ZRemIfScore`, `EvalInt/EvalStrSlice`. It does NOT have a plain `ZRem`.
- ZSET member formats (canonical, see `cmd/lifecycle-worker/job.go`
  `encodeZSetMember` / `encodeSeedMember` and broker `lifecycle.go:1117`):
  - beat: `{"user_id":"u","entity_id":"e","op":"beat"}` (op can also be
    dream/compact/reconcile/outreach on re-arm paths)
  - seed: `{"user_id":"u","op":"seed"}` — two-key format, do NOT fork it.
- The due ZSET key is `"due:lifecycle"` (dispatcher/worker constant).
- Existing style: package-level funcs in `pkg/session/valkey.go` taking
  `*valkey.Client` (e.g. `AcquireSnapshotLease`). Put new helpers in a new file
  `pkg/session/datapurge.go` to keep `valkey.go` focused.

## Implementation

### `pkg/valkey/valkey.go` — add

```go
// ZRem removes members from a ZSET. Returns the number actually removed.
func (c *Client) ZRem(ctx context.Context, key string, members ...string) (int64, error)
```
(Builder: `c.vc.B().Zrem().Key(key).Member(members...)` — follow `ZAdd` style.)

### `pkg/session/datapurge.go` (new)

```go
package session

// DataPurgeState is the JSON blob stored at session:datadel:{userID} while a
// user-initiated data purge is running (or stalled, until TTL).
type DataPurgeState struct {
    RequestID string `json:"request_id"`
    Phase     string `json:"phase"`      // coarse phase marker for debugging: "kill","s3","beats","dek","done"
    StartedAt int64  `json:"started_at"` // unix seconds
    Attempts  int    `json:"attempts"`   // sweeper resume attempts
}

const (
    // DataPurgeRegistryKey is the ZSET of in-flight/stalled purges; member = userID, score = StartedAt.
    DataPurgeRegistryKey = "session:datadel:registry"
    // DefaultDataPurgeFlagTTL bounds how long a stalled purge can block connect (hours, not minutes).
    DefaultDataPurgeFlagTTL = time.Hour
)

func dataPurgeFlagKey(userID string) string // "session:datadel:" + userID

func SetDataPurgeFlag(ctx, vc *valkey.Client, userID string, st DataPurgeState, ttl time.Duration) error
func GetDataPurgeFlag(ctx, vc *valkey.Client, userID string) (*DataPurgeState, error) // nil when absent
func DeleteDataPurgeFlag(ctx, vc *valkey.Client, userID string) error
func RegisterDataPurge(ctx, vc *valkey.Client, userID string, startedAtUnix float64) error   // ZAdd registry
func UnregisterDataPurge(ctx, vc *valkey.Client, userID string) error                       // ZRem registry
func ListDataPurgeRegistry(ctx, vc *valkey.Client) ([]string, error)                        // ZRangeByScore -inf..+inf
func IsDataPurgeActive(ctx, vc *valkey.Client, userID string) (bool, error)                 // flag != nil

// ParseLifecycleMember decodes a due:lifecycle member into userID/entityID/op.
// ok=false for non-JSON legacy members (never match them for removal — they
// pre-date the format and belong to no purge).
func ParseLifecycleMember(member string) (userID, entityID, op string, ok bool)

// RemoveUserLifecycleMembers removes ALL due:lifecycle members belonging to
// userID (beat + seed formats). Re-scans after each removal round (max 3
// passes) so a concurrent ZAdd re-arm race cannot strand members. Returns
// total removed. Best-effort per member: unparseable members are skipped.
func RemoveUserLifecycleMembers(ctx, vc *valkey.Client, userID string) (int64, error)
```

`RemoveUserLifecycleMembers` algorithm:
1. `ZRangeByScoreWithScores(ctx, "due:lifecycle", math.Inf(-1), math.Inf(1))`.
2. Filter members where `ParseLifecycleMember` → userID matches exactly.
3. If none → return 0. Else `ZRem(ctx, "due:lifecycle", matched...)`.
4. Repeat (max 3 passes) while any user member still present; return sum.

### `pkg/session/datapurge_test.go` (new)

`ParseLifecycleMember` and the member-filter logic are pure — unit test
exhaustively:
- beat member, seed member, malformed JSON, empty member, member with extra
  keys, `ok=false` cases.
- If the package has no Valkey test harness (check how existing session tests
  touch Valkey — if none, do NOT invent containers): cover
  `RemoveUserLifecycleMembers`'s pure filtering via an injectable
  `zsetScanner/zsetRemover` seam OR test it end-to-end in Phase 7 e2e. Keep the
  seam tiny (two function fields or a small interface) — production wiring
  passes the valkey client.

Also test key naming + registry constants for accidental drift.

## Verification

```powershell
go build ./pkg/valkey/... ./pkg/session/...
go test ./pkg/session/... -run 'DataPurge|LifecycleMember' -v
go test ./pkg/valkey/...
```

## Commit

Part of the Phase 2 combined commit (see 2-1).

## Checklist

- [ ] `valkey.Client.ZRem` added
- [ ] `datapurge.go` with flag/registry/parse/remove helpers
- [ ] Pure-logic tests written first, observed failing, then green
- [ ] No new test-container dependency introduced
- [ ] `go test ./pkg/valkey/... ./pkg/session/...` green
