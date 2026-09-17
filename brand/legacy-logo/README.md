# Legacy logo: the A-with-arrow mark

Retired in favour of the wordmark in `../wordmark/`. Kept for reference.

Final mark, cleaned up from `concepts/` round 4 and `ref.svg`.
Alternatives explored along the way live in `variations/`; the final is
variation 07 with the baseline trimmed from 160 to 150 so the arrow
sits lower in the letter without moving.

| File | Use |
| --- | --- |
| `mark.svg` | White mark for dark backgrounds (the app UI). |
| `mark-on-light.svg` | Navy mark for light backgrounds (docs, README). |
| `icon.svg` | Square app icon / favicon source on the canvas colour. |
| `preview.svg` | Sizes and backgrounds side by side. |
| `social/profile.svg` | Padded square source for round profile pictures. |

## Geometry

Drawn on a 148 x 150 grid. Every diagonal has the same 2:5 slope
(2 units across for 5 units down), and every stroke is 28 units wide
measured horizontally (26 units perpendicular). All key y values are
multiples of 5 so every vertex lands on an integer.

- A body (left leg, flat apex, upper right leg): `M60 0H88L102 35H74L28 150H0Z`
- Lower right leg: `M106 115H134L148 150H120Z`
- Arrow: `M57 105H130L106 45H78L92 80H67Z`

Line equations (x as a function of y): left outer `60 - 2y/5`,
left inner `88 - 2y/5`, right inner `60 + 2y/5`, right outer `88 + 2y/5`.
The inner edges meet at (74, 35), and the upper right-leg piece ends on
that same line, so it forms a solid roof.

Arrow edges, clockwise from the bottom-left corner: bottom edge y=105
from x=57 to the tip at x=130; tip diagonal up to (106, 45) on the right
leg's outer line; flat top to (78, 45); rise down to (92, 80) on the right
leg's inner line; shaft top back to (67, 80); left end down to (57, 105),
parallel to the left leg. The arrowhead is the missing 28-wide segment of
the right leg, rising 35 above a 25-tall shaft.

Gaps: 10 units above and below the arrow to the two right-leg pieces,
and 11 units horizontally (10 perpendicular) to the inside of the left leg.

## Colours

Letter white `#ffffff` on the app canvas `#0a0f18` (from
`webapp/app/globals.css`); canvas navy on light backgrounds. The arrow
takes a desaturated steel blue that changes with the mode so it stays
close to the letter's own value: `#a9bfd8` on dark, `#34557a` on light.
This is pair 03 from `colour/subtle/`.

## Renders

Rasters live in `renders/`, regenerated from the SVGs with ImageMagick
(`magick -density 288 -background none icon.svg -resize 512x512 ...`).

- `renders/favicon/` has `favicon.ico` (16, 32, 48), PNGs at 16 to 512,
  `apple-touch-icon-180.png`, and `icon.svg` for browsers that take an
  SVG favicon.
- `renders/social/` has the profile picture at 400 and 800 px, built
  from `social/profile.svg`, which pads the mark so it clears a circular
  crop. Dark mode only.
- `renders/mark-*-1000.png` are transparent marks at 1000 px wide.

## Usage note

The mark is not used inside the app UI for now. It is for the favicon
and social profiles only.
