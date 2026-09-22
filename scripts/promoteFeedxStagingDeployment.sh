#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <verified-deployment-url> <deployment-git-sha>" >&2
  exit 1
fi

readonly deployment_url="$1"
readonly deployment_sha="$2"
readonly vercel_scope="shadowxs-projects-5e91a0d4"

bash scripts/verifyFeedxStagingVercelProject.sh --deployment-sha "$deployment_sha"

exec npx --yes vercel@latest promote "$deployment_url" --scope "$vercel_scope" --yes
