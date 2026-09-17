# annotate-sidecar

Python sidecar service for ML-powered annotation features. Runs alongside the Next.js frontend and provides object tracking, homography estimation, video preparation, and export encoding.

## Current scope note

This sidecar actively backs the frame-native project and clip workflows:

- `/video/normalize/start` supplies authoritative per-video metadata and chooses preserve, remux, or transcode for every v2 video import
- `/track/detect` supplies provisional player targets and `/track/stream` supplies live trusted keyframes for the highlight-driven tracking workflow; `/track` remains the equivalent non-streaming response path
- `/homography/stream` supplies frame-based clip calibration progress and results; `/homography` remains the timestamp-based pin/compatibility path. Both use vendored `PnLCalib`; clip calibration solves every 15 source frames with interpolation and web-layer sanity filtering

`/derived-media/exact-motion` and the generic `/export/*` session API remain implemented and tested service boundaries, but the canonical v2 UI does not currently expose clip MP4 export. Presentations play absolute frame ranges directly from original project videos; exact-motion encoding is retained only as a possible future export primitive.

## Requirements

- **Python 3.10–3.12** (3.12 recommended and used for release verification)
- **ffmpeg** (for export encoding) — `brew install ffmpeg` / `apt install ffmpeg`

## Setup

```bash
cd sidecar

# Create a virtual environment
python3.12 -m venv .venv
source .venv/bin/activate   # macOS/Linux
# .venv\Scripts\activate    # Windows

# Install pinned development and test dependencies
pip install -r requirements-dev.lock.txt

# Return to the repository root and install the required homography provider
cd ..
./scripts/setup-pnlcalib.sh
```

> **Note:** `requirements.lock.txt` is the smaller application runtime; `requirements-dev.lock.txt` adds pytest for contributors. Use the corresponding unpinned `.txt` inputs only when intentionally refreshing dependency versions.
>
> Tracking depends on `supervision`. Homography is a required 0.2 capability: `scripts/setup-pnlcalib.sh` installs the pinned PnLCalib source and verifies both model weights by SHA-256 under `sidecar/third_party/pnlcalib`. Developers may override that path with `ANNOTATE_PNLCALIB_ROOT`; the release launcher refuses to start when the pinned provider is missing or invalid.

## Running

```bash
# Default: http://127.0.0.1:8321
python -m annotate_sidecar

# Custom port
python -m annotate_sidecar --port 9000

# Debug logging
python -m annotate_sidecar --log-level debug
```

## Tests

Run pytest through the virtual-environment interpreter so the sidecar package root is on Python's import path:

```bash
cd sidecar
.venv/bin/python -m pytest tests
```

Routes that take a video locator (`/track`, `/homography`) expect either:
- `videoRef` from `POST /video/register` (recommended)
- absolute `videoPath` (legacy/manual)

Relative `videoPath` values are rejected.

## API Endpoints

| Method   | Path               | Description                          |
|----------|---------------------|--------------------------------------|
| `GET`    | `/health`           | Sidecar status & model availability  |
| `POST`   | `/track`            | Object tracking (annotate adapter + vendored trackers OC-SORT core; optional debug artifact) |
| `POST`   | `/track/stream`     | NDJSON tracking stream with each trusted keyframe followed by the final result |
| `POST`   | `/track/detect`     | Detect all players at one frame for interactive target selection |
| `GET`    | `/track/debug/{artifact}` | Download a saved tracking debug MP4 artifact |
| `POST`   | `/homography`       | Pitch homography (annotate range adapter + vendored trackers PnLCalib provider) |
| `POST`   | `/homography/stream` | NDJSON calibration phases and completed/total sample counts, followed by the final result; disconnect cancels remaining work |
| `POST`   | `/export/start`     | Begin export session                 |
| `POST`   | `/export/frame`     | Submit rendered frame (base64 JPEG)  |
| `POST`   | `/export/encode`    | Encode frames to MP4 (ffmpeg)        |
| `GET`    | `/export/{sessionId}/file` | Download encoded export MP4 before cleanup |
| `DELETE` | `/export/{id}`      | Clean up export session              |
| `POST`   | `/derived-media/exact-motion` | Encode an exact video segment; dormant primitive retained for future export use |
| `POST`   | `/video/register`   | Upload video file and get `videoRef` |
| `POST`   | `/video/normalize`  | Compatibility synchronous normalization endpoint |
| `POST`   | `/video/normalize/start` | Upload video and start a smart background import job |
| `GET`    | `/video/normalize/{jobId}` | Poll analyze/remux/transcode/probe progress and metadata |
| `GET`    | `/video/normalize/{jobId}/file` | Download a remux/transcode result and clean up the job |
| `DELETE` | `/video/normalize/{jobId}` | Acknowledge preserve, or cancel and clean up an import job |
| `POST`   | `/video/probe`      | Count frames and return authoritative FPS/dimensions without normalizing |
| `DELETE` | `/video/{videoRef}` | Unregister a temporary uploaded video |

## Architecture

```
annotate_sidecar/
  __init__.py
  __main__.py              # CLI entry point (arg parsing + uvicorn)
  server.py                # FastAPI app, CORS, lifespan events
  video_registry.py        # Temporary videoRef -> temp-file registry
  routes/
    health.py              # GET /health
    track.py               # Tracking, player detection, and optional debug artifact download
    homography.py          # POST /homography and /homography/stream
    export.py              # Export endpoints
    derived_media.py       # POST /derived-media/exact-motion
    video.py               # Video register, smart import, probe, and cleanup
  services/
    frame_extractor.py     # cv2.VideoCapture → frames by ms
    tracker.py             # annotate-owned tracking adapter / response shaping
    calibration/           # PnLCalib-backed range adapter + public response types
    encoder.py             # ffmpeg MP4 encoding
    video_probe.py         # fast container count, packet count, decode fallback
  vendor/
    trackers/              # Vendored trackers primitives (OC-SORT + PnLCalib)
  models/                  # Optional local model cache (gitignored)
```

## Tracking defaults

Tracking defaults are centralized in:

- [`annotate_sidecar/config/tracking.py`](annotate_sidecar/config/tracking.py)

Current ownership stance:

- `annotate` sidecar owns the practical app defaults and override policy
- vendored trackers core owns lower-level implementation details
- `/track` request fields (`fps`, `classes`, `confThreshold`, `iouThreshold`, `debugVideo`) act as request-level overrides
- `stopOnLoss` enables the interactive editor contract: inference stops at the first frame where continuity cannot identify the chosen player and returns `stoppedAtMs`

Current app-facing tracking semantics:

- `/track/detect` supplies provisional foot-anchored highlights for every detected player at the current frame
- the clip editor creates a `highlight` from the player the analyst selects
- tracked highlight geometry is treated as foot-anchored
- the sidecar seed matcher prefers the selected player's foot point and tolerates loose seeds
- raw OC-SORT IDs are treated as a preference signal, not absolute truth, because seed-frame detections may be immature (`track_id = -1`) and later frames can reassign IDs
- the annotate-owned adapter follows spatial continuity when a raw ID would imply an unreasonable jump
- when continuity is lost, the editor pauses at that frame for human reacquisition rather than extrapolating an uncertain identity

Optional sidecar-level environment overrides:

- `ANNOTATE_TRACKING_MODEL`
- `ANNOTATE_TRACKING_SAMPLE_FPS`
- `ANNOTATE_TRACKING_CLASSES`
- `ANNOTATE_TRACKING_CONF_THRESHOLD`
- `ANNOTATE_TRACKING_IOU_THRESHOLD`
- `ANNOTATE_TRACKING_TRACK_BUFFER`
- `ANNOTATE_TRACKING_MIN_CONSECUTIVE_FRAMES`
- `ANNOTATE_TRACKING_DIRECTION_WEIGHT`
- `ANNOTATE_TRACKING_HIGH_CONF_THRESHOLD`
- `ANNOTATE_TRACKING_DELTA_T`

## Video import

The v2 webapp uses the background job endpoints rather than the blocking compatibility route. Each video retains its own authoritative FPS and resolution. The job selects the least destructive path:

- compatible CFR H.264/yuv420p MP4 is `preserve`d without FFmpeg encoding;
- compatible CFR H.264 in another container is `remux`ed without video re-encoding;
- near-CFR H.264 MP4 can be `remux`ed onto a regular frame clock without decoding or re-encoding; and
- more irregular variable-frame-rate or incompatible media is `transcode`d to CFR H.264 at its source FPS and dimensions.

The browser reports upload and result-download bytes; FFmpeg operations report processed media time. For preserve, the browser writes its original `File` directly into the project and acknowledges the sidecar job with `DELETE`. Authoritative probing first accepts positive container `nb_frames`; only files without it incur a packet scan, followed by explicit decoding as a last resort.

Timestamp-only preparation scans every video packet before choosing the fast path. It requires compatible video/audio, a near-constant cadence, no large gaps, at most 200 ms of timing adjustment anywhere, and a reconstructible decoded/display frame order. A second packet scan verifies the output clock and ordering. Pictures and audio are copied unchanged; frame timing is regularized rather than exactly preserved. Up to two reference pictures immediately beyond an original edit-list end may become visible, but discarded preroll/interior pictures are rejected. Inputs exceeding the bounds, unsupported FFmpeg behavior, or failed verification fall back to encoding. This path uses ordinary FFmpeg rather than platform-specific hardware or new dependencies.

The import panel estimates remaining time for the current step from its measured progress over a rolling 30-second window. Upload bytes are not used to predict encoding time, and step changes reset the estimate. Until progress advances, or after a 15-second stall, the panel does not display a numerical prediction.

On macOS, `auto` mode prefers the FFmpeg `h264_videotoolbox` encoder, moving H.264 encoding onto Apple media hardware. Eligible H.264/yuv420p inputs at least two minutes long use two concurrent hardware-decoded and hardware-encoded segments when dimensions are unchanged, pixels are square, and no rotation is needed. Both segments use the same absolute frame grid, with decoding preroll before the join. The final stream-copy join restores exact frame timestamps and copies compatible AAC/MP3 audio without re-encoding. Progress combines both workers and the join. Temporary segments require approximately one extra output file's worth of disk space during joining and are removed on completion, cancellation, or failure.

An unsupported input or failed parallel attempt uses the original single-stream path. Other systems, or a failed hardware attempt, use `libx264` with the `veryfast` preset and at most four encoder threads and two filter threads. Long-operation timeouts scale with media duration, and the sidecar runs at most one import job at a time, with at most two segment workers inside that job.

Optional overrides:

- `ANNOTATE_NORMALIZE_ENCODER=auto|h264_videotoolbox|libx264`
- `ANNOTATE_NORMALIZE_THREADS=<1-16>` (software fallback; default `4` or the machine's lower CPU count)
- `ANNOTATE_NORMALIZE_PARALLEL=0` (disable the two-segment macOS optimization)
- `ANNOTATE_NORMALIZE_RETIME=0` (disable timestamp-only preparation and retain the frame-selection-preserving transcode path)

## Homography calibration

Homography now follows the same ownership pattern as tracking:

- `annotate` sidecar owns the app-facing `/homography` and `/homography/stream` contracts and clip-range extraction
- the calibration layer lives under [`annotate_sidecar/services/calibration/`](annotate_sidecar/services/calibration/)
- the only active provider is the vendored trackers `PnLCalibProvider`
- clip requests send integer `startFrame`, exclusive `endFrame`, `sourceFps`, and `everyNFrames: 15`; the provider samples exact source-frame indices rather than accumulating fractional timestamps. Intermediate preprocessing samples are retained every three source frames, with an inference every fifth sample. The provider drops invalid/corrupt solutions, fills and interpolates the sparse sequence, then adapts it back into Annotate's cached frame format
- the webapp applies an additional jump sanity filter before using a matrix

The streaming endpoint emits `progress` events with `phase`, `completed`, and `total`, then a `result` event containing the same `frames` payload as `/homography`. Phases distinguish queueing, sample preparation, model loading, calibration, and interpolation. Counts measure solved sample slots rather than interpolated output frames. Worker failures after streaming starts arrive as `error` events. Canceling/disconnecting stops at the next worker checkpoint, not in the middle of a GPU inference or model initialization.

Calibration runs off the HTTP event loop, so health checks and other requests remain responsive. A service-level lock serializes calibration jobs and reuses the loaded models across requests. The default provider configuration selects CUDA, then Apple MPS, then CPU. Checkpoints load on CPU before transferring models once to the selected device. Temporary sampled-video preprocessing and rejection/interpolation rules are retained; the denser frame interval applies to new clip computations. The stream also accepts legacy timestamp requests; pin requests are unchanged.

Current clip-side coexistence rule:

- pitch-space authoring is supported for pitch-grounded primitives such as `box` and `circle`
- normal tactical tools and tracking anchors remain image-space
- the clip editor projects pitch-space annotations through the returned homography at playback/render time

`GET /health` now includes a `homography` section with:

- active provider name
- provider availability summaries

## Hardware

- **CPU-only** works for the implemented endpoints when their required models and provider assets are installed. Tracking and homography are substantially slower.
- **CUDA GPU** accelerates YOLO and PnLCalib significantly. PyTorch auto-detects CUDA if available.
- **Apple Silicon** uses Metal (MPS) for PnLCalib when PyTorch reports it available; otherwise calibration runs on CPU.
- **Linux storage** is higher because standard PyTorch wheels include CUDA runtime libraries even on CPU-only systems.

## Local service authorization

The default browser launcher accepts `http://localhost:*` and `http://127.0.0.1:*` origins on any port without a bearer token, preserving the self-hosted workflow. Keep the service bound to loopback; this is not a public-server deployment configuration.

Managed-host preparation adds optional `ANNOTATE_AUTH_TOKEN` and `ANNOTATE_ALLOWED_ORIGINS`. A configured token must be 32-256 URL-safe alphanumeric/underscore/hyphen characters; use a freshly generated cryptographic token, not a password. Allowed origins are an explicit comma-separated list. Managed mode requires `Authorization: Bearer <token>` for HTTP routes and rejects other Origins. Matching CORS preflights work without authentication; they do not authorize the subsequent request. Startup refuses a weak token or missing origins.

The native host keeps the upstream token private and supplies a distinct per-window proxy URL/token at launch. The proxy permits only health, detection, tracking, homography and cleanup for video references registered for that window. Renderer-supplied paths and private native routes are rejected; bearer authentication alone is not filesystem isolation. Browser launch behavior is unchanged. See [Desktop Development Host](../desktop/README.md).

Managed mode also provides private host-only `POST /native/register`, `POST /native/import` and `GET /native/import/{job_id}/result` routes. They are unavailable without managed authentication and are never forwarded by the renderer proxy. Registration of an existing native source does not transfer file ownership: unregister and import cleanup leave the source intact. Native import reuses the existing preserve/remux/transcode jobs and authoritative probe, allowing the host to copy prepared media directly into the project without a browser upload/download round trip.

## Troubleshooting

- **"ffmpeg not found"** — Install ffmpeg: `brew install ffmpeg` (macOS) or `apt install ffmpeg` (Linux).
- **PnLCalib unavailable** — from the repository root, rerun `./scripts/setup-pnlcalib.sh`. It repairs the pinned source and verifies both model weights before the next launch.
- **YOLO model download fails** — The first tracking call downloads `yolov8n.pt` (~6MB). Check internet connectivity.
- **Need to inspect tracker behavior frame-by-frame** — `/track` can optionally emit a saved annotated MP4 and expose it through `/track/debug/{artifact}`. Use the `debugVideo` request field to control artifact generation; the route returns `debugVideoUrl` when an artifact is produced.
