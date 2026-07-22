import cv2
import numpy as np

from annotate_sidecar.vendor.trackers.core.ultralytics_ocsort import _iter_video_samples


class FakeCapture:
    def __init__(self):
        self.position = 0
        self.set_calls: list[tuple[int, float]] = []

    def set(self, prop: int, value: float) -> bool:
        self.set_calls.append((prop, value))
        if prop == cv2.CAP_PROP_POS_FRAMES:
            self.position = int(round(value))
        elif prop == cv2.CAP_PROP_POS_MSEC:
            self.position = int(np.floor(value * 30 / 1000 + 0.5))
        return True

    def get(self, prop: int) -> float:
        if prop == cv2.CAP_PROP_POS_FRAMES:
            return float(self.position)
        return 0.0

    def read(self):
        frame = np.asarray([self.position], dtype=np.int64)
        self.position += 1
        return True, frame


def test_dense_tracking_samples_seek_once_then_decode_sequentially():
    capture = FakeCapture()

    samples = list(_iter_video_samples(capture, [1000.0, 1100.0, 1200.0], 10.0))

    assert capture.set_calls == [(cv2.CAP_PROP_POS_FRAMES, 10)]
    assert [int(frame[0]) for _, frame in samples] == [10, 11, 12]


def test_sparse_tracking_samples_keep_direct_timestamp_seeking():
    capture = FakeCapture()

    samples = list(_iter_video_samples(capture, [0.0, 1000.0, 2000.0], 30.0))

    assert capture.set_calls == [
        (cv2.CAP_PROP_POS_MSEC, 0.0),
        (cv2.CAP_PROP_POS_MSEC, 1000.0),
        (cv2.CAP_PROP_POS_MSEC, 2000.0),
    ]
    assert [int(frame[0]) for _, frame in samples] == [0, 30, 60]
