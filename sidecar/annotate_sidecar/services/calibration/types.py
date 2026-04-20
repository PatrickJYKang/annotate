from __future__ import annotations

from dataclasses import dataclass


@dataclass(slots=True)
class HomographyFrame:
    """Public homography frame returned to the annotate app."""

    tMs: float
    matrix: list[float]
    method: str
