# Legacy Browser Installation

These instructions and scripts preserve the terminal-based Annotate 0.2 installation path. Normal installations should use the [desktop downloads](../../README.md#install). Browser development is still supported and is documented separately in [development setup](../../docs/development.md).

The archived installer defaults to `v0.2.0`, not the latest desktop version. Existing release tags retain their original file paths, so old download links continue to work. Do not run the installer against a working development checkout: it checks out the requested release. Use a separate installation folder.

## Quick install

On macOS or a common Linux distribution, run:

```bash
(curl -fsSL https://raw.githubusercontent.com/PatrickJYKang/annotate/v0.2.0/install.sh -o /tmp/install-annotate.sh || wget -qO /tmp/install-annotate.sh https://raw.githubusercontent.com/PatrickJYKang/annotate/v0.2.0/install.sh) && bash /tmp/install-annotate.sh
```

The installer bootstraps missing prerequisites where possible, installs locked dependencies and checksum-verified PnLCalib models, builds the browser app, and creates a Desktop launcher. It stops with a Chrome download link if no supported browser exists. Set `ANNOTATE_AUTO_START=0` to skip automatic startup, or `ANNOTATE_RUN_TESTS=1` to run install-time tests. Installation is large and can take several minutes or more.

## Requirements

- macOS or a 64-bit Linux distribution using `apt`, `dnf`, `yum`, or `pacman`. This shell installer does not support Windows.
- Git, Node.js 18.18 or newer, Python 3.10-3.12, ffmpeg and curl. The installer provisions these where supported; these version requirements describe the pinned 0.2.0 release, not current development.
- A Chromium browser such as Chrome, Edge, Brave, Arc or Chromium. Safari and Firefox do not expose the required File System Access API.
- At least 8 GB RAM; 16 GB is recommended for computer vision. Allow at least 6 GB free on macOS or 12 GB on Linux, plus project media and exports. Standard Linux PyTorch wheels may include CUDA libraries even on CPU-only systems.
- Internet for dependency/model installation and the first YOLO download.

## Manual fallback

If cloning failed, install the prerequisites and clone into a new folder:

```bash
git clone --depth 1 --branch v0.2.0 --single-branch \
  https://github.com/PatrickJYKang/annotate.git ~/Documents/annotate
```

If installation failed after cloning, run these commands in that release checkout:

```bash
cd ~/Documents/annotate
cd webapp && npm ci && cd ..
python3.12 -m venv sidecar/.venv
sidecar/.venv/bin/python -m pip install -r sidecar/requirements.lock.txt
./scripts/setup-pnlcalib.sh
npm run build
npm run start
```

## Launchers and troubleshooting

The installer creates `Annotate.command` on the macOS Desktop or `Annotate.desktop` on Linux. Keep its terminal open while Annotate runs. Closing it or pressing Ctrl+C stops the browser server and sidecar. Logs are written to `<install-folder>/.runtime/app.log`; the default ports are 3000 and 8321.

If the sidecar is offline, inspect that log, restart the launcher, and check whether another process owns those ports. If PnLCalib is unavailable, run `./scripts/setup-pnlcalib.sh` in the installed release folder, then restart. First-use YOLO download failures require an internet connection and write access to the model/cache location.

In this checkout the archived scripts are `install.sh`, `Install Annotate.command`, `start-annotate.sh` and `Annotate.command` in this directory. The launcher defaults to the repository root two levels above it; `ANNOTATE_APP_DIR` can override the application directory. Generated shortcuts resolve either this layout or the root-level launcher used by older pinned releases. The active `npm run dev` and `npm run start` scripts remain under the repository's `scripts/` directory.
