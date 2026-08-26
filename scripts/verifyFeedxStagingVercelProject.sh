#!/usr/bin/env bash
set -euo pipefail

readonly expected_project_id="prj_t6uJtKPDu9GuyefG6IqAfxh5YoIi"
readonly expected_project_name="fnb-system-staging"
readonly project_file=".vercel/project.json"

usage() {
  echo "Usage: $0 --deployment-sha <git-sha>" >&2
}

if [[ $# -ne 2 || "$1" != "--deployment-sha" || -z "$2" ]]; then
  usage
  exit 1
fi

readonly deployment_sha="$2"

if ! git_root="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  echo "Refusing FeedX Staging deployment: this directory is not a Git worktree." >&2
  exit 1
fi

current_branch="$(git branch --show-current)"
if [[ "$current_branch" != "dev" ]]; then
  echo "Refusing FeedX Staging deployment: canonical Staging can only deploy from the dev branch, not ${current_branch:-a detached HEAD}." >&2
  exit 1
fi

if [[ -n "$(git status --porcelain --untracked-files=all)" ]]; then
  echo "Refusing FeedX Staging deployment: the worktree is dirty." >&2
  exit 1
fi

local_head="$(git rev-parse HEAD)"
if ! origin_dev="$(git rev-parse origin/dev 2>/dev/null)"; then
  echo "Refusing FeedX Staging deployment: origin/dev is unavailable. Fetch it before deploying." >&2
  exit 1
fi

if [[ "$local_head" != "$origin_dev" ]]; then
  echo "Refusing FeedX Staging deployment: local HEAD ($local_head) does not match origin/dev ($origin_dev)." >&2
  exit 1
fi

if [[ "$deployment_sha" != "$origin_dev" ]]; then
  echo "Refusing FeedX Staging deployment: requested deployment SHA ($deployment_sha) does not match origin/dev ($origin_dev)." >&2
  exit 1
fi

if [[ ! -f "$project_file" ]]; then
  echo "Refusing FeedX Staging deployment: $project_file is missing. Do not run an implicit Vercel link." >&2
  exit 1
fi

actual_project_id="$(node -e 'const fs = require("fs"); const project = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(project.projectId || "");' "$project_file")"
actual_project_name="$(node -e 'const fs = require("fs"); const project = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(project.projectName || "");' "$project_file")"

if [[ "$actual_project_id" != "$expected_project_id" || "$actual_project_name" != "$expected_project_name" ]]; then
  echo "Refusing FeedX Staging deployment: linked Vercel project is ${actual_project_name:-unknown} (${actual_project_id:-unknown}), expected $expected_project_name ($expected_project_id)." >&2
  exit 1
fi

echo "Canonical Staging deployment verified: $expected_project_name ($expected_project_id) at $origin_dev"
