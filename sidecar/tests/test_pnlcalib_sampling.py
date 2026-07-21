import cv2
import numpy as np
import pytest

from annotate_sidecar.services.calibration.providers.pnlcalib import PnLCalibCalibrationProvider


def test_sampled_clip_uses_the_requested_source_frames(tmp_path):
    source_path = tmp_path / "source.avi"
    writer = cv2.VideoWriter(
        str(source_path),
        cv2.VideoWriter_fourcc(*"MJPG"),
        10.0,
        (64, 48),
    )
    assert writer.isOpened()
    for frame_index in range(20):
        writer.write(np.full((48, 64, 3), frame_index * 10, dtype=np.uint8))
    writer.release()

    output_path = tmp_path / "sampled.mp4"
    timestamps = PnLCalibCalibrationProvider()._write_sampled_clip(
        video_path=str(source_path),
        start_ms=200,
        end_ms=1200,
        fps=2,
        output_path=output_path,
    )

    assert timestamps == [200, 700.0, 1200.0]
    capture = cv2.VideoCapture(str(output_path))
    means = []
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        means.append(float(frame.mean()))
    capture.release()

    assert len(means) == 3
    assert means == pytest.approx([20, 70, 120], abs=12)
