# What canvas text can reach

Measured in headless Chromium **156.0.8078.4** (Playwright `chromium_headless_shell-1248`, macOS arm64), on a
2D canvas, drawing "Rag" (or the word named) in Fraunces 5.3.0 and Archivo 5.3.0. The direction of each finding
(does it differ or not) is asserted by `test/v2/fonts-browser.test.mjs`, so a browser that changes the answer
fails that test. The exact numbers (pixel counts, widths) come from the scratch probes
`.scratch/fonts/probe1.mjs`, `probe2.mjs` and `probe3.mjs` and are not asserted. Two findings are probe-only,
with no test: the derived `"wdth" 80` width, and the small-caps against scaled-capitals comparison; both are
marked. The `reach` flags in `index.mjs` are the per-axis summary. The looks in the next task are designed from
this page.

"Differs" means the two canvases hash differently (or, where stated, differ by that many pixels). A control
family that cannot show the effect (Archivo has no `opsz`) gives the noise floor.

## Axes

| Axis | Face | Route | Reach | Notes |
|---|---|---|---|---|
| `wght` | both | weight in `ctx.font` | yes, continuous | 100 and 900 differ. Any integer weight works. |
| `wdth` | Archivo | `ctx.fontStretch` keyword | yes, **six steps only** | See below. |
| `opsz` | Fraunces | none on `ctx`; derived family | **no** on the base family; yes through `Fraunces Text` (opsz 9) and `Fraunces Display` (opsz 144) | The base family follows the pixel size automatically. |
| `SOFT` | Fraunces | none on `ctx`; derived family | **no** on the base family; yes through `Fraunces Soft` (SOFT 100) | Two values only (0 and 100), not a ramp. |
| `WONK` | Fraunces | not exposed | not tested | The file carries it; no entry pins it. |

### `ctx.fontStretch` takes keywords, not percentages

The brief asked for `wdth` "as a percentage". Canvas does not take one: `ctx.fontStretch = '70%'` is ignored and
reads back `'normal'`. Only the nine CSS keywords work, and Archivo's axis (62-125) covers six of them:

| Keyword | wdth | Width of "Rag" at 120 px |
|---|---|---|
| `extra-condensed` | 62.5 | 147.08 |
| `condensed` | 75 | 170.76 |
| `semi-condensed` | 87.5 | 194.44 |
| `normal` | 100 | 218.12 |
| `semi-expanded` | 112.5 | 246.90 |
| `expanded` | 125 | 275.67 |

`ultra-condensed` (50) clamps to the face's 62 (146.13); `extra-expanded` and `ultra-expanded` clamp to 125
(275.67, equal to `expanded`). Animating width through this route jumps between steps. `STRETCH_KEYWORDS` in
`index.mjs` is the percent-to-keyword table.

Gotcha: assigning `ctx.font` resets `ctx.fontStretch` to `normal`. Set the stretch after the font (the
engine's `applyFont` already does).

### Pinned axes through derived families

`new FontFace('Fraunces Soft', url, { weight: '100 900', variationSettings: '"SOFT" 100' })` is honoured by this
Chromium (the descriptor reads back, and the drawing differs from the base). The same trick on Archivo
(`"wdth" 80`) changes the width of "Rag" from 218.12 to 180.23 (probe only, no test). A derived family is one fixed value of that
axis; a smooth ramp would need one family per value.

A derived `opsz` family matches the automatic optical size at the same pixel size exactly (0 differing pixels:
`Fraunces Text` against `Fraunces` at 9 px; `Fraunces Display` against `Fraunces` at 192 px, where automatic
clamps to 144), so `variationSettings` is setting `opsz` in CSS pixels, as expected.

## Optical size is automatic, and follows the unscaled pixel size

Same word, same 192 px nominal size: Fraunces at 24 px drawn under `ctx.scale(8, 8)` against 192 px at scale 1
differs by **20653 pixels**; the Archivo control differs by **0**. So canvas applies `opsz` from the font size
in `ctx.font`, not from the size on screen.

- Changing `ctx.font`'s pixel size changes the letter shapes (heavier, sturdier small text; finer, higher
  contrast large text), not just the scale.
- Zooming with `ctx.scale` (a camera move) does not change the shapes; only a font-size change does. This
  follows from the comparison above (the scaled 24 px drawing kept its 24 px shapes); it was not measured
  separately.
- `measureText` follows it: "Rag" measured at 24 px times 8 is 345.2 px wide, at 192 px it is 294.4. A
  Fraunces layout must be measured at the pixel size it is drawn at; scaling a measurement from another size is
  wrong. Archivo measures 349.0 both ways.

## Element CSS reaches every axis, but only on an attached canvas

Not in the brief, found while probing. `font-variation-settings` set on the canvas **element**
(`canvas.style.fontVariationSettings = '"SOFT" 50, "opsz" 40'`) changes what `ctx.fillText` draws:

- On a canvas **in the page**: `SOFT` 0, 50 and 100 are three different drawings (3375, 2382 and 2353 pixels
  apart); `opsz` 9 against 144 differs by 8673 pixels; Archivo `wdth` 80 against 81 differs by 2094 pixels (80
  against 90: 7860). So width, optical size and softness all move continuously, not in steps. The same setting
  draws the same pixels twice.
- On a **detached** canvas (never appended): ignored, 0 differing pixels for every axis.
- A `"wght"` entry overrides the weight in `ctx.font` (CSS 900 with `ctx.font` 400 is pixel-identical to
  `ctx.font` 900).
- `canvas.style.fontOpticalSizing = 'none'` turns automatic `opsz` off: the 24 px x8 against 192 px comparison
  drops from 20653 to 0 pixels.

The stage draws on a canvas in the page (`#stage`), so this route is available to the looks. But `stage.mjs`
builds its measure context on a **detached** canvas, which ignores the element style: if a look uses this route,
layout would be measured with different shapes than are drawn, unless the measure canvas is moved into the page
and given the same style. It is not in the
`reach` flags (those describe what `ctx` and derived families give); using it means writing to the element's
style before each draw, and never drawing text on a detached or off-screen canvas that needs it. Nothing
consumes it yet.

## Kerning, letter spacing, small caps

All three change canvas text in both families (hashes differ):

- `ctx.fontKerning = 'none'` against `'normal'`, "AVATAR To": Fraunces width 585.14 against 555.76, Archivo
  649.25 against 611.95 (120 px). Kerning is on by default; `'none'` widens.
- `ctx.letterSpacing = '10px'` against `'0px'`: "Rag" is exactly 30 px wider (three letters), in both
  families. The engine already sets it from `font.tracking`.
- `ctx.fontVariantCaps = 'small-caps'` against `'normal'`, "rag": Fraunces 151.74 against 161.26, Archivo
  170.67 against 184.14. The small-caps drawing of "a" is not identical to a capital "A" scaled to any of 60,
  65, 70 or 75 percent (nearest, 70: 466 differing pixels), so it is probably the font's own small-cap glyphs
  and not a synthesised fallback. That is not proven, and the comparison is probe only (no test).

## Nunito (the `cosmos` look)

Added with the `cosmos` look: Nunito 5.3.0 (`@fontsource-variable/nunito`, Latin, upright), one axis, `wght`
200-1000. The same check as above, repeated for it in the same Chromium **156.0.8078.4**:
`test/v2/fonts-browser.test.mjs` draws "Rag" at weight 200 and at 1000 through `ctx.font` and the drawings differ, so
canvas reaches its weight axis (`reach.wght` true; the other three flags false, as it has no other axis). The stage
loads it through `facesFor` with no page error or blocked request (the same test). A specimen drawn on the cosmos
field at 32 to 232 px and weights 600, 700 and 800 (`.scratch/cosmos/probe.mjs`, probe only) shows the three
weights distinctly.

Not measured: every FONTS entry carries the `100 900` weight descriptor (`fontFaces`), so a requested weight above
900 may stop at 900 rather than reach the face's 1000. The look uses 600 to 800, inside both ranges.

## Geist Variable (the `keynote` look)

Added with the `keynote` look: Geist 5.3.0 (`@fontsource-variable/geist`, Latin, upright), one axis, `wght` 100-900,
registered as the family `Geist Variable` so it never collides with the static shared `Geist` 400 and 600
(`engine/page/fonts-shared.mjs`). The same check, repeated in the same Chromium **156.0.8078.4**:
`test/v2/fonts-browser.test.mjs` draws "Rag" at weight 100 and at 900, and at the weight sweep's 300 and 800, through
`ctx.font`, and each pair draws differently, so canvas reaches the weight axis (`reach.wght` true; no other axis). The
stage loads it through `facesFor` with no page error or blocked request (the same test).

## What this means for the looks

- Animate `wght` freely in both faces.
- Archivo width: use the six keyword steps, or the element-CSS route for a smooth ramp.
- Fraunces `opsz`: leave it automatic, or pin `Fraunces Text` / `Fraunces Display`. Animating font size animates
  `opsz` for free; zooming does not. `Fraunces Display` (opsz 144) is pixel-identical to `Fraunces` at 144 px and
  above (automatic clamps at 144), so for large headlines only `Fraunces Text` changes anything.
- Fraunces `SOFT`: two values (`Fraunces`, `Fraunces Soft`); a crossfade between two draws is the only way to
  animate it through `ctx`, or use the element-CSS route.
- Never rely on a percentage in `ctx.fontStretch`.
- Nunito: animate `wght` freely between 200 and 900; it has no other axis.
- Geist Variable: animate `wght` freely between 100 and 900 (keynote's sweep runs 300 to 800); it has no other axis.
