#!/usr/bin/env bash
# Rebuild the deterministic Reporting poster QA fixture only on FeedX Staging.
set -euo pipefail

expected_ref="ujkzdaaadnvcfayuldmh"
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
actual_ref="$(tr -d '[:space:]' < "$repo_root/supabase/.temp/project-ref")"

if [[ "$actual_ref" != "$expected_ref" ]]; then
  echo "Refusing Reporting fixture seed: linked project is '$actual_ref', expected FeedX Staging '$expected_ref'." >&2
  exit 1
fi

cd "$repo_root"
supabase db query --linked --file scripts/seedReportingPosterQaFixtures.sql
supabase db query --linked --file scripts/verifyReportingPosterQaFixtures.sql
