# motion.json reference: a scene: its fields, transitions and camera

Part of the reference indexed in ../schema.md.

## Scene
`id` (a name of letters, digits, `_`, `-` and `.`, starting with a letter or digit, as it is also a file name; scene ids and element ids share one namespace, so a scene `title` and an element `title` clash), `duration` (0.2–60 s), `elements` (array), optional `style` (`standard` or `sketch`, overriding the root `style`; a drawn scene allows only `text`, `shape`, `icon`, `group` and the sketch blocks, and the `erase` transition between two drawn scenes; see `references/sketch.md`), optional `camera` (see Camera below), optional `background` (a CSS colour, or `"art"`: the theme's seeded art, drawn full-bleed behind the elements in dark mode at the canvas size and seeded by the scene `id`, so the same spec always gets the same art;
a light page-colour scrim dims it and text and counters on it get a soft page-colour halo), `transition` (`none` default | `fade`: scene opacity 0→1 over min(0.4 s unless `duration` is set, scene length), from the page background | `crossfade`: the same fade-in, over the previous scene, which stays on screen at full opacity until the window ends (so the stage colour never shows through; the previous scene is not faded out) | `push`, `slide`, `wipe`, `zoom`, `blur`, `iris`, `gl-ripple`, `gl-cube`; or the object form `{ "type", "direction"?, "duration"? }`: see Transitions below). On the first scene every name but `none` and `fade` is an error, as there is nothing to come in over. `fade` on scene 1 makes frame 0, the video's thumbnail, blank.
Scenes play sequentially; scene *n* starts at the sum of earlier durations. Only the active scene is drawn, except during the window of a `crossfade`, `push`, `slide`, `wipe`, `zoom`, `blur`, `iris`, `gl-ripple` or `gl-cube` scene (its `duration`, 0.4 s unless set, at most the scene's own length), when the previous one is drawn too (beneath at full opacity, or beside it for a `push`). Timing and audio never change: a transition overlaps the pictures, not the clock.

### Transitions

A scene's `transition` (and the root default) is a name, or `{ "type": "push", "direction": "up", "duration": 0.6 }`; only `type` is required. `duration` is 0.1–2 s (default 0.4), cut short to the scene's own length. The progress through the window is eased (`inOutCubic`); the outgoing scene stays mounted until the window ends. During a `push`, `slide`, `wipe`, `zoom`, `blur` or `iris` window both layers are painted opaque, with the scene's `background`, else the root one, so a scene that sets none still covers the old one (a `crossfade` keeps transparent layers on purpose).
A scene background that is see-through (`transparent`, or any colour with alpha under 1: `rgba()`/`hsla()`, a slash alpha in `rgb()`/`hsl()`, or hex with alpha such as `#0008`) is painted over the root colour (and the theme's page colour if that is see-through too), so the old scene still cannot show. `check.mjs` counts every window (a `crossfade` too) as change, never part of a dead stretch, and does not judge contrast for text of the scene while it comes in, because the screenshot there is two layers; a text that shows only inside its window gets an `info:` line saying so. `direction` of `push`, `slide` and `wipe` is the edge the new scene comes from, `left` (default), `right`, `up` or `down`; of `zoom` and `iris` it is `in` (default) or `out`; `gl-cube` takes the same four edges (`left` default); `blur`, `fade`, `crossfade` and `gl-ripple` take none, and an unknown direction is an error that lists the ones that type takes.

| `type` | what moves |
|---|---|
| `push` | the new scene enters from the edge and pushes the old one out the opposite side, both moving by the canvas size |
| `slide` | the new scene slides in over the old one, which stays put |
| `wipe` | the new scene is revealed by a rectangle growing from the edge |
| `zoom` | the new scene scales to 1 from 1.2 (`in`) or 0.8 (`out`) while it fades in |
| `blur` | the new scene sharpens from a 24 px blur to none while it fades in |
| `iris` | `in`: the new scene opens as a circle from the centre; `out`: the old scene closes to a circle over the new one |
| `gl-ripple` | a WebGL shader: a wave spreads from the centre through both scenes while they cross over, and dies away at both ends of the window |
| `gl-cube` | a WebGL shader: both scenes are faces of a box that turns in perspective, the new one coming from `direction` (`left` default); the backdrop round the box is black |

**WebGL transitions (`gl-ripple`, `gl-cube`).** In a render, each frame of the window is made from two screenshots, the outgoing and the incoming scene alone, which a second browser page runs a fragment shader over, in software WebGL (Chromium's swiftshader, no GPU), and a screenshot of that canvas is the frame. The first frame of the window is the outgoing scene and the first frame after it the incoming one, exactly; the frames between are drawn by the shader, with captions and grain warped along with their scene. The result is deterministic like every other frame: the spike (`test/webgl-spike.test.mjs`) drew the same bytes on macOS and Ubuntu, and `--workers 4` gives the MP4 of `--workers 1` (`test/gl-transitions.test.mjs`).
`render.mjs` prints `webgl: N frames composed in software` on stderr; a frame of a window costs two scene screenshots, two texture uploads and a canvas screenshot instead of one screenshot, and a browser with no WebGL is an error that tells you to use `push` or `crossfade`. **The live preview and `check.mjs` have no compositor**: they show a `gl-cube` as a `push` from the same edge and a `gl-ripple` as a crossfade, `check.mjs` judges those stand-in layers (so a ripple window can report text over text and a cube never does), and `validate.mjs` says so in a `note:` line on stderr. Judge the look from a render or from `render.mjs --contact-sheet`, which composes the window's tiles too (without the in-page stamp: the sheet labels each tile).

The window is also where `check.mjs` looks for text over text. Use `references/examples/transitions.json` as the pattern, and `references/examples/gl-transitions.json` for the WebGL ones.

### Camera

A scene's optional `camera` moves every element of that scene as one: `{ "keyframes": [{ "t", "zoom"?, "x"?, "y"?, "rotate"?, "ease"? }], "shake"?: { "amount", "hz"?, "seed"? } }`. A camera needs a keyframe that sets `zoom`, `x`, `y` or `rotate` away from rest (zoom 1, x 0, y 0, rotate 0), or a `shake` with an `amount` above 0; one that never leaves rest does nothing and is an error.

| field | type | default | notes |
|---|---|---|---|
| `keyframes[].t` | number ≥ 0 | required | scene seconds, sorted, at most the scene's `duration` (the rules for an element's keyframes) |
| `keyframes[].zoom` | number 0.5–3 | 1 | 1 is no zoom, 2 doubles the size, 0.5 halves it |
| `keyframes[].x`, `.y` | number (px) | 0 | the canvas point the camera looks at, measured from the centre: `x: 100` moves the picture 100 px left (times the zoom); with a `rotate` the pan turns with the roll, so the point lands off centre |
| `keyframes[].rotate` | number (degrees) | 0 | the picture rolls about the canvas centre (before the pan moves it) |
| `keyframes[].ease` | an ease name | `linear` | the ease of the tween that ends at this keyframe |
| `shake.amount` | number 0–100 (px) | required | the largest offset in either direction; the shake runs for the whole scene, so put it on a short scene of its own |
| `shake.hz` | number > 0, at most 60 | 8 | noise steps per second; the offset blends between steps |
| `shake.seed` | integer 0–7918 | 1 | the same seed always shakes the same way and every seed another way (the bound keeps the x and y noise of different seeds apart), so renders stay byte-identical |

A property is tweened between the keyframes that set it and held before the first and after the last, as for an element. The picture is `translate(shake) scale(zoom) translate(-x, -y) rotate(rotate)` about the canvas centre, drawn inside the scene's layer: the scene's background (a colour, or the `"art"` plate) stays on the layer and does not move, so zooming out below 1, panning, rolling or shaking never shows a gap, and a transition still moves, clips or fades the layer as a whole. The camera moves the elements only; the background, captions, grain and the vignette stay put. Use `references/examples/camera-push-in.json` as the pattern.

`check.mjs` measures boxes after the camera, so text pushed out of the safe area by a held zoom is reported (`text "top" leaves the safe area (top) at 3.97s`). While a camera tween runs, every element of the scene counts as moving for the safe-area, overlap and caption-zone rules (as if its own keyframe were tweening), exactly as an element's own tween does: the move is not judged while it runs (so a reveal pan that starts with a label part-way in frame, or a push out from a tight zoom, is fine), the pose it settles in and the scene's last frame are. Two keyframes with equal values are a hold, not a move, so a camera held that way is judged at every moment. A shake has no keyframes and does not count as moving, so keep text clear of the edges by `shake.amount` too.
The text floor reads the size as drawn, camera zoom included, and is not relaxed by a camera tween. A camera tween or a shake is change for the dead-stretch audit (read from the camera node's transform at every step, so it also counts for a scene that shows no element, such as an art plate alone, and a camera held with equal keyframes is still a dead stretch) and the viral 3 s rule (which, reading the spec alone, ignores moves between equal values too).
