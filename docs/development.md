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

Video import obtains authoritative frame metadata from the sidecar and preserves compatible media, remuxes when possible, or transcodes when needed. Existing project schema, drawing and playback code are shared with desktop; avoid simultaneous browser and desktop edits to one project folder.

## Tests and production build

```bash
npm test
npm run playwright:install
npm run test:e2e
npm --prefix webapp run lint
(cd sidecar && .venv/bin/python -m pytest tests)
npm run build
npm run start
```

`npm run dev` and `npm run start` use the maintained scripts under `scripts/`, not the archived Desktop launchers. Desktop development, production renderer builds and native tests are documented in [desktop/README.md](../desktop/README.md).
