#!/usr/bin/env bash
set -euo pipefail

readonly expected_project_id="prj_t6uJtKPDu9GuyefG6IqAfxh5YoIi"
readonly expected_project_name="fnb-system-staging"
readonly project_file=".vercel/project.json"

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

echo "Vercel target verified: $expected_project_name ($expected_project_id)"
