#!/usr/bin/env bash
# e2e/approve-pending-devices.sh
# ─────────────────────────────────────────────────────────────────────────────
# Approve devices awaiting sync approval on the E2E Soulbits Engine.
#
# The engine has no CLOUD_MODE bypass any more (plan 7-13): management-API auth
# and device approval are unconditionally enforced, and a newly paired device
# registers PENDING (is_approved=0). It cannot sync until approved over the
# engine's admin API with the X-Admin-API-Key header.
#
# Usage:
#   ./e2e/approve-pending-devices.sh [ADMIN_URL]
#
#   ADMIN_URL   defaults to http://localhost:28081 (the compose file publishes
#               the admin port). From inside the Docker network use
#               http://soulbits-engine:28081.
#
# The admin key comes from SE_ADMIN_API_KEY (default "e2e-admin", matching
# e2e/docker-compose.yml).
#
# NOTE: the shipped .maestro suite is boot-only and never opens a sync session,
# so there is nothing to approve during a boot-only run. Run this once a
# pairing/sync flow is added.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

ADMIN_URL="${1:-http://localhost:28081}"
ADMIN_KEY="${SE_ADMIN_API_KEY:-e2e-admin}"

echo "Querying pending devices at ${ADMIN_URL}/api/sync/devices/pending ..."
pending="$(curl -sf -H "X-Admin-API-Key: ${ADMIN_KEY}" "${ADMIN_URL}/api/sync/devices/pending")"

# Extract device_id values without requiring jq (the engine marshals a compact
# JSON array of device objects; device_id is a string field).
ids="$(printf '%s' "${pending}" | grep -o '"device_id":"[^"]*"' | sed 's/.*:"//; s/"$//' || true)"

if [ -z "${ids}" ]; then
  echo "No pending devices."
  exit 0
fi

for id in ${ids}; do
  echo "Approving device ${id} ..."
  curl -sf -X POST -H "X-Admin-API-Key: ${ADMIN_KEY}" \
    "${ADMIN_URL}/api/sync/devices/${id}/approve"
  echo
done
