#!/usr/bin/env bash
# Recreate Crew Growth QA data only on the linked FeedX Staging project.
set -euo pipefail

expected_ref="ujkzdaaadnvcfayuldmh"
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
current_ref="$(tr -d '[:space:]' < "$repo_root/supabase/.temp/project-ref")"

if [[ "$current_ref" != "$expected_ref" ]]; then
  echo "Refusing to seed: linked Supabase ref is '$current_ref', expected FeedX Staging '$expected_ref'." >&2
  exit 1
fi

cd "$repo_root"
supabase db query --linked --file scripts/seedCrewGrowthQaData.sql
supabase db query --linked --file scripts/verifyCrewGrowthStaging.sql
