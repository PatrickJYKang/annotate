#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export ANNOTATE_APP_DIR="${ANNOTATE_APP_DIR:-$SCRIPT_DIR}"
export ANNOTATE_VERSION="${ANNOTATE_VERSION:-0.1 pre-release}"
exec "$SCRIPT_DIR/start-annotate.sh"
