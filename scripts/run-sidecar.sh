#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SIDECAR_DIR="$ROOT_DIR/sidecar"
SIDECAR_HOST="${SIDECAR_HOST:-127.0.0.1}"
SIDECAR_PORT="${SIDECAR_PORT:-8321}"
SIDECAR_LOG_LEVEL="${SIDECAR_LOG_LEVEL:-info}"

if [[ -x "$SIDECAR_DIR/.venv/bin/python" ]]; then
  PYTHON_BIN="$SIDECAR_DIR/.venv/bin/python"
else
  PYTHON_BIN="${PYTHON:-python3}"
fi

cd "$SIDECAR_DIR"
exec "$PYTHON_BIN" -m annotate_sidecar --host "$SIDECAR_HOST" --port "$SIDECAR_PORT" --log-level "$SIDECAR_LOG_LEVEL" "$@"
