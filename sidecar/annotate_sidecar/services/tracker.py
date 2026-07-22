"""
Object tracking service — app adapter over vendored trackers OC-SORT primitives.

This layer keeps annotate-owned behavior in one place:
  - request/response shaping for `/track`
  - seed bbox matching semantics exposed to the app
  - absolute-ms keyframe formatting with `visible: false`
"""

import logging
from pathlib import Path
from typing import Callable, Optional

import numpy as np

from ..config import TrackingDefaults, get_tracking_defaults
from .tracking_debug import create_tracking_debug_path
from ..vendor.trackers import BBox, UltralyticsOCSORTCore
from ..vendor.trackers.core.matching import find_best_iou_match

logger = logging.getLogger("annotate_sidecar.tracker")


def _bbox_bottom_center(bbox: BBox) -> tuple[float, float]:
    return (bbox.x + bbox.w / 2, bbox.y + bbox.h)


def _tracking_keyframe(timestamp_ms: float, bbox: BBox) -> dict:
    return {
        "tMs": timestamp_ms,
        "x": bbox.x,
        "y": bbox.y,
        "w": bbox.w,
        "h": bbox.h,
        "visible": True,
    }


def _appearance_similarity(
    left: Optional[tuple[float, ...]],
    right: Optional[tuple[float, ...]],
) -> Optional[float]:
    if left is None or right is None or len(left) != len(right):
        return None
    return float(np.clip(np.dot(np.asarray(left), np.asarray(right)), 0.0, 1.0))


def _blend_appearance(
    current: tuple[float, ...],
    observed: tuple[float, ...],
    weight: float = 0.08,
) -> tuple[float, ...]:
    blended = np.asarray(current) * (1.0 - weight) + np.asarray(observed) * weight
    norm = float(np.linalg.norm(blended))
    if not np.isfinite(norm) or norm <= 1e-9:
        return current
    return tuple(float(value) for value in blended / norm)


def _continuity_jump_threshold(bbox: BBox, frames_since_seen: int = 1) -> float:
    base = max(8.0, min(30.0, bbox.h * 0.25 + bbox.w * 0.15))
    return min(base * 2.5, base * (1.0 + max(0, frames_since_seen - 1) * 0.2))


def _interpolate_detection_gaps(
    selected_detections: list[Optional[BBox]],
) -> list[Optional[BBox]]:
    """Fill bounded detector misses without extrapolating beyond known observations."""

    filled = selected_detections.copy()
    observed_indices = [
        index for index, detection in enumerate(selected_detections)
        if detection is not None
    ]
    for left_index, right_index in zip(observed_indices, observed_indices[1:]):
        gap = right_index - left_index
        if gap <= 1:
            continue
        left = selected_detections[left_index]
        right = selected_detections[right_index]
        if left is None or right is None:
            continue
        for index in range(left_index + 1, right_index):
            alpha = (index - left_index) / gap
            filled[index] = BBox(
                x=left.x + (right.x - left.x) * alpha,
                y=left.y + (right.y - left.y) * alpha,
                w=left.w + (right.w - left.w) * alpha,
                h=left.h + (right.h - left.h) * alpha,
                confidence=min(left.confidence, right.confidence),
                class_id=left.class_id,
                track_id=right.track_id if alpha >= 0.5 else left.track_id,
            )
    return filled


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
        predicted_foot: Optional[tuple[float, float]] = None,
        frames_since_seen: int = 1,
        target_appearance: Optional[tuple[float, ...]] = None,
    ) -> Optional[int]:
        if not detections:
            return None

        threshold = _continuity_jump_threshold(last_bbox, frames_since_seen)
        target_x, target_y = predicted_foot or _bbox_bottom_center(last_bbox)

        candidates: list[tuple[float, float, Optional[float], int]] = []
        for index, detection in enumerate(detections):
            foot_x, foot_y = _bbox_bottom_center(detection)
            distance = float(np.hypot(foot_x - target_x, foot_y - target_y))
            similarity = _appearance_similarity(target_appearance, detection.appearance)
            appearance_penalty = 0.25 if similarity is None else 1.0 - similarity
            score = distance / max(threshold, 1.0) + appearance_penalty * 0.45 - detection.confidence * 0.04
            candidates.append((score, distance, similarity, index))

        if preferred_track_id is not None:
            preferred = [
                candidate for candidate in candidates
                if detections[candidate[3]].track_id == preferred_track_id
                and (candidate[2] is None or candidate[2] >= 0.22)
            ]
            if preferred:
                _, distance, _, index = min(preferred, key=lambda candidate: candidate[1])
                if distance <= threshold * 1.25:
                    return index

        plausible = [
            candidate for candidate in candidates
            if candidate[1] <= threshold
            and (candidate[2] is None or candidate[2] >= 0.38)
        ]
        return min(plausible, default=None, key=lambda candidate: candidate[0])[3] if plausible else None

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
        max_gap_frames: int,
    ) -> None:
        last_bbox = initial_bbox
        preferred_track_id = initial_track_id
        target_appearance = initial_bbox.appearance
        last_foot = np.asarray(_bbox_bottom_center(initial_bbox), dtype=float)
        velocity = np.zeros(2, dtype=float)
        frames_since_seen = 0
        frame_index = start_idx + step

        while 0 <= frame_index < len(tracked_frames):
            frames_since_seen += 1
            if frames_since_seen > max(1, max_gap_frames):
                break
            detections = tracked_frames[frame_index].detections
            predicted_foot = last_foot + velocity * frames_since_seen
            chosen_idx = self._choose_detection_by_continuity(
                detections=detections,
                last_bbox=last_bbox,
                preferred_track_id=preferred_track_id,
                predicted_foot=(float(predicted_foot[0]), float(predicted_foot[1])),
                frames_since_seen=frames_since_seen,
                target_appearance=target_appearance,
            )
            if chosen_idx is not None:
                chosen_detection = detections[chosen_idx]
                selected_detection_indices[frame_index] = chosen_idx
                selected_detections[frame_index] = chosen_detection
                chosen_foot = np.asarray(_bbox_bottom_center(chosen_detection), dtype=float)
                observed_velocity = (chosen_foot - last_foot) / frames_since_seen
                velocity = velocity * 0.65 + observed_velocity * 0.35
                speed = float(np.linalg.norm(velocity))
                if speed > 10.0:
                    velocity *= 10.0 / speed
                last_foot = chosen_foot
                last_bbox = chosen_detection
                if chosen_detection.track_id is not None and chosen_detection.track_id >= 0:
                    preferred_track_id = chosen_detection.track_id
                similarity = _appearance_similarity(target_appearance, chosen_detection.appearance)
                if (
                    target_appearance is not None
                    and chosen_detection.appearance is not None
                    and (similarity is None or similarity >= 0.5)
                ):
                    target_appearance = _blend_appearance(target_appearance, chosen_detection.appearance)
                elif target_appearance is None:
                    target_appearance = chosen_detection.appearance
                frames_since_seen = 0
            frame_index += step

    def _follow_spatial_continuity(
        self,
        *,
        tracked_frames: list,
        selected_detection_indices: list[Optional[int]],
        selected_detections: list[Optional[BBox]],
        seed_idx: int,
        seed_detection: BBox,
        max_gap_frames: int,
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
            max_gap_frames=max_gap_frames,
        )
        self._walk_tracking_direction(
            tracked_frames=tracked_frames,
            selected_detection_indices=selected_detection_indices,
            selected_detections=selected_detections,
            start_idx=seed_idx,
            step=-1,
            initial_bbox=seed_detection,
            initial_track_id=initial_track_id,
            max_gap_frames=max_gap_frames,
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
        stop_on_loss: bool = False,
        progress_callback: Optional[Callable[[dict], None]] = None,
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
            progress_callback: Receives each trusted keyframe as tracking advances.

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

        incremental_selected_indices: list[Optional[int]] = []
        incremental_selected_detections: list[Optional[BBox]] = []
        incremental_match_idx: Optional[int] = None
        incremental_called = False
        incremental_last_bbox: Optional[BBox] = None
        incremental_preferred_track_id: Optional[int] = None
        incremental_target_appearance: Optional[tuple[float, ...]] = None
        incremental_last_foot = np.zeros(2, dtype=float)
        incremental_velocity = np.zeros(2, dtype=float)

        def stop_after_first_continuity_loss(frame_result) -> bool:
            nonlocal incremental_called
            nonlocal incremental_last_bbox
            nonlocal incremental_match_idx
            nonlocal incremental_preferred_track_id
            nonlocal incremental_target_appearance
            nonlocal incremental_last_foot
            nonlocal incremental_velocity

            incremental_called = True
            detections = frame_result.detections
            if not incremental_selected_detections:
                incremental_match_idx = self.match_seed_bbox(detections, seed_bbox, iou_threshold)
                incremental_selected_indices.append(incremental_match_idx)
                if incremental_match_idx is None:
                    incremental_selected_detections.append(None)
                    return True
                seed_detection = detections[incremental_match_idx]
                incremental_selected_detections.append(seed_detection)
                incremental_last_bbox = seed_detection
                incremental_preferred_track_id = (
                    seed_detection.track_id
                    if seed_detection.track_id is not None and seed_detection.track_id >= 0
                    else None
                )
                incremental_target_appearance = seed_detection.appearance
                incremental_last_foot = np.asarray(_bbox_bottom_center(seed_detection), dtype=float)
                if progress_callback is not None:
                    progress_callback(_tracking_keyframe(frame_result.timestamp_ms, seed_detection))
                return False

            if incremental_last_bbox is None:
                incremental_selected_indices.append(None)
                incremental_selected_detections.append(None)
                return True

            predicted_foot = incremental_last_foot + incremental_velocity
            chosen_idx = self._choose_detection_by_continuity(
                detections=detections,
                last_bbox=incremental_last_bbox,
                preferred_track_id=incremental_preferred_track_id,
                predicted_foot=(float(predicted_foot[0]), float(predicted_foot[1])),
                frames_since_seen=1,
                target_appearance=incremental_target_appearance,
            )
            incremental_selected_indices.append(chosen_idx)
            if chosen_idx is None:
                incremental_selected_detections.append(None)
                return True

            chosen_detection = detections[chosen_idx]
            incremental_selected_detections.append(chosen_detection)
            chosen_foot = np.asarray(_bbox_bottom_center(chosen_detection), dtype=float)
            observed_velocity = chosen_foot - incremental_last_foot
            incremental_velocity = incremental_velocity * 0.65 + observed_velocity * 0.35
            speed = float(np.linalg.norm(incremental_velocity))
            if speed > 10.0:
                incremental_velocity *= 10.0 / speed
            incremental_last_foot = chosen_foot
            incremental_last_bbox = chosen_detection
            if chosen_detection.track_id is not None and chosen_detection.track_id >= 0:
                incremental_preferred_track_id = chosen_detection.track_id
            similarity = _appearance_similarity(incremental_target_appearance, chosen_detection.appearance)
            if (
                incremental_target_appearance is not None
                and chosen_detection.appearance is not None
                and (similarity is None or similarity >= 0.5)
            ):
                incremental_target_appearance = _blend_appearance(
                    incremental_target_appearance,
                    chosen_detection.appearance,
                )
            elif incremental_target_appearance is None:
                incremental_target_appearance = chosen_detection.appearance
            if progress_callback is not None:
                progress_callback(_tracking_keyframe(frame_result.timestamp_ms, chosen_detection))
            return False

        use_incremental_stop = (
            stop_on_loss
            and not debug_video
            and abs(seed_frame_ms - start_ms) <= (500.0 / max(fps, 1.0))
            and bool(getattr(self._core, "supports_incremental_stop", False))
        )
        track_kwargs = {
            "video_path": video_path,
            "start_ms": start_ms,
            "end_ms": end_ms,
            "fps": fps,
            "classes": classes,
            "conf_threshold": conf_threshold,
        }
        if use_incremental_stop:
            track_kwargs["stop_callback"] = stop_after_first_continuity_loss
        tracked_frames = self._core.track_video_range(**track_kwargs)

        seed_idx = 0 if incremental_called else min(
            range(len(tracked_frames)),
            key=lambda index: abs(tracked_frames[index].timestamp_ms - seed_frame_ms),
        )
        seed_detections = tracked_frames[seed_idx].detections

        # Match seed bbox
        match_idx = incremental_match_idx if incremental_called else self.match_seed_bbox(
            seed_detections,
            seed_bbox,
            iou_threshold,
        )
        target_track_id = None if match_idx is None else seed_detections[match_idx].track_id
        selected_detection_indices: list[Optional[int]] = (
            incremental_selected_indices if incremental_called else [None] * len(tracked_frames)
        )
        selected_detections: list[Optional[BBox]] = (
            incremental_selected_detections if incremental_called else [None] * len(tracked_frames)
        )
        if match_idx is not None and not incremental_called:
            seed_detection = seed_detections[match_idx]
            selected_detection_indices[seed_idx] = match_idx
            selected_detections[seed_idx] = seed_detection
            self._follow_spatial_continuity(
                tracked_frames=tracked_frames,
                selected_detection_indices=selected_detection_indices,
                selected_detections=selected_detections,
                seed_idx=seed_idx,
                seed_detection=seed_detection,
                max_gap_frames=track_buffer,
            )
            if target_track_id is None or target_track_id < 0:
                resolved_track_id = next((
                    detection.track_id
                    for detection in selected_detections
                    if detection is not None and detection.track_id is not None and detection.track_id >= 0
                ), None)
                if resolved_track_id is not None:
                    target_track_id = resolved_track_id
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
        output_detections = _interpolate_detection_gaps(selected_detections)
        keyframes: list[dict] = []
        total_detections = 0

        first_loss_index: Optional[int] = None
        if stop_on_loss:
            first_loss_index = next((
                index
                for index in range(seed_idx, len(output_detections))
                if output_detections[index] is None
            ), None)
        output_start_index = seed_idx if stop_on_loss else 0
        output_end_index = first_loss_index if first_loss_index is not None else len(tracked_frames)

        for frame_index, frame_result in enumerate(tracked_frames):
            total_detections += len(frame_result.detections)
            if frame_index < output_start_index or frame_index >= output_end_index:
                continue
            detection = output_detections[frame_index]
            if detection is not None:
                keyframe = _tracking_keyframe(frame_result.timestamp_ms, detection)
            else:
                # Bounded gaps were filled above. Anything still unmatched is
                # outside the trusted path and must be explicit rather than a
                # visually ambiguous hole in the keyframe timeline.
                keyframe = {
                    "tMs": frame_result.timestamp_ms,
                    "x": 0, "y": 0, "w": 0, "h": 0,
                    "visible": False,
                }
            keyframes.append(keyframe)
            if progress_callback is not None and not incremental_called:
                progress_callback(keyframe)

        logger.info(
            "Tracking complete: %d keyframes, %d total detections",
            len(keyframes), total_detections,
        )

        result = {
            "keyframes": keyframes,
            "trackId": target_track_id,
            "detectionCount": total_detections,
        }
        if stop_on_loss:
            result["completed"] = first_loss_index is None
            result["stoppedAtMs"] = (
                tracked_frames[first_loss_index].timestamp_ms
                if first_loss_index is not None
                else None
            )
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
