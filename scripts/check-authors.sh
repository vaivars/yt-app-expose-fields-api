#!/usr/bin/env bash
# Fails when an unpushed commit's author or committer email differs from CHECK_AUTHORS_EMAIL.
# Without CHECK_AUTHORS_EMAIL (contributors) the check is skipped; maintainers set it in mise.local.toml.
set -euo pipefail

expected=${CHECK_AUTHORS_EMAIL:-}
if [ -z "$expected" ]; then
  exit 0
fi

bad=$(git log --format='%h %ae %ce %s' HEAD --not --remotes=origin | awk -v e="$expected" '$2 != e || $3 != e')
if [ -n "$bad" ]; then
  echo "Unpushed commits with an author or committer other than $expected:" >&2
  echo "$bad" >&2
  exit 1
fi
