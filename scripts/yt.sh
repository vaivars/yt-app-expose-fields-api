#!/usr/bin/env bash
# Runs the local YouTrack from compose.yaml for the contract tests.
# YT_COMPOSE overrides the compose command; YT_PROJECT the compose project (each project has its own volumes).
set -euo pipefail

compose=${YT_COMPOSE:-}
if [ -z "$compose" ]; then
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    compose="docker compose"
  elif command -v podman-compose >/dev/null 2>&1; then
    compose="podman-compose"
  elif command -v podman >/dev/null 2>&1; then
    compose="podman compose"
  else
    echo "No compose command found; install docker compose or podman-compose, or set YT_COMPOSE" >&2
    exit 1
  fi
fi
project=${YT_PROJECT:-hidden-fields}

# $compose is deliberately unquoted: it may be two words ("docker compose").
case "${1:-}" in
  up) $compose -p "$project" up -d ;;
  down) $compose -p "$project" down ;;
  logs) $compose -p "$project" logs youtrack ;;
  reset) $compose -p "$project" down -v ;;
  *)
    echo "usage: scripts/yt.sh up|down|logs|reset" >&2
    exit 2
    ;;
esac
