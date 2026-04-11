# annotate-sidecar

Python sidecar service for ML-powered annotation features. Runs alongside the
Next.js frontend and provides object tracking, segmentation, homography
estimation, and video export encoding.

## Current scope note

- The repository still contains clip-oriented CV endpoints and related tooling
  (`/track`, `/segment`, `/homography`, clip export, occlusion support).
- Those clip/CV-on-clips workflows are currently **on hold** as active
  development tracks. They remain documented here because the code is still in
  the repo.
- Current sidecar-facing work is focused on **video loading for presentations**,
  specifically exact-motion transition media.

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

# Install core dependencies
pip install -r requirements.txt

# Optional: install MobileSAM for person segmentation
pip install git+https://github.com/ChaoningZhang/MobileSAM.git
```

> **Note:** Narya (homography estimation) is vendored at
> `annotate_sidecar/vendor/narya/` — no separate install needed.
> Its dependencies (tensorflow, torch, kornia, segmentation-models)
> are included in `requirements.txt`.

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
| `POST`   | `/track`            | Object tracking (YOLO + ByteTrack)   |
| `POST`   | `/homography`       | Pitch homography (vendored Narya)    |
| `POST`   | `/segment`          | Person segmentation (YOLO + MobileSAM) |
| `POST`   | `/export/start`     | Begin export session                 |
| `POST`   | `/export/frame`     | Submit rendered frame (base64 JPEG)  |
| `POST`   | `/export/encode`    | Encode frames to MP4 (ffmpeg)        |
| `DELETE` | `/export/{id}`      | Clean up export session              |
| `POST`   | `/derived-media/exact-motion` | Encode exact video segment for presentation playback |
| `POST`   | `/video/register`   | Upload video file and get `videoRef` |
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
    track.py               # POST /track
    segment.py             # POST /segment
    homography.py          # POST /homography
    export.py              # Export endpoints
    derived_media.py       # POST /derived-media/exact-motion
    video.py               # Video register/unregister endpoints
  services/
    frame_extractor.py     # cv2.VideoCapture → frames by ms
    tracker.py             # YOLO + ByteTrack wrapper
    segmenter.py           # YOLO + MobileSAM wrapper
    homography_estimator.py  # Narya wrapper
    encoder.py             # ffmpeg MP4 encoding
  vendor/
    narya/               # Vendored Narya homography (MIT license)
  models/                # Downloaded model weights (gitignored)
```

## Hardware

- **CPU-only** works for all features. Tracking and segmentation are
  slower but functional.
- **CUDA GPU** accelerates YOLO, MobileSAM, and Narya significantly.
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
- **YOLO model download fails** — The first `/track` or `/segment` call
  downloads `yolov8n.pt` (~6MB). Check internet connectivity.
- **MobileSAM weights download fails** — Weights (~10MB) are auto-downloaded
  to `~/.cache/annotate-sidecar/` on first `/segment` call. Check internet
  connectivity and write permissions.
- **segmentation_models import error** — Ensure `TF_USE_LEGACY_KERAS=1`
  and `SM_FRAMEWORK=tf.keras` are set. The sidecar sets these automatically.
