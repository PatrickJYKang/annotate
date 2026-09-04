# Annotate logo

Final mark, cleaned up from `../logo-concepts` round 4 and `ref.svg`.

| File | Use |
| --- | --- |
| `mark.svg` | White mark for dark backgrounds (the app UI). |
| `mark-on-light.svg` | Navy mark for light backgrounds (docs, README). |
| `icon.svg` | Square app icon / favicon source on the canvas colour. |
| `preview.svg` | Sizes and backgrounds side by side. |

## Geometry

Drawn on a 188 x 160 grid. Every diagonal has the same 1:2 slope
(1 unit across for 2 units down), and every stroke is 28 units wide
measured horizontally (25 units perpendicular).

- A body (left leg, flat apex, upper right leg): `M80 0H108L134 52H106L94 28L28 160H0Z`
- Lower right leg: `M133 106H161L188 160H160Z`
- Arrow: `M71 96H156L139 62H111L118 76H81Z`

Arrow edges, going clockwise from the bottom-left corner:
bottom edge y=96 from x=71 to the tip at x=156; tip diagonal up to
(139, 62) on the right leg's outer line; flat top to (111, 62); rise down
to (118, 76) on the right leg's inner line; shaft top back to (81, 76);
left end down to (71, 96), parallel to the left leg. The arrowhead is
therefore the missing 28-wide segment of the right leg, and the shaft
is 20 units tall.

Gaps: 10 units above and below the arrow to the two right-leg pieces,
and 11 units horizontally (10 perpendicular) to the inside of the left leg.

## Colours

Single colour. White `#ffffff` on the app canvas `#0a0f18`
(from `webapp/app/globals.css`); canvas navy on light backgrounds.
