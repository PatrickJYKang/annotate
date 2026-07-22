from math import hypot
from typing import Optional

from .types import BBox


def bbox_intersection_area(a: BBox, b: BBox) -> float:
    ax1, ay1, ax2, ay2 = a.x, a.y, a.x + a.w, a.y + a.h
    bx1, by1, bx2, by2 = b.x, b.y, b.x + b.w, b.y + b.h
    ix1 = max(ax1, bx1)
    iy1 = max(ay1, by1)
    ix2 = min(ax2, bx2)
    iy2 = min(ay2, by2)
    return max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)


def bbox_iou(a: BBox, b: BBox) -> float:
    """Compute intersection-over-union of two bboxes."""

    inter = bbox_intersection_area(a, b)
    union = a.w * a.h + b.w * b.h - inter
    return inter / union if union > 0 else 0.0


def bbox_contains_point(bbox: BBox, x: float, y: float) -> bool:
    return bbox.x <= x <= (bbox.x + bbox.w) and bbox.y <= y <= (bbox.y + bbox.h)


def bbox_center_distance(a: BBox, b: BBox) -> float:
    acx = a.x + a.w / 2
    acy = a.y + a.h / 2
    bcx = b.x + b.w / 2
    bcy = b.y + b.h / 2
    return hypot(acx - bcx, acy - bcy)


def bbox_bottom_center(bbox: BBox) -> tuple[float, float]:
    return (bbox.x + bbox.w / 2, bbox.y + bbox.h)


def bbox_bottom_center_distance_to_point(bbox: BBox, x: float, y: float) -> float:
    bcx, bcy = bbox_bottom_center(bbox)
    return hypot(bcx - x, bcy - y)


def find_best_iou_match(
    detections: list[BBox],
    user_bbox: BBox,
    iou_threshold: float = 0.3,
) -> Optional[int]:
    if not detections:
        return None

    seed_fx, seed_fy = bbox_bottom_center(user_bbox)

    foot_candidates: list[tuple[float, float, float, int]] = []
    for i, det in enumerate(detections):
        if bbox_contains_point(det, seed_fx, seed_fy):
            foot_candidates.append((
                -bbox_iou(det, user_bbox),
                bbox_bottom_center_distance_to_point(det, seed_fx, seed_fy),
                -det.confidence,
                i,
            ))
    if foot_candidates:
        foot_candidates.sort()
        return foot_candidates[0][3]

    relaxed_foot_candidates: list[tuple[float, float, float, int]] = []
    seed_width_tolerance = max(12.0, user_bbox.w * 1.5)
    seed_height_tolerance = max(20.0, user_bbox.h * 2.0)
    for i, det in enumerate(detections):
        det_fx, det_fy = bbox_bottom_center(det)
        dx = abs(det_fx - seed_fx)
        dy = abs(det_fy - seed_fy)
        if dx <= seed_width_tolerance and dy <= seed_height_tolerance:
            relaxed_foot_candidates.append((
                bbox_bottom_center_distance_to_point(det, seed_fx, seed_fy),
                -det.confidence,
                -bbox_iou(det, user_bbox),
                i,
            ))
    if relaxed_foot_candidates:
        relaxed_foot_candidates.sort()
        return relaxed_foot_candidates[0][3]

    best_idx = None
    best_iou = 0.0
    for i, det in enumerate(detections):
        score = bbox_iou(det, user_bbox)
        if score > best_iou:
            best_iou = score
            best_idx = i

    if best_iou >= iou_threshold:
        return best_idx

    seed_area = user_bbox.w * user_bbox.h
    if seed_area <= 0:
        return None

    coverage_candidates: list[tuple[float, float, float, int]] = []
    seed_cx = user_bbox.x + user_bbox.w / 2
    seed_cy = user_bbox.y + user_bbox.h / 2
    for i, det in enumerate(detections):
        inter = bbox_intersection_area(det, user_bbox)
        seed_coverage = inter / seed_area
        if seed_coverage >= 0.5:
            coverage_candidates.append((
                seed_coverage,
                -bbox_center_distance(det, user_bbox),
                det.confidence,
                i,
            ))
    if coverage_candidates:
        coverage_candidates.sort(reverse=True)
        return coverage_candidates[0][3]

    center_candidates: list[tuple[float, float, int]] = []
    for i, det in enumerate(detections):
        if bbox_contains_point(det, seed_cx, seed_cy):
            center_candidates.append((
                bbox_iou(det, user_bbox),
                -bbox_center_distance(det, user_bbox),
                i,
            ))
    if center_candidates:
        center_candidates.sort(reverse=True)
        return center_candidates[0][2]

    nearest_idx = min(
        range(len(detections)),
        key=lambda index: (
            bbox_bottom_center_distance_to_point(detections[index], seed_fx, seed_fy),
            -detections[index].confidence,
        ),
    )
    nearest_distance = bbox_bottom_center_distance_to_point(detections[nearest_idx], seed_fx, seed_fy)
    maximum_fallback_distance = max(48.0, user_bbox.w * 1.5, user_bbox.h * 3.0)
    return nearest_idx if nearest_distance <= maximum_fallback_distance else None
