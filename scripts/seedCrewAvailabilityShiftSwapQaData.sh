#!/usr/bin/env bash
# Recreate Availability and Shift Swap QA data only on FeedX Staging.
set -euo pipefail

expected_ref="ujkzdaaadnvcfayuldmh"
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
current_ref="$(tr -d '[:space:]' < "$repo_root/supabase/.temp/project-ref")"

if [[ "$current_ref" != "$expected_ref" ]]; then
  echo "Refusing to seed: linked Supabase ref is '$current_ref', expected FeedX Staging '$expected_ref'." >&2
  exit 1
fi

cd "$repo_root"
supabase db query --linked --file scripts/seedCrewAvailabilityShiftSwapQaData.sql
supabase db query --linked --file scripts/verifyCrewAvailabilityShiftSwapStaging.sql
