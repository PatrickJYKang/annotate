#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM
  if [[ -n "${WEBAPP_PID:-}" ]]; then
    kill "$WEBAPP_PID" 2>/dev/null || true
  fi
  if [[ -n "${SIDECAR_PID:-}" ]]; then
    kill "$SIDECAR_PID" 2>/dev/null || true
  fi
  wait 2>/dev/null || true
  exit "$exit_code"
}

trap cleanup EXIT INT TERM

cd "$ROOT_DIR"

./scripts/run-sidecar.sh &
SIDECAR_PID=$!

npm --prefix webapp run dev &
WEBAPP_PID=$!

EXIT_CODE=0
while true; do
  if ! kill -0 "$SIDECAR_PID" 2>/dev/null; then
    wait "$SIDECAR_PID" || EXIT_CODE=$?
    break
  fi
  if ! kill -0 "$WEBAPP_PID" 2>/dev/null; then
    wait "$WEBAPP_PID" || EXIT_CODE=$?
    break
  fi
  sleep 1
done

exit "$EXIT_CODE"
