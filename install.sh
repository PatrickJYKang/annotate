#!/usr/bin/env bash

set -euo pipefail

ANNOTATE_VERSION="0.2"
DEFAULT_REF="v0.2.0"
REPO_URL="${ANNOTATE_REPO_URL:-https://github.com/PatrickJYKang/annotate.git}"
REF="${ANNOTATE_REF:-$DEFAULT_REF}"
DEFAULT_INSTALL_DIR="${HOME}/Documents/annotate"
INSTALL_DIR=""
SELF_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
LOG_FILE="${ANNOTATE_INSTALL_LOG:-${TMPDIR:-/tmp}/annotate-install-$(date +%Y%m%d-%H%M%S).log}"
VERBOSE_INSTALL="${ANNOTATE_VERBOSE_INSTALL:-0}"
RUN_TESTS="${ANNOTATE_RUN_TESTS:-0}"
BREW_UPDATE="${ANNOTATE_BREW_UPDATE:-0}"
AUTO_START="${ANNOTATE_AUTO_START:-1}"

# Overall progress. Percentages are weighted by how long each phase actually
# takes (dependency installs dominate wall-clock time), not by step count.
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
  printf "\n[%s] %3d%% %s\n" "$bar" "$percent" "$label"
}

fmt_elapsed() {
  local total="$1"
  if ((total >= 60)); then
    printf "%dm %02ds" $((total / 60)) $((total % 60))
  else
    printf "%ds" "$total"
  fi
}

warn() {
  printf "Warning: %s\n" "$*" >&2
}

die() {
  printf "\nError: %s\n" "$*" >&2
  if [[ -f "$LOG_FILE" ]]; then
    printf "\nLast log lines from %s:\n" "$LOG_FILE" >&2
    tail -n 80 "$LOG_FILE" >&2 || true
  fi
  exit 1
}

run_logged() {
  local label="$1"
  shift
  local spinner='|/-\'
  local i=0
  local pid
  local status
  local start_seconds

  mkdir -p "$(dirname "$LOG_FILE")"
  {
    printf "\n[%s] %s\n" "$(date)" "$label"
    printf "Command:"
    printf " %q" "$@"
    printf "\n"
  } >>"$LOG_FILE"

  if [[ "$VERBOSE_INSTALL" == "1" ]]; then
    printf "\n"
    printf '%s\n' "--- $label ---"
    printf "Command:"
    printf " %q" "$@"
    printf "\n"
    "$@" 2>&1 | tee -a "$LOG_FILE"
    status=${PIPESTATUS[0]}
    if [[ "$status" -eq 0 ]]; then
      printf '%s\n' "--- $label complete ---"
      return 0
    fi
    die "$label failed with exit code $status."
  fi

  "$@" >>"$LOG_FILE" 2>&1 &
  pid=$!
  start_seconds=$SECONDS

  while kill -0 "$pid" 2>/dev/null; do
    local frame="${spinner:$((i % ${#spinner})):1}"
    i=$((i + 1))
    printf "\r\033[K  %s... %s (%s) (log: %s)" "$label" "$frame" "$(fmt_elapsed $((SECONDS - start_seconds)))" "$LOG_FILE"
    sleep 0.5
  done

  status=0
  wait "$pid" || status=$?
  if [[ "$status" -eq 0 ]]; then
    printf "\r\033[K  %s... done (%s)\n" "$label" "$(fmt_elapsed $((SECONDS - start_seconds)))"
    return 0
  fi

  printf "\r\033[K  %s... failed after %s (log: %s)\n" "$label" "$(fmt_elapsed $((SECONDS - start_seconds)))" "$LOG_FILE" >&2
  die "$label failed with exit code $status."
}

# Like run_logged, but renders a real progress bar for pip installs by counting
# "Collecting <package>" lines in the log against the expected package total.
# Once pip switches to its install phase the bar holds at 95% ("finalizing").
run_pip_logged() {
  local label="$1"
  local total_packages="$2"
  shift 2
  local spinner='|/-\'
  local i=0
  local pid
  local status
  local start_seconds
  local log_offset
  local collected
  local percent
  local suffix
  local width=24
  local filled
  local empty
  local bar
  local j

  if ((total_packages < 1)); then
    total_packages=1
  fi

  if [[ "$VERBOSE_INSTALL" == "1" ]]; then
    run_logged "$label" "$@"
    return
  fi

  mkdir -p "$(dirname "$LOG_FILE")"
  {
    printf "\n[%s] %s\n" "$(date)" "$label"
    printf "Command:"
    printf " %q" "$@"
    printf "\n"
  } >>"$LOG_FILE"

  log_offset=$(wc -l < "$LOG_FILE")
  "$@" >>"$LOG_FILE" 2>&1 &
  pid=$!
  start_seconds=$SECONDS

  while kill -0 "$pid" 2>/dev/null; do
    collected=$(tail -n "+$((log_offset + 1))" "$LOG_FILE" 2>/dev/null | grep -c '^Collecting ' || true)
    if ((collected > total_packages)); then
      collected=$total_packages
    fi
    percent=$((collected * 90 / total_packages))
    suffix=""
    if tail -n "+$((log_offset + 1))" "$LOG_FILE" 2>/dev/null | grep -q '^Installing collected packages'; then
      percent=95
      suffix=", finalizing"
    fi

    filled=$((percent * width / 100))
    empty=$((width - filled))
    bar=""
    for ((j = 0; j < filled; j += 1)); do bar="${bar}#"; done
    for ((j = 0; j < empty; j += 1)); do bar="${bar}-"; done

    local frame="${spinner:$((i % ${#spinner})):1}"
    i=$((i + 1))
    printf "\r\033[K  %s [%s] %3d%% (%d/%d packages%s, %s) %s" \
      "$label" "$bar" "$percent" "$collected" "$total_packages" "$suffix" \
      "$(fmt_elapsed $((SECONDS - start_seconds)))" "$frame"
    sleep 0.5
  done

  status=0
  wait "$pid" || status=$?
  if [[ "$status" -eq 0 ]]; then
    printf "\r\033[K  %s... done (%s)\n" "$label" "$(fmt_elapsed $((SECONDS - start_seconds)))"
    return 0
  fi

  printf "\r\033[K  %s... failed after %s (log: %s)\n" "$label" "$(fmt_elapsed $((SECONDS - start_seconds)))" "$LOG_FILE" >&2
  die "$label failed with exit code $status."
}

expand_path() {
  local path="$1"
  if [[ "$path" == "~" ]]; then
    printf "%s\n" "$HOME"
  elif [[ "$path" == "~/"* ]]; then
    printf "%s/%s\n" "$HOME" "${path#"~/"}"
  else
    printf "%s\n" "$path"
  fi
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

hash_file() {
  local file="$1"
  if command_exists shasum; then
    shasum -a 256 "$file" | awk '{print $1}'
  elif command_exists sha256sum; then
    sha256sum "$file" | awk '{print $1}'
  else
    die "Could not find shasum or sha256sum."
  fi
}

confirm_default_yes() {
  local prompt="$1"
  local answer

  if [[ "${ANNOTATE_AUTO_YES:-0}" == "1" ]]; then
    return 0
  fi

  printf "%s [Y/n]: " "$prompt"
  read -r answer
  case "${answer:-Y}" in
    y|Y|yes|YES|Yes) return 0 ;;
    *) return 1 ;;
  esac
}

load_homebrew_shellenv() {
  if [[ -x /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[ -x /usr/local/bin/brew ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
}

ensure_macos_command_line_tools() {
  if xcode-select -p >/dev/null 2>&1; then
    return
  fi

  printf "\nmacOS Command Line Tools are required for Homebrew and Git.\n"
  printf "A system installer window may open. Complete it, then return here.\n"
  xcode-select --install >/dev/null 2>&1 || true
  printf "Press Enter after Command Line Tools have finished installing."
  read -r _

  xcode-select -p >/dev/null 2>&1 || die "Command Line Tools are still missing. Rerun this installer after installing them."
}

install_homebrew_macos() {
  load_homebrew_shellenv
  if command_exists brew; then
    return
  fi

  command_exists curl || die "curl was not found. macOS normally includes curl; install curl or update macOS, then rerun this installer."
  ensure_macos_command_line_tools

  if ! confirm_default_yes "Homebrew is not installed. Install Homebrew now so Annotate can install Git, Node, Python, and ffmpeg?"; then
    die "Homebrew is required for one-shot dependency installation on macOS."
  fi

  sudo -v || true
  run_logged "Installing Homebrew" bash -lc 'NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
  load_homebrew_shellenv
  command_exists brew || die "Homebrew installation finished, but brew is not on PATH. Open a new Terminal window and rerun this installer."
}

install_macos_prerequisites() {
  local missing=()
  local formula
  install_homebrew_macos

  for formula in git node python@3.12 ffmpeg; do
    if ! brew list --formula "$formula" >/dev/null 2>&1; then
      missing+=("$formula")
    fi
  done

  if [[ "$BREW_UPDATE" == "1" ]]; then
    run_logged "Updating Homebrew" brew update
  fi

  if [[ "${#missing[@]}" -gt 0 ]]; then
    run_logged "Installing missing system dependencies" brew install "${missing[@]}"
  else
    printf "System dependencies already installed; skipping Homebrew install.\n"
  fi

  load_homebrew_shellenv
}

install_linux_prerequisites() {
  local missing=()
  local cmd
  for cmd in git npm python3 ffmpeg curl; do
    if ! command_exists "$cmd"; then
      missing+=("$cmd")
    fi
  done

  if [[ "${#missing[@]}" -eq 0 ]]; then
    printf "System dependencies already installed; skipping package-manager install.\n"
    return
  fi

  printf "Missing system commands: %s\n" "${missing[*]}"

  if command_exists apt-get; then
    command_exists sudo || die "sudo is required to install dependencies with apt-get."
    sudo -v
    run_logged "Updating apt package index" sudo apt-get update
    run_logged "Installing system dependencies" sudo apt-get install -y git nodejs npm python3 python3-venv python3-pip ffmpeg curl
  elif command_exists dnf; then
    command_exists sudo || die "sudo is required to install dependencies with dnf."
    sudo -v
    run_logged "Installing system dependencies" sudo dnf install -y git nodejs npm python3 python3-pip ffmpeg curl
  elif command_exists yum; then
    command_exists sudo || die "sudo is required to install dependencies with yum."
    sudo -v
    run_logged "Installing system dependencies" sudo yum install -y git nodejs npm python3 python3-pip ffmpeg curl
  elif command_exists pacman; then
    command_exists sudo || die "sudo is required to install dependencies with pacman."
    sudo -v
    run_logged "Installing system dependencies" sudo pacman -Sy --needed git nodejs npm python python-pip ffmpeg curl
  else
    die "Unsupported Linux package manager. Install Git, Node.js 18.17+, npm, Python 3.10+, venv, ffmpeg, and curl, then rerun this installer."
  fi
}

has_chromium_browser() {
  case "$(uname -s)" in
    Darwin)
      has_chromium_macos
      ;;
    Linux)
      has_chromium_linux
      ;;
    *)
      return 1
      ;;
  esac
}

has_chromium_macos() {
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
      return 0
    fi
  done

  return 1
}

has_chromium_linux() {
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
    if command_exists "$cmd"; then
      return 0
    fi
  done

  return 1
}

ensure_chromium_browser() {
  if has_chromium_browser; then
    return
  fi

  cat >&2 <<'EOF'

Annotate requires a Chromium-based browser for project folder access.

Please install Google Chrome, then rerun this installer:
https://www.google.com/chrome/

Chrome is not installed automatically by this script.
EOF
  exit 1
}

verify_node_version() {
  command_exists node || die "node was not found after dependency installation."
  node - <<'NODE' || die "Node.js 18.18 or newer is required."
const [major, minor] = process.versions.node.split(".").map(Number);
process.exit(major > 18 || (major === 18 && minor >= 18) ? 0 : 1);
NODE
}

verify_python_version() {
  local python_bin
  python_bin="$(find_python_bin)"
  [[ -n "$python_bin" ]] || die "Python 3 was not found after dependency installation."
  "$python_bin" - <<'PY' || die "Python 3.10-3.12 is required for the sidecar."
import sys
raise SystemExit(0 if (3, 10) <= sys.version_info < (3, 13) else 1)
PY
}

find_python_bin() {
  if command_exists python3.12; then
    command -v python3.12
  elif command_exists python3.11; then
    command -v python3.11
  elif command_exists python3.10; then
    command -v python3.10
  elif command_exists python3; then
    command -v python3
  else
    return 1
  fi
}

ensure_prerequisites() {
  local os_name
  os_name="$(uname -s)"

  ensure_chromium_browser

  case "$os_name" in
    Darwin)
      install_macos_prerequisites
      ;;
    Linux)
      install_linux_prerequisites
      ;;
    *)
      die "Unsupported operating system: $os_name. This installer currently supports macOS and common Linux distributions."
      ;;
  esac

  command_exists git || die "git was not found after dependency installation."
  command_exists npm || die "npm was not found after dependency installation."
  command_exists curl || die "curl was not found after dependency installation."
  command_exists ffmpeg || warn "ffmpeg was not found. Clip export and derived media will not work until ffmpeg is installed."
  verify_node_version
  verify_python_version
}

prompt_install_dir() {
  local answer
  printf "\nChoose where to install Annotate.\n"
  printf "Install folder [%s]: " "$DEFAULT_INSTALL_DIR"
  read -r answer
  answer="${answer:-$DEFAULT_INSTALL_DIR}"
  INSTALL_DIR="$(expand_path "$answer")"
}

clone_or_update_repo() {
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    printf "Existing Annotate checkout found. Updating %s...\n" "$INSTALL_DIR"
    run_logged "Fetching release ref" git -C "$INSTALL_DIR" fetch --tags origin
    if git -C "$INSTALL_DIR" rev-parse --verify --quiet "refs/tags/$REF" >/dev/null; then
      run_logged "Checking out Annotate $ANNOTATE_VERSION" git -c advice.detachedHead=false -C "$INSTALL_DIR" checkout --detach "$REF"
    else
      run_logged "Checking out release ref" git -C "$INSTALL_DIR" checkout "$REF"
      run_logged "Updating release ref" git -C "$INSTALL_DIR" pull --ff-only origin "$REF"
    fi
    return
  fi

  if [[ -e "$INSTALL_DIR" ]] && [[ -n "$(find "$INSTALL_DIR" -mindepth 1 -maxdepth 1 2>/dev/null)" ]]; then
    die "$INSTALL_DIR already exists and is not empty. Choose an empty folder or an existing Annotate git checkout."
  fi

  mkdir -p "$(dirname "$INSTALL_DIR")"
  run_logged "Cloning Annotate $ANNOTATE_VERSION" git -c advice.detachedHead=false clone --branch "$REF" --single-branch "$REPO_URL" "$INSTALL_DIR"
}

install_node_dependencies() {
  local lock_file="$INSTALL_DIR/webapp/package-lock.json"
  local stamp_file="$INSTALL_DIR/webapp/node_modules/.annotate-package-lock.sha256"
  local lock_hash
  [[ -f "$lock_file" ]] || die "Missing webapp package lock: $lock_file"
  lock_hash="$(hash_file "$lock_file")"

  if [[ -d "$INSTALL_DIR/webapp/node_modules" ]] && [[ -f "$stamp_file" ]] && [[ "$(cat "$stamp_file")" == "$lock_hash" ]]; then
    printf "Webapp node_modules already matches package-lock.json; skipping npm ci.\n"
    return
  fi

  run_logged "Installing webapp Node dependencies from lockfile" bash -lc 'cd "$1/webapp" && npm ci --no-audit --no-fund' _ "$INSTALL_DIR"
  printf "%s" "$lock_hash" > "$stamp_file"
}

install_sidecar_dependencies() {
  local python_bin
  local requirements_file
  local stamp_file
  local requirements_hash
  local total_packages
  python_bin="$(find_python_bin || true)"
  [[ -n "$python_bin" ]] || die "python3 was not found. Install Python 3, then rerun this installer."
  requirements_file="$INSTALL_DIR/sidecar/requirements.lock.txt"
  [[ -f "$requirements_file" ]] || die "Missing locked sidecar requirements: $requirements_file"
  stamp_file="$INSTALL_DIR/sidecar/.venv/.annotate-requirements.sha256"
  requirements_hash="$(hash_file "$requirements_file")"

  if [[ -x "$INSTALL_DIR/sidecar/.venv/bin/python" ]] && [[ -f "$stamp_file" ]] && [[ "$(cat "$stamp_file")" == "$requirements_hash" ]]; then
    printf "Python sidecar environment already matches requirements.lock.txt; skipping reinstall.\n"
    return
  fi

  total_packages=$(grep -c '==' "$requirements_file" || true)
  printf "This is the slowest step: it downloads PyTorch, TensorFlow, and OpenCV wheels (2+ GB on first install).\n"

  run_logged "Creating Python sidecar environment" "$python_bin" -m venv "$INSTALL_DIR/sidecar/.venv"
  run_logged "Installing locked Python packaging tools" "$INSTALL_DIR/sidecar/.venv/bin/python" -m pip install --disable-pip-version-check --progress-bar off --upgrade pip==26.2.1 setuptools==83.0.0 wheel==0.46.3
  run_pip_logged "Installing locked Python sidecar dependencies" "$total_packages" "$INSTALL_DIR/sidecar/.venv/bin/python" -m pip install --disable-pip-version-check --progress-bar off -r "$requirements_file"
  printf "%s" "$requirements_hash" > "$stamp_file"
}

install_pnlcalib() {
  [[ -x "$INSTALL_DIR/scripts/setup-pnlcalib.sh" ]] || die "Missing PnLCalib setup script."
  run_logged "Installing PnLCalib source and model weights" "$INSTALL_DIR/scripts/setup-pnlcalib.sh"
}

build_webapp() {
  local revision
  local stamp_file="$INSTALL_DIR/webapp/.next/.annotate-build-revision"
  revision="$(git -C "$INSTALL_DIR" rev-parse HEAD)"

  if [[ -f "$INSTALL_DIR/webapp/.next/BUILD_ID" ]] \
    && [[ -f "$stamp_file" ]] \
    && [[ "$(cat "$stamp_file")" == "$revision" ]]; then
    printf "Production web build already matches %s; skipping rebuild.\n" "$revision"
    return
  fi

  run_logged "Building the production web application" bash -lc 'cd "$1" && npm run build' _ "$INSTALL_DIR"
  mkdir -p "$(dirname "$stamp_file")"
  printf "%s" "$revision" > "$stamp_file"
}

run_tests() {
  if [[ "$RUN_TESTS" != "1" ]]; then
    printf "Skipping tests by default. Set ANNOTATE_RUN_TESTS=1 to run install-time tests.\n"
    return
  fi

  run_logged "Running webapp tests" bash -lc 'cd "$1" && npm test' _ "$INSTALL_DIR"
  run_logged "Running sidecar tests" bash -lc 'cd "$1/sidecar" && PYTHONPATH=. .venv/bin/pytest' _ "$INSTALL_DIR"
}

write_shell_launcher() {
  local output_path="$1"
  cat > "$output_path" <<EOF
#!/usr/bin/env bash
export ANNOTATE_APP_DIR="$INSTALL_DIR"
export ANNOTATE_VERSION="$ANNOTATE_VERSION"
exec "$INSTALL_DIR/start-annotate.sh"
EOF
  chmod +x "$output_path"
}

write_macos_command_launcher() {
  local output_path="$1"
  cat > "$output_path" <<EOF
#!/usr/bin/env bash
export ANNOTATE_APP_DIR="$INSTALL_DIR"
export ANNOTATE_VERSION="$ANNOTATE_VERSION"
exec "$INSTALL_DIR/start-annotate.sh"
EOF
  chmod +x "$output_path"
}

write_linux_desktop_launcher() {
  local output_path="$1"
  cat > "$output_path" <<EOF
[Desktop Entry]
Type=Application
Name=Annotate 0.2
Comment=Launch Football Analysis Annotator 0.2
Terminal=true
Exec=bash -lc 'export ANNOTATE_APP_DIR="$INSTALL_DIR"; export ANNOTATE_VERSION="$ANNOTATE_VERSION"; exec "$INSTALL_DIR/start-annotate.sh"'
EOF
  chmod +x "$output_path"
}

create_desktop_launchers() {
  local desktop_dir="${HOME}/Desktop"
  mkdir -p "$desktop_dir"

  write_shell_launcher "$desktop_dir/start-annotate.sh"

  case "$(uname -s)" in
    Darwin)
      write_macos_command_launcher "$desktop_dir/Annotate.command"
      printf "Created launchers:\n"
      printf "  %s\n" "$desktop_dir/Annotate.command"
      printf "  %s\n" "$desktop_dir/start-annotate.sh"
      ;;
    Linux)
      write_linux_desktop_launcher "$desktop_dir/Annotate.desktop"
      printf "Created launchers:\n"
      printf "  %s\n" "$desktop_dir/Annotate.desktop"
      printf "  %s\n" "$desktop_dir/start-annotate.sh"
      ;;
    *)
      printf "Created launcher:\n"
      printf "  %s\n" "$desktop_dir/start-annotate.sh"
      ;;
  esac
}

maybe_remove_standalone_installer() {
  if [[ "${ANNOTATE_KEEP_INSTALLER:-0}" == "1" ]]; then
    return
  fi

  if [[ "$SELF_PATH" == "$INSTALL_DIR/"* ]]; then
    return
  fi

  if git -C "$(dirname "$SELF_PATH")" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    return
  fi

  rm -f "$SELF_PATH" || warn "Could not remove installer at $SELF_PATH."
}

main() {
  printf "Annotate 0.2 installer\n"
  printf "Version: %s\n" "$ANNOTATE_VERSION"
  printf "Repository: %s\n" "$REPO_URL"
  printf "Git ref: %s\n" "$REF"
  printf "Install log: %s\n" "$LOG_FILE"
  printf "Verbose install output: %s\n" "$VERBOSE_INSTALL"
  printf "Run install-time tests: %s\n" "$RUN_TESTS"
  printf "Run Homebrew update: %s\n" "$BREW_UPDATE"
  printf "Launch after install: %s\n" "$AUTO_START"

  progress 2 "Installing prerequisites"
  ensure_prerequisites

  progress 16 "Choosing install folder"
  prompt_install_dir

  progress 18 "Cloning or updating Annotate"
  clone_or_update_repo

  progress 26 "Installing Node dependencies"
  install_node_dependencies

  progress 42 "Creating Python sidecar environment"
  install_sidecar_dependencies

  progress 80 "Installing homography models"
  install_pnlcalib

  progress 88 "Building production application"
  build_webapp

  progress 94 "Running tests"
  run_tests

  progress 96 "Creating desktop launchers"
  create_desktop_launchers

  progress 97 "Checking launcher script"
  bash -n "$INSTALL_DIR/start-annotate.sh"

  progress 99 "Cleaning installer"
  maybe_remove_standalone_installer

  progress 100 "Done"
  printf "\nInstall complete.\n"
  printf "Double-click Annotate.command on your Desktop, or run:\n"
  printf "  %s/start-annotate.sh\n" "$INSTALL_DIR"
  if [[ "$AUTO_START" == "1" ]]; then
    printf "\nStarting Annotate now...\n"
    export ANNOTATE_APP_DIR="$INSTALL_DIR"
    export ANNOTATE_VERSION
    exec "$INSTALL_DIR/start-annotate.sh"
  fi
}

# Test hook: set ANNOTATE_INSTALL_NO_MAIN=1 to source this file without
# running the installer (used to exercise individual functions).
if [[ "${ANNOTATE_INSTALL_NO_MAIN:-0}" != "1" ]]; then
  main "$@"
fi
