#!/usr/bin/env python3
"""Generate an SVG legend for manual homography keypoint abbreviations.

The script reads MANUAL_PITCH_KEYPOINTS from ClipEditor.tsx and outputs
an image that maps each abbreviation label to its full tooltip meaning.
"""

from __future__ import annotations

from datetime import datetime, timezone
from html import escape
from pathlib import Path
import re
import sys


RE_LABEL_TOOLTIP = re.compile(
    r"label:\s*'([^']+)'\s*,\s*tooltip:\s*'([^']+)'",
    re.MULTILINE,
)


def extract_keypoints(tsx_text: str) -> list[tuple[str, str]]:
    seen: set[str] = set()
    items: list[tuple[str, str]] = []
    for label, tooltip in RE_LABEL_TOOLTIP.findall(tsx_text):
        if label in seen:
            continue
        seen.add(label)
        items.append((label, tooltip))
    return items


def build_svg(items: list[tuple[str, str]]) -> str:
    width = 1500
    margin_x = 40
    margin_y = 36
    title_h = 38
    subtitle_h = 24
    header_h = 34
    row_h = 28
    table_top = margin_y + title_h + subtitle_h + 24
    table_h = header_h + row_h * len(items)
    height = table_top + table_h + 32

    split_x = 280

    lines: list[str] = []
    lines.append('<?xml version="1.0" encoding="UTF-8"?>')
    lines.append(
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">'
    )
    lines.append('<rect width="100%" height="100%" fill="#0f172a"/>')

    lines.append(
        f'<text x="{margin_x}" y="{margin_y}" font-size="30" '
        'font-family="Helvetica, Arial, sans-serif" fill="#f8fafc" '
        'font-weight="700" dominant-baseline="hanging">Manual Homography Keypoint Abbreviations</text>'
    )

    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines.append(
        f'<text x="{margin_x}" y="{margin_y + title_h}" font-size="17" '
        'font-family="Helvetica, Arial, sans-serif" fill="#cbd5e1" dominant-baseline="hanging">'
        f'Generated from ClipEditor MANUAL_PITCH_KEYPOINTS ({len(items)} labels) — {generated_at}</text>'
    )

    # Table container
    lines.append(
        f'<rect x="{margin_x}" y="{table_top}" width="{width - margin_x * 2}" height="{table_h}" '
        'fill="#111827" stroke="#334155" stroke-width="1.5"/>'
    )
    lines.append(
        f'<line x1="{margin_x + split_x}" y1="{table_top}" x2="{margin_x + split_x}" y2="{table_top + table_h}" '
        'stroke="#334155" stroke-width="1"/>'
    )
    lines.append(
        f'<rect x="{margin_x}" y="{table_top}" width="{width - margin_x * 2}" height="{header_h}" '
        'fill="#1f2937"/>'
    )

    lines.append(
        f'<text x="{margin_x + 14}" y="{table_top + 8}" font-size="16" font-family="Helvetica, Arial, sans-serif" '
        'fill="#93c5fd" font-weight="700">Abbrev</text>'
    )
    lines.append(
        f'<text x="{margin_x + split_x + 14}" y="{table_top + 8}" font-size="16" font-family="Helvetica, Arial, sans-serif" '
        'fill="#93c5fd" font-weight="700">Meaning</text>'
    )

    for idx, (label, tooltip) in enumerate(items):
        y = table_top + header_h + idx * row_h
        if idx % 2 == 0:
            lines.append(
                f'<rect x="{margin_x}" y="{y}" width="{width - margin_x * 2}" height="{row_h}" fill="#0b1220"/>'
            )

        lines.append(
            f'<text x="{margin_x + 14}" y="{y + 6}" font-size="15" font-family="Helvetica, Arial, sans-serif" '
            f'fill="#f59e0b" font-weight="700">{escape(label)}</text>'
        )
        lines.append(
            f'<text x="{margin_x + split_x + 14}" y="{y + 6}" font-size="15" font-family="Helvetica, Arial, sans-serif" '
            f'fill="#e2e8f0">{escape(tooltip)}</text>'
        )

    lines.append('</svg>')
    return "\n".join(lines)


def main() -> int:
    script_path = Path(__file__).resolve()
    webapp_dir = script_path.parent.parent
    src_path = webapp_dir / "components" / "clip" / "ClipEditor.tsx"
    out_path = webapp_dir / "public" / "manual-h-keypoints-legend.svg"

    if not src_path.exists():
        print(f"Error: source file not found: {src_path}", file=sys.stderr)
        return 1

    tsx_text = src_path.read_text(encoding="utf-8")
    items = extract_keypoints(tsx_text)
    if not items:
        print("Error: no keypoint label/tooltip pairs found in ClipEditor.tsx", file=sys.stderr)
        return 1

    svg = build_svg(items)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(svg, encoding="utf-8")

    print(f"Wrote {out_path} ({len(items)} entries)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
