#!/usr/bin/env python
"""Build the Annotate wordmark and 'a' mark from the app's UI font.

Reads IBM Plex Sans Variable from webapp/node_modules, instances it at the
chosen weight, shapes the text with HarfBuzz (so kerning matches the
browser), converts the glyphs to SVG outlines, writes the SVGs, and renders
PNGs with ImageMagick.

Needs: fonttools, brotli, uharfbuzz (pip) and `magick` on PATH.
Run from anywhere:  python brand/wordmark/tools/build.py
"""
import os, subprocess, shutil
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen
import uharfbuzz as hb

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)
REPO = os.path.abspath(os.path.join(OUT, "..", ".."))
SRC = os.path.join(REPO, "webapp/node_modules/@fontsource-variable/ibm-plex-sans/files/ibm-plex-sans-latin-wght-normal.woff2")

WEIGHT = 700          # IBM Plex Sans Bold
ALT_WEIGHT = 600      # kept in preview for comparison
TRACKING = 0          # font units added between glyphs (1000 upm)
CANVAS, WHITE, NAVY = "#0a0f18", "#ffffff", "#0a0f18"

def instance(wght):
    f = TTFont(SRC); f.flavor = None
    return instancer.instantiateVariableFont(f, {"wght": wght})

def shape(tt, text, tracking=0):
    tmp = os.path.join(HERE, ".tmp.ttf"); tt.save(tmp)
    face = hb.Face(hb.Blob.from_file_path(tmp)); font = hb.Font(face)
    buf = hb.Buffer(); buf.add_str(text); buf.guess_segment_properties()
    hb.shape(font, buf, {"kern": True, "liga": True})
    os.remove(tmp)
    order = tt.getGlyphOrder(); out, x = [], 0
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        out.append((order[info.codepoint], x + pos.x_offset, pos.y_offset))
        x += pos.x_advance + tracking
    return out

def bounds(tt, glyphs):
    gs = tt.getGlyphSet(); bp = BoundsPen(gs)
    for n, gx, gy in glyphs:
        gs[n].draw(TransformPen(bp, (1, 0, 0, 1, gx, gy)))
    return bp.bounds

def path(tt, glyphs, scale, ox, baseline):
    gs = tt.getGlyphSet()
    pen = SVGPathPen(gs, ntos=lambda v: f"{round(v, 2):g}")
    for n, gx, gy in glyphs:
        gs[n].draw(TransformPen(pen, (scale, 0, 0, -scale, ox + gx * scale, baseline - gy * scale)))
    return pen.getCommands()

def fitted(tt, glyphs, box_w, box_h, target_w=None, target_h=None):
    """Scale glyphs to target width or height and centre their bounding box in box_w x box_h."""
    x0, y0, x1, y1 = bounds(tt, glyphs)
    scale = target_w / (x1 - x0) if target_w else target_h / (y1 - y0)
    w, h = (x1 - x0) * scale, (y1 - y0) * scale
    ox = (box_w - w) / 2 - x0 * scale
    baseline = (box_h - h) / 2 + y1 * scale
    return path(tt, glyphs, scale, ox, baseline), scale

def tight(tt, glyphs, scale, pad):
    x0, y0, x1, y1 = bounds(tt, glyphs)
    w, h = (x1 - x0) * scale + 2 * pad, (y1 - y0) * scale + 2 * pad
    d = path(tt, glyphs, scale, pad - x0 * scale, pad + y1 * scale)
    return d, round(w, 2), round(h, 2)

def svg(w, h, body, title, desc, bg=None):
    rect = f'\n  <rect width="{w}" height="{h}" fill="{bg}"/>' if bg else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" role="img" aria-labelledby="title desc">\n'
            f'  <title id="title">{title}</title>\n  <desc id="desc">{desc}</desc>{rect}\n{body}\n</svg>\n')

def write(name, content):
    p = os.path.join(OUT, name); os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, "w").write(content); return p

def render(src, dst, size=None, width=None, density=288):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    resize = f"{size}x{size}" if size else f"{width}x"
    subprocess.run(["magick", "-density", str(density), "-background", "none", src, "-resize", resize, dst], check=True)

def main():
    tt = instance(WEIGHT); alt = instance(ALT_WEIGHT)
    word = shape(tt, "annotate", TRACKING); word_alt = shape(alt, "annotate", TRACKING)
    a = shape(tt, "a")

    # Transparent wordmarks, 0.2 scale (200 px em), 20 px padding
    d, w, h = tight(tt, word, 0.2, 20)
    write("annotate.svg", svg(w, h, f'  <path fill="{WHITE}" d="{d}"/>', "annotate", "The Annotate wordmark, IBM Plex Sans Bold, for dark backgrounds."))
    write("annotate-on-light.svg", svg(w, h, f'  <path fill="{NAVY}" d="{d}"/>', "annotate", "The Annotate wordmark, IBM Plex Sans Bold, for light backgrounds."))

    # Square lockup: word at 74% of the side, centred (profile picture / social)
    d, _ = fitted(tt, word, 400, 400, target_w=296)
    write("annotate-square.svg", svg(400, 400, f'  <path fill="{WHITE}" d="{d}"/>', "annotate", "Square wordmark lockup on the app canvas colour.", bg=CANVAS))

    # 'a' mark
    d, w, h = tight(tt, a, 0.2, 20)
    write("a.svg", svg(w, h, f'  <path fill="{WHITE}" d="{d}"/>', "a", "Abbreviated Annotate mark: lowercase a, for dark backgrounds."))
    write("a-on-light.svg", svg(w, h, f'  <path fill="{NAVY}" d="{d}"/>', "a", "Abbreviated Annotate mark: lowercase a, for light backgrounds."))
    d, _ = fitted(tt, a, 240, 240, target_h=140)
    write("a-icon.svg", svg(240, 240, f'  <path fill="{WHITE}" d="{d}"/>', "a", "Square icon / favicon source: lowercase a on the app canvas colour.", bg=CANVAS))
    d, _ = fitted(tt, a, 400, 400, target_h=200)
    write("a-square.svg", svg(400, 400, f'  <path fill="{WHITE}" d="{d}"/>', "a", "Square profile picture: lowercase a on the app canvas colour, padded for a round crop.", bg=CANVAS))

    # Preview sheet
    d7, _ = fitted(tt, word, 620, 200, target_w=560)
    d6, _ = fitted(alt, word_alt, 620, 200, target_w=560)
    dsq, _ = fitted(tt, word, 260, 260, target_w=192)
    da, _ = fitted(tt, a, 260, 260, target_h=130)
    dl, _ = fitted(tt, word, 620, 160, target_w=560)
    body = f"""  <rect width="1000" height="760" fill="#151e2b"/>
  <g transform="translate(40 40)"><rect width="620" height="200" fill="{CANVAS}"/><path fill="{WHITE}" d="{d7}"/></g>
  <text x="40" y="262" fill="#a7b1bf" font-family="IBM Plex Sans, Helvetica, Arial, sans-serif" font-size="13">Weight 700 (primary)</text>
  <g transform="translate(40 290)"><rect width="620" height="200" fill="{CANVAS}"/><path fill="{WHITE}" d="{d6}"/></g>
  <text x="40" y="512" fill="#a7b1bf" font-family="IBM Plex Sans, Helvetica, Arial, sans-serif" font-size="13">Weight 600 (alternate)</text>
  <g transform="translate(40 540)"><rect width="620" height="160" fill="{WHITE}"/><path fill="{NAVY}" d="{dl}"/></g>
  <text x="40" y="722" fill="#a7b1bf" font-family="IBM Plex Sans, Helvetica, Arial, sans-serif" font-size="13">On light</text>
  <g transform="translate(700 40)"><rect width="260" height="260" fill="{CANVAS}"/><path fill="{WHITE}" d="{dsq}"/><circle cx="130" cy="130" r="130" fill="none" stroke="#67aaf0" stroke-dasharray="4 4"/></g>
  <text x="700" y="322" fill="#a7b1bf" font-family="IBM Plex Sans, Helvetica, Arial, sans-serif" font-size="13">annotate-square (dashed: round crop)</text>
  <g transform="translate(700 350)"><rect width="260" height="260" fill="{CANVAS}"/><path fill="{WHITE}" d="{da}"/><circle cx="130" cy="130" r="130" fill="none" stroke="#67aaf0" stroke-dasharray="4 4"/></g>
  <text x="700" y="632" fill="#a7b1bf" font-family="IBM Plex Sans, Helvetica, Arial, sans-serif" font-size="13">a-square (dashed: round crop)</text>"""
    write("preview.svg", f'<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="760" viewBox="0 0 1000 760">\n{body}\n</svg>\n')

    # Renders
    R = os.path.join(OUT, "renders")
    shutil.rmtree(R, ignore_errors=True)
    for s in (400, 800):
        render(os.path.join(OUT, "annotate-square.svg"), f"{R}/social/annotate-profile-{s}.png", size=s)
        render(os.path.join(OUT, "a-square.svg"), f"{R}/social/a-profile-{s}.png", size=s)
    for s in (16, 32, 48, 64, 192, 512):
        render(os.path.join(OUT, "a-icon.svg"), f"{R}/favicon/icon-{s}.png", size=s)
    render(os.path.join(OUT, "a-icon.svg"), f"{R}/favicon/apple-touch-icon-180.png", size=180)
    subprocess.run(["magick", f"{R}/favicon/icon-16.png", f"{R}/favicon/icon-32.png", f"{R}/favicon/icon-48.png", f"{R}/favicon/favicon.ico"], check=True)
    shutil.copy(os.path.join(OUT, "a-icon.svg"), f"{R}/favicon/icon.svg")
    render(os.path.join(OUT, "annotate.svg"), f"{R}/annotate-dark-2000.png", width=2000)
    render(os.path.join(OUT, "annotate-on-light.svg"), f"{R}/annotate-light-2000.png", width=2000)
    print("done")

if __name__ == "__main__":
    main()
