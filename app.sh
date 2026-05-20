#!/usr/bin/env bash

set -euo pipefail

ANNOTATE_VERSION="${ANNOTATE_VERSION:-0.1 pre-release}"
ROOT_DIR="${ANNOTATE_APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
WEB_PORT="${PORT:-3000}"
SIDECAR_PORT="${SIDECAR_PORT:-8321}"
APP_URL="${ANNOTATE_APP_URL:-http://127.0.0.1:${WEB_PORT}}"
SIDECAR_URL="${NEXT_PUBLIC_SIDECAR_URL:-http://127.0.0.1:${SIDECAR_PORT}}"
LOG_DIR="$ROOT_DIR/.runtime"
LOG_FILE="$LOG_DIR/app.log"
DEV_PID=""

progress() {
  local percent="$1"
  local label="$2"
  local width=32
  local filled=$((percent * width / 100))
  local empty=$((width - filled))
  local bar=""
  local i

  for ((i = 0; i < filled; i += 1)); do bar="${bar}#"; done
  for ((i = 0; i < empty; i += 1)); do bar="${bar}-"; done
  printf "\r[%s] %3d%% %s" "$bar" "$percent" "$label"
}

finish_progress_line() {
  printf "\n"
}

die() {
  finish_progress_line
  printf "Error: %s\n" "$*" >&2
  if [[ -f "$LOG_FILE" ]]; then
    printf "\nLast log lines from %s:\n" "$LOG_FILE" >&2
    tail -n 60 "$LOG_FILE" >&2 || true
  fi
  exit 1
}

cleanup() {
  if [[ -n "$DEV_PID" ]] && kill -0 "$DEV_PID" 2>/dev/null; then
    kill "$DEV_PID" 2>/dev/null || true
    wait "$DEV_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

url_ready() {
  curl -fsS --max-time 1 "$1" >/dev/null 2>&1
}

wait_for_url() {
  local url="$1"
  local label="$2"
  local start_percent="$3"
  local end_percent="$4"
  local timeout_seconds="${5:-120}"
  local elapsed=0
  local percent

  while ((elapsed <= timeout_seconds)); do
    if url_ready "$url"; then
      progress "$end_percent" "$label ready"
      finish_progress_line
      return 0
    fi
    if [[ -n "$DEV_PID" ]] && ! kill -0 "$DEV_PID" 2>/dev/null; then
      wait "$DEV_PID" || true
      die "Annotate stopped before ${label} became ready."
    fi
    percent=$((start_percent + (elapsed * (end_percent - start_percent) / timeout_seconds)))
    progress "$percent" "Waiting for ${label}..."
    sleep 1
    elapsed=$((elapsed + 1))
  done

  die "Timed out waiting for ${label} at ${url}."
}

open_chromium_macos() {
  local url="$1"
  local apps=(
    "Google Chrome"
    "Microsoft Edge"
    "Brave Browser"
    "Arc"
    "Chromium"
    "Google Chrome Canary"
  )
  local app

  for app in "${apps[@]}"; do
    if open -Ra "$app" 2>/dev/null; then
      printf "Opening Annotate in %s because project folders require a Chromium-based browser.\n" "$app"
      open -a "$app" "$url"
      return 0
    fi
  done

  return 1
}

open_chromium_linux() {
  local url="$1"
  local commands=(
    "google-chrome"
    "google-chrome-stable"
    "microsoft-edge"
    "microsoft-edge-stable"
    "brave-browser"
    "brave"
    "chromium"
    "chromium-browser"
  )
  local cmd

  for cmd in "${commands[@]}"; do
    if command -v "$cmd" >/dev/null 2>&1; then
      printf "Opening Annotate in %s because project folders require a Chromium-based browser.\n" "$cmd"
      "$cmd" "$url" >/dev/null 2>&1 &
      return 0
    fi
  done

  return 1
}

open_app_url() {
  local url="$1"
  local os_name
  os_name="$(uname -s)"

  case "$os_name" in
    Darwin)
      if open_chromium_macos "$url"; then return 0; fi
      ;;
    Linux)
      if open_chromium_linux "$url"; then return 0; fi
      ;;
  esac

  printf "\nAnnotate requires a Chromium-based browser for project folder access.\n"
  printf "Install or open Google Chrome, Microsoft Edge, Brave, Arc, or Chromium, then visit:\n"
  printf "%s\n" "$url"
}

main() {
  printf "Annotate %s\n" "$ANNOTATE_VERSION"
  cd "$ROOT_DIR"
  mkdir -p "$LOG_DIR"
  : > "$LOG_FILE"

  progress 5 "Checking local install"
  command -v npm >/dev/null 2>&1 || die "npm was not found. Install Node.js, then rerun this launcher."
  command -v curl >/dev/null 2>&1 || die "curl was not found."
  [[ -f "$ROOT_DIR/package.json" ]] || die "Could not find package.json in $ROOT_DIR."
  [[ -d "$ROOT_DIR/webapp/node_modules" ]] || die "Web dependencies are missing. Run ./install.sh from $ROOT_DIR."
  finish_progress_line

  if url_ready "$APP_URL"; then
    progress 100 "Annotate is already running"
    finish_progress_line
    open_app_url "$APP_URL"
    printf "Annotate is already available at %s.\n" "$APP_URL"
    return 0
  fi

  export NEXT_PUBLIC_SIDECAR_URL="$SIDECAR_URL"

  progress 15 "Starting Annotate services"
  npm run dev > "$LOG_FILE" 2>&1 &
  DEV_PID=$!
  finish_progress_line

  wait_for_url "${SIDECAR_URL}/health" "sidecar" 20 55 120
  wait_for_url "$APP_URL" "web app" 55 90 120

  progress 100 "Opening browser"
  finish_progress_line
  open_app_url "$APP_URL"

  printf "\nAnnotate is running at %s\n" "$APP_URL"
  printf "Keep this terminal window open. Press Ctrl+C here to stop Annotate.\n"
  printf "Logs: %s\n\n" "$LOG_FILE"

  wait "$DEV_PID"
}

main "$@"
