# motion.json reference

Validate with `node scripts/validate.mjs motion.json`. Unknown properties are errors (with did-you-mean). All coordinates are canvas pixels (origin top-left); an element's `x`,`y` is its **centre**.

## Root
| field | type | default | notes |
|---|---|---|---|
| `size` | `[w, h]` ints 16–3840 | `[1920, 1080]` | logical canvas; `render --size` rescales output |
| `fps` | 24 \| 25 \| 30 \| 60 | 30 | |
| `background` | CSS colour | `#0b0d12` | |
| `scenes` | array, 1–50 | required | total duration ≤ 120 s |

## Scene
`id` (string, globally unique), `duration` (0.2–60 s), `elements` (array), optional `background`, `transition` (`none` default | `fade`: scene opacity 0→1 over min(0.4 s, duration)).
Scenes play sequentially; scene *n* starts at the sum of earlier durations. Only the active scene is drawn.

## Elements
Common: `id` (unique across scenes and elements), `type`, `x`, `y` (required), `opacity` (0–1, default 1), `scale` (1), `rotate` (deg, 0), `keyframes`.

| type | extra fields | animatable props |
|---|---|---|
| `text` | `text` (req), `fontSize` (48), `fontWeight` 400\|500\|600\|700\|800 (600), `color` (#fff), `align` left\|center\|right (center), `maxWidth`, `font` sans\|mono | opacity x y scale rotate |
| `counter` | `to` (req), `from` (0), `decimals` (0), `prefix`, `suffix`, + text styling | + `value` (starts at `from`) |
| `shape` | `shape` rect\|ellipse\|line (req), `width`, `height`, `radius`, `fill`, `stroke`, `strokeWidth` | + `draw` 0–1 (stroke reveal; default 1) |
| `image` | `src` (req, relative to the spec file; must stay inside the spec folder, be a regular file, no symlinks out, no dotfiles), `width`, `height` (req), `fit` contain\|cover\|fill | opacity x y scale rotate |
| `chart` | `vegaLite` (req, with inline `data.values`), `width`, `height` (req) | + `reveal` 0–1 (left-to-right wipe; default 1) |

Counter default: a counter with **no** `value` keyframes counts `from` → `to` from t=0 to `min(2, 0.8 × scene duration)` seconds with `outCubic`. Add any `value` keyframe to take control of the timing.

Colours (`background`, scene `background`, `color`, `fill`, `stroke`) must be hex (`#rgb`, `#rrggbb`, with optional alpha), `rgb()/rgba()/hsl()/hsla()` or a named CSS colour. `url(...)`, `var(...)` and anything else is rejected.

Shape notes: a `line` has length `width`, thickness `strokeWidth` and is horizontal; angle it with `rotate`. To grow a vertical bar upward from a baseline, use a line with `"rotate": 270` and animate `draw` 0→1. `fill` defaults to white for rect/ellipse unless only a `stroke` is given.

Chart notes: data must be inline: `data.values`, or `datasets` plus `data: {name}`. Any `url` key anywhere in the Vega-Lite spec (remote `data.url`, lookup `from.data.url`, image-mark `url`) is rejected; the renderer also blocks all non-local network requests. Do not set `width`/`height` inside `vegaLite`; the element's are used. Fonts, dark axes and a teal default colour are applied through a built-in Vega-Lite `config`; your own `config` keys override it. The chart is rendered to SVG once at load.

## Keyframes
`{ "t": seconds, "ease": name, <prop>: value, ... }`
- `t` is relative to the scene start, sorted ascending, ≤ scene duration.
- Per property the track is built from the keyframes that set it: before the first, the value is that keyframe's value; between two, it interpolates using the **destination** keyframe's `ease` (default `linear`); after the last, it holds. Properties no keyframe sets keep the element's base value.
- Sampling: frame *i* shows time *i / fps*, so the last frame is one frame **before** the scene/video end. Put the final keyframe at least one frame (1/fps s) before the scene end, or it is never shown fully.
- `ease`: `linear`, or `in|out|inOut` × `Quad|Cubic|Quart|Back|Elastic|Bounce|Sine|Expo|Circ`.

## Cross-field errors (examples)
- `scenes[1].elements[0].id: duplicate id "title" (first used at scenes[0].elements[0].id)`
- `scenes[0].elements[0].keyframes[1].draw: not animatable on text; animatable: opacity, x, y, scale, rotate`
- `scenes[0].elements[0].keyframes[2].t: 5 exceeds scene duration 3`
- `scenes: total duration 121s exceeds the 120s limit`
- `scenes[0].elements[1].src: file not found: pic.png` (also `must stay inside the spec folder`, `hidden files are not allowed`)
- `scenes[0].elements[0].vegaLite.layer[1].data.url: remote data is not allowed — inline data.values`
- `background: must be a CSS colour (hex, rgb(), rgba(), hsl(), hsla() or a named colour)`
- `scenes[0].elements[0].vegaLite.data.values: required — chart needs inline data.values`

## CLI
- `node scripts/validate.mjs <spec> [--json]` — exit 0 / 1 / 2.
- `node scripts/preview.mjs <spec> [--open]`
- `node scripts/render.mjs <spec> [--out file.mp4] [--fps n] [--size WxH] [--contact-sheet]` — default out `<specdir>/out/<name>.mp4`; with `--contact-sheet`, `--out` is a directory and PNGs go to `<out>/contact/<scene-id>.png` (default `<specdir>/out`). `--size` sides must be 16–3840 and even. Output is written to `<name>.partial.mp4` and renamed on success; Ctrl+C removes it (exit 130/143). `--fps` is an output override (integer 1–120); the spec's own `fps` is limited to 24/25/30/60.
- ffmpeg is looked up as `$FFMPEG_PATH`, then `ffmpeg` on PATH, then an optionally installed `ffmpeg-static`.
