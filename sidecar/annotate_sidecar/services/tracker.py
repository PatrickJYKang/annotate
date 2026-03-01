"""
Object tracking service — YOLO + ByteTrack wrapper.

Provides:
  - detect_frame(frame, classes) → list of detections with bboxes
  - match_seed_bbox(detections, user_bbox, iou_threshold) → best match index
  - track_range(video_path, start_ms, end_ms, seed_bbox, seed_frame_ms, fps)
    → list of keyframe dicts with absolute video-ms timestamps
"""

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

import numpy as np

logger = logging.getLogger("annotate_sidecar.tracker")


@dataclass
class BBox:
    """Bounding box in pixel coordinates (x, y, w, h)."""
    x: float
    y: float
    w: float
    h: float
    confidence: float = 0.0
    class_id: int = 0
    track_id: Optional[int] = None


@dataclass
class KeyframeDict:
    """A tracking keyframe result with absolute video-ms timestamp."""
    tMs: float
    x: float
    y: float
    w: float
    h: float
    visible: bool = True


def _iou(a: BBox, b: BBox) -> float:
    """Compute intersection-over-union of two bboxes."""
    ax1, ay1, ax2, ay2 = a.x, a.y, a.x + a.w, a.y + a.h
    bx1, by1, bx2, by2 = b.x, b.y, b.x + b.w, b.y + b.h
    ix1 = max(ax1, bx1)
    iy1 = max(ay1, by1)
    ix2 = min(ax2, bx2)
    iy2 = min(ay2, by2)
    iw = max(0, ix2 - ix1)
    ih = max(0, iy2 - iy1)
    inter = iw * ih
    union = a.w * a.h + b.w * b.h - inter
    return inter / union if union > 0 else 0.0


class Tracker:
    """YOLO + ByteTrack object tracker."""

    def __init__(self, model_name: str = "yolov8n.pt"):
        self._model = None
        self._model_name = model_name

    def _load_model(self):
        """Lazy-load the YOLO model on first use."""
        if self._model is not None:
            return
        try:
            from ultralytics import YOLO
        except ImportError:
            raise RuntimeError(
                "ultralytics is required for tracking. "
                "Install with: pip install ultralytics"
            )
        logger.info("Loading YOLO model: %s", self._model_name)
        self._model = YOLO(self._model_name)
        logger.info("YOLO model loaded")

    def detect_frame(
        self,
        frame: np.ndarray,
        classes: Optional[List[int]] = None,
        conf_threshold: float = 0.25,
    ) -> List[BBox]:
        """
        Run YOLO detection on a single frame.

        Args:
            frame: BGR numpy array.
            classes: COCO class IDs to keep (default [0] = person).
            conf_threshold: Minimum confidence.

        Returns:
            List of BBox detections.
        """
        self._load_model()
        if classes is None:
            classes = [0]  # person

        results = self._model(frame, verbose=False, conf=conf_threshold)
        detections: List[BBox] = []

        for r in results:
            if r.boxes is None:
                continue
            for box in r.boxes:
                cls_id = int(box.cls[0].item())
                if cls_id not in classes:
                    continue
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                conf = float(box.conf[0].item())
                detections.append(BBox(
                    x=x1, y=y1, w=x2 - x1, h=y2 - y1,
                    confidence=conf, class_id=cls_id,
                ))

        return detections

    def match_seed_bbox(
        self,
        detections: List[BBox],
        user_bbox: BBox,
        iou_threshold: float = 0.3,
    ) -> Optional[int]:
        """
        Find the detection that best matches the user-provided seed bbox.

        Returns:
            Index of best matching detection, or None if no match above threshold.
        """
        best_idx = None
        best_iou = 0.0
        for i, det in enumerate(detections):
            score = _iou(det, user_bbox)
            if score > best_iou:
                best_iou = score
                best_idx = i

        if best_iou >= iou_threshold:
            return best_idx
        return None

    def track_range(
        self,
        video_path: str,
        start_ms: float,
        end_ms: float,
        seed_bbox: BBox,
        seed_frame_ms: float,
        fps: float = 30.0,
        classes: Optional[List[int]] = None,
        conf_threshold: float = 0.25,
        iou_threshold: float = 0.3,
        track_buffer: int = 30,
    ) -> dict:
        """
        Track an object across a video range using YOLO + ByteTrack.

        Args:
            video_path: Path to the video file.
            start_ms: Start timestamp (absolute video ms).
            end_ms: End timestamp (absolute video ms).
            seed_bbox: User-selected bounding box to identify the target.
            seed_frame_ms: Timestamp where the seed bbox is drawn.
            fps: Desired tracking frame rate.
            classes: COCO class IDs to track (default [0] = person).
            conf_threshold: YOLO confidence threshold.
            iou_threshold: IoU threshold for seed matching.
            track_buffer: Frames without target before marking invisible.

        Returns:
            Dict with keys: keyframes, trackId, detectionCount

        Raises:
            FileNotFoundError: If video doesn't exist.
            ValueError: If no matching detection found at seed frame.
        """
        self._load_model()
        if classes is None:
            classes = [0]

        path = Path(video_path)
        if not path.exists():
            raise FileNotFoundError(f"Video not found: {video_path}")

        from .frame_extractor import extract_frame

        # --- Pass 1: Run tracking on all frames ---
        import cv2

        cap = cv2.VideoCapture(str(path))
        if not cap.isOpened():
            raise FileNotFoundError(f"Cannot open video: {video_path}")

        interval_ms = 1000.0 / fps
        timestamps: List[float] = []
        t = start_ms
        while t <= end_ms:
            timestamps.append(t)
            t += interval_ms

        logger.info(
            "Tracking %d frames in %.1f–%.1fms of %s",
            len(timestamps), start_ms, end_ms, path.name,
        )

        # Collect frames
        frames: List[np.ndarray] = []
        actual_timestamps: List[float] = []
        for ts in timestamps:
            cap.set(cv2.CAP_PROP_POS_MSEC, ts)
            ret, frame = cap.read()
            if ret and frame is not None:
                frames.append(frame)
                actual_timestamps.append(ts)
        cap.release()

        if not frames:
            raise RuntimeError("No frames could be read from video")

        # Run YOLO tracking with persist=True for ByteTrack
        logger.info("Running YOLO+ByteTrack on %d frames...", len(frames))
        self._model.predictor = None  # Reset tracker state
        all_track_results = []
        for frame in frames:
            results = self._model.track(
                frame,
                verbose=False,
                conf=conf_threshold,
                classes=classes,
                persist=True,
                tracker="bytetrack.yaml",
            )
            all_track_results.append(results)

        # --- Pass 2: Find seed frame and match target track ID ---
        # Find the frame closest to seed_frame_ms
        seed_idx = 0
        min_diff = abs(actual_timestamps[0] - seed_frame_ms)
        for i, ts in enumerate(actual_timestamps):
            diff = abs(ts - seed_frame_ms)
            if diff < min_diff:
                min_diff = diff
                seed_idx = i

        # Extract detections from seed frame results
        seed_results = all_track_results[seed_idx]
        seed_detections: List[BBox] = []
        for r in seed_results:
            if r.boxes is None:
                continue
            for box in r.boxes:
                cls_id = int(box.cls[0].item())
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                conf = float(box.conf[0].item())
                tid = int(box.id[0].item()) if box.id is not None else None
                seed_detections.append(BBox(
                    x=x1, y=y1, w=x2 - x1, h=y2 - y1,
                    confidence=conf, class_id=cls_id, track_id=tid,
                ))

        # Match seed bbox
        match_idx = self.match_seed_bbox(seed_detections, seed_bbox, iou_threshold)
        if match_idx is None:
            # Return error with detected bboxes for frontend display
            detected = [
                {"x": d.x, "y": d.y, "w": d.w, "h": d.h, "confidence": d.confidence}
                for d in seed_detections
            ]
            raise ValueError(
                f"No detection matches seed bbox (IoU >= {iou_threshold}). "
                f"Found {len(seed_detections)} detections at seed frame.",
                detected,
            )

        target_track_id = seed_detections[match_idx].track_id
        if target_track_id is None:
            raise ValueError("Matched detection has no track ID assigned by ByteTrack.")

        logger.info("Target track ID: %d", target_track_id)

        # --- Pass 3: Extract keyframes for target track ID ---
        keyframes: List[dict] = []
        total_detections = 0
        frames_since_seen = 0

        for frame_idx, (ts, results) in enumerate(zip(actual_timestamps, all_track_results)):
            found = False
            for r in results:
                if r.boxes is None:
                    continue
                for box in r.boxes:
                    total_detections += 1
                    tid = int(box.id[0].item()) if box.id is not None else None
                    if tid == target_track_id:
                        x1, y1, x2, y2 = box.xyxy[0].tolist()
                        keyframes.append({
                            "tMs": ts,
                            "x": x1,
                            "y": y1,
                            "w": x2 - x1,
                            "h": y2 - y1,
                            "visible": True,
                        })
                        found = True
                        frames_since_seen = 0
                        break
                if found:
                    break

            if not found:
                frames_since_seen += 1
                if frames_since_seen > track_buffer:
                    # Target lost for too long — mark invisible
                    keyframes.append({
                        "tMs": ts,
                        "x": 0, "y": 0, "w": 0, "h": 0,
                        "visible": False,
                    })

        logger.info(
            "Tracking complete: %d keyframes, %d total detections",
            len(keyframes), total_detections,
        )

        return {
            "keyframes": keyframes,
            "trackId": target_track_id,
            "detectionCount": total_detections,
        }
