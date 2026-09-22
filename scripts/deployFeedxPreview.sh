#!/usr/bin/env bash
set -euo pipefail

readonly vercel_scope="shadowxs-projects-5e91a0d4"

previous_argument=""
for argument in "$@"; do
  if [[ "$argument" == "--prod" || "$argument" == "--target=production" || ( "$previous_argument" == "--target" && "$argument" == "production" ) ]]; then
    echo "Refusing Preview deployment: feature worktrees must not use a production target or alter the canonical Staging alias." >&2
    exit 1
  fi
  previous_argument="$argument"
done

exec npx --yes vercel@latest deploy --scope "$vercel_scope" --yes "$@"
