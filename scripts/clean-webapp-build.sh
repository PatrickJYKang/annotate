#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEBAPP_DIR="$ROOT_DIR/webapp"

rm -rf "$WEBAPP_DIR/.next" "$WEBAPP_DIR/.next-playwright" "$WEBAPP_DIR/tsconfig.tsbuildinfo"
