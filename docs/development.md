# Development Setup

This is a source-development workflow, not the end-user installer. Use the [desktop downloads](../README.md#install) to run the packaged app, or [legacy browser installation](../legacy/browser-install/README.md) for the archived release installer.

## Browser preview

Use Node.js 22 or 24 with npm, Python 3.12, Git, ffmpeg, and a current Chromium browser. macOS is the primary development environment; the service scripts also support Linux. Install dependencies from the repository root:

```bash
npm ci
npm --prefix webapp ci
python3.12 -m venv sidecar/.venv
sidecar/.venv/bin/python -m pip install -r sidecar/requirements-dev.lock.txt
./scripts/setup-pnlcalib.sh
npm run dev
```

The Next.js app defaults to `http://localhost:3000` and the Python sidecar to `http://127.0.0.1:8321`. Keep the development process running while using the preview. Use `PORT`, `SIDECAR_PORT` and `NEXT_PUBLIC_SIDECAR_URL` to run on different ports. Safari and Firefox do not expose the browser project's required File System Access API.

Set `ANNOTATE_PNLCALIB_ROOT` when using an existing verified provider outside `sidecar/third_party/pnlcalib`. Set `NEXT_DIST_DIR` to isolate a preview's generated output from production builds. When reusing a preview for Playwright, set `PLAYWRIGHT_WEB_PORT` and `PLAYWRIGHT_SIDECAR_PORT` to its actual ports.

YOLO runs with Annotate-private settings and usage analytics/HUB integration disabled. Source runs use the OS configuration directory under `Annotate/sidecar/ultralytics`; `ANNOTATE_ULTRALYTICS_CONFIG_DIR` overrides that root for isolated profiles. An inherited generic `YOLO_CONFIG_DIR` is intentionally not reused. See [sidecar privacy settings](../sidecar/README.md#yolo-privacy-settings) for paths and regression coverage. Restart the Python sidecar after backend changes; Next.js hot reload does not reload it.

Video import obtains authoritative frame metadata from the sidecar and preserves compatible media, remuxes when possible, or transcodes when needed. Existing project schema, drawing and playback code are shared with desktop; avoid simultaneous browser and desktop edits to one project folder.

Current development targets [0.2.4](../desktop/releases/0.2.4.md), while package manifests still read 0.2.3-rc.1. A running preview uses source changes; an installed desktop app does not. Restart the sidecar after Python changes, and rebuild/restart the standalone desktop renderer after UI changes before comparing hosts.

## Tests and production build

```bash
npm test
npm run playwright:install
npm run test:e2e
npm --prefix webapp run lint
./webapp/node_modules/.bin/tsc --noEmit -p webapp/tsconfig.json
npm run test:desktop
(cd sidecar && .venv/bin/python -m pytest tests)
npm run build
npm run start
```

`npm run dev` and `npm run start` use the maintained scripts under `scripts/`, not the archived Desktop launchers. Desktop development, production renderer builds and native tests are documented in [desktop/README.md](../desktop/README.md).

Browser tests cover the shared workflows; native-host tests cover filesystem/IPC contracts. Before distributing installers, rebuild the standalone renderer after UI or guide-link changes, then stage and package each target. Run the packaged Electron smoke separately: a browser pass or a Windows archive-integrity pass does not verify a Windows desktop launch. Guide text/media live in the separate `annotate-docs` repository, not in this build. Completed videos and remaining topics are listed in the [demo recording inventory](demo-recording-checklist.md); the [capture/editing workflow](demo-recording-workflow.md) documents the isolated native-app setup and local production artifacts.

## Recording regressions

`webapp/lib/export/recording.test.ts` covers timing-to-segment conversion and output-frame accumulation. `webapp/e2e/presentation.spec.ts` covers the real recording UI, saved takes, imported clip timings, MP4 output and shared video/overlay alignment. Test the actual moving annotation layer and a decoded video frame, not only a playhead readout. The latest regressions include missed frame callbacks and a pixel comparison between clip and recording views at the same source frame.

Browser recording export uses the sidecar session API. Desktop uses project-bound `recording.*` commands in `desktop/core/recording-export.mjs`, which call that encoder privately and write through the native project store. A browser pass does not establish native export permissions, cleanup or shutdown behavior. Use disposable project copies for these checks and verify the resulting MP4 as well as saved timing data.
