#!/usr/bin/env bash
set -euo pipefail
expected_ref="ujkzdaaadnvcfayuldmh"
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
current_ref="$(tr -d '[:space:]' < "$repo_root/supabase/.temp/project-ref")"
if [[ "$current_ref" != "$expected_ref" ]]; then echo "Refusing to seed: expected Staging ref $expected_ref, found $current_ref." >&2; exit 1; fi
cd "$repo_root"
supabase db query --linked --file scripts/seedCrewPerformanceQaData.sql
supabase db query --linked --file scripts/verifyCrewPerformanceStaging.sql
