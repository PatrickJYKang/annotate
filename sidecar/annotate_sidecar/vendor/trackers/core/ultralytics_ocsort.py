"""
Ultralytics detection + trackers-backed OC-SORT execution.

This module owns the low-level model loading, frame sampling, and detection to
sv.Detections conversion. App-specific seed matching and response shaping still
belong in annotate's `services.tracker`.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Callable, Optional

import numpy as np

from .ocsort.tracker import OCSORTTracker
from .types import BBox, FrameTrackResult

logger = logging.getLogger("annotate_sidecar.vendor.trackers.ultralytics_ocsort")


def _nearest_source_frame(timestamp_ms: float, source_fps: float) -> int:
    return max(0, int(np.floor(timestamp_ms * source_fps / 1000.0 + 0.5)))


def _iter_video_samples(cap, timestamps: list[float], source_fps: float):
    """Read dense samples sequentially while retaining seeking for sparse jobs."""

    import cv2

    if not timestamps:
        return

    target_frames = [_nearest_source_frame(timestamp, source_fps) for timestamp in timestamps]
    source_span = target_frames[-1] - target_frames[0] + 1
    use_sequential_decode = source_span <= max(4, len(target_frames) * 4)

    if not use_sequential_decode:
        for timestamp_ms in timestamps:
            cap.set(cv2.CAP_PROP_POS_MSEC, timestamp_ms)
            ok, frame = cap.read()
            yield timestamp_ms, frame if ok else None
        return

    cap.set(cv2.CAP_PROP_POS_FRAMES, target_frames[0])
    next_source_frame = int(round(cap.get(cv2.CAP_PROP_POS_FRAMES)))
    last_frame = None
    last_source_frame: Optional[int] = None
    exhausted = False

    for timestamp_ms, target_frame in zip(timestamps, target_frames):
        while not exhausted and (last_source_frame is None or last_source_frame < target_frame):
            ok, frame = cap.read()
            if not ok or frame is None:
                exhausted = True
                last_frame = None
                break
            last_frame = frame
            last_source_frame = next_source_frame
            next_source_frame += 1
        yield timestamp_ms, last_frame if last_source_frame == target_frame else None


class UltralyticsOCSORTCore:
    """Low-level YOLO + OC-SORT tracking primitive."""

    supports_incremental_stop = True

    def __init__(
        self,
        model_name: str = "yolov8n.pt",
        *,
        lost_track_buffer: int = 30,
        minimum_consecutive_frames: int = 1,
        minimum_iou_threshold: float = 0.3,
        direction_consistency_weight: float = 0.2,
        high_conf_det_threshold: float = 0.25,
        delta_t: int = 3,
    ) -> None:
        self._model = None
        self._model_name = model_name
        self._lost_track_buffer = lost_track_buffer
        self._minimum_consecutive_frames = minimum_consecutive_frames
        self._minimum_iou_threshold = minimum_iou_threshold
        self._direction_consistency_weight = direction_consistency_weight
        self._high_conf_det_threshold = high_conf_det_threshold
        self._delta_t = delta_t

    def _load_model(self):
        if self._model is not None:
            return
        try:
            from ultralytics import YOLO
        except ImportError as exc:
            raise RuntimeError(
                "ultralytics is required for tracking. Install with: pip install ultralytics"
            ) from exc
        logger.info("Loading YOLO model: %s", self._model_name)
        self._model = YOLO(self._model_name)
        logger.info("YOLO model loaded")

    @staticmethod
    def _result_to_detections(result, classes: list[int], conf_threshold: float):
        import supervision as sv

        if result.boxes is None or len(result.boxes) == 0:
            return sv.Detections.empty()

        xyxy_values = result.boxes.xyxy.cpu().numpy()
        conf_values = result.boxes.conf.cpu().numpy()
        class_values = result.boxes.cls.cpu().numpy().astype(int)

        keep_mask = np.isin(class_values, np.asarray(classes, dtype=int))
        keep_mask &= conf_values >= conf_threshold
        if not np.any(keep_mask):
            return sv.Detections.empty()

        return sv.Detections(
            xyxy=xyxy_values[keep_mask].astype(np.float32),
            confidence=conf_values[keep_mask].astype(np.float32),
            class_id=class_values[keep_mask].astype(int),
        )

    @staticmethod
    def _appearance_descriptor(frame: np.ndarray, xyxy: np.ndarray) -> Optional[tuple[float, ...]]:
        import cv2

        frame_height, frame_width = frame.shape[:2]
        x1, y1, x2, y2 = (float(value) for value in xyxy)
        width = max(0.0, x2 - x1)
        height = max(0.0, y2 - y1)
        # The central upper body carries useful kit colour while excluding most grass.
        crop_x1 = max(0, min(frame_width, int(np.floor(x1 + width * 0.15))))
        crop_x2 = max(0, min(frame_width, int(np.ceil(x1 + width * 0.85))))
        crop_y1 = max(0, min(frame_height, int(np.floor(y1 + height * 0.08))))
        crop_y2 = max(0, min(frame_height, int(np.ceil(y1 + height * 0.58))))
        if crop_x2 <= crop_x1 or crop_y2 <= crop_y1:
            return None

        crop = frame[crop_y1:crop_y2, crop_x1:crop_x2]
        if crop.size == 0:
            return None
        hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
        mask = ((hsv[:, :, 1] > 45) & (hsv[:, :, 2] > 35)).astype(np.uint8) * 255
        if int(np.count_nonzero(mask)) < 8:
            return None
        histogram = cv2.calcHist([hsv], [0, 1], mask, [18, 4], [0, 180, 0, 256]).reshape(-1)
        norm = float(np.linalg.norm(histogram))
        if not np.isfinite(norm) or norm <= 1e-9:
            return None
        return tuple(float(value) for value in histogram / norm)

    @classmethod
    def _tracked_detections_to_bboxes(
        cls,
        detections,
        frame: Optional[np.ndarray] = None,
    ) -> list[BBox]:
        if len(detections) == 0:
            return []

        confidence = detections.confidence
        class_id = detections.class_id
        tracker_id = getattr(detections, "tracker_id", None)

        boxes: list[BBox] = []
        for index, xyxy in enumerate(detections.xyxy):
            x1, y1, x2, y2 = xyxy.tolist()
            boxes.append(
                BBox(
                    x=float(x1),
                    y=float(y1),
                    w=float(x2 - x1),
                    h=float(y2 - y1),
                    confidence=float(confidence[index]) if confidence is not None else 0.0,
                    class_id=int(class_id[index]) if class_id is not None else 0,
                    track_id=int(tracker_id[index]) if tracker_id is not None else None,
                    appearance=cls._appearance_descriptor(frame, xyxy) if frame is not None else None,
                )
            )
        return boxes

    def detect_frame(
        self,
        frame: np.ndarray,
        classes: Optional[list[int]] = None,
        conf_threshold: float = 0.25,
    ) -> list[BBox]:
        self._load_model()
        if classes is None:
            classes = [0]

        results = self._model(frame, verbose=False, conf=conf_threshold)
        detections: list[BBox] = []
        for result in results:
            for bbox in self._tracked_detections_to_bboxes(
                self._result_to_detections(result, classes, conf_threshold),
                frame,
            ):
                detections.append(bbox)
        return detections

    def track_video_range(
        self,
        video_path: str,
        start_ms: float,
        end_ms: float,
        fps: float = 30.0,
        classes: Optional[list[int]] = None,
        conf_threshold: float = 0.25,
        stop_callback: Optional[Callable[[FrameTrackResult], bool]] = None,
    ) -> list[FrameTrackResult]:
        self._load_model()
        if classes is None:
            classes = [0]

        path = Path(video_path)
        if not path.exists():
            raise FileNotFoundError(f"Video not found: {video_path}")

        import cv2

        cap = cv2.VideoCapture(str(path))
        if not cap.isOpened():
            raise FileNotFoundError(f"Cannot open video: {video_path}")

        interval_ms = 1000.0 / fps
        timestamps: list[float] = []
        current = start_ms
        while current <= end_ms + 1e-6:
            timestamps.append(current)
            current += interval_ms

        if not timestamps:
            cap.release()
            return []

        tracker = OCSORTTracker(
            lost_track_buffer=self._lost_track_buffer,
            frame_rate=fps,
            minimum_consecutive_frames=self._minimum_consecutive_frames,
            minimum_iou_threshold=self._minimum_iou_threshold,
            direction_consistency_weight=self._direction_consistency_weight,
            high_conf_det_threshold=self._high_conf_det_threshold,
            delta_t=self._delta_t,
        )

        source_fps = float(cap.get(cv2.CAP_PROP_FPS))
        if not np.isfinite(source_fps) or source_fps <= 0:
            source_fps = fps

        tracked_frames: list[FrameTrackResult] = []
        try:
            for timestamp_ms, frame in _iter_video_samples(cap, timestamps, source_fps):
                if frame is None:
                    frame_result = FrameTrackResult(timestamp_ms=timestamp_ms, detections=[])
                    tracked_frames.append(frame_result)
                    if stop_callback and stop_callback(frame_result):
                        break
                    continue

                results = self._model(frame, verbose=False, conf=conf_threshold)
                if not results:
                    frame_result = FrameTrackResult(timestamp_ms=timestamp_ms, detections=[])
                    tracked_frames.append(frame_result)
                    if stop_callback and stop_callback(frame_result):
                        break
                    continue

                detections = self._result_to_detections(results[0], classes, conf_threshold)
                tracked = tracker.update(detections)
                frame_result = FrameTrackResult(
                    timestamp_ms=timestamp_ms,
                    detections=self._tracked_detections_to_bboxes(tracked, frame),
                )
                tracked_frames.append(frame_result)
                if stop_callback and stop_callback(frame_result):
                    break
        finally:
            cap.release()

        return tracked_frames
