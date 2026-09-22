#!/usr/bin/env bash
set -euo pipefail

expected_ref="ujkzdaaadnvcfayuldmh"
actual_ref="$(tr -d '\n' < supabase/.temp/project-ref)"

if [[ "$actual_ref" != "$expected_ref" ]]; then
  echo "Refusing localized-content seed: linked project is $actual_ref, expected Staging $expected_ref." >&2
  exit 1
fi

echo "Target: fnb-system-staging ($actual_ref)"
supabase db query --linked --file scripts/seedCrewLocalizedContentQaData.sql
