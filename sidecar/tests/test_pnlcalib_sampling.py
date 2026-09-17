import cv2
import numpy as np
import pytest
from annotate_sidecar.vendor.trackers.calibration.types import CalibrationFrame

from annotate_sidecar.services.calibration.providers.pnlcalib import PnLCalibCalibrationProvider
from annotate_sidecar.services.calibration.types import CalibrationFrameRange


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


def test_sampled_calibration_reuses_provider_and_keeps_absolute_times(monkeypatch, tmp_path):
    source = tmp_path / 'source.avi'
    writer = cv2.VideoWriter(str(source), cv2.VideoWriter_fourcc(*'MJPG'), 10, (64, 48))
    for index in range(20):
        writer.write(np.full((48, 64, 3), index * 10, dtype=np.uint8))
    writer.release()
    provider = PnLCalibCalibrationProvider()
    built, calls = [], []
    class FakeCalibrator:
        def calibrate_frames(self, samples, **kwargs):
            calls.append({**kwargs, 'means': [None if frame is None else frame.mean() for frame in samples]})
            return [CalibrationFrame(frame_idx=index + 1, timestamp_s=index / kwargs['fps']) for index in range(kwargs['total_frames'])]
    def build(**kwargs):
        built.append(kwargs)
        return FakeCalibrator()
    monkeypatch.setattr(provider, '_build_calibrator', build)
    frames = provider.estimate_range(str(source), 200, 1200, fps=5, skip_interval=1)
    assert [frame.tMs for frame in frames] == [200, 400, 600, 800, 1000, 1200]
    assert calls[0]['means'][::2] == pytest.approx([20, 60, 100], abs=12)
    assert calls[0]['means'][1::2] == [None, None, None]
    provider.estimate_range(str(source), 200, 1200, fps=5, skip_interval=2)
    assert len(built) == 1
    assert calls[1]['every_n_frames'] == 3


def test_calibrate_frames_preserves_sampling_progress_and_failed_frame_slots(monkeypatch):
    from annotate_sidecar.vendor.trackers.calibration.providers.pnlcalib import PnLCalibProvider
    provider = PnLCalibProvider(config_data={'smoothing': {'enabled': False}})
    monkeypatch.setattr(provider, '_ensure_runtime', lambda: {'FramebyFrameCalib': lambda **kwargs: object()})
    monkeypatch.setattr(provider, '_ensure_models', lambda: (object(), object()))
    inferred = []
    def infer(**kwargs):
        inferred.append(kwargs['frame_idx'])
        return CalibrationFrame(frame_idx=kwargs['frame_idx'], timestamp_s=kwargs['timestamp_s'])
    monkeypatch.setattr(provider, '_run_frame_inference', infer)
    progress = []
    frames = provider.calibrate_frames(
        [np.zeros((48, 64, 3)), None, None, None, np.zeros((48, 64, 3))],
        frame_width=64, frame_height=48, fps=5, total_frames=5, every_n_frames=2, on_progress=progress.append,
    )
    assert inferred == [1, 5]
    assert frames[2].diagnostics == {'sampled': True, 'reason': 'decode_failed'}
    assert [frame.frame_idx for frame in frames] == [1, 2, 3, 4, 5]
    assert progress[-1] == {'phase': 'interpolating', 'completed': 3, 'total': 3}


def test_progress_can_cancel_before_models_load(monkeypatch):
    from annotate_sidecar.vendor.trackers.calibration.providers.pnlcalib import PnLCalibProvider
    provider = PnLCalibProvider()
    monkeypatch.setattr(provider, '_ensure_models', lambda: pytest.fail('Canceled work must not load models'))
    def cancel(progress):
        raise RuntimeError('canceled')
    with pytest.raises(RuntimeError, match='canceled'):
        provider.calibrate_frames([], frame_width=64, frame_height=48, fps=5, total_frames=0, every_n_frames=1, on_progress=cancel)


@pytest.mark.parametrize('fps', [24, 25, 30, 60000 / 1001])
def test_clip_homography_samples_exact_source_frames_and_excludes_end(monkeypatch, tmp_path, fps):
    source = tmp_path / 'source.avi'
    writer = cv2.VideoWriter(str(source), cv2.VideoWriter_fourcc(*'MJPG'), fps, (64, 48))
    for index in range(64):
        writer.write(np.full((48, 64, 3), index * 3, dtype=np.uint8))
    writer.release()
    calls = []

    class FakeCalibrator:
        def calibrate_frames(self, samples, **kwargs):
            calls.append({**kwargs, 'means': [None if frame is None else frame.mean() for frame in samples]})
            return [CalibrationFrame(frame_idx=index + 1, timestamp_s=index / kwargs['fps']) for index in range(kwargs['total_frames'])]

    provider = PnLCalibCalibrationProvider()
    monkeypatch.setattr(provider, '_build_calibrator', lambda **kwargs: FakeCalibrator())
    result = provider.estimate_range(str(source), 0, 1, frame_range=CalibrationFrameRange(7, 62, fps, 15))
    assert [round(frame.tMs * fps / 1000) for frame in result] == list(range(7, 62, 3))
    assert calls[0]['every_n_frames'] == 5
    assert calls[0]['means'][::5] == pytest.approx([index * 3 for index in (7, 22, 37, 52)], abs=12)
