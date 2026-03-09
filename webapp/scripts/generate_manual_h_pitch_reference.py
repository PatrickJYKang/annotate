#!/usr/bin/env python3
"""Generate a pitch reference SVG for manual homography keypoints.

Outputs an image that shows:
- Canonical pitch orientation (top/bottom/left/right)
- Abbreviation markers on the pitch
- A legend mapping each abbreviation to full meaning
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from html import escape
from pathlib import Path


# Keep these aligned with ClipEditor.tsx
PITCH_MIN = 3.0
PITCH_MAX = 317.0
PITCH_CENTER = (PITCH_MIN + PITCH_MAX) / 2.0
FIELD_SPAN = PITCH_MAX - PITCH_MIN

PENALTY_DEPTH = FIELD_SPAN * (16.5 / 105)
SIX_YARD_DEPTH = FIELD_SPAN * (5.5 / 105)
PENALTY_HALF_WIDTH = FIELD_SPAN * ((40.32 / 2) / 68)
SIX_YARD_HALF_WIDTH = FIELD_SPAN * ((18.32 / 2) / 68)
PENALTY_SPOT_OFFSET = FIELD_SPAN * (11 / 105)
ARC_RADIUS = FIELD_SPAN * (9.15 / 105)
ARC_DX = PENALTY_DEPTH - PENALTY_SPOT_OFFSET
ARC_DY = math.sqrt(max(0.0, ARC_RADIUS * ARC_RADIUS - ARC_DX * ARC_DX))

LEFT_PENALTY_X = PITCH_MIN + PENALTY_DEPTH
RIGHT_PENALTY_X = PITCH_MAX - PENALTY_DEPTH
LEFT_SIX_X = PITCH_MIN + SIX_YARD_DEPTH
RIGHT_SIX_X = PITCH_MAX - SIX_YARD_DEPTH

PENALTY_TOP_Y = PITCH_CENTER - PENALTY_HALF_WIDTH
PENALTY_BOTTOM_Y = PITCH_CENTER + PENALTY_HALF_WIDTH
SIX_TOP_Y = PITCH_CENTER - SIX_YARD_HALF_WIDTH
SIX_BOTTOM_Y = PITCH_CENTER + SIX_YARD_HALF_WIDTH

LEFT_PENALTY_SPOT_X = PITCH_MIN + PENALTY_SPOT_OFFSET
RIGHT_PENALTY_SPOT_X = PITCH_MAX - PENALTY_SPOT_OFFSET

KEYPOINTS = [
    ("TL", "Top-left pitch corner", PITCH_MIN, PITCH_MIN),
    ("TR", "Top-right pitch corner", PITCH_MAX, PITCH_MIN),
    ("BR", "Bottom-right pitch corner", PITCH_MAX, PITCH_MAX),
    ("BL", "Bottom-left pitch corner", PITCH_MIN, PITCH_MAX),
    ("CL-T", "Center line at top touchline", PITCH_CENTER, PITCH_MIN),
    ("CL-B", "Center line at bottom touchline", PITCH_CENTER, PITCH_MAX),
    ("C-SP", "Center spot", PITCH_CENTER, PITCH_CENTER),
    ("LPA-TL", "Left penalty area top-left corner", PITCH_MIN, PENALTY_TOP_Y),
    ("LPA-TR", "Left penalty area top-right corner", LEFT_PENALTY_X, PENALTY_TOP_Y),
    ("LPA-BR", "Left penalty area bottom-right corner", LEFT_PENALTY_X, PENALTY_BOTTOM_Y),
    ("LPA-BL", "Left penalty area bottom-left corner", PITCH_MIN, PENALTY_BOTTOM_Y),
    ("RPA-TL", "Right penalty area top-left corner", RIGHT_PENALTY_X, PENALTY_TOP_Y),
    ("RPA-TR", "Right penalty area top-right corner", PITCH_MAX, PENALTY_TOP_Y),
    ("RPA-BR", "Right penalty area bottom-right corner", PITCH_MAX, PENALTY_BOTTOM_Y),
    ("RPA-BL", "Right penalty area bottom-left corner", RIGHT_PENALTY_X, PENALTY_BOTTOM_Y),
    ("LSB-TL", "Left six-yard box top-left corner", PITCH_MIN, SIX_TOP_Y),
    ("LSB-TR", "Left six-yard box top-right corner", LEFT_SIX_X, SIX_TOP_Y),
    ("LSB-BR", "Left six-yard box bottom-right corner", LEFT_SIX_X, SIX_BOTTOM_Y),
    ("LSB-BL", "Left six-yard box bottom-left corner", PITCH_MIN, SIX_BOTTOM_Y),
    ("RSB-TL", "Right six-yard box top-left corner", RIGHT_SIX_X, SIX_TOP_Y),
    ("RSB-TR", "Right six-yard box top-right corner", PITCH_MAX, SIX_TOP_Y),
    ("RSB-BR", "Right six-yard box bottom-right corner", PITCH_MAX, SIX_BOTTOM_Y),
    ("RSB-BL", "Right six-yard box bottom-left corner", RIGHT_SIX_X, SIX_BOTTOM_Y),
    ("L-PS", "Left penalty spot", LEFT_PENALTY_SPOT_X, PITCH_CENTER),
    ("R-PS", "Right penalty spot", RIGHT_PENALTY_SPOT_X, PITCH_CENTER),
    ("L-ARC-T", "Left penalty arc top point", LEFT_PENALTY_X, PITCH_CENTER - ARC_DY),
    ("L-ARC-A", "Left penalty arc apex (toward center)", LEFT_PENALTY_SPOT_X + ARC_RADIUS, PITCH_CENTER),
    ("L-ARC-B", "Left penalty arc bottom point", LEFT_PENALTY_X, PITCH_CENTER + ARC_DY),
    ("R-ARC-T", "Right penalty arc top point", RIGHT_PENALTY_X, PITCH_CENTER - ARC_DY),
    ("R-ARC-A", "Right penalty arc apex (toward center)", RIGHT_PENALTY_SPOT_X - ARC_RADIUS, PITCH_CENTER),
    ("R-ARC-B", "Right penalty arc bottom point", RIGHT_PENALTY_X, PITCH_CENTER + ARC_DY),
]


def sample_arc_left(n: int = 32):
    theta = math.acos(max(-1.0, min(1.0, (LEFT_PENALTY_X - LEFT_PENALTY_SPOT_X) / ARC_RADIUS)))
    out = []
    for i in range(n + 1):
        a = -theta + (2 * theta) * (i / n)
        x = LEFT_PENALTY_SPOT_X + ARC_RADIUS * math.cos(a)
        y = PITCH_CENTER + ARC_RADIUS * math.sin(a)
        out.append((x, y))
    return out


def sample_arc_right(n: int = 32):
    theta = math.acos(max(-1.0, min(1.0, (RIGHT_PENALTY_SPOT_X - RIGHT_PENALTY_X) / ARC_RADIUS)))
    out = []
    for i in range(n + 1):
        a = -theta + (2 * theta) * (i / n)
        x = RIGHT_PENALTY_SPOT_X - ARC_RADIUS * math.cos(a)
        y = PITCH_CENTER + ARC_RADIUS * math.sin(a)
        out.append((x, y))
    return out


def build_svg() -> str:
    width = 2000
    height = 1220
    pitch_x = 80
    pitch_y = 120
    pitch_w = 1200
    pitch_h = 980

    legend_x = 1320
    legend_y = 140
    row_h = 29

    def sx(x: float) -> float:
        return pitch_x + (x - PITCH_MIN) / FIELD_SPAN * pitch_w

    def sy(y: float) -> float:
        return pitch_y + (y - PITCH_MIN) / FIELD_SPAN * pitch_h

    parts: list[str] = []
    parts.append('<?xml version="1.0" encoding="UTF-8"?>')
    parts.append(f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">')
    parts.append('<rect width="100%" height="100%" fill="#0b1220"/>')

    # Title
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    parts.append('<text x="80" y="34" font-family="Helvetica, Arial, sans-serif" font-size="34" font-weight="700" fill="#f8fafc">Manual Homography Pitch Reference</text>')
    parts.append(f'<text x="80" y="68" font-family="Helvetica, Arial, sans-serif" font-size="16" fill="#cbd5e1">Orientation + abbreviation map ({len(KEYPOINTS)} keypoints) — {escape(ts)}</text>')

    # Orientation hints
    parts.append(f'<text x="{pitch_x + pitch_w/2}" y="88" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="18" fill="#93c5fd">TOP touchline (y = min; often far-side in broadcast view)</text>')
    parts.append(f'<text x="{pitch_x + pitch_w/2}" y="{pitch_y + pitch_h + 36}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="18" fill="#93c5fd">BOTTOM touchline (y = max; often near-side in broadcast view)</text>')
    parts.append(f'<text x="26" y="{pitch_y + pitch_h/2}" transform="rotate(-90 26 {pitch_y + pitch_h/2})" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="18" fill="#93c5fd">LEFT goal side (x = min)</text>')
    parts.append(f'<text x="{pitch_x + pitch_w + 52}" y="{pitch_y + pitch_h/2}" transform="rotate(90 {pitch_x + pitch_w + 52} {pitch_y + pitch_h/2})" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="18" fill="#93c5fd">RIGHT goal side (x = max)</text>')

    # Pitch base
    parts.append(f'<rect x="{pitch_x}" y="{pitch_y}" width="{pitch_w}" height="{pitch_h}" fill="#166534" stroke="#e2e8f0" stroke-width="4"/>')

    # Halfway line + center circle
    parts.append(f'<line x1="{sx(PITCH_CENTER)}" y1="{sy(PITCH_MIN)}" x2="{sx(PITCH_CENTER)}" y2="{sy(PITCH_MAX)}" stroke="#e2e8f0" stroke-width="3"/>')
    parts.append(f'<circle cx="{sx(PITCH_CENTER)}" cy="{sy(PITCH_CENTER)}" r="{(ARC_RADIUS / FIELD_SPAN) * pitch_w}" fill="none" stroke="#e2e8f0" stroke-width="3"/>')

    # Penalty + six-yard rectangles
    def draw_rect(x1: float, y1: float, x2: float, y2: float):
        x = sx(min(x1, x2))
        y = sy(min(y1, y2))
        w = abs(sx(x2) - sx(x1))
        h = abs(sy(y2) - sy(y1))
        parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="none" stroke="#e2e8f0" stroke-width="3"/>')

    draw_rect(PITCH_MIN, PENALTY_TOP_Y, LEFT_PENALTY_X, PENALTY_BOTTOM_Y)
    draw_rect(RIGHT_PENALTY_X, PENALTY_TOP_Y, PITCH_MAX, PENALTY_BOTTOM_Y)
    draw_rect(PITCH_MIN, SIX_TOP_Y, LEFT_SIX_X, SIX_BOTTOM_Y)
    draw_rect(RIGHT_SIX_X, SIX_TOP_Y, PITCH_MAX, SIX_BOTTOM_Y)

    # Spots
    parts.append(f'<circle cx="{sx(PITCH_CENTER)}" cy="{sy(PITCH_CENTER)}" r="4" fill="#e2e8f0"/>')
    parts.append(f'<circle cx="{sx(LEFT_PENALTY_SPOT_X)}" cy="{sy(PITCH_CENTER)}" r="4" fill="#e2e8f0"/>')
    parts.append(f'<circle cx="{sx(RIGHT_PENALTY_SPOT_X)}" cy="{sy(PITCH_CENTER)}" r="4" fill="#e2e8f0"/>')

    # Penalty arcs
    left_arc = " ".join(f"{sx(x)},{sy(y)}" for x, y in sample_arc_left())
    right_arc = " ".join(f"{sx(x)},{sy(y)}" for x, y in sample_arc_right())
    parts.append(f'<polyline points="{left_arc}" fill="none" stroke="#e2e8f0" stroke-width="3"/>')
    parts.append(f'<polyline points="{right_arc}" fill="none" stroke="#e2e8f0" stroke-width="3"/>')

    # Axis inset
    inset_x = 98
    inset_y = 980
    parts.append(f'<rect x="{inset_x}" y="{inset_y}" width="220" height="98" fill="#0f172a" stroke="#334155" stroke-width="1.5"/>')
    parts.append(f'<line x1="{inset_x + 34}" y1="{inset_y + 70}" x2="{inset_x + 182}" y2="{inset_y + 70}" stroke="#f59e0b" stroke-width="2.5"/>')
    parts.append(f'<line x1="{inset_x + 34}" y1="{inset_y + 70}" x2="{inset_x + 34}" y2="{inset_y + 26}" stroke="#60a5fa" stroke-width="2.5"/>')
    parts.append(f'<text x="{inset_x + 190}" y="{inset_y + 74}" font-family="Helvetica, Arial, sans-serif" font-size="14" fill="#f59e0b">+x (right)</text>')
    parts.append(f'<text x="{inset_x + 8}" y="{inset_y + 20}" font-family="Helvetica, Arial, sans-serif" font-size="14" fill="#60a5fa">-y (up)</text>')
    parts.append(f'<text x="{inset_x + 8}" y="{inset_y + 92}" font-family="Helvetica, Arial, sans-serif" font-size="14" fill="#93c5fd">y increases downward on image</text>')

    # Keypoint markers + abbreviations
    for label, tooltip, x, y in KEYPOINTS:
        px = sx(x)
        py = sy(y)
        parts.append(f'<circle cx="{px}" cy="{py}" r="5" fill="#f97316" stroke="#111827" stroke-width="1.3"/>')

        lx = px + (8 if x <= PITCH_CENTER else -66)
        ly = py + (14 if y <= PITCH_CENTER else -8)
        parts.append(
            f'<text x="{lx}" y="{ly}" font-family="Helvetica, Arial, sans-serif" font-size="12" '
            f'font-weight="700" fill="#fbbf24">{escape(label)}</text>'
        )

    # Legend panel
    legend_w = width - legend_x - 40
    legend_h = 34 + row_h * len(KEYPOINTS)
    parts.append(f'<rect x="{legend_x}" y="{legend_y}" width="{legend_w}" height="{legend_h}" fill="#111827" stroke="#334155" stroke-width="1.5"/>')
    parts.append(f'<rect x="{legend_x}" y="{legend_y}" width="{legend_w}" height="34" fill="#1f2937"/>')
    parts.append(f'<line x1="{legend_x + 130}" y1="{legend_y}" x2="{legend_x + 130}" y2="{legend_y + legend_h}" stroke="#334155" stroke-width="1"/>')
    parts.append(f'<text x="{legend_x + 10}" y="{legend_y + 22}" font-family="Helvetica, Arial, sans-serif" font-size="15" font-weight="700" fill="#93c5fd">Abbrev</text>')
    parts.append(f'<text x="{legend_x + 142}" y="{legend_y + 22}" font-family="Helvetica, Arial, sans-serif" font-size="15" font-weight="700" fill="#93c5fd">Meaning</text>')

    for i, (label, tooltip, _x, _y) in enumerate(KEYPOINTS):
        y = legend_y + 34 + i * row_h
        if i % 2 == 0:
            parts.append(f'<rect x="{legend_x}" y="{y}" width="{legend_w}" height="{row_h}" fill="#0b1220"/>')
        parts.append(f'<text x="{legend_x + 10}" y="{y + 20}" font-family="Helvetica, Arial, sans-serif" font-size="13" font-weight="700" fill="#f59e0b">{escape(label)}</text>')
        parts.append(f'<text x="{legend_x + 142}" y="{y + 20}" font-family="Helvetica, Arial, sans-serif" font-size="13" fill="#e2e8f0">{escape(tooltip)}</text>')

    parts.append('</svg>')
    return "\n".join(parts)


def main() -> int:
    out_path = Path(__file__).resolve().parent.parent / "public" / "manual-h-pitch-reference.svg"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(build_svg(), encoding="utf-8")
    print(f"Wrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
