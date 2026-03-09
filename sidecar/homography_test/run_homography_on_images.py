#!/usr/bin/env python3
"""Run the sidecar's Narya homography estimator on a folder of images."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from typing import List, Optional, Sequence, Tuple

import cv2
import numpy as np

SIDECAR_ROOT = Path(__file__).resolve().parents[1]
if str(SIDECAR_ROOT) not in sys.path:
    sys.path.insert(0, str(SIDECAR_ROOT))

from annotate_sidecar.services.homography_estimator import HomographyEstimator
from annotate_sidecar.vendor.narya.utils.homography import compute_homography

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff"}

PITCH_MIN = 3.0
PITCH_MAX = 317.0
PITCH_CENTER = 160.0
CENTER_CIRCLE_RADIUS = 36.0


def _project_point(H: np.ndarray, x: float, y: float) -> Optional[Tuple[float, float]]:
    denom = float(H[2, 0] * x + H[2, 1] * y + H[2, 2])
    if abs(denom) < 1e-8:
        return None

    out_x = float((H[0, 0] * x + H[0, 1] * y + H[0, 2]) / denom)
    out_y = float((H[1, 0] * x + H[1, 1] * y + H[1, 2]) / denom)
    return out_x, out_y


def _project_polyline(H: np.ndarray, points: Sequence[Tuple[float, float]]) -> List[Tuple[int, int]]:
    projected: List[Tuple[int, int]] = []
    for x, y in points:
        out = _project_point(H, x, y)
        if out is None:
            continue
        projected.append((int(round(out[0])), int(round(out[1]))))
    return projected


def _circle_polyline(cx: float, cy: float, radius: float, segments: int = 72) -> List[Tuple[float, float]]:
    points: List[Tuple[float, float]] = []
    for i in range(segments + 1):
        t = 2.0 * np.pi * (i / segments)
        points.append((cx + radius * float(np.cos(t)), cy + radius * float(np.sin(t))))
    return points


def _build_pitch_polylines() -> List[List[Tuple[float, float]]]:
    border = [
        (PITCH_MIN, PITCH_MIN),
        (PITCH_MAX, PITCH_MIN),
        (PITCH_MAX, PITCH_MAX),
        (PITCH_MIN, PITCH_MAX),
        (PITCH_MIN, PITCH_MIN),
    ]

    return [
        border,
        [(PITCH_CENTER, PITCH_MIN), (PITCH_CENTER, PITCH_MAX)],
        [(PITCH_MIN, 55.0), (PITCH_MAX, 55.0)],
        [(PITCH_MIN, 105.0), (PITCH_MAX, 105.0)],
        [(PITCH_MIN, 215.0), (PITCH_MAX, 215.0)],
        [(PITCH_MIN, 265.0), (PITCH_MAX, 265.0)],
        _circle_polyline(PITCH_CENTER, PITCH_CENTER, CENTER_CIRCLE_RADIUS),
    ]


def _draw_overlay(image: np.ndarray, H: np.ndarray) -> np.ndarray:
    out = image.copy()
    for line in _build_pitch_polylines():
        projected = _project_polyline(H, line)
        if len(projected) < 2:
            continue
        pts = np.asarray(projected, dtype=np.int32).reshape((-1, 1, 2))
        cv2.polylines(out, [pts], False, (255, 255, 0), 2, cv2.LINE_AA)
    return out


def _collect_images(input_dir: Path) -> List[Path]:
    return sorted(
        p
        for p in input_dir.iterdir()
        if p.is_file() and p.suffix.lower() in IMAGE_SUFFIXES
    )


def _parse_args() -> argparse.Namespace:
    root = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(
        description="Run sidecar homography estimator on local images.",
    )
    parser.add_argument(
        "--input-dir",
        type=Path,
        default=root / "inputs",
        help="Directory containing test images (default: homography_test/inputs)",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=root / "outputs",
        help="Directory for results.json and overlay renders (default: homography_test/outputs)",
    )
    parser.add_argument(
        "--no-overlays",
        action="store_true",
        help="Skip writing overlay preview images.",
    )
    parser.add_argument(
        "--mode",
        choices=["deep", "auto"],
        default="deep",
        help="Homography mode: deep forces DeepHomo path, auto uses sidecar default (default: deep)",
    )
    return parser.parse_args()


def _estimate_frame(estimator: HomographyEstimator, frame: np.ndarray, mode: str) -> Tuple[Optional[np.ndarray], str]:
    if mode == "auto":
        return estimator.estimate_frame(frame)

    estimator._load()
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    narya_estimator = estimator._estimator
    if narya_estimator is None or not narya_estimator.homo_model.available:
        return None, "failed"

    corners = narya_estimator.homo_model(rgb)
    if corners is None:
        return None, "failed"

    pred_homo = compute_homography(corners)[0]
    if isinstance(pred_homo, np.ndarray):
        return pred_homo.reshape(3, 3).astype(float), "torch-forced"
    return None, "failed"


def _to_float_list(matrix: np.ndarray) -> List[float]:
    return [float(v) for v in matrix.flatten().tolist()]


def main() -> int:
    args = _parse_args()
    input_dir: Path = args.input_dir
    output_dir: Path = args.output_dir
    save_overlays: bool = not args.no_overlays
    mode: str = args.mode

    input_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)

    images = _collect_images(input_dir)
    if not images:
        print(f"No images found in {input_dir}. Add files and run again.")
        return 0

    estimator = HomographyEstimator()
    if not estimator.available:
        print("Homography dependencies unavailable in this environment.")
        return 1

    results = []
    success_count = 0

    for image_path in images:
        frame = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
        if frame is None:
            results.append(
                {
                    "file": image_path.name,
                    "status": "error",
                    "method": "failed",
                    "message": "Unable to decode image",
                }
            )
            continue

        H, method = _estimate_frame(estimator, frame, mode)
        if H is None:
            results.append(
                {
                    "file": image_path.name,
                    "status": "failed",
                    "method": method,
                    "matrix": None,
                }
            )
            continue

        success_count += 1
        item = {
            "file": image_path.name,
            "status": "ok",
            "method": method,
            "matrix": _to_float_list(H),
        }

        if save_overlays:
            overlay = _draw_overlay(frame, H)
            overlay_name = f"{image_path.stem}_overlay.jpg"
            overlay_path = output_dir / overlay_name
            cv2.imwrite(str(overlay_path), overlay)
            item["overlay"] = overlay_name

        results.append(item)

    summary = {
        "total": len(images),
        "ok": success_count,
        "failed": len(images) - success_count,
        "results": results,
    }

    summary_path = output_dir / "results.json"
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print(f"Processed {len(images)} images.")
    print(f"Successful homographies: {success_count}")
    print(f"Summary: {summary_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
