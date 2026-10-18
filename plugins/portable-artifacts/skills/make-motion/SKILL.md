---
name: make-motion
description: Use when the user wants a short animated explainer video (titles, counters, shapes, charts, images with keyframed motion) previewed locally and exported to MP4, with music or a voiceover only when asked; spec-driven, offline, open source, works with any agent that can run shell commands.
argument-hint: what to make, e.g. an 8s clip with Q3 revenue up 18% then a bar chart of Q1-Q3
---

# make-motion

You write one JSON file, `motion.json`. Scripts validate it, preview it in a browser and render it to MP4. You never write animation code, and you never edit generated output.

Run every command from the project folder (where `motion.json` lives), using the full path to the scripts. Image paths resolve relative to the spec file. If the request is empty, ask what the video should say, how long it should be, and the size (default 1920x1080, 30 fps).

**Audio is opt-in.** Add `audio` tracks only when the prompt asks for sound (music, soundtrack, voiceover, narration, "read it aloud", a sound effect) or the user confirms when you ask. Never add audio to a prompt that does not mention it. When the prompt is about sound but unclear (for example "make it feel polished" with an mp3 in the folder), ask one question before writing the spec. Music and sound effects are files the user supplies; a voiceover can be synthesised with `voice.mjs` (workflow step 2) when the prompt asks for narration without giving a file.

## Before the first build

`<skill-dir>` is the folder containing this SKILL.md. Run `node <skill-dir>/scripts/doctor.mjs --json` (add `--for <spec.json>` once the spec exists, `--for voiceover` for a voiceover (make-motion), `--for check` before `check.mjs` (skills that have one)). It needs only Node.

If it reports anything missing, tell the user in one message: each item, why it is needed, its size and the command, plus every `notes` and `info` entry from the output (they disclose downloads and the files an install writes). Ask once per set of missing items (the plain run and a later `--for` run may each find new ones). On yes, run `node <skill-dir>/scripts/doctor.mjs --fix <ids>` with the ids it reported, and the same `--for` you diagnosed with (for example `--fix <ids> --for check`). Hand the user the exact command to run themselves for anything the doctor reports as refused (it needs sudo, or has no automatic fix), skipped (needs node_modules first), installed elsewhere, still missing, or failed; in Claude Code suggest prefixing it with `!`. On no, do what you can without it and give the user the remaining commands.

## Workflow

Run every step yourself, in this same turn, with your shell or file tools. Do not end your reply after showing or describing the JSON: keep going until validate prints `valid` and the output file exists.

1. Write `motion.json` in the project (shape below; full reference in `<skill-dir>/references/schema.md`; copy a file from `<skill-dir>/references/examples/` to start).
   Actually create the file: describing it or announcing a patch is not enough. If your file tool fails, write it with a short `node -e` script that calls `fs.writeFileSync`, then confirm the file exists before validating.
2. Voiceover (only when asked, see above; run the doctor with `--for voiceover` first, and if the user declines the voice install, ask for a voice file instead): write the narration to `voice/<scene-id>.txt` (plain spoken text, no markdown), then `node <skill-dir>/scripts/voice.mjs --text-file voice/<scene-id>.txt --out voice/<scene-id>.wav [--voice af_heart] [--speed 1]` writes a 24 kHz wav and prints its length. Use `--text-file`, not a quoted argument: the shell would expand `$4.2M` or backticks inside a double-quoted string and the clip would silently say something else. One clip per scene, scene-anchored in the spec (`"scene": "<id>", "at": 0.3`); keep each clip shorter than its scene (lengthen the scene if the printed duration does not fit). Voices: `af_heart` (default, warm US female), `af_bella`, `am_michael` (US male), `bf_emma` (UK female); `--list-voices` prints all. Write the narration text yourself from the prompt; keep it short and spoken, no markdown.
3. `node <skill-dir>/scripts/validate.mjs motion.json` — fix every line it prints (`<json.path>: <message>`, with did-you-mean) and re-run until it says `valid`. Exit 0 ok, 1 spec errors, 2 usage/IO error.
4. Self-check: `node <skill-dir>/scripts/render.mjs motion.json --contact-sheet` writes `out/contact/<scene-id>.png` next to the spec (one frame per scene, at 85% of its duration). Look at each PNG: clipped text, invisible elements, overlaps, wrong fonts. Fix the spec and repeat.
5. `node <skill-dir>/scripts/preview.mjs motion.json [--open]` prints a localhost URL with scrubber, play/pause, scene markers, Space and arrow keys. The page reloads when the file changes. It plays the audio tracks in sync (approximate; M mutes); the MP4 timing is exact.
6. Set `generatedBy` to the model you are running as, your effort level if you know it, and your host (for example Claude Code, Codex, Copilot CLI, Gemini CLI). Never guess; leave out any field you do not know. `--model`, `--effort` and `--agent` on render.mjs override it. `node <skill-dir>/scripts/render.mjs motion.json [--out out/video.mp4] [--fps 30] [--size 1920x1080] [--model <m>] [--effort <e>] [--agent <a>]` writes the MP4 (H.264, yuv420p; AAC audio when the spec has tracks). It prints the path and frame count. The provenance goes into the MP4's `comment` and `artist` tags, and the preview page shows the same line in a footer.

When asked for a change ("slow scene 2", "make the title blue"), edit only the fields the request names in `motion.json`, then validate again. Do not rewrite the spec from scratch.

When done, report the spec path, the MP4 path with its duration and size, and one line per scene.

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
                         { "t": 0.6, "opacity": 1, "y": 480, "ease": "outCubic" } ] } ] } ],
  "audio": [
    { "src": "music.mp3", "volume": 0.4, "fadeOut": 2 },
    { "src": "voice.wav", "scene": "intro", "at": 0.5 } ]
}
```

- Root: `size` (default 1920x1080), `fps` (24, 25, 30, 60), `background`, optional `generatedBy` (`{ model?, effort?, agent? }`), optional `theme` (a shared theme name: `dusk`, `press`, `poster`, `paper`, `ink`, `blueprint`, `editorial` — its dark colours and fonts become the defaults; omit it for `dusk`), `scenes` (1–50, total ≤ 120 s). Only `scenes` is required.
- Audio track (optional root `audio` array, up to 20): `src` (relative to the spec, inside the spec folder; mp3, wav, m4a, aac, ogg or flac), `at` (seconds from the video start, default 0), `scene` (a scene `id`; `at` is then relative to that scene's start, so lengthening an earlier scene keeps a voiceover aligned), `duration` (trim, seconds), `volume` (0–1, default 1), `fadeIn` / `fadeOut` (seconds). `fadeOut` anchors to the `duration` trim or the video end; a clip that ends earlier gets no fade. No `loop`: a short music file just stops.
- Scene: `id`, `duration` (0.2–60 s), `elements`, optional `background` (a colour, or `"art"` for the theme's seeded art full-bleed behind the elements), `transition` (`none` or `fade`, a 0.4 s fade-in). Only one scene is visible at a time; scenes play back to back.
- Every element: `id` (unique in the whole spec), `type`, `x`, `y` (canvas pixels; the anchor is the element centre), optional `opacity`, `scale`, `rotate` (degrees), `keyframes`.
- Types: `text` (optional `"role": "title"`: the theme's display font and, without `keyframes`, its kinetic entrance), `counter` (`from`, `to`, `decimals`, `prefix`, `suffix`; animate `value`), `shape` (`rect`, `ellipse`, `line`; a line is horizontal of length `width`, use `rotate` to angle it; animate `draw` 0–1), `image` (`src` relative to the spec), `chart` (`vegaLite` with inline `data.values`, `width`, `height`; animate `reveal` 0–1 for a left-to-right wipe).
- Keyframe: `t` (seconds inside the scene, sorted, ≤ scene duration), optional `ease`, plus any animatable props for that type. Per property: it holds the first keyframe's value before it, interpolates to each later keyframe using that keyframe's `ease`, and holds the last value after. A property missing from a keyframe is interpolated across it. Frame *i* samples t = i/fps, so put the final keyframe at least one frame (1/fps s) before the scene end. A counter with no `value` keyframes counts from→to over min(2 s, 80% of the scene) with outCubic.
- Eases: `linear`, or `in|out|inOut` + `Quad|Cubic|Quart|Back|Elastic|Bounce|Sine|Expo|Circ`. Prefer `outCubic` / `outQuad` for entrances.

## Style defaults

The `dusk` theme when the spec names none: its dark page colour, Host Grotesk for text, Commit Mono for `"font": "mono"`, Funnel Display for `role: "title"`; 1920x1080 sizes (titles 72–120 px, body 40–48 px, captions ≥ 28 px). Charts get a dark theme automatically; put a Vega-Lite `config` in the chart to override it. Keep entrances short (0.5–0.9 s), stagger elements by 0.2–0.4 s, and stay under 15 s unless asked. Fonts are bundled; never use CDN URLs. Charts must carry inline data (`data.values`, or `datasets` + `data.name`); any `url` in a chart spec is rejected. Colours must be hex, rgb()/hsl() or named.

## Degraded mode

If Node, Chromium or ffmpeg cannot be installed here, still write and validate `motion.json` (validation needs only the skill's `node_modules`: run the doctor), then give the user the exact preview and render commands above to run themselves.

## Voiceover and audio notes

What the scripts do, and why:

- `voice.mjs` disposes the ORT session (`tts.model.dispose()`) in a `finally`; on failure it sets `process.exitCode` (never `process.exit()`) and lets the event loop drain. Exiting with a live session, or calling `process.exit()`, aborts with exit 134 / `mutex lock failed`. Keep it that way if you edit or wrap the script.
- Long narration is synthesised sentence by sentence: the text is split into sentences capped at 300 characters, each goes through its own `tts.generate()` call and the clips are joined, because Kokoro truncates one call at about 27 s. Pass the text with `--text-file`, never as a quoted argument.
- `amix` takes the first input's sample rate and channel layout, so every track is normalised with `aformat=sample_rates=48000:channel_layouts=stereo` before mixing and the encode pins `-ac 2`. Without it a mono 24 kHz voice listed first collapses stereo music.

## Security

The preview server binds 127.0.0.1 only and accepts only local Host headers, and serves only this skill's own folders plus the image and audio files the spec names. The renderer aborts every non-local request and sends a strict CSP. The validator is not the offline guarantee; the CSP and the renderer's request abort (`guardNetwork()`) are. No network access at validate, preview or render time. The one exception is `voice.mjs`: its first run downloads the Kokoro voice model (about 90 MB) from huggingface.co into `<skill-dir>/.cache/models`, after which it is offline too.
