"""
Homography estimation service — Narya wrapper.

Provides:
  - estimate_frame(frame) → (H, method) — single-frame homography
  - estimate_range(video_path, start_ms, end_ms, fps, skip_interval)
    → list of HomographyFrame dicts with temporal smoothing
"""

import logging
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional, Tuple

import numpy as np

# Must be set before tensorflow/keras/segmentation_models are imported
# so that segmentation_models uses Keras 2 (tf-keras) instead of Keras 3
os.environ.setdefault("TF_USE_LEGACY_KERAS", "1")
os.environ.setdefault("SM_FRAMEWORK", "tf.keras")

logger = logging.getLogger("annotate_sidecar.homography_estimator")


@dataclass
class HomographyFrame:
    """A homography result for a single video frame."""
    tMs: float
    matrix: List[float]  # 9 floats (row-major 3×3)
    method: str  # 'cv' | 'torch' | 'interpolated' | 'failed'


class HomographyEstimator:
    """Narya-based pitch homography estimator."""

    def __init__(self):
        self._estimator = None
        self._available = None

    @property
    def available(self) -> bool:
        """Check if Narya's dependencies (tensorflow, torch, etc.) are importable."""
        if self._available is None:
            try:
                import tensorflow  # noqa: F401
                import torch  # noqa: F401
                import kornia  # noqa: F401
                import segmentation_models  # noqa: F401
                self._available = True
            except Exception as e:
                logger.info("Narya dependencies not available: %s", e)
                self._available = False
        return self._available

    def _load(self):
        """Lazy-load the vendored Narya HomographyEstimator on first use."""
        if self._estimator is not None:
            return
        if not self.available:
            raise RuntimeError(
                "Narya dependencies are required for homography estimation. "
                "Install: pip install tensorflow torch torchvision kornia segmentation-models six"
            )
        try:
            from ..vendor.narya.models.homography_estimator import HomographyEstimator as NaryaEstimator
            logger.info("Loading Narya HomographyEstimator (pretrained=True)...")
            self._estimator = NaryaEstimator(pretrained=True)
            logger.info("Narya HomographyEstimator loaded")
        except Exception as e:
            logger.error("Failed to load Narya HomographyEstimator: %s", e)
            raise RuntimeError(f"Failed to load Narya: {e}")

    def estimate_frame(
        self,
        frame: np.ndarray,
    ) -> Tuple[Optional[np.ndarray], str]:
        """
        Estimate homography for a single frame.

        Args:
            frame: BGR numpy array (H, W, 3) from cv2.

        Returns:
            (H_matrix, method) where H_matrix is 3×3 ndarray or None on failure,
            and method is 'cv' (keypoints), 'torch' (deep homo), or 'failed'.
        """
        self._load()

        try:
            import cv2
            # Narya expects RGB; it handles its own resizing/preprocessing
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

            # Narya's __call__ returns (pred_homo, method)
            # where pred_homo is a 3×3 np.ndarray
            # and method is "cv" (keypoint-based) or "torch" (deep homo)
            pred_homo, method = self._estimator(rgb)

            if pred_homo is not None and isinstance(pred_homo, np.ndarray):
                mat = pred_homo.reshape(3, 3).astype(float)
                return mat, method

            return None, "failed"
        except Exception as e:
            logger.warning("Homography estimation failed for frame: %s", e)
            return None, "failed"

    def estimate_range(
        self,
        video_path: str,
        start_ms: float,
        end_ms: float,
        fps: float = 5.0,
        skip_interval: int = 0,
    ) -> List[HomographyFrame]:
        """
        Estimate homographies for a range of frames with temporal smoothing.

        Args:
            video_path: Path to video file.
            start_ms: Start time (absolute video ms).
            end_ms: End time (absolute video ms).
            fps: Sampling rate for frame extraction.
            skip_interval: If > 0, only run estimator every N frames,
                          interpolate the rest.

        Returns:
            List of HomographyFrame with temporally smoothed matrices.
        """
        self._load()

        import cv2

        path = Path(video_path)
        if not path.exists():
            raise FileNotFoundError(f"Video not found: {video_path}")

        cap = cv2.VideoCapture(str(path))
        if not cap.isOpened():
            raise FileNotFoundError(f"Cannot open video: {video_path}")

        # Build timestamp list
        interval_ms = 1000.0 / fps
        timestamps: List[float] = []
        t = start_ms
        while t <= end_ms:
            timestamps.append(t)
            t += interval_ms

        if not timestamps:
            cap.release()
            return []

        logger.info(
            "Estimating homography for %d frames in %.1f–%.1fms of %s",
            len(timestamps), start_ms, end_ms, path.name,
        )

        # Extract frames and run estimator
        raw_results: List[Tuple[float, Optional[np.ndarray], str]] = []

        for i, ts in enumerate(timestamps):
            # Skip frames if skip_interval > 0
            if skip_interval > 0 and i % (skip_interval + 1) != 0:
                raw_results.append((ts, None, "interpolated"))
                continue

            cap.set(cv2.CAP_PROP_POS_MSEC, ts)
            ret, frame = cap.read()
            if not ret or frame is None:
                raw_results.append((ts, None, "failed"))
                continue

            H, method = self.estimate_frame(frame)
            raw_results.append((ts, H, method))

        cap.release()

        # --- Temporal smoothing ---
        results = _temporal_smooth(raw_results, timestamps)

        logger.info("Homography estimation complete: %d frames", len(results))
        return results


def _temporal_smooth(
    raw_results: List[Tuple[float, Optional[np.ndarray], str]],
    timestamps: List[float],
) -> List[HomographyFrame]:
    """
    Apply temporal smoothing to homography estimates:
    1. Interpolate missing/failed frames using scipy.interpolate.interp1d
    2. Apply Savitzky-Golay filter for temporal consistency
    """
    n = len(raw_results)
    if n == 0:
        return []

    # Collect valid matrices and their indices
    valid_indices: List[int] = []
    valid_matrices: List[np.ndarray] = []
    methods: List[str] = []

    for i, (ts, H, method) in enumerate(raw_results):
        methods.append(method)
        if H is not None:
            valid_indices.append(i)
            valid_matrices.append(H)

    # If no valid matrices, return all as failed
    if not valid_matrices:
        return [
            HomographyFrame(tMs=ts, matrix=[1, 0, 0, 0, 1, 0, 0, 0, 1], method="failed")
            for ts, _, _ in raw_results
        ]

    # If only one valid matrix, replicate it
    if len(valid_matrices) == 1:
        mat_flat = valid_matrices[0].flatten().tolist()
        results = []
        for i, (ts, H, method) in enumerate(raw_results):
            m = method if H is not None else "interpolated"
            results.append(HomographyFrame(tMs=ts, matrix=mat_flat, method=m))
        return results

    # Flatten matrices to (n_valid, 9) for interpolation
    valid_flat = np.array([m.flatten() for m in valid_matrices])  # (n_valid, 9)
    valid_ts = np.array([timestamps[i] for i in valid_indices])

    # Interpolate missing frames
    try:
        from scipy.interpolate import interp1d
        all_ts = np.array(timestamps)
        interpolator = interp1d(
            valid_ts, valid_flat, axis=0,
            kind='linear', fill_value='extrapolate',
        )
        all_flat = interpolator(all_ts)  # (n, 9)
    except ImportError:
        logger.warning("scipy not available — skipping interpolation, using nearest")
        all_flat = np.zeros((n, 9))
        for i in range(n):
            # Find nearest valid
            dists = np.abs(np.array(valid_indices) - i)
            nearest = valid_indices[np.argmin(dists)]
            idx_in_valid = valid_indices.index(nearest)
            all_flat[i] = valid_flat[idx_in_valid]

    # Apply Savitzky-Golay filter for temporal smoothing
    if n >= 5:
        try:
            from scipy.signal import savgol_filter
            window = min(5, n if n % 2 == 1 else n - 1)
            if window >= 3:
                all_flat = savgol_filter(all_flat, window_length=window, polyorder=min(3, window - 1), axis=0)
        except ImportError:
            logger.warning("scipy not available — skipping Savitzky-Golay smoothing")

    # Build result list
    results: List[HomographyFrame] = []
    for i, (ts, H_orig, method) in enumerate(raw_results):
        m = method
        if H_orig is None and m != "failed":
            m = "interpolated"
        results.append(HomographyFrame(
            tMs=ts,
            matrix=all_flat[i].tolist(),
            method=m,
        ))

    return results
