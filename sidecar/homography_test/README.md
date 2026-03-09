# Homography image test workspace

Drop test frames into `inputs/` and run the sidecar's current homography model on them.

## Run

From the repo root:

```bash
/Users/patrickkang/Documents/code/annotate/sidecar/.venv/bin/python \
  /Users/patrickkang/Documents/code/annotate/sidecar/homography_test/run_homography_on_images.py
```

This debug runner now defaults to `--mode deep` (forced DeepHomo path).

To run sidecar default behavior (keypoint-first, deep fallback), use:

```bash
/Users/patrickkang/Documents/code/annotate/sidecar/.venv/bin/python \
  /Users/patrickkang/Documents/code/annotate/sidecar/homography_test/run_homography_on_images.py \
  --mode auto
```

## Outputs

- `outputs/results.json` — per-image status, method (`cv`, `torch`, `failed`), and matrix.
- `outputs/*_overlay.jpg` — pitch overlay projected with the estimated matrix.

Use `--no-overlays` to skip preview image generation.
