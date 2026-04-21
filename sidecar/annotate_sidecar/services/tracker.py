"""
Object tracking service — app adapter over vendored trackers OC-SORT primitives.

This layer keeps annotate-owned behavior in one place:
  - request/response shaping for `/track`
  - seed bbox matching semantics exposed to the app
  - absolute-ms keyframe formatting with `visible: false`
"""

import logging
from pathlib import Path
from typing import Optional

import numpy as np

from ..config import TrackingDefaults, get_tracking_defaults
from .tracking_debug import create_tracking_debug_path
from ..vendor.trackers import BBox, UltralyticsOCSORTCore
from ..vendor.trackers.core.matching import find_best_iou_match

logger = logging.getLogger("annotate_sidecar.tracker")


def _bbox_bottom_center(bbox: BBox) -> tuple[float, float]:
    return (bbox.x + bbox.w / 2, bbox.y + bbox.h)


def _bbox_bottom_center_distance(a: BBox, b: BBox) -> float:
    ax, ay = _bbox_bottom_center(a)
    bx, by = _bbox_bottom_center(b)
    return float(np.hypot(ax - bx, ay - by))


def _continuity_jump_threshold(bbox: BBox) -> float:
    return max(40.0, max(bbox.h * 1.35, bbox.w * 2.0))

class Tracker:
    """Annotate-owned adapter around the vendored trackers OC-SORT core."""

    def __init__(
        self,
        config: Optional[TrackingDefaults] = None,
        core: Optional[UltralyticsOCSORTCore] = None,
    ):
        self._config = config or get_tracking_defaults()
        self._core = core or UltralyticsOCSORTCore(
            model_name=self._config.detector_model_name,
            lost_track_buffer=self._config.track_buffer_frames,
            minimum_consecutive_frames=self._config.minimum_consecutive_frames,
            minimum_iou_threshold=self._config.iou_threshold,
            direction_consistency_weight=self._config.direction_consistency_weight,
            high_conf_det_threshold=self._config.high_conf_det_threshold,
            delta_t=self._config.delta_t,
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

    def _choose_detection_by_continuity(
        self,
        *,
        detections: list[BBox],
        last_bbox: BBox,
        preferred_track_id: Optional[int],
    ) -> Optional[int]:
        if not detections:
            return None

        threshold = _continuity_jump_threshold(last_bbox)
        preferred_idx: Optional[int] = None
        preferred_distance: Optional[float] = None

        if preferred_track_id is not None:
            for index, detection in enumerate(detections):
                if detection.track_id == preferred_track_id:
                    preferred_idx = index
                    preferred_distance = _bbox_bottom_center_distance(detection, last_bbox)
                    break

        nearest_idx = min(
            range(len(detections)),
            key=lambda index: (
                _bbox_bottom_center_distance(detections[index], last_bbox),
                -detections[index].confidence,
            ),
        )
        nearest_distance = _bbox_bottom_center_distance(detections[nearest_idx], last_bbox)

        if preferred_idx is not None:
            if preferred_distance is not None and preferred_distance <= threshold:
                return preferred_idx
            if nearest_distance < (preferred_distance if preferred_distance is not None else float("inf")):
                return nearest_idx
            return preferred_idx

        if nearest_distance <= threshold * 2.5:
            return nearest_idx
        return None

    def _walk_tracking_direction(
        self,
        *,
        tracked_frames: list,
        selected_detection_indices: list[Optional[int]],
        selected_detections: list[Optional[BBox]],
        start_idx: int,
        step: int,
        initial_bbox: BBox,
        initial_track_id: Optional[int],
    ) -> None:
        last_bbox = initial_bbox
        preferred_track_id = initial_track_id
        frame_index = start_idx + step

        while 0 <= frame_index < len(tracked_frames):
            detections = tracked_frames[frame_index].detections
            chosen_idx = self._choose_detection_by_continuity(
                detections=detections,
                last_bbox=last_bbox,
                preferred_track_id=preferred_track_id,
            )
            if chosen_idx is not None:
                chosen_detection = detections[chosen_idx]
                selected_detection_indices[frame_index] = chosen_idx
                selected_detections[frame_index] = chosen_detection
                last_bbox = chosen_detection
                if chosen_detection.track_id is not None and chosen_detection.track_id >= 0:
                    preferred_track_id = chosen_detection.track_id
            frame_index += step

    def _follow_spatial_continuity(
        self,
        *,
        tracked_frames: list,
        selected_detection_indices: list[Optional[int]],
        selected_detections: list[Optional[BBox]],
        seed_idx: int,
        seed_detection: BBox,
    ) -> None:
        initial_track_id = seed_detection.track_id if seed_detection.track_id is not None and seed_detection.track_id >= 0 else None
        self._walk_tracking_direction(
            tracked_frames=tracked_frames,
            selected_detection_indices=selected_detection_indices,
            selected_detections=selected_detections,
            start_idx=seed_idx,
            step=1,
            initial_bbox=seed_detection,
            initial_track_id=initial_track_id,
        )
        self._walk_tracking_direction(
            tracked_frames=tracked_frames,
            selected_detection_indices=selected_detection_indices,
            selected_detections=selected_detections,
            start_idx=seed_idx,
            step=-1,
            initial_bbox=seed_detection,
            initial_track_id=initial_track_id,
        )

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
        debug_video: bool = False,
    ) -> dict:
        """
        Track an object across a video range using YOLO + trackers OC-SORT.

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
        target_track_id = None if match_idx is None else seed_detections[match_idx].track_id
        selected_detection_indices: list[Optional[int]] = [None] * len(tracked_frames)
        selected_detections: list[Optional[BBox]] = [None] * len(tracked_frames)
        if match_idx is not None:
            seed_detection = seed_detections[match_idx]
            selected_detection_indices[seed_idx] = match_idx
            selected_detections[seed_idx] = seed_detection
            self._follow_spatial_continuity(
                tracked_frames=tracked_frames,
                selected_detection_indices=selected_detection_indices,
                selected_detections=selected_detections,
                seed_idx=seed_idx,
                seed_detection=seed_detection,
            )
        debug_video_path: Optional[Path] = None
        if debug_video:
            debug_video_path = create_tracking_debug_path()
            self._render_debug_video(
                video_path=video_path,
                tracked_frames=tracked_frames,
                fps=fps,
                seed_bbox=seed_bbox,
                seed_frame_ms=seed_frame_ms,
                seed_frame_index=seed_idx,
                output_path=debug_video_path,
                target_track_id=target_track_id,
                matched_seed_detection_index=match_idx,
                selected_detection_indices=selected_detection_indices,
            )
        if match_idx is None:
            # Return error with detected bboxes for frontend display
            detected = [
                {"x": d.x, "y": d.y, "w": d.w, "h": d.h, "confidence": d.confidence}
                for d in seed_detections
            ]
            extra = {"debugVideoPath": str(debug_video_path)} if debug_video_path else None
            raise ValueError(
                f"No detection sufficiently matches the seed bbox or foot anchor "
                f"(IoU >= {iou_threshold}). "
                f"Found {len(seed_detections)} detections at seed frame.",
                detected,
                extra,
            )

        if target_track_id is None:
            extra = {"debugVideoPath": str(debug_video_path)} if debug_video_path else None
            raise ValueError("Matched detection has no track ID assigned by OC-SORT.", [], extra)

        logger.info("Target track ID: %d", target_track_id)

        # --- Pass 3: Extract keyframes for the spatially continuous target path ---
        keyframes: list[dict] = []
        total_detections = 0
        frames_since_seen = 0

        for frame_index, frame_result in enumerate(tracked_frames):
            total_detections += len(frame_result.detections)
            detection = selected_detections[frame_index]
            if detection is not None:
                keyframes.append({
                    "tMs": frame_result.timestamp_ms,
                    "x": detection.x,
                    "y": detection.y,
                    "w": detection.w,
                    "h": detection.h,
                    "visible": True,
                })
                frames_since_seen = 0
            else:
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

        result = {
            "keyframes": keyframes,
            "trackId": target_track_id,
            "detectionCount": total_detections,
        }
        if debug_video_path:
            result["debugVideoPath"] = str(debug_video_path)
        return result

    def _render_debug_video(
        self,
        *,
        video_path: str,
        tracked_frames: list,
        fps: float,
        seed_bbox: BBox,
        seed_frame_ms: float,
        seed_frame_index: int,
        output_path: Path,
        target_track_id: Optional[int],
        matched_seed_detection_index: Optional[int],
        selected_detection_indices: list[Optional[int]],
    ) -> None:
        import cv2

        source = Path(video_path)
        cap = cv2.VideoCapture(str(source))
        if not cap.isOpened():
            logger.warning("Could not open video for tracking debug render: %s", video_path)
            return

        frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        if frame_width <= 0 or frame_height <= 0:
            cap.release()
            logger.warning("Video has invalid dimensions for tracking debug render: %s", video_path)
            return

        output_path.parent.mkdir(parents=True, exist_ok=True)
        writer = cv2.VideoWriter(
            str(output_path),
            cv2.VideoWriter_fourcc(*"mp4v"),
            fps,
            (frame_width, frame_height),
        )
        if not writer.isOpened():
            cap.release()
            logger.warning("Could not create tracking debug video at %s", output_path)
            return

        try:
            for frame_index, frame_result in enumerate(tracked_frames):
                cap.set(cv2.CAP_PROP_POS_MSEC, frame_result.timestamp_ms)
                ok, frame = cap.read()
                if not ok or frame is None:
                    frame = np.zeros((frame_height, frame_width, 3), dtype=np.uint8)
                elif frame.shape[1] != frame_width or frame.shape[0] != frame_height:
                    frame = cv2.resize(frame, (frame_width, frame_height))

                overlay = frame.copy()
                for detection_index, detection in enumerate(frame_result.detections):
                    is_selected = selected_detection_indices[frame_index] == detection_index
                    is_target = (
                        target_track_id is not None
                        and detection.track_id == target_track_id
                    )
                    color = (60, 220, 80) if is_selected else ((255, 180, 0) if is_target else (0, 180, 255))
                    thickness = 3 if is_selected else 2
                    x1 = int(round(detection.x))
                    y1 = int(round(detection.y))
                    x2 = int(round(detection.x + detection.w))
                    y2 = int(round(detection.y + detection.h))
                    cv2.rectangle(overlay, (x1, y1), (x2, y2), color, thickness)
                    foot_x = int(round(detection.x + detection.w / 2))
                    foot_y = int(round(detection.y + detection.h))
                    cv2.circle(overlay, (foot_x, foot_y), 4, color, -1)
                    label = f"id {detection.track_id} conf {detection.confidence:.2f}"
                    if frame_index == seed_frame_index and detection_index == matched_seed_detection_index:
                        label = f"{label} [seed-match]"
                    elif is_selected:
                        label = f"{label} [selected]"
                    cv2.putText(
                        overlay,
                        label,
                        (x1, max(18, y1 - 8)),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.45,
                        color,
                        1,
                        cv2.LINE_AA,
                    )

                if frame_index == seed_frame_index:
                    seed_x1 = int(round(seed_bbox.x))
                    seed_y1 = int(round(seed_bbox.y))
                    seed_x2 = int(round(seed_bbox.x + seed_bbox.w))
                    seed_y2 = int(round(seed_bbox.y + seed_bbox.h))
                    seed_fx = int(round(seed_bbox.x + seed_bbox.w / 2))
                    seed_fy = int(round(seed_bbox.y + seed_bbox.h))
                    cv2.rectangle(overlay, (seed_x1, seed_y1), (seed_x2, seed_y2), (0, 0, 255), 2)
                    cv2.circle(overlay, (seed_fx, seed_fy), 5, (255, 0, 255), -1)
                    cv2.putText(
                        overlay,
                        "seed bbox / foot",
                        (seed_x1, max(18, seed_y1 - 8)),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.55,
                        (255, 255, 255),
                        2,
                        cv2.LINE_AA,
                    )

                header = f"t={frame_result.timestamp_ms:.0f}ms  detections={len(frame_result.detections)}  target={target_track_id}"
                cv2.putText(
                    overlay,
                    header,
                    (12, 24),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.65,
                    (255, 255, 255),
                    2,
                    cv2.LINE_AA,
                )
                if abs(frame_result.timestamp_ms - seed_frame_ms) < (500.0 / max(fps, 1.0)):
                    cv2.putText(
                        overlay,
                        "seed frame",
                        (12, 48),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.6,
                        (255, 0, 255),
                        2,
                        cv2.LINE_AA,
                    )

                writer.write(overlay)
        finally:
            writer.release()
            cap.release()
