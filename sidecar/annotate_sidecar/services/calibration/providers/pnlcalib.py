from __future__ import annotations

import math
import tempfile
from collections.abc import Callable
from pathlib import Path

try:
    import tomllib
except ModuleNotFoundError:  # Python 3.10
    import tomli as tomllib

import numpy as np

from ....config import CalibrationDefaults, get_calibration_defaults
from ....vendor.trackers import PnLCalibProvider
from ..base import CalibrationProvider
from ..types import CalibrationFrameRange, HomographyFrame


IDENTITY_H = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]


class PnLCalibCalibrationProvider(CalibrationProvider):
    """Annotate bridge around the vendored trackers PnLCalib provider."""

    name = "pnlcalib"
    supports_manual_seed_tracking = False

    def __init__(self, defaults: CalibrationDefaults | None = None):
        self._defaults = defaults or get_calibration_defaults()
        self._calibrator: PnLCalibProvider | None = None

    @property
    def available(self) -> bool:
        return self._build_calibrator(skip_interval=0).is_available()

    def estimate_range(
        self,
        video_path: str,
        start_ms: float,
        end_ms: float,
        fps: float = 5.0,
        skip_interval: int = 0,
        on_progress: Callable[[dict], None] | None = None,
        frame_range: CalibrationFrameRange | None = None,
    ) -> list[HomographyFrame]:
        import cv2

        if frame_range is not None:
            start_ms = frame_range.start_frame * 1000 / frame_range.source_fps
            end_ms = (frame_range.end_frame - 1) * 1000 / frame_range.source_fps
            fps = frame_range.source_fps / frame_range.sample_step
            skip_interval = frame_range.every_n_frames // frame_range.sample_step - 1
        if not all(math.isfinite(value) for value in (start_ms, end_ms, fps)) or fps <= 0 or start_ms < 0 or end_ms < start_ms:
            raise ValueError("Invalid homography range or sample rate")
        on_progress = on_progress or (lambda _progress: None)
        stride = max(1, skip_interval + 1)
        count = math.floor((end_ms - start_ms) * fps / 1000 + 1e-6) + 1
        total = (count + stride - 1) // stride
        prepare_progress = lambda: on_progress({'phase': 'preparing', 'completed': 0, 'total': total})
        prepare_progress()
        # Preserve the established preprocessing pixels. Raw decoding is faster
        # but changed a few PnLCalib solutions in the real-video parity check.
        with tempfile.TemporaryDirectory(prefix='annotate-pnlcalib-') as temp:
            clip_path = Path(temp) / 'clip.mp4'
            timestamps = self._write_sampled_clip(
                video_path=video_path, start_ms=start_ms, end_ms=end_ms, fps=fps,
                output_path=clip_path, on_progress=prepare_progress,
                frame_range=frame_range,
            )
            cap = cv2.VideoCapture(str(clip_path))
            if not cap.isOpened():
                cap.release()
                raise RuntimeError('Cannot read sampled calibration clip')
            try:
                def samples():
                    for index in range(len(timestamps)):
                        if not cap.grab():
                            yield None
                        elif index % stride:
                            yield None
                        else:
                            ok, frame = cap.retrieve()
                            yield frame if ok else None

                if self._calibrator is None:
                    self._calibrator = self._build_calibrator(skip_interval=skip_interval)
                frames = self._calibrator.calibrate_frames(
                    samples(), frame_width=int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
                    frame_height=int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)), fps=fps,
                    total_frames=len(timestamps), every_n_frames=stride, on_progress=on_progress,
                )
                return [self._to_public_frame(frame, timestamps[frame.frame_idx - 1]) for frame in frames]
            finally:
                cap.release()

    def _build_calibrator(self, *, skip_interval: int) -> PnLCalibProvider:
        config_data = self._load_config_data()
        sampling = dict(config_data.get("sampling", {}))
        sampling["every_n_frames"] = max(1, skip_interval + 1)
        config_data["sampling"] = sampling

        overlay = dict(config_data.get("overlay", {}))
        overlay["enabled"] = False
        config_data["overlay"] = overlay

        output = dict(config_data.get("output", {}))
        output["write_camera_jsonl"] = False
        output["write_homography_jsonl"] = False
        output["write_quality_csv"] = False
        config_data["output"] = output

        return PnLCalibProvider(
            config_path=self._defaults.config_path,
            config_data=config_data,
            upstream_root=self._defaults.upstream_root,
        )

    def _load_config_data(self) -> dict[str, object]:
        if not self._defaults.config_path.exists():
            return {}
        with self._defaults.config_path.open("rb") as handle:
            data = tomllib.load(handle)
        return data if isinstance(data, dict) else {}

    def _write_sampled_clip(
        self,
        *,
        video_path: str,
        start_ms: float,
        end_ms: float,
        fps: float,
        output_path: Path | None = None,
        on_progress: Callable[[], None] | None = None,
        frame_range: CalibrationFrameRange | None = None,
    ) -> list[float]:
        import cv2

        source_path = Path(video_path)
        if not source_path.exists():
            raise FileNotFoundError(f"Video not found: {video_path}")

        cap = cv2.VideoCapture(str(source_path))
        if not cap.isOpened():
            raise FileNotFoundError(f"Cannot open video: {video_path}")

        frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        if frame_width <= 0 or frame_height <= 0:
            cap.release()
            raise RuntimeError("Video has invalid dimensions for calibration")

        if frame_range is not None:
            target_frame_indices = list(range(frame_range.start_frame, frame_range.end_frame, frame_range.sample_step))
            timestamps = [index * 1000 / frame_range.source_fps for index in target_frame_indices]
        else:
            timestamps = []
            current = start_ms
            interval_ms = 1000.0 / fps
            while current <= end_ms + 1e-6:
                timestamps.append(current)
                current += interval_ms
            source_fps = float(cap.get(cv2.CAP_PROP_FPS))
            if source_fps <= 0:
                source_fps = fps
            target_frame_indices = [max(0, round(timestamp * source_fps / 1000.0)) for timestamp in timestamps]

        if output_path is None:
            cap.release()
            return timestamps

        output_path.parent.mkdir(parents=True, exist_ok=True)
        writer = cv2.VideoWriter(
            str(output_path),
            cv2.VideoWriter_fourcc(*"mp4v"),
            fps,
            (frame_width, frame_height),
        )
        if not writer.isOpened():
            cap.release()
            raise RuntimeError(f"Could not create temporary calibration clip at {output_path}")

        blank_frame = np.zeros((frame_height, frame_width, 3), dtype=np.uint8)
        cap.set(cv2.CAP_PROP_POS_FRAMES, target_frame_indices[0])
        next_frame_index = int(round(cap.get(cv2.CAP_PROP_POS_FRAMES)))
        last_sampled_frame = None
        try:
            for target_frame_index in target_frame_indices:
                if on_progress:
                    on_progress()
                sampled_frame = None
                while next_frame_index <= target_frame_index:
                    if not cap.grab():
                        break
                    if next_frame_index == target_frame_index:
                        ok, candidate = cap.retrieve()
                        if ok and candidate is not None:
                            sampled_frame = candidate
                    next_frame_index += 1
                frame = sampled_frame if sampled_frame is not None else last_sampled_frame
                if frame is None:
                    writer.write(blank_frame)
                    continue
                if frame.shape[1] != frame_width or frame.shape[0] != frame_height:
                    frame = cv2.resize(frame, (frame_width, frame_height))
                writer.write(frame)
                last_sampled_frame = frame
        finally:
            writer.release()
            cap.release()

        return timestamps

    @staticmethod
    def _to_public_frame(frame, timestamp_ms: float) -> HomographyFrame:
        diagnostics = dict(frame.diagnostics)
        if frame.pitch_to_image is None:
            method = "failed"
            matrix = list(IDENTITY_H)
        elif "interpolated_from_frame_idx" in diagnostics:
            method = "interpolated_gap"
            matrix = np.asarray(frame.pitch_to_image, dtype=np.float64).reshape(-1).tolist()
        elif "held_from_frame_idx" in diagnostics:
            method = "held_short_gap"
            matrix = np.asarray(frame.pitch_to_image, dtype=np.float64).reshape(-1).tolist()
        else:
            method = "pnlcalib"
            matrix = np.asarray(frame.pitch_to_image, dtype=np.float64).reshape(-1).tolist()
        return HomographyFrame(
            tMs=timestamp_ms,
            matrix=matrix,
            method=method,
        )
