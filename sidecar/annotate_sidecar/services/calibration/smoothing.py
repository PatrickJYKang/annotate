from __future__ import annotations

from dataclasses import replace

from ..homography_estimator import HomographyFrame

SHORT_FAILED_GAP_MAX_FRAMES = 2


def is_usable_homography_frame(frame: HomographyFrame) -> bool:
    return frame.method != "failed"


def fill_short_failed_gaps(
    frames: list[HomographyFrame],
    max_failed_gap_frames: int = SHORT_FAILED_GAP_MAX_FRAMES,
) -> list[HomographyFrame]:
    """
    Conservatively bridge very short failed runs by holding the nearest
    usable matrix. Longer failures stay explicit.
    """
    if len(frames) <= 1 or max_failed_gap_frames <= 0:
        return list(frames)

    smoothed = list(frames)
    index = 0
    while index < len(smoothed):
        if is_usable_homography_frame(smoothed[index]):
            index += 1
            continue

        start = index
        while index < len(smoothed) and not is_usable_homography_frame(smoothed[index]):
            index += 1
        end = index
        gap_len = end - start
        if gap_len > max_failed_gap_frames:
            continue

        left = smoothed[start - 1] if start - 1 >= 0 and is_usable_homography_frame(smoothed[start - 1]) else None
        right = smoothed[end] if end < len(smoothed) and is_usable_homography_frame(smoothed[end]) else None
        template = left or right
        if template is None:
            continue

        fill_method = "held_short_gap"
        for fill_index in range(start, end):
            smoothed[fill_index] = replace(
                smoothed[fill_index],
                matrix=list(template.matrix),
                method=fill_method,
            )

    return smoothed
