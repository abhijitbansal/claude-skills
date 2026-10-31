# motion.json reference

Validate with `node scripts/validate.mjs motion.json`. Unknown properties are errors (with did-you-mean). All coordinates are canvas pixels (origin top-left); an element's `x`,`y` is its **centre**.

## Root
| field | type | default | notes |
|---|---|---|---|
| `size` | `[w, h]` ints 16–3840 | `[1920, 1080]` | logical canvas; `render --size` rescales output |
| `fps` | 24 \| 25 \| 30 \| 60 | 30 | |
| `background` | CSS colour | the theme's page colour | |
| `theme` | shared theme name (`dusk`, `press`, `poster`, `paper`, `ink`, `blueprint`, `editorial`, `mono`, `brief`) | `dusk` | optional; see below |
| `generatedBy` | `{ model?, effort?, agent? }`, each 1–60 chars of `A-Za-z0-9 ._:/()+-` | none | provenance; shown in the preview footer and written to the MP4 `comment`/`artist` tags; missing fields read "not reported" |
| `cues` | array, up to 30 | none | procedural sound cues; see Cues below |
| `texture` | `{ vignette?, grain? }` | none (off) | film texture over the whole video; see Texture below |
| `transition` | `none` \| `fade` \| `crossfade` | `none` | the default for every scene that sets no `transition`; a root `crossfade` leaves the first scene a plain start |
| `scenes` | array, 1–50 | required | total duration ≤ 120 s |

### theme
Without `theme` the spec draws as `dusk` (`render --theme` can pick another for a spec that names none). The theme's **dark** colours and fonts become the defaults: `background` is its page colour, text is its text colour, shapes without a `fill` or `stroke` use its accent, charts take its palette and axis colours, `sans` text uses its body font, `"font": "mono"` its mono font and `"role": "title"` text its display font. A weight the theme font does not ship is mapped to the nearest one it does (no synthetic bold), mono default included. Anything the spec sets itself (`background`, `color`, `fill`, a chart `config`) still wins. Fonts come from the skill's bundled `shared/fonts`, no network. An unknown name is an error with a did-you-mean.

## Scene
`id` (string, globally unique), `duration` (0.2–60 s), `elements` (array), optional `background` (a CSS colour, or `"art"`: the theme's seeded art, drawn full-bleed behind the elements in dark mode at the canvas size and seeded by the scene `id`, so the same spec always gets the same art; a light page-colour scrim dims it and text and counters on it get a soft page-colour halo), `transition` (`none` default | `fade`: scene opacity 0→1 over min(0.4 s, duration), from the page background | `crossfade`: the same fade-in, over the previous scene, which stays on screen at full opacity until the window ends (so the stage colour never shows through; the previous scene is not faded out); on the first scene it is an error, as there is nothing to fade in over). `fade` on scene 1 makes frame 0, the video's thumbnail, blank.
Scenes play sequentially; scene *n* starts at the sum of earlier durations. Only the active scene is drawn, except during the first min(0.4 s, duration) of a `crossfade` scene, when the previous one is drawn beneath it at full opacity. Timing and audio never change: a crossfade overlaps the pictures, not the clock.

## Audio
Optional root `audio` array, up to 20 tracks. Tracks mix over the whole video; contact sheets ignore them.
| field | type | default | notes |
|---|---|---|---|
| `src` | string | required | relative to the spec file; same path rules as image `src`; `mp3` \| `wav` \| `m4a` \| `aac` \| `ogg` \| `flac` |
| `at` | seconds ≥ 0 | 0 | from the video start; with `scene`, from that scene's start |
| `scene` | scene `id` | none | anchors `at` to the scene, so changing an earlier scene's duration keeps the track aligned |
| `duration` | seconds > 0 | whole clip | trim; the track stops at `start + duration`, clamped to the video end |
| `volume` | 0–1 | 1 | literal gain (the mix is not normalised) |
| `fadeIn` | seconds ≥ 0 | 0 | from the track start |
| `fadeOut` | seconds ≥ 0 | 0 | ends at the `duration` trim, else at the video end. `fadeIn + fadeOut` must fit in the time the track plays. A clip that ends earlier gets no fade (the file length is never probed). No `loop`: a short file just stops |

## Texture
Optional root `texture`: `vignette` (boolean, default off) darkens the corners with one radial-gradient layer over the scenes (clear to 55 % of the way out, 0.55 black at the corners); `grain` (0–0.15, default 0 = off) lays one static layer of monochrome film grain over each scene, as an SVG `feTurbulence` seeded from the scene `id` and never re-seeded, so the same spec renders byte-identical frames. It is blended with `overlay` and its noise averages mid-grey, so it adds texture without changing a frame's average brightness (measured: the mean luma of a frame stays within 1 of the grain-free frame at `grain` 0.15 in dusk, paper and press). A higher `grain` is stronger. Unknown keys are errors with a did-you-mean. Specs without `texture` render as before.
**Cost, measured:** the render loop (seek plus PNG screenshot, 1920x1080, 90 frames, Playwright Chromium on one Apple-silicon Mac, two rounds) took about 17 to 33 ms per frame with no texture, about 42 ms with `vignette`, about 100 ms with `grain` and about 187 ms with both. A 30 s clip at 30 fps (900 frames) therefore costs about 1 minute more with grain and about 2.5 minutes more with both. Texture applies to every scene; leave it off for long renders you do not need it on. Each scene carries its own full-frame grain bitmap (one per scene at the canvas size), so a spec with very many scenes at 4K holds a lot of memory in the page; keep `grain` for short or few-scene clips there.

## Cues
Optional root `cues` array, up to 30: short sounds the renderer synthesises, no file needed. Opt-in: a spec with no `cues` renders exactly as before, and a spec with neither `audio` nor `cues` stays silent. Cues are mixed through the same graph as `audio` tracks; contact sheets and the preview ignore them.
| field | type | default | notes |
|---|---|---|---|
| `cue` | `pop` \| `click` \| `whoosh` \| `chime` \| `impact` \| `riser` \| `swoosh` \| `typing` \| `drop` \| `ding` | required | `pop`: a 0.16 s blip with a bright tick at its start; `click`: a 0.04 s dry UI tick; `whoosh`: 0.8 s of air going past, loudest and brightest 0.4 s in (start it 0.4 s before the cut it marks); `chime`: a 1.4 s three-partial bell with a short room tail; `impact`: a 0.9 s thud whose pitch falls two octaves in its first 0.1 s; `riser`: 1.6 s of noise climbing in pitch and level, ending at full level (start it 1.6 s before the moment it builds to); `swoosh`: a 0.3 s whoosh for a transition, loudest 0.15 s in; `typing`: key clicks 0.035 s apart, one per character (0.035 s × characters + 0.05 s long); `drop`: a 0.6 s sub hit; `ding`: a 0.5 s notification ding. `whoosh`, `riser` and `swoosh` are stereo above 120 Hz (mono below); the rest are mono |
| `at` | seconds ≥ 0 | required (except with `follow`) | from the video start; with `scene`, from that scene's start. Must fall before the video end |
| `follow` | a `text` element `id` | none | `typing` only: the cue starts when that typing text starts typing (its scene start, or its first `value` keyframe) and clicks once per character. With `value` keyframes the clicks are spread evenly up to the first keyframe that reaches the whole text, so under an ease they only approximate the characters. Not with `at` or `scene`; counted at 0.035 s per character from where it starts typing, it must end inside the text's scene. Without `follow`, a `typing` cue is a single key click at `at` |
| `scene` | scene `id` | none | anchors `at` to the scene, as on an audio track, so changing an earlier scene's duration keeps the cue aligned |
| `volume` | 0–1 | 1 | literal gain on a cue that peaks at -6 dBFS (0.5); the mix is not normalised |
| `pan` | -1..1 | 0 | equal-power: the centre is unity in both channels, a hard pan is 3 dB louder in its channel |
| `note` | `A`-`G`, optional `#` or `b`, octave 0-8 | per cue | tunes `pop` (default E5), `chime` (A5), `impact` (F2), `drop` (C2) and `ding` (E6); an error on `click`, `whoosh`, `riser`, `swoosh` and `typing`, which are noise |
Each cue is built in layers (a short transient, a body, and on `pop`, `chime`, `impact` and `ding` a reverb tail under 0.5 s) and every cue peaks at -6 dBFS in each channel. The sounds are pure functions of the cue: noise is seeded, so the same spec gives the same WAV bytes and the same MP4. A cue longer than the time left is cut at the video end, and every cue is faded out over its last 5 ms in the mix so a cut one cannot click. With `scene`, `at` must be inside that scene (a smaller `at`, or a later scene, is the fix the validator names); a cue never spills into the next scene.

## Elements
Common: `id` (unique across scenes and elements), `type`, `x`, `y` (required), `opacity` (0–1, default 1), `scale` (1), `rotate` (deg, 0), `keyframes`.

| type | extra fields | animatable props |
|---|---|---|
| `text` | `text` (req), `role` (`title` only; see below), `exit` (boolean, false; see below), `typing` (boolean, false; see below), `fontSize` (48), `fontWeight` 400\|500\|600\|700\|800 (600), `color` (the theme's text colour), `align` left\|center\|right (center), `maxWidth`, `font` sans\|mono | opacity x y scale rotate (+ `value` when `typing`) |
| `counter` | `to` (req), `from` (0), `decimals` (0), `prefix`, `suffix`, + text styling | + `value` (starts at `from`) |
| `shape` | `shape` rect\|ellipse\|line (req), `width`, `height`, `radius`, `fill`, `stroke`, `strokeWidth`, `elevated` (rect only), `cap` and `arrow` (line only) | + `draw` 0–1 (stroke reveal; default 1) |
| `image` | `src` (req, relative to the spec file; must stay inside the spec folder, be a regular file, no symlinks out, no dotfiles), `width`, `height` (req), `fit` contain\|cover\|fill | opacity x y scale rotate |
| `chart` | `vegaLite` (req, with inline `data.values`), `width`, `height` (req) | + `reveal` 0–1 (left-to-right wipe; default 1) |

Title role: a `text` with `"role": "title"` uses the theme's display font (the weight maps to the one the display font ships). `"font": "mono"` wins over the role: a mono title draws in the mono font, still with the entrance preset below. When it has **no** `keyframes` it gets the theme's kinetic entrance: `dusk` **rise** (fades in and rises 0.35 × `fontSize` into place, 0.9 s), `press` **ink-in** (fades in while settling from 104% scale, no movement, 1.1 s), `poster` **slam** (snaps in from 135% scale with an `outBack` landing, 0.5 s). A preset is a plain function of the scene duration and `fps`, compressed to end at least one frame before a short scene's end, so renders stay reproducible. Any `keyframes` (an empty list too) turn it off. `paper`, `ink`, `blueprint` and `editorial` have no preset.

Exit (opt-in): `"exit": true` on such a title also gives it the theme's exit, with the `exit` ease: `rise` fades as it drops 0.35 × `fontSize`, `ink-in` fades as it grows back to 104%, `slam` fades as it snaps down to 85%. The exit takes half the entrance (0.45 / 0.55 / 0.25 s) and lands one frame before the scene end, but never starts before 90% of the scene (a shorter scene gets a shorter exit, so the 85% contact frame always shows the title fully in). It is skipped on the spec's last scene, when the entrance has not landed by 90% of the scene, and whenever the title has its own `keyframes`. Without `exit` nothing changes.

Typing (opt-in): `"typing": true` on a `text` reveals its characters one at a time, 0.035 s each, from the start of its scene, with a caret after the last typed character (a thin bar; solid while typing, blinking every 0.5 s once the text is complete). Counted in grapheme clusters, so an emoji, a ZWJ sequence, a flag or a letter with a combining accent is one character and is never typed in halves. The element's box is always the full text: the untyped rest keeps its space but is not drawn, so a centred line does not shift as it fills and `check.mjs` judges its final box from the first frame. Its animatable `value` is the number of characters typed: with no `value` keyframes it runs 0 → N from t=0 at 0.035 s per character; add any `value` keyframe to take control of the start and pace (as on a counter's `value`). `typing` on any other element type is an error, and so is a `value` keyframe on a text without it. A typing text with no `value` keyframes must finish a frame before its scene ends (`0.035 × characters + 1/fps` seconds at most), or the validator says to shorten the text or lengthen the scene.

Counter default: a counter with **no** `value` keyframes counts `from` → `to` from t=0 to `min(2, 0.8 × scene duration)` seconds with `outCubic`. Add any `value` keyframe to take control of the timing.

Colours (`background`, scene `background` other than `"art"`, `color`, `fill`, `stroke`) must be hex (`#rgb`, `#rrggbb`, with optional alpha), `rgb()/rgba()/hsl()/hsla()` or a named CSS colour. `url(...)`, `var(...)` and anything else is rejected.

Theme colour tokens: a shape `fill` or `stroke` and a text or counter `color` may also name a token (`surface`, `line`, `accent`, `accentSoft`, `good`, `bad`, `warn`, `text`, `text2`, `text3`, `cat1`..`cat6`) instead of a hex. It resolves to that colour of the active theme's dark variant, so a theme change recolours the card too. Backgrounds take no tokens; an unknown name is an error that lists them. Hex specs render exactly as before.

Shape notes: a `line` has length `width`, thickness `strokeWidth` and is horizontal; angle it with `rotate`. To grow a vertical bar upward from a baseline, use a line with `"rotate": 270` and animate `draw` 0→1. `fill` defaults to the theme accent for rect/ellipse unless only a `stroke` is given. `"elevated": true` on a rect draws a card: the fill moves 6 % toward the theme text colour and a 1 px `rgba(255,255,255,.06)` highlight sits just inside the edge (no drop shadow, which would not show on a dark page); it is drawn as one extra node after the rect, is drawn in with it as `draw` grows, and is left off a rect with only a `stroke` (no fill to lift). `"elevated": false` is accepted on any shape and does nothing. `"cap": "round"` rounds a line's ends and pulls both endpoints in by half the stroke width, so the line keeps its `width`; the default stays flat. A round-cap line stays hidden until its drawn length is more than a cap radius (half the stroke width), so it grows from a stub rather than popping in as a dot. A line with an arrow needs a `width` of more than 3 × `strokeWidth` (3.5 × with a round cap) and one with a round cap alone more than `strokeWidth`; the validator names the minimum. `"arrow": "end"` adds a filled triangle head (3 × `strokeWidth` long, 3 × wide, ending at `width`) that appears once `draw` reaches 0.98.

Chart notes: data must be inline: `data.values`, or `datasets` plus `data: {name}`. Any `url` key anywhere in the Vega-Lite spec (remote `data.url`, lookup `from.data.url`, image-mark `url`) is rejected; the renderer also blocks all non-local network requests. Do not set `width`/`height` inside `vegaLite`; the element's are used. The theme's fonts, axis colours, accent and palette are applied through a built-in Vega-Lite `config`; your own `config` keys override it. The built-in config also sets: about five ticks on each axis, no y domain line, no tick marks and no vertical gridlines, bars with 10 px rounded ends and a 0.3 gap between them, lines 4 px wide with round caps and joins, and filled points ringed in the page colour (a hollow `filled: false` point keeps its accent outline). The chart `reveal` is a left-to-right wipe with a soft edge. The chart is rendered to SVG once at load.

## Keyframes
`{ "t": seconds, "ease": name, <prop>: value, ... }`
- `t` is relative to the scene start, sorted ascending, ≤ scene duration.
- Per property the track is built from the keyframes that set it: before the first, the value is that keyframe's value; between two, it interpolates using the **destination** keyframe's `ease` (default `linear`); after the last, it holds. Properties no keyframe sets keep the element's base value.
- Sampling: frame *i* shows time *i / fps*, so the last frame is one frame **before** the scene/video end. Put the final keyframe at least one frame (1/fps s) before the scene end, or it is never shown fully.
- `ease`: `linear`, or `in|out|inOut` × `Quad|Cubic|Quart|Back|Elastic|Bounce|Sine|Expo|Circ`, or a named ease: `enter` (cubic-bezier 0.16, 1, 0.3, 1: fast out, soft settle, for entrances), `exit` (0.6, 0, 0.9, 0.35: slow start, accelerating away), `move` (0.65, 0, 0.35, 1: symmetric, for a move between two places), `land` (0.55, 0, 0.2, 1.12: overshoots about 1% just before it lands; one hero moment per clip; never on a counter's `value`, where the number would show past its target). See `motion-design.md`.

## Cross-field errors (examples)
- `scenes[1].elements[0].id: duplicate id "title" (first used at scenes[0].elements[0].id)`
- `scenes[0].elements[0].keyframes[1].draw: not animatable on text; animatable: opacity, x, y, scale, rotate`
- `scenes[0].elements[0].keyframes[2].t: 5 exceeds scene duration 3`
- `scenes[0].elements[0].keyframes[0].value: not animatable on text; animatable: opacity, x, y, scale, rotate (value needs "typing": true)`
- `texture.grain: must be <= 0.15`
- `scenes[0].elements[0].text: typing 100 characters takes 3.50s but scene "one" lasts 1s (it must finish a frame before the scene ends at 30 fps); shorten the text or lengthen the scene to at least 3.54s` (render.mjs asks again with its `--fps`, which replaces the spec's)
- `scenes: total duration 121s exceeds the 120s limit`
- `audio[0].src: unsupported audio format ".wma"; use mp3, wav, m4a, aac, ogg or flac`
- `audio[1].scene: scene "outro" not found; scenes: intro, chart`
- `audio[1].at: starts at 9s (scene "chart" + 4s), but the video ends at 8s`
- `cues[1].cue: must be one of "pop", "click", "whoosh", "chime", "impact", "riser", "swoosh", "typing", "drop", "ding"; did you mean "chime"?`
- `cues[0].at: 2s is past the end of scene "two", which lasts 2s; use a smaller at, or put the cue in a later scene`
- `cues[0].note: click has no pitch; note is for pop, chime, impact, drop and ding`
- `cues[0].follow: element "title" is not a typing text (set "typing": true on it, or drop follow)` (also `only typing takes follow`, and `cues[0].at: not with follow; the cue starts when "title" starts typing`)
- `cues[0].follow: "title" types past the end of scene "one"`
- `audio[0].fadeOut: fadeIn 1s + fadeOut 2.5s exceed the 3s the track plays (from 2s to the video end at 5s)`
- `scenes[0].elements[1].src: file not found: pic.png` (also `must stay inside the spec folder`, `hidden files are not allowed`)
- `scenes[0].elements[0].fill: must be a CSS colour (hex, rgb(), rgba(), hsl(), hsla() or a named colour) or a theme token: surface, line, accent, ...`
- `scenes[0].transition: crossfade needs a previous scene to fade in over; use "fade" or "none" on the first scene`
- `scenes[0].elements[1].cap: only valid on a line shape` (also `elevated: only valid on a rect shape`, `arrow: only valid on a line shape`)
- `scenes[0].elements[0].vegaLite.layer[1].data.url: remote data is not allowed — inline data.values`
- `background: must be a CSS colour (hex, rgb(), rgba(), hsl(), hsla() or a named colour)` (for `"art"` on the root: `; "art" is only valid as a scene background`)
- `scenes[0].elements[0].role: unknown role "heading"; did you mean "title"?`
- `scenes[0].elements[0].vegaLite.data.values: required — chart needs inline data.values`

## CLI
- `node scripts/validate.mjs <spec> [--json]` — exit 0 / 1 / 2.
- `node scripts/voice.mjs "<text>" | --text-file <file> --out <file.wav> [--voice af_heart] [--speed 0.5–2]` / `--list-voices` — synthesises a voiceover locally with Kokoro (kokoro-js, Apache-2.0; 24 kHz mono wav; prints the path and duration). Needs `cd <skill-dir> && npm install kokoro-js@1.2.1 --no-save` (on demand, not part of `npm ci`) and a one-time ~90 MB model download into `<skill-dir>/.cache/models`; offline after that. Exit 0 / 2 usage or not installed / 1 synthesis error.
- `node scripts/preview.mjs <spec> [--open]`
- `node scripts/check.mjs <spec> [--json] [--theme name]` — seeks the render page to every contact-sheet moment (all of them, uncapped); flags a visible text or counter outside the safe area (60 px at 1080 on the short side, on every side: 60 px at 1920x1080, 120 px at 3840x2160) while it is not moving (between or after its keyframe tweens), two visible texts or counters overlapping while neither is moving or fading, and a scene that ends with nothing on screen (every element invisible or wholly off the canvas; a title whose `exit` preset was applied counts as present, since it left on purpose). A **warning**, never a failure (exit stays 0; printed to stderr as `warning: scenes[0]: ...`, and under `warnings` in `--json`, which is left out when there is none), when the first scene shows nothing at t = 0, since that blank frame is the video's thumbnail; the message names the cause (a `fade`, an opacity 0 first keyframe such as a title's theme entrance, a line or chart at `draw`/`reveal` 0, or a typing text with no characters typed yet: its caret alone is not content). An `art` background counts as shown. A crossfade window is sampled at its midpoint, and a visible text or counter of the incoming scene that overlaps one of the outgoing scene there is a warning too (`warning: scenes[1].elements[0]: text "b" overlaps text "a" of the outgoing scene ...`). A box wholly off the canvas has left the frame and is never clipped. `--theme` is the theme for a spec that sets none, as in render.mjs (an unknown name exits 2). A crash prints `check crashed: …` alone (JSON `crashed: true`). Exit 0 ok (or `check: skipped (no browser: …)`), 1 problems, 2 usage.
- `node scripts/render.mjs <spec> [--out file.mp4] [--fps n] [--size WxH] [--theme name] [--model m] [--effort e] [--agent a] [--contact-sheet]` — `--model`/`--effort`/`--agent` override the spec's `generatedBy` (hostile values fail validation, exit 1); `--theme` is a shared theme for a spec that sets none (a spec's own `theme` wins; an unknown name exits 2). Default out `<specdir>/out/<name>.mp4`; with `--contact-sheet`, `--out` is a directory and PNGs go to `<out>/contact/<scene-id>.png` (default `<specdir>/out`). `--size` sides must be 16–3840 and even. Output is written to `<name>.partial.mp4` and renamed on success; Ctrl+C removes it (exit 130/143). When the spec has `audio`, the MP4 also carries an AAC 48 kHz stereo track at 192 kb/s, mixed with normalisation off so `volume` is literal; the video length never changes because of audio. Before any frame is captured each audio file gets a decode probe on its first audio stream (a bad or video-only file fails with `audio[i].src: ffmpeg cannot decode …`, exit 1), and the whole mix graph is dry-run for 0.1 s against a generated video (an ffmpeg older than 4.4 fails with `audio: ffmpeg rejected the mix …`, exit 1). Every track is converted to 48 kHz stereo before mixing, so track order never changes the result. A spec without `audio` or `cues` renders exactly as before, with no audio stream. After any render that has audio, a line `audio: -17.6 LUFS integrated, true peak -3.3 dBTP` (ffmpeg `ebur128`) follows the frame count: information only, it never fails a render. `--fps` is an output override (integer 1–120); the spec's own `fps` is limited to 24/25/30/60. Two renders of the same spec and media give identical frames and audio; the MP4 `comment` tag carries the build date, so the files differ by day unless `SOURCE_DATE_EPOCH` is set.
- ffmpeg is looked up as `$FFMPEG_PATH`, then `ffmpeg` on PATH, then an optionally installed `ffmpeg-static`. Audio mixing needs ffmpeg ≥ 4.4 (`amix normalize`, `adelay all`); an older build fails at encode time with `Option normalize not found`.
