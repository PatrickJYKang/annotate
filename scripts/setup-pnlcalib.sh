#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PNLCALIB_ROOT="${ANNOTATE_PNLCALIB_ROOT:-$ROOT_DIR/sidecar/third_party/pnlcalib}"
PNLCALIB_REPOSITORY="https://github.com/mguti97/PnLCalib.git"
PNLCALIB_COMMIT="8c87391d6f4ea40c5e4d65e61529916c7a49ce62"
WEIGHTS_DIRECTORY="$PNLCALIB_ROOT/weights"
KEYPOINTS_URL="https://github.com/mguti97/PnLCalib/releases/download/v1.0.0/SV_kp"
LINES_URL="https://github.com/mguti97/PnLCalib/releases/download/v1.0.0/SV_lines"
KEYPOINTS_SHA256="7ea78fa76aaf94976a8eca428d6e3c59697a93430cba1a4603e20284b61f5113"
LINES_SHA256="d72f4ed71734a2e3df9fa084f666e9b8adaef21bf69bac8952d6d3f970ff7455"
CHECK_ONLY=0

if [[ "${1:-}" == "--check" ]]; then
  CHECK_ONLY=1
elif [[ -n "${1:-}" ]]; then
  printf "Usage: %s [--check]\n" "$0" >&2
  exit 2
fi

hash_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    printf "Neither shasum nor sha256sum is available.\n" >&2
    return 1
  fi
}

source_is_valid() {
  [[ -d "$PNLCALIB_ROOT/.git" ]] || return 1
  [[ "$(git -C "$PNLCALIB_ROOT" rev-parse HEAD 2>/dev/null || true)" == "$PNLCALIB_COMMIT" ]]
}

weight_is_valid() {
  local path="$1"
  local expected="$2"
  [[ -f "$path" ]] && [[ "$(hash_file "$path")" == "$expected" ]]
}

installation_is_valid() {
  source_is_valid \
    && weight_is_valid "$WEIGHTS_DIRECTORY/SV_kp" "$KEYPOINTS_SHA256" \
    && weight_is_valid "$WEIGHTS_DIRECTORY/SV_lines" "$LINES_SHA256"
}

download_weight() {
  local url="$1"
  local output="$2"
  local expected="$3"
  local partial="${output}.part"

  if weight_is_valid "$output" "$expected"; then
    printf "Verified %s.\n" "$(basename "$output")"
    return
  fi

  rm -f "$output"
  if command -v curl >/dev/null 2>&1; then
    curl --fail --location --retry 3 --continue-at - --output "$partial" "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget --continue --output-document "$partial" "$url"
  else
    printf "curl or wget is required to download PnLCalib weights.\n" >&2
    return 1
  fi

  if [[ "$(hash_file "$partial")" != "$expected" ]]; then
    rm -f "$partial"
    printf "Checksum verification failed for %s.\n" "$(basename "$output")" >&2
    return 1
  fi
  mv "$partial" "$output"
}

if ((CHECK_ONLY)); then
  if installation_is_valid; then
    printf "PnLCalib source and weights are ready.\n"
    exit 0
  fi
  printf "PnLCalib is missing or does not match the Annotate 0.2 release lock.\n" >&2
  exit 1
fi

command -v git >/dev/null 2>&1 || { printf "git is required to install PnLCalib.\n" >&2; exit 1; }

if ! source_is_valid; then
  if [[ -d "$PNLCALIB_ROOT/.git" ]]; then
    git -C "$PNLCALIB_ROOT" fetch origin "$PNLCALIB_COMMIT"
  elif [[ -e "$PNLCALIB_ROOT" ]]; then
    printf "%s exists but is not a PnLCalib git checkout; refusing to replace it.\n" "$PNLCALIB_ROOT" >&2
    exit 1
  else
    mkdir -p "$(dirname "$PNLCALIB_ROOT")"
    git clone --filter=blob:none --no-checkout "$PNLCALIB_REPOSITORY" "$PNLCALIB_ROOT"
  fi
  git -C "$PNLCALIB_ROOT" fetch --depth 1 origin "$PNLCALIB_COMMIT"
  git -c advice.detachedHead=false -C "$PNLCALIB_ROOT" checkout --detach "$PNLCALIB_COMMIT"
fi

mkdir -p "$WEIGHTS_DIRECTORY"
download_weight "$KEYPOINTS_URL" "$WEIGHTS_DIRECTORY/SV_kp" "$KEYPOINTS_SHA256"
download_weight "$LINES_URL" "$WEIGHTS_DIRECTORY/SV_lines" "$LINES_SHA256"

installation_is_valid || { printf "PnLCalib installation did not pass verification.\n" >&2; exit 1; }
printf "PnLCalib source and weights are ready at %s.\n" "$PNLCALIB_ROOT"
