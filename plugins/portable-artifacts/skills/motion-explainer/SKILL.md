---
name: motion-explainer
description: Use when the user wants a short animated explainer video (titles, counters, shapes, charts, images with keyframed motion) previewed locally and exported to MP4; spec-driven, offline, open source, works with any agent that can run shell commands.
---

# motion-explainer

You write one JSON file, `motion.json`. Scripts validate it, preview it in a browser and render it to MP4. You never write animation code, and you never edit generated output.

Paths below are relative to this skill folder. Run the commands from here; the spec can live anywhere (image paths resolve relative to the spec file).

## One-time setup (tell the user if a step fails)

```
npm ci                          # animejs, vega-lite, playwright, fonts
npx playwright install chromium # ~150 MB; without it the scripts fall back to system Chrome
# ffmpeg: brew install ffmpeg | apt install ffmpeg  (or set FFMPEG_PATH)
```

## Workflow

1. Write `motion.json` (shape below; full reference in `references/schema.md`; copy a file from `references/examples/` to start).
2. `node scripts/validate.mjs motion.json` — fix every line it prints (`<json.path>: <message>`, with did-you-mean) and re-run until it says `valid`. Exit 0 ok, 1 spec errors, 2 usage/IO error.
3. Self-check: `node scripts/render.mjs motion.json --contact-sheet` writes `out/contact/<scene-id>.png` (one frame per scene, at 85% of its duration). Look at each PNG: clipped text, invisible elements, overlaps, wrong fonts. Fix the spec and repeat.
4. `node scripts/preview.mjs motion.json [--open]` prints a localhost URL with scrubber, play/pause, scene markers, Space and arrow keys. The page reloads when the file changes.
5. `node scripts/render.mjs motion.json [--out out/video.mp4] [--fps 30] [--size 1920x1080]` writes the MP4 (H.264, yuv420p, no audio). It prints the path and frame count.

When asked for a change ("slow scene 2", "make the title blue"), edit only the fields the request names in `motion.json`, then validate again. Do not rewrite the spec from scratch.

## Spec shape

```json
{
  "size": [1920, 1080], "fps": 30, "background": "#0b0d12",
  "scenes": [
    { "id": "intro", "duration": 3, "transition": "fade",
      "elements": [
        { "id": "title", "type": "text", "text": "Q3 revenue up 18%", "x": 960, "y": 480,
          "fontSize": 96, "fontWeight": 700, "color": "#ffffff",
          "keyframes": [ { "t": 0, "opacity": 0, "y": 520 },
                         { "t": 0.6, "opacity": 1, "y": 480, "ease": "outCubic" } ] } ] } ]
}
```

- Root: `size` (default 1920x1080), `fps` (24, 25, 30, 60), `background`, `scenes` (1–50, total ≤ 120 s). Only `scenes` is required.
- Scene: `id`, `duration` (0.2–60 s), `elements`, optional `background`, `transition` (`none` or `fade`, a 0.4 s fade-in). Only one scene is visible at a time; scenes play back to back.
- Every element: `id` (unique in the whole spec), `type`, `x`, `y` (canvas pixels; the anchor is the element centre), optional `opacity`, `scale`, `rotate` (degrees), `keyframes`.
- Types: `text`, `counter` (`from`, `to`, `decimals`, `prefix`, `suffix`; animate `value`), `shape` (`rect`, `ellipse`, `line`; a line is horizontal of length `width`, use `rotate` to angle it; animate `draw` 0–1), `image` (`src` relative to the spec), `chart` (`vegaLite` with inline `data.values`, `width`, `height`; animate `reveal` 0–1 for a left-to-right wipe).
- Keyframe: `t` (seconds inside the scene, sorted, ≤ scene duration), optional `ease`, plus any animatable props for that type. Per property: it holds the first keyframe's value before it, interpolates to each later keyframe using that keyframe's `ease`, and holds the last value after. A property missing from a keyframe is interpolated across it. Frame *i* samples t = i/fps, so put the final keyframe at least one frame (1/fps s) before the scene end. A counter with no `value` keyframes counts from→to over min(2 s, 80% of the scene) with outCubic.
- Eases: `linear`, or `in|out|inOut` + `Quad|Cubic|Quart|Back|Elastic|Bounce|Sine|Expo|Circ`. Prefer `outCubic` / `outQuad` for entrances.

## Style defaults

Dark background, Inter for text, JetBrains Mono for `"font": "mono"`, 1920x1080 sizes (titles 72–120 px, body 40–48 px, captions ≥ 28 px). Charts get a dark theme automatically; put a Vega-Lite `config` in the chart to override it. Keep entrances short (0.5–0.9 s), stagger elements by 0.2–0.4 s, and stay under 15 s unless asked. Fonts are bundled; never use CDN URLs. Charts must carry inline data (`data.values`, or `datasets` + `data.name`); any `url` in a chart spec is rejected. Colours must be hex, rgb()/hsl() or named.

## Degraded mode

If Node, Chromium or ffmpeg cannot be installed here, still write and validate `motion.json` (validation needs only `npm ci`), then give the user the exact preview and render commands above to run themselves.

## Security

The preview server binds 127.0.0.1 only and accepts only local Host headers, and serves only this skill's own folders plus the image files the spec names. The renderer aborts every non-local request and sends a strict CSP. No network access at build, preview or render time.
