#!/usr/bin/env bash
# Staging-only entry point for scripts/seedCrewLearningQaData.sql.
set -euo pipefail

expected_ref="ujkzdaaadnvcfayuldmh"
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
current_ref="$(tr -d '[:space:]' < "$repo_root/supabase/.temp/project-ref")"

if [[ "$current_ref" != "$expected_ref" ]]; then
  echo "Refusing to seed: linked Supabase ref is '$current_ref', expected Staging '$expected_ref'." >&2
  exit 1
fi

cd "$repo_root"
supabase db query --linked --file scripts/seedCrewLearningQaData.sql
supabase db query --linked --file scripts/verifyCrewLearningQaData.sql
