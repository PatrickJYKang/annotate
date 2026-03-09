"""
Homography estimation service.

Provides:
  - estimate_frame(frame) → (H, method) — single-frame homography
  - estimate_range(video_path, start_ms, end_ms, fps, skip_interval)
    → list of HomographyFrame dicts without temporal interpolation
  - estimate_range_from_seed_homography(...)
    → dynamic per-frame homography from one manual seed using keypoint+color tracking
"""

import logging
import os
from dataclasses import dataclass
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
    method: str  # 'color' | 'cv' | 'torch' | 'failed'


class HomographyEstimator:
    """Pitch homography estimator with color-based first pass + optional Narya fallback."""

    def __init__(self):
        self._estimator = None
        self._narya_checked = False
        self._narya_available = False

    @property
    def available(self) -> bool:
        """Homography requires OpenCV (color-based mode)."""
        try:
            import cv2  # noqa: F401
            return True
        except Exception as e:
            logger.info("OpenCV not available for homography: %s", e)
            return False

    def _load_narya(self) -> bool:
        """Best-effort lazy-load of vendored Narya estimator."""
        if self._estimator is not None:
            self._narya_available = True
            self._narya_checked = True
            return True
        if self._narya_checked:
            return self._narya_available

        self._narya_checked = True
        try:
            import tensorflow  # noqa: F401
            import torch  # noqa: F401
            import kornia  # noqa: F401
            import segmentation_models  # noqa: F401
            from ..vendor.narya.models.homography_estimator import HomographyEstimator as NaryaEstimator

            logger.info("Loading Narya HomographyEstimator (pretrained=True)...")
            self._estimator = NaryaEstimator(pretrained=True)
            logger.info("Narya HomographyEstimator loaded")
            self._narya_available = True
        except Exception as e:
            logger.info("Narya fallback unavailable: %s", e)
            self._narya_available = False

        return self._narya_available

    @staticmethod
    def _estimate_frame_color(frame: np.ndarray) -> Optional[np.ndarray]:
        """Estimate homography from pitch color mask (green field contour)."""
        import cv2

        h, w = frame.shape[:2]
        if h <= 0 or w <= 0:
            return None

        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        # Broad green mask for grass/turf
        mask = cv2.inRange(hsv, (25, 20, 20), (95, 255, 255))

        kernel = np.ones((9, 9), np.uint8)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)

        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            return None

        contour = max(contours, key=cv2.contourArea)
        if cv2.contourArea(contour) < (h * w * 0.12):
            return None

        hull = cv2.convexHull(contour)
        peri = cv2.arcLength(hull, True)
        approx = cv2.approxPolyDP(hull, 0.02 * peri, True)

        if len(approx) == 4:
            quad = approx.reshape(4, 2).astype(np.float32)
        else:
            rect = cv2.minAreaRect(hull)
            quad = cv2.boxPoints(rect).astype(np.float32)

        # Order corners as top-left, top-right, bottom-right, bottom-left
        by_y = quad[np.argsort(quad[:, 1])]
        top = by_y[:2][np.argsort(by_y[:2, 0])]
        bot = by_y[2:][np.argsort(by_y[2:, 0])]
        ordered = np.array([top[0], top[1], bot[1], bot[0]], dtype=np.float32)

        src = np.array([[3, 3], [317, 3], [317, 317], [3, 317]], dtype=np.float32)
        H = cv2.getPerspectiveTransform(src, ordered)
        if H is None:
            return None
        if not np.isfinite(H).all():
            return None
        det = float(np.linalg.det(H))
        if abs(det) < 1e-9:
            return None

        return H.astype(float)

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
            and method is 'color', 'cv' (keypoints), 'torch' (deep homo), or 'failed'.
        """
        try:
            color_h = self._estimate_frame_color(frame)
            if color_h is not None:
                return color_h, "color"
        except Exception as e:
            logger.debug("Color homography failed for frame: %s", e)

        if self._load_narya():
            try:
                import cv2

                # Narya expects RGB; it handles its own resizing/preprocessing
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                pred_homo, method = self._estimator(rgb)

                if pred_homo is not None and isinstance(pred_homo, np.ndarray):
                    mat = pred_homo.reshape(3, 3).astype(float)
                    return mat, method
            except Exception as e:
                logger.debug("Narya homography failed for frame: %s", e)

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
        Estimate homographies for a range of frames with no temporal interpolation.

        Args:
            video_path: Path to video file.
            start_ms: Start time (absolute video ms).
            end_ms: End time (absolute video ms).
            fps: Sampling rate for frame extraction.
            skip_interval: If > 0, only run estimator every N frames.

        Returns:
            List of HomographyFrame sampled independently.
        """
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
                raw_results.append((ts, None, "failed"))
                continue

            cap.set(cv2.CAP_PROP_POS_MSEC, ts)
            ret, frame = cap.read()
            if not ret or frame is None:
                raw_results.append((ts, None, "failed"))
                continue

            H, method = self.estimate_frame(frame)
            raw_results.append((ts, H, method))

        cap.release()

        identity = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]
        results = [
            HomographyFrame(
                tMs=ts,
                matrix=(H.flatten().tolist() if H is not None else identity),
                method=method if H is not None else "failed",
            )
            for ts, H, method in raw_results
        ]

        logger.info("Homography estimation complete: %d frames", len(results))
        return results

    def estimate_range_from_seed_homography(
        self,
        video_path: str,
        start_ms: float,
        end_ms: float,
        seed_ms: float,
        seed_matrix: List[float],
        fps: float = 5.0,
        skip_interval: int = 0,
    ) -> List[HomographyFrame]:
        """
        Track pitch-line keypoints from a single manual seed homography.

        The seed homography defines pitch->image at seed_ms. We then:
        1) generate many pitch keypoints on line-rich regions,
        2) project them to image,
        3) track with LK optical flow,
        4) color-gate to white-ish line pixels,
        5) fit homography per frame with RANSAC + quality gates.

        No temporal interpolation is used.
        """
        import cv2

        if len(seed_matrix) != 9:
            raise RuntimeError("seedMatrix must have 9 values")

        seed_h = np.array(seed_matrix, dtype=np.float64).reshape(3, 3)
        if not np.isfinite(seed_h).all() or abs(float(np.linalg.det(seed_h))) < 1e-9:
            raise RuntimeError("seedMatrix is invalid")

        path = Path(video_path)
        if not path.exists():
            raise FileNotFoundError(f"Video not found: {video_path}")

        cap = cv2.VideoCapture(str(path))
        if not cap.isOpened():
            raise FileNotFoundError(f"Cannot open video: {video_path}")

        native_fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)

        def _read_frame_at_ms(ts: float) -> Tuple[bool, Optional[np.ndarray]]:
            if native_fps > 1e-6:
                frame_idx = max(0, int(round((float(ts) / 1000.0) * native_fps)))
                cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
            else:
                cap.set(cv2.CAP_PROP_POS_MSEC, float(ts))
            ret, frm = cap.read()
            return bool(ret), frm

        # Seed frame
        ret_seed, seed_frame = _read_frame_at_ms(seed_ms)
        if not ret_seed or seed_frame is None:
            cap.release()
            raise RuntimeError(f"Unable to read seed frame at {seed_ms:.1f}ms")

        seed_h32 = seed_h.astype(np.float32)
        seed_gray = cv2.cvtColor(seed_frame, cv2.COLOR_BGR2GRAY)
        img_h, img_w = seed_frame.shape[:2]

        # Build pitch keypoints (dense boundary + midline + center horizontal)
        pitch_min = 3.0
        pitch_max = 317.0
        pitch_center = (pitch_min + pitch_max) / 2.0
        samples = np.linspace(pitch_min, pitch_max, 13, dtype=np.float32)
        pts = []
        for u in samples:
            pts.append((float(u), pitch_min))
            pts.append((float(u), pitch_max))
            pts.append((float(u), pitch_center))
        for v in samples:
            pts.append((pitch_min, float(v)))
            pts.append((pitch_max, float(v)))
            pts.append((pitch_center, float(v)))

        # Deduplicate
        uniq = sorted({(round(u, 3), round(v, 3)) for (u, v) in pts})
        pitch_pts_all = np.array(uniq, dtype=np.float32)

        projected_seed = cv2.perspectiveTransform(
            pitch_pts_all.reshape(-1, 1, 2),
            seed_h32,
        ).reshape(-1, 2)

        in_bounds = (
            (projected_seed[:, 0] >= 2)
            & (projected_seed[:, 0] < img_w - 2)
            & (projected_seed[:, 1] >= 2)
            & (projected_seed[:, 1] < img_h - 2)
        )
        pitch_pts = pitch_pts_all[in_bounds]
        img_pts = projected_seed[in_bounds]

        if len(pitch_pts) < 4:
            cap.release()
            raise RuntimeError("Seed homography projects too few keypoints inside frame")

        # Seed color gate: keep line-like (white-ish) points when enough are available
        hsv_seed = cv2.cvtColor(seed_frame, cv2.COLOR_BGR2HSV)
        sat_vals = []
        val_vals = []
        for x, y in img_pts:
            xi = int(round(float(x)))
            yi = int(round(float(y)))
            patch = hsv_seed[max(0, yi - 2):min(img_h, yi + 3), max(0, xi - 2):min(img_w, xi + 3)]
            if patch.size == 0:
                sat_vals.append(255.0)
                val_vals.append(0.0)
                continue
            mean_hsv = patch.reshape(-1, 3).mean(axis=0)
            sat_vals.append(float(mean_hsv[1]))
            val_vals.append(float(mean_hsv[2]))

        sat_arr = np.array(sat_vals, dtype=np.float32)
        val_arr = np.array(val_vals, dtype=np.float32)
        seed_line_mask = (sat_arr < 95.0) & (val_arr > 110.0)
        if int(seed_line_mask.sum()) >= 8:
            pitch_pts = pitch_pts[seed_line_mask]
            img_pts = img_pts[seed_line_mask]

        if len(pitch_pts) < 4:
            cap.release()
            raise RuntimeError("Not enough seed keypoints after color gating")

        base_pitch_pts = pitch_pts.astype(np.float32)
        base_img_pts = img_pts.astype(np.float32).reshape(-1, 1, 2)

        interval_ms = 1000.0 / fps
        timestamps: List[float] = []
        t = start_ms
        while t <= end_ms:
            timestamps.append(t)
            t += interval_ms

        if not timestamps:
            cap.release()
            return []

        identity = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]
        lk_params = dict(
            winSize=(25, 25),
            maxLevel=3,
            criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 30, 0.01),
        )

        frames: List[Optional[np.ndarray]] = []
        grays: List[Optional[np.ndarray]] = []
        for ts in timestamps:
            ret, frame = _read_frame_at_ms(ts)
            if ret and frame is not None:
                frames.append(frame)
                grays.append(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY))
            else:
                frames.append(None)
                grays.append(None)
        cap.release()

        seed_idx = min(range(len(timestamps)), key=lambda i: abs(timestamps[i] - seed_ms))
        if frames[seed_idx] is not None and grays[seed_idx] is not None:
            seed_gray_for_pass = grays[seed_idx]
        else:
            seed_gray_for_pass = seed_gray

        results_by_idx: List[Optional[HomographyFrame]] = [None] * len(timestamps)
        results_by_idx[seed_idx] = HomographyFrame(
            tMs=timestamps[seed_idx],
            matrix=seed_h.astype(np.float64).flatten().tolist(),
            method="manual_keypoints",
        )

        pitch_corners = np.array(
            [[3.0, 3.0], [317.0, 3.0], [317.0, 317.0], [3.0, 317.0]],
            dtype=np.float32,
        )

        continuity_pitch = np.array(
            [
                [3.0, 3.0],
                [317.0, 3.0],
                [317.0, 317.0],
                [3.0, 317.0],
                [160.0, 3.0],
                [160.0, 317.0],
                [160.0, 160.0],
            ],
            dtype=np.float32,
        )

        kernel3 = np.ones((3, 3), np.uint8)

        def _polygon_area(poly: np.ndarray) -> float:
            x = poly[:, 0]
            y = poly[:, 1]
            return 0.5 * abs(float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1))))

        def _build_line_mask(frame: np.ndarray) -> np.ndarray:
            hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
            line_mask = (((hsv[:, :, 1] < 95) & (hsv[:, :, 2] > 130))).astype(np.uint8) * 255
            line_mask = cv2.morphologyEx(line_mask, cv2.MORPH_OPEN, kernel3)
            line_mask = cv2.dilate(line_mask, kernel3, iterations=1)
            return line_mask

        def _snap_points_to_line_mask(
            pts: np.ndarray,
            line_mask: np.ndarray,
            radius: int,
        ) -> Tuple[np.ndarray, np.ndarray]:
            if len(pts) == 0:
                return np.empty((0, 2), dtype=np.float32), np.empty((0,), dtype=bool)

            h_mask, w_mask = line_mask.shape[:2]
            snapped: List[List[float]] = []
            valid: List[bool] = []

            for x, y in pts:
                xi = int(round(float(x)))
                yi = int(round(float(y)))
                x0 = max(0, xi - radius)
                x1 = min(w_mask, xi + radius + 1)
                y0 = max(0, yi - radius)
                y1 = min(h_mask, yi + radius + 1)
                roi = line_mask[y0:y1, x0:x1]

                if roi.size == 0:
                    snapped.append([float(x), float(y)])
                    valid.append(False)
                    continue

                ys, xs = np.where(roi > 0)
                if len(xs) == 0:
                    snapped.append([float(x), float(y)])
                    valid.append(False)
                    continue

                gx = xs.astype(np.float32) + float(x0)
                gy = ys.astype(np.float32) + float(y0)
                d2 = (gx - float(x)) ** 2 + (gy - float(y)) ** 2
                k = int(np.argmin(d2))
                snapped.append([float(gx[k]), float(gy[k])])
                valid.append(True)

            return np.array(snapped, dtype=np.float32), np.array(valid, dtype=bool)

        def _fit_h_with_quality(
            fit_pitch: np.ndarray,
            fit_img: np.ndarray,
            prev_h: np.ndarray,
            method_ok: str,
        ) -> Tuple[Optional[np.ndarray], str]:
            if len(fit_img) < 4 or len(fit_pitch) < 4:
                return None, "failed"

            h_est, inliers = cv2.findHomography(
                fit_pitch.reshape(-1, 1, 2),
                fit_img.reshape(-1, 1, 2),
                cv2.RANSAC,
                4.0,
            )
            if h_est is None or (not np.isfinite(h_est).all()) or abs(float(np.linalg.det(h_est))) < 1e-9:
                return None, "failed"

            projected = cv2.perspectiveTransform(fit_pitch.reshape(-1, 1, 2), h_est).reshape(-1, 2)
            reproj = np.linalg.norm(projected - fit_img, axis=1)

            if inliers is not None:
                inlier_mask = inliers.reshape(-1).astype(bool)
            else:
                inlier_mask = np.zeros((len(fit_img),), dtype=bool)

            inlier_count = int(inlier_mask.sum())
            inlier_ratio = float(inlier_count / max(1, len(fit_img)))
            reproj_err = float(np.mean(reproj[inlier_mask])) if inlier_count > 0 else float("inf")

            if not (inlier_count >= 4 and inlier_ratio >= 0.30 and reproj_err <= 10.0):
                return None, "failed"

            h_est64 = h_est.astype(np.float64)

            prev_anchor = cv2.perspectiveTransform(
                continuity_pitch.reshape(-1, 1, 2),
                prev_h.astype(np.float32),
            ).reshape(-1, 2)
            cur_anchor = cv2.perspectiveTransform(
                continuity_pitch.reshape(-1, 1, 2),
                h_est64.astype(np.float32),
            ).reshape(-1, 2)
            anchor_motion = np.linalg.norm(cur_anchor - prev_anchor, axis=1)
            if float(np.median(anchor_motion)) > 110.0:
                return None, "failed"

            prev_poly = cv2.perspectiveTransform(
                pitch_corners.reshape(-1, 1, 2),
                prev_h.astype(np.float32),
            ).reshape(-1, 2)
            cur_poly = cv2.perspectiveTransform(
                pitch_corners.reshape(-1, 1, 2),
                h_est64.astype(np.float32),
            ).reshape(-1, 2)
            prev_area = max(1.0, _polygon_area(prev_poly))
            cur_area = _polygon_area(cur_poly)
            area_ratio = float(cur_area / prev_area)
            if area_ratio < 0.25 or area_ratio > 4.0:
                return None, "failed"

            return h_est64, method_ok

        def _process_indices(indices: List[int], init_gray: np.ndarray, init_h: np.ndarray) -> None:
            prev_gray = init_gray
            prev_h = init_h.astype(np.float64)

            for i, idx in enumerate(indices):
                ts = timestamps[idx]

                if skip_interval > 0 and (idx % (skip_interval + 1)) != 0:
                    results_by_idx[idx] = HomographyFrame(tMs=ts, matrix=prev_h.flatten().tolist(), method="manual_held")
                    continue

                frame = frames[idx]
                gray = grays[idx]
                if frame is None or gray is None:
                    results_by_idx[idx] = HomographyFrame(tMs=ts, matrix=prev_h.flatten().tolist(), method="manual_held")
                    continue

                h, w = frame.shape[:2]

                # Reproject all base pitch points with previous valid H, then LK from prev->current.
                proj_prev = cv2.perspectiveTransform(
                    base_pitch_pts.reshape(-1, 1, 2),
                    prev_h.astype(np.float32),
                ).reshape(-1, 2)

                inb_prev = (
                    (proj_prev[:, 0] >= 2)
                    & (proj_prev[:, 0] < w - 2)
                    & (proj_prev[:, 1] >= 2)
                    & (proj_prev[:, 1] < h - 2)
                )

                prev_pitch = base_pitch_pts[inb_prev]
                flow_pitch = prev_pitch
                prev_img_pts = proj_prev[inb_prev].astype(np.float32).reshape(-1, 1, 2)

                line_mask = _build_line_mask(frame)

                flow_img = np.empty((0, 2), dtype=np.float32)
                if len(prev_img_pts) >= 4:
                    next_pts, status, err = cv2.calcOpticalFlowPyrLK(prev_gray, gray, prev_img_pts, None, **lk_params)
                    if next_pts is not None and status is not None:
                        good = status.reshape(-1).astype(bool)
                        if err is not None:
                            good = good & (err.reshape(-1) < 45.0)

                        next_flat = next_pts.reshape(-1, 2)
                        inb_cur = (
                            (next_flat[:, 0] >= 2)
                            & (next_flat[:, 0] < w - 2)
                            & (next_flat[:, 1] >= 2)
                            & (next_flat[:, 1] < h - 2)
                        )
                        good = good & inb_cur

                        back_pts, back_status, _ = cv2.calcOpticalFlowPyrLK(gray, prev_gray, next_pts, None, **lk_params)
                        if back_pts is not None and back_status is not None:
                            fb_err = np.linalg.norm(back_pts.reshape(-1, 2) - prev_img_pts.reshape(-1, 2), axis=1)
                            good = good & back_status.reshape(-1).astype(bool) & (fb_err < 2.5)

                        if int(good.sum()) >= 4:
                            flow_img = next_flat[good]
                            flow_pitch = flow_pitch[good]
                        else:
                            flow_pitch = np.empty((0, 2), dtype=np.float32)

                fit_img = flow_img
                fit_pitch = flow_pitch
                if len(flow_img) >= 4:
                    snapped_flow, snap_ok = _snap_points_to_line_mask(flow_img, line_mask, radius=7)
                    if int(snap_ok.sum()) >= 4:
                        fit_img = snapped_flow[snap_ok]
                        fit_pitch = flow_pitch[snap_ok]

                frame_h: Optional[np.ndarray] = None
                frame_method = "failed"

                frame_h, frame_method = _fit_h_with_quality(
                    fit_pitch,
                    fit_img,
                    prev_h,
                    method_ok="manual_keypoints_lines",
                )

                # Fallback: snap projected previous points directly to line mask (no LK).
                if frame_h is None:
                    proj_points = prev_img_pts.reshape(-1, 2)
                    snapped_proj, proj_ok = _snap_points_to_line_mask(proj_points, line_mask, radius=12)
                    if int(proj_ok.sum()) >= 4:
                        frame_h, frame_method = _fit_h_with_quality(
                            prev_pitch[proj_ok],
                            snapped_proj[proj_ok],
                            prev_h,
                            method_ok="manual_linesnap_fallback",
                        )

                if frame_h is None:
                    frame_h = prev_h
                    frame_method = "manual_held"

                prev_h = frame_h
                prev_gray = gray
                results_by_idx[idx] = HomographyFrame(tMs=ts, matrix=frame_h.flatten().tolist(), method=frame_method)

        # Forward from seed to end.
        if seed_idx < len(timestamps) - 1:
            _process_indices(
                list(range(seed_idx + 1, len(timestamps))),
                seed_gray_for_pass,
                seed_h,
            )

        # Backward from seed to start.
        if seed_idx > 0:
            _process_indices(
                list(range(seed_idx - 1, -1, -1)),
                seed_gray_for_pass,
                seed_h,
            )

        results: List[HomographyFrame] = []
        for i, ts in enumerate(timestamps):
            frame = results_by_idx[i]
            if frame is None:
                results.append(HomographyFrame(tMs=ts, matrix=identity, method="failed"))
            else:
                results.append(frame)

        method_counts = {}
        for f in results:
            method_counts[f.method] = method_counts.get(f.method, 0) + 1

        logger.info(
            "Manual keypoint homography tracking complete: %d frames, methods=%s",
            len(results),
            method_counts,
        )
        return results
