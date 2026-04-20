"""
Vendored low-level tracker core.

This deliberately owns model loading, frame sampling, and Ultralytics/ByteTrack
execution while leaving app-specific request validation and seed selection in
annotate's sidecar service layer.
"""

import logging
from pathlib import Path
from typing import Optional

import numpy as np

from .types import BBox, FrameTrackResult

logger = logging.getLogger("annotate_sidecar.vendor.trackers.ultralytics_bytetrack")


class UltralyticsByteTrackCore:
    """Low-level YOLO + ByteTrack tracking primitive."""

    def __init__(self, model_name: str = "yolov8n.pt", tracker_config: str = "bytetrack.yaml"):
        self._model = None
        self._model_name = model_name
        self._tracker_config = tracker_config

    def _load_model(self):
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
        classes: Optional[list[int]] = None,
        conf_threshold: float = 0.25,
    ) -> list[BBox]:
        self._load_model()
        if classes is None:
            classes = [0]

        results = self._model(frame, verbose=False, conf=conf_threshold)
        detections: list[BBox] = []

        for result in results:
            if result.boxes is None:
                continue
            for box in result.boxes:
                cls_id = int(box.cls[0].item())
                if cls_id not in classes:
                    continue
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                conf = float(box.conf[0].item())
                detections.append(BBox(
                    x=x1,
                    y=y1,
                    w=x2 - x1,
                    h=y2 - y1,
                    confidence=conf,
                    class_id=cls_id,
                ))

        return detections

    def track_video_range(
        self,
        video_path: str,
        start_ms: float,
        end_ms: float,
        fps: float = 30.0,
        classes: Optional[list[int]] = None,
        conf_threshold: float = 0.25,
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
        while current <= end_ms:
            timestamps.append(current)
            current += interval_ms

        logger.info(
            "Tracking %d frames in %.1f–%.1fms of %s",
            len(timestamps), start_ms, end_ms, path.name,
        )

        frames: list[np.ndarray] = []
        actual_timestamps: list[float] = []
        for timestamp_ms in timestamps:
            cap.set(cv2.CAP_PROP_POS_MSEC, timestamp_ms)
            ok, frame = cap.read()
            if ok and frame is not None:
                frames.append(frame)
                actual_timestamps.append(timestamp_ms)
        cap.release()

        if not frames:
            raise RuntimeError("No frames could be read from video")

        logger.info("Running vendored YOLO+ByteTrack core on %d frames...", len(frames))
        self._model.predictor = None
        tracked_frames: list[FrameTrackResult] = []
        for timestamp_ms, frame in zip(actual_timestamps, frames):
            results = self._model.track(
                frame,
                verbose=False,
                conf=conf_threshold,
                classes=classes,
                persist=True,
                tracker=self._tracker_config,
            )
            detections: list[BBox] = []
            for result in results:
                if result.boxes is None:
                    continue
                for box in result.boxes:
                    cls_id = int(box.cls[0].item())
                    if cls_id not in classes:
                        continue
                    x1, y1, x2, y2 = box.xyxy[0].tolist()
                    conf = float(box.conf[0].item())
                    track_id = int(box.id[0].item()) if box.id is not None else None
                    detections.append(BBox(
                        x=x1,
                        y=y1,
                        w=x2 - x1,
                        h=y2 - y1,
                        confidence=conf,
                        class_id=cls_id,
                        track_id=track_id,
                    ))
            tracked_frames.append(FrameTrackResult(timestamp_ms=timestamp_ms, detections=detections))

        return tracked_frames
