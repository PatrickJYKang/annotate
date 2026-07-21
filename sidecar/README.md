# annotate-sidecar

Python sidecar service for ML-powered annotation features. Runs alongside the
Next.js frontend and provides object tracking, segmentation, homography
estimation, and video export encoding.

## Current scope note

This sidecar actively backs the frame-native project and clip workflows:

- `/video/normalize/start` supplies authoritative per-video metadata and chooses
  preserve, remux, or transcode for every v2 video import
- `/track` is the live highlight-driven player-tracking path
- `/homography` is the live clip homography path on vendored `PnLCalib`
- `/derived-media/exact-motion` continues to power presentation playback media

`/segment` and the generic `/export/*` session API remain implemented and
tested service boundaries, but the canonical v2 UI does not currently expose
foreground compositing or clip MP4 export.

## Requirements

- **Python 3.10–3.12** (3.12 recommended; TensorFlow does not support 3.13+)
- **ffmpeg** (for export encoding) — `brew install ffmpeg` / `apt install ffmpeg`

## Setup

```bash
cd sidecar

# Create a virtual environment
python3.12 -m venv .venv
source .venv/bin/activate   # macOS/Linux
# .venv\Scripts\activate    # Windows

# Install pinned pre-release dependencies
pip install -r requirements.lock.txt

# Optional: install MobileSAM for person segmentation
pip install git+https://github.com/ChaoningZhang/MobileSAM.git
```

> **Note:** `requirements.lock.txt` pins the verified application environment. Use
> `requirements.txt` only when intentionally refreshing dependency versions.
>
> Tracking now depends on `supervision`, and homography now depends on
> `lsq-ellipse` plus an accessible `PnLCalib` checkout + weights. Those Python
> dependencies are included in `requirements.lock.txt`; the upstream `PnLCalib`
> assets are discovered from either:
> - `sidecar/third_party/pnlcalib`
> - a sibling checkout at `../trackers/third_party/pnlcalib`
> - `ANNOTATE_PNLCALIB_ROOT`

## Running

```bash
# Default: http://127.0.0.1:8321
python -m annotate_sidecar

# Custom port
python -m annotate_sidecar --port 9000

# Debug logging
python -m annotate_sidecar --log-level debug
```

Routes that take a video locator (`/track`, `/segment`, `/homography`) expect either:
- `videoRef` from `POST /video/register` (recommended)
- absolute `videoPath` (legacy/manual)

Relative `videoPath` values are rejected.

## API Endpoints

| Method   | Path               | Description                          |
|----------|---------------------|--------------------------------------|
| `GET`    | `/health`           | Sidecar status & model availability  |
| `POST`   | `/track`            | Object tracking (annotate adapter + vendored trackers OC-SORT core; optional debug artifact) |
| `GET`    | `/track/debug/{artifact}` | Download a saved tracking debug MP4 artifact |
| `POST`   | `/homography`       | Pitch homography (annotate range adapter + vendored trackers PnLCalib provider) |
| `POST`   | `/segment`          | Person segmentation (YOLO + MobileSAM) |
| `POST`   | `/export/start`     | Begin export session                 |
| `POST`   | `/export/frame`     | Submit rendered frame (base64 JPEG)  |
| `POST`   | `/export/encode`    | Encode frames to MP4 (ffmpeg)        |
| `GET`    | `/export/{sessionId}/file` | Download encoded export MP4 before cleanup |
| `DELETE` | `/export/{id}`      | Clean up export session              |
| `POST`   | `/derived-media/exact-motion` | Encode exact video segment for presentation playback |
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
    track.py               # POST /track + optional debug artifact download
    segment.py             # POST /segment
    homography.py          # POST /homography
    export.py              # Export endpoints
    derived_media.py       # POST /derived-media/exact-motion
    video.py               # Video register, smart import, probe, and cleanup
  services/
    frame_extractor.py     # cv2.VideoCapture → frames by ms
    tracker.py             # annotate-owned tracking adapter / response shaping
    segmenter.py           # YOLO + MobileSAM wrapper
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

Current app-facing tracking semantics:

- the clip editor seeds tracking from `highlight` annotations
- tracked highlight geometry is treated as foot-anchored
- the sidecar seed matcher prefers the selected player's foot point and tolerates loose seeds
- raw OC-SORT IDs are treated as a preference signal, not absolute truth, because seed-frame detections may be immature (`track_id = -1`) and later frames can reassign IDs
- the annotate-owned adapter follows spatial continuity when a raw ID would imply an unreasonable jump

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

The v2 webapp uses the background job endpoints rather than the blocking
compatibility route. Each video retains its own authoritative FPS and
resolution. The job selects the least destructive path:

- compatible CFR H.264/yuv420p MP4 is `preserve`d without FFmpeg encoding;
- compatible CFR H.264 in another container is `remux`ed without video
  re-encoding; and
- variable-frame-rate or incompatible media is `transcode`d to CFR H.264 at
  its source FPS and dimensions.

The browser reports upload and result-download bytes; FFmpeg operations report
processed media time. For preserve, the browser writes its original `File`
directly into the project and acknowledges the sidecar job with `DELETE`.
Authoritative probing first accepts positive container `nb_frames`; only files
without it incur a packet scan, followed by explicit decoding as a last resort.

On macOS, `auto` mode prefers the FFmpeg `h264_videotoolbox` encoder, moving
H.264 encoding onto Apple media hardware. Other systems, or a failed hardware
attempt, use `libx264` with the `veryfast` preset and at most four threads.
The filter graph is separately capped at two threads, long-operation timeouts
scale with media duration, and the sidecar runs at most one import job at a
time.

Optional overrides:

- `ANNOTATE_NORMALIZE_ENCODER=auto|h264_videotoolbox|libx264`
- `ANNOTATE_NORMALIZE_THREADS=<1-16>` (software fallback; default `4` or the
  machine's lower CPU count)

## Homography calibration

Homography now follows the same ownership pattern as tracking:

- `annotate` sidecar owns the app-facing `/homography` contract and clip-range extraction
- the calibration layer lives under
  [`annotate_sidecar/services/calibration/`](annotate_sidecar/services/calibration/)
- the only active provider is the vendored trackers `PnLCalibProvider`
- smoothing/interpolation happens inside the vendored provider config, then results are adapted back into annotate's cached frame format

Current clip-side coexistence rule:

- pitch-space authoring is supported for pitch-grounded primitives such as `box` and `circle`
- normal tactical tools and tracking anchors remain image-space
- the clip editor projects pitch-space annotations through the returned homography at playback/render time

`GET /health` now includes a `homography` section with:

- active provider name
- provider availability summaries

## Hardware

- **CPU-only** works for the implemented endpoints when their required models
  and provider assets are installed. Tracking, segmentation, and homography
  are substantially slower.
- **CUDA GPU** accelerates YOLO, MobileSAM, and PnLCalib significantly.
  PyTorch auto-detects CUDA if available.
- **Apple Silicon** is supported via MPS (Metal Performance Shaders)
  for PyTorch operations.

## CORS

The sidecar allows requests from `http://localhost:*` to support the Next.js
dev server on any port.

## Troubleshooting

- **"ffmpeg not found"** — Install ffmpeg: `brew install ffmpeg` (macOS)
  or `apt install ffmpeg` (Linux).
- **"MobileSAM not installed"** — Run
  `pip install git+https://github.com/ChaoningZhang/MobileSAM.git`
  inside the sidecar venv.
- **TensorFlow not installing** — Use Python 3.12. TensorFlow does not
  yet support 3.13+.
- **PnLCalib unavailable** — ensure `lsq-ellipse` is installed and that the
  upstream checkout + weights are reachable via `sidecar/third_party/pnlcalib`,
  `../trackers/third_party/pnlcalib`, or `ANNOTATE_PNLCALIB_ROOT`.
- **YOLO model download fails** — The first `/track` or `/segment` call
  downloads `yolov8n.pt` (~6MB). Check internet connectivity.
- **Need to inspect tracker behavior frame-by-frame** — `/track` can optionally
  emit a saved annotated MP4 and expose it through `/track/debug/{artifact}`.
  Use the `debugVideo` request field to control artifact generation; the route
  returns `debugVideoUrl` when an artifact is produced.
- **MobileSAM weights download fails** — Weights (~10MB) are auto-downloaded
  to `~/.cache/annotate-sidecar/` on first `/segment` call. Check internet
  connectivity and write permissions.
- **segmentation_models import error** — Ensure `TF_USE_LEGACY_KERAS=1`
  and `SM_FRAMEWORK=tf.keras` are set. The sidecar sets these automatically.
