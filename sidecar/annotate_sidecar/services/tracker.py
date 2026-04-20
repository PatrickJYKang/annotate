"""
Object tracking service — app adapter over vendored tracker primitives.

This layer keeps annotate-owned behavior in one place:
  - request/response shaping for `/track`
  - seed bbox matching semantics exposed to the app
  - absolute-ms keyframe formatting with `visible: false`

The lower-level model loading, frame sampling, and ByteTrack execution now live
under `annotate_sidecar.vendor.trackers`.
"""

import logging
from typing import Optional

import numpy as np

from ..config import TrackingDefaults, get_tracking_defaults
from ..vendor.trackers import BBox, UltralyticsByteTrackCore
from ..vendor.trackers.core.matching import find_best_iou_match

logger = logging.getLogger("annotate_sidecar.tracker")

class Tracker:
    """Annotate-owned adapter around the vendored tracker core."""

    def __init__(
        self,
        config: Optional[TrackingDefaults] = None,
        core: Optional[UltralyticsByteTrackCore] = None,
    ):
        self._config = config or get_tracking_defaults()
        self._core = core or UltralyticsByteTrackCore(
            model_name=self._config.detector_model_name,
            tracker_config=self._config.core_tracker_config,
        )

    def detect_frame(
        self,
        frame: np.ndarray,
        classes: Optional[list[int]] = None,
        conf_threshold: Optional[float] = None,
    ) -> list[BBox]:
        if classes is None:
            classes = list(self._config.classes)
        if conf_threshold is None:
            conf_threshold = self._config.conf_threshold
        return self._core.detect_frame(frame, classes=classes, conf_threshold=conf_threshold)

    def match_seed_bbox(
        self,
        detections: list[BBox],
        user_bbox: BBox,
        iou_threshold: float = 0.3,
    ) -> Optional[int]:
        return find_best_iou_match(detections, user_bbox, iou_threshold=iou_threshold)

    def track_range(
        self,
        video_path: str,
        start_ms: float,
        end_ms: float,
        seed_bbox: BBox,
        seed_frame_ms: float,
        fps: Optional[float] = None,
        classes: Optional[list[int]] = None,
        conf_threshold: Optional[float] = None,
        iou_threshold: Optional[float] = None,
        track_buffer: Optional[int] = None,
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
        if classes is None:
            classes = list(self._config.classes)
        if fps is None:
            fps = self._config.sample_fps
        if conf_threshold is None:
            conf_threshold = self._config.conf_threshold
        if iou_threshold is None:
            iou_threshold = self._config.iou_threshold
        if track_buffer is None:
            track_buffer = self._config.track_buffer_frames

        tracked_frames = self._core.track_video_range(
            video_path=video_path,
            start_ms=start_ms,
            end_ms=end_ms,
            fps=fps,
            classes=classes,
            conf_threshold=conf_threshold,
        )

        seed_idx = min(
            range(len(tracked_frames)),
            key=lambda index: abs(tracked_frames[index].timestamp_ms - seed_frame_ms),
        )
        seed_detections = tracked_frames[seed_idx].detections

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
        keyframes: list[dict] = []
        total_detections = 0
        frames_since_seen = 0

        for frame_result in tracked_frames:
            found = False
            total_detections += len(frame_result.detections)
            for detection in frame_result.detections:
                if detection.track_id == target_track_id:
                    keyframes.append({
                        "tMs": frame_result.timestamp_ms,
                        "x": detection.x,
                        "y": detection.y,
                        "w": detection.w,
                        "h": detection.h,
                        "visible": True,
                    })
                    found = True
                    frames_since_seen = 0
                    break

            if not found:
                frames_since_seen += 1
                if frames_since_seen > track_buffer:
                    # Target lost for too long — mark invisible
                    keyframes.append({
                        "tMs": frame_result.timestamp_ms,
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
