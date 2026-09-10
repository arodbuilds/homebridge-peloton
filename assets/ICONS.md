# homebridge-peloton — icon assets

Direction 3A "Throw weight": a dumbbell whose bar is the switch track, with the solid
square thrown to the on end. Same 192 grid and line weight as `homebridge-notify-switch`,
on an oxide-red field instead of steel.

## Colors

| Role | Hex |
| --- | --- |
| Field | `#6E2220` (oxide red — deliberately not Peloton's brand red) |
| Mark | `#F2F2F3` |
| Light variant ink | `#8E2C26` on `#F2F2F3` |

## Files

| File | Use |
| --- | --- |
| `peloton-dark.svg` | 192 × 192 tile as it ships (mark on oxide field) |
| `peloton-light.svg` | 192 × 192 light-ground variant |
| `peloton-mark.svg` | mark alone, `currentColor`, no field |
| `peloton-footer.svg` | 24-grid line glyph for the settings-page footer, `currentColor` |
| `peloton-512.png` | 512 × 512 raster — npm / plugin listing |
| `peloton-192.png` | 192 × 192 raster — plugins list |
| `peloton-banner.png` | 1280 × 320 README banner |
| `peloton-social.png` | 1280 × 640 GitHub social preview |

## Geometry (192 grid, artwork square)

- Weights: `30 × 76` at `(22, 58)` and `(140, 58)`, stroke `12`
- Bar: `y 96`, `x 52 → 140`, stroke `14`, butt cap
- Square: `32 × 32` at `(62, 80)`, solid
- Minimum size `32px`; below that drop the bar to stroke `12`

Artwork is drawn square — the Homebridge UI rounds the corners itself, so do not
pre-round the PNGs.

## Footer glyph

`peloton-footer.svg` is drawn on a 24 grid at stroke `1.5` and inherits `currentColor`,
so it takes the settings UI's text color in both light and dark themes. Render at 20px
in the footer row:

```html
<img src="peloton-footer.svg" width="20" height="20" alt="">
Peloton v1.0.0 · Made by Alex Rodriguez · …
```

Inline the SVG instead of using `<img>` if you need `currentColor` to follow the theme.
