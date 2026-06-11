#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SELF_PATH="$SCRIPT_DIR/$(basename "${BASH_SOURCE[0]}")"
INSTALLER="$SCRIPT_DIR/install.sh"
GITHUB_URL="https://github.com/PatrickJYKang/annotate"

if [[ -f "$INSTALLER" ]]; then
  exec "$INSTALLER"
fi

printf "install.sh was not found next to this launcher.\n"
printf "If installation already finished, the installer removed itself and this file is no longer needed.\n\n"
printf "Are you done with installation? Answer yes to delete this file. [y/N]: "
read -r answer || answer=""
case "${answer:-N}" in
  y|Y|yes|YES|Yes)
    rm -f -- "$SELF_PATH"
    printf "Deleted %s.\nYou can close this window.\n" "$SELF_PATH"
    ;;
  *)
    printf "Keeping this file.\n"
    printf "To reinstall or download a fresh installer, visit:\n  %s\n" "$GITHUB_URL"
    ;;
esac
