from typing import Optional

from .types import BBox


def bbox_iou(a: BBox, b: BBox) -> float:
    """Compute intersection-over-union of two bboxes."""

    ax1, ay1, ax2, ay2 = a.x, a.y, a.x + a.w, a.y + a.h
    bx1, by1, bx2, by2 = b.x, b.y, b.x + b.w, b.y + b.h
    ix1 = max(ax1, bx1)
    iy1 = max(ay1, by1)
    ix2 = min(ax2, bx2)
    iy2 = min(ay2, by2)
    iw = max(0, ix2 - ix1)
    ih = max(0, iy2 - iy1)
    inter = iw * ih
    union = a.w * a.h + b.w * b.h - inter
    return inter / union if union > 0 else 0.0


def find_best_iou_match(
    detections: list[BBox],
    user_bbox: BBox,
    iou_threshold: float = 0.3,
) -> Optional[int]:
    best_idx = None
    best_iou = 0.0
    for i, det in enumerate(detections):
        score = bbox_iou(det, user_bbox)
        if score > best_iou:
            best_iou = score
            best_idx = i

    if best_iou >= iou_threshold:
        return best_idx
    return None
