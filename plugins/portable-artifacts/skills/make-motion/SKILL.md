---
name: make-motion
description: Use when the user wants a short animated explainer video (titles, counters, shapes, charts, images with keyframed motion) previewed locally and exported to MP4, with music or a voiceover only when asked; spec-driven, offline, open source, works with any agent that can run shell commands.
argument-hint: what to make, e.g. an 8s clip with Q3 revenue up 18% then a bar chart of Q1-Q3
model: haiku
effort: low
---

# make-motion

You write one JSON file, `motion.json`. Scripts validate it, preview it in a browser and render it to MP4. You never write animation code, and you never edit generated output.

Run every command from the project folder (where `motion.json` lives), using the full path to the scripts. Image paths resolve relative to the spec file. If the request is empty, ask what the video should say, how long it should be, and the format (default 16:9, 30 fps). Before writing a spec, or handing the work to another agent, run the Intake (one round) section below, and put its answers in the hand-off brief.

**Audio is opt-in.** Add `audio` tracks only when the prompt asks for sound (music, soundtrack, voiceover, narration, "read it aloud", a sound effect, a click or a whoosh) or the user confirms when you ask. Never add audio to a prompt that does not mention it. A music or voice file the user names, in the prompt or in the intake round, counts as asking for that track. When the prompt is about sound but unclear (for example "make it feel polished" with an mp3 in the folder), put it in the intake round (see Intake (one round)) rather than asking separately. Music and sound effects are files the user supplies; a voiceover can be synthesised with `voice.mjs` (workflow step 2) when the prompt asks for narration without giving a file. Short UI-style sounds need no file: the root `cues` array (below) synthesises them locally.

## Cheaper model

Skip this section if you are running in Claude Code (it already runs this skill on the model named in the frontmatter), or if `artifact-builder` is not in your list of available agents. Otherwise, if you can start another agent, start the `artifact-builder` agent to do the work, unless you are already artifact-builder. If you are already artifact-builder, skip the rest of this section and do the work yourself.

Give it a self-contained brief. It has no memory of this conversation, so the brief must say:

1. What to build, and every fact and choice from this conversation that affects it (data, names, wording, theme, what the user asked for and what they ruled out).
2. This skill directory: the full path of the folder that holds this SKILL.md.
3. The spec path: where it should write the JSON spec.
4. Optionally, an output folder for the build (it passes this to the build script as `--out`).

Relay only the output path it returns. Do not repeat its work.

If the `artifact-builder` agent is not installed, or you cannot start another agent, continue with the steps below yourself.

## Before the first build

`<skill-dir>` is the folder containing this SKILL.md. Run `node <skill-dir>/scripts/doctor.mjs --json` (add `--for <spec.json>` once the spec exists, `--for voiceover` for a voiceover (make-motion), `--for check` before `check.mjs` (skills that have one)). It needs only Node.

If it reports anything missing, tell the user in one message: each item, why it is needed, its size and the command, plus every `notes` and `info` entry from the output (they disclose downloads and the files an install writes). Ask once per set of missing items (the plain run and a later `--for` run may each find new ones). On yes, run `node <skill-dir>/scripts/doctor.mjs --fix <ids>` with the ids it reported, and the same `--for` you diagnosed with (for example `--fix <ids> --for check`). Hand the user the exact command to run themselves for anything the doctor reports as refused (it needs sudo, or has no automatic fix), skipped (needs node_modules first), installed elsewhere, still missing, or failed; in Claude Code suggest prefixing it with `!`. On no, do what you can without it and give the user the remaining commands.

## Intake (one round)

Before writing the spec, ask once. Send one message that lists every option below with its default, so the user can answer in one reply, or say "defaults". Ask before any hand-off to `artifact-builder` and put the answers in its brief. Leave out an option the prompt already settles ("a 9:16 clip", "with a voiceover") and say what you took from it. If the prompt already settles every option that matters, skip the round and build. Then build; do not ask again.

- **format**: `16:9` (default), `9:16` for Reels, TikTok and Shorts, `1:1` or `4:5`. Write the name you take as the spec's `format`; it sets the size.
- **length**: about 10 s (default); 8 to 30 s works well.
- **assets**: your own files in the project folder. Photos or a logo (PNG, JPG, SVG), clips (mp4, mov, webm, m4v), music and a voice file (mp3, wav, m4a, aac, ogg, flac). Default: none, so the video is built from text, shapes and charts. Naming a music or voice file here counts as asking for that track.
- **voiceover**: narration synthesised on this machine with Kokoro. Default: off. Saying yes means a one-time install of about 250 MB plus a 90 MB voice model (the doctor check in Before the first build asks again before it installs). A voice file in assets replaces it.
- **sound**: short synthesised cues (pop, click, whoosh, chime, impact, riser, swoosh, typing, drop, ding), or none. Default: none; the audio opt-in rule above stands.
- **theme**: `dusk`, `press` or `poster`, as in Choosing a theme. Default: the one that section picks for the prompt, `dusk` when unclear.
- **CTA**: a closing line and what to do (for example "Try it free at example.com"). Default: none.
- **captions**: on-screen words from an SRT, VTT or Whisper JSON file in the project folder, or from the voiceover's sentence timings, in one style: `plain`, `pill`, `karaoke` (the spoken word highlighted), `kinetic`, `boxed` or `typewriter`. Default: off; `plain` when on without a style.

If the prompt asks you to build and you cannot pause for an answer, skip the round and build with the defaults. That covers `claude -p`, `codex exec`, `copilot -p`, the eval, or any run that cannot pause for an answer. Do not ask a question in place of a spec. Your final report then carries one line with the value you actually used for each option, not the defaults when the prompt settled something else:

`intake: skipped (<reason>); values used: format <format>, length <seconds> s, assets <files or none>, voiceover <on or off>, sound <cues or none>, theme <name>, CTA <text or none>, captions <style or off>`

Fill `<reason>` with why you could not ask. With nothing settled by the prompt the line reads `format 16:9, length 10 s, assets none, voiceover off, sound none, theme <name>, CTA none, captions off`.

## Workflow

Run every step yourself, in this same turn, with your shell or file tools. Do not end your reply after showing or describing the JSON: keep going until validate prints `valid` and the output file exists.

1. Write `motion.json` in the project (shape below; full reference in `<skill-dir>/references/schema.md`; copy a file from `<skill-dir>/references/examples/` to start).
   Actually create the file: describing it or announcing a patch is not enough. If your file tool fails, write it with a short `node -e` script that calls `fs.writeFileSync`, then confirm the file exists before validating.
2. Voiceover (only when asked, see above; run the doctor with `--for voiceover` first, and if the user declines the voice install, ask for a voice file instead): write the narration to `voice/<scene-id>.txt` (plain spoken text, no markdown), then `node <skill-dir>/scripts/voice.mjs --text-file voice/<scene-id>.txt --out voice/<scene-id>.wav [--voice af_heart] [--speed 1]` writes a 24 kHz wav and prints its length; it also writes `voice/<scene-id>.json` with sentence times (`{ sampleRate, voice, sentences: [{ text, start, end }] }`, seconds from the clip start), and prints that path on a third line; use it as a captions `src`. Use `--text-file`, not a quoted argument: the shell would expand `$4.2M` or backticks inside a double-quoted string and the clip would silently say something else. One clip per scene, scene-anchored in the spec (`"scene": "<id>", "at": 0.3`); keep each clip shorter than its scene (lengthen the scene if the printed duration does not fit). Voices: `af_heart` (default, warm US female), `af_bella`, `am_michael` (US male), `bf_emma` (UK female); `--list-voices` prints all. Write the narration text yourself from the prompt; keep it short and spoken, no markdown.
3. `node <skill-dir>/scripts/validate.mjs motion.json` — fix every line it prints (`<json.path>: <message>`, with did-you-mean) and re-run until it says `valid`. Exit 0 ok, 1 spec errors, 2 usage/IO error.
4. Self-check, look then check: `node <skill-dir>/scripts/render.mjs motion.json --contact-sheet` writes one tiled sheet per scene to `out/contact/<scene-id>.png` next to the spec. Each tile is the scene at one moment, stamped `<scene-id> · <seconds>s`: 0.1 s in, 0.1 s after each keyframe lands, 85% of the scene, and its last frame. A scene with more than 11 moments shows 11 of them (12 tiles in all) and says so on stderr (`<scene-id>: N moments, showing 11`). When the frame is wider than 360 px, the last tile repeats the last frame at 360 px wide, as a phone shows it. Open every PNG and look for clipped text, overlaps, invisible elements, wrong fonts, and text too small to read on the phone tile. Then run `node <skill-dir>/scripts/check.mjs motion.json [--theme <name>]` (run the doctor with `--for check` first; pass the same `--theme` you render with). It seeks the same kind of moments in the real page, all of them rather than only the 11 a sheet shows, and prints one line per problem (`scenes[i].elements[j]: <message>`, or `scenes[i]: …` for a whole scene): visible text or a counter outside the safe area (60 px at 1080 on the short side, on every side) while it is not moving; two visible texts or counters overlapping while neither is moving or fading (a cross-fade swap in one spot is fine); a scene that ends with nothing on screen; with `captions`, a text or counter held in the caption zone while a caption shows (`text "sub" sits in the caption zone (y >= 842) at 1.00s; move it above y 842 or end the captions before it`) and a captions layer outside the zone. An element that has left the frame entirely counts as gone, not clipped. Exit 0 ok, 1 problems, 2 usage error; without a browser it prints `check: skipped (no browser: …)` and exits 0, so rely on the sheets. Fix the spec and repeat both.
5. `node <skill-dir>/scripts/preview.mjs motion.json [--open]` prints a localhost URL with scrubber, play/pause, scene markers, Space and arrow keys. The page reloads when the file changes. It plays the audio tracks in sync (approximate; M mutes); the MP4 timing is exact.
6. Set `generatedBy` to the model you are running as, your effort level if you know it, and your host (for example Claude Code, Codex, Copilot CLI, Gemini CLI). Never guess; leave out any field you do not know. `--model`, `--effort` and `--agent` on render.mjs override it. `node <skill-dir>/scripts/render.mjs motion.json [--out out/video.mp4] [--fps 30] [--size 1920x1080] [--model <m>] [--effort <e>] [--agent <a>]` writes the MP4 (H.264, yuv420p; AAC audio when the spec has tracks). It prints the theme it drew (`theme: <name>`, first line), then the path and frame count. The provenance goes into the MP4's `comment` and `artist` tags, and the preview page shows the same line in a footer.

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

- Root: `format` (`16:9`, `9:16`, `1:1` or `4:5`; a preset that sets the size, the safe area and the caption zone), `size` (default 1920x1080; leave it out when you set `format`, a `size` that disagrees with it is an error), `fps` (24, 25, 30, 60), `background`, optional `generatedBy` (`{ model?, effort?, agent? }`), optional `theme` (a shared theme name: `dusk`, `press`, `poster`, `paper`, `ink`, `blueprint`, `editorial`, `mono`, `brief` — its dark colours and fonts become the defaults; omit it for `dusk`), `scenes` (1–50, total ≤ 120 s). Only `scenes` is required. For a vertical or square clip set `format` (`16:9`, `9:16`, `1:1`, `4:5`) instead of `size`; keep captions in the caption zone the format defines (the lower part of the safe area: from 78 % of the height down, 72 % for `9:16` and `4:5`), so keep other text above it.
- Audio track (optional root `audio` array, up to 20): `src` (relative to the spec, inside the spec folder; mp3, wav, m4a, aac, ogg or flac), `at` (seconds from the video start, default 0), `scene` (a scene `id`; `at` is then relative to that scene's start, so lengthening an earlier scene keeps a voiceover aligned), `duration` (trim, seconds), `volume` (0–1, default 1), `fadeIn` / `fadeOut` (seconds). `fadeOut` anchors to the `duration` trim or the video end; a clip that ends earlier gets no fade. No `loop`: a short music file just stops.
- Sound cue (optional root `cues` array, up to 30; opt-in like `audio`, a spec without it has no cue and no audio change): `cue` (`pop`, `click`, `whoosh`, `chime`, `impact`, `riser`, `swoosh`, `typing`, `drop` or `ding`), `at` (seconds, required except with `follow`), `scene` (a scene `id`; `at` is then relative to it, so retiming keeps the cue on its beat), `volume` (0–1, default 1, literal), `pan` (-1 left to 1 right), `note` (a pitch such as `A4` or `C#5`, for `pop`, `chime`, `impact`, `drop` and `ding` only). A `typing` cue with `follow: "<text id>"` clicks along with that text's typing (no `at` or `scene` then). A `whoosh` is loudest 0.4 s in and a `riser` builds for 1.6 s, so start them that much before the moment they mark. The sounds are generated deterministically at render time (the same spec gives the same audio), mixed with any `audio` tracks, and skipped by the preview. Use few: at most one `impact` and one `whoosh` or `riser` per clip, and nothing under continuous motion (see `references/motion-design.md`). After a render with audio, `render.mjs` prints `audio: <n> LUFS integrated, true peak <n> dBTP`; it is information, not a gate.
- Captions (optional root `captions` array, up to 20; off unless the prompt or the intake asks for them): `src` (relative to the spec, inside the spec folder: an `srt`, `vtt` or Whisper `json` file the user gives, or the voice sidecar `voice/<scene-id>.json`), `style` (`plain` (default), `pill`, `karaoke`, `kinetic`, `boxed` or `typewriter`), `at` and `scene` (timed like an audio track: give a voiceover's captions the same `scene` and `at` as its audio track; only one track may show at a time, so give a second track a later `at` or `scene`). Captions sit in the caption zone, 2 to 6 words at a time, over every scene; keep every other text box above the zone (its bottom edge above y 842 at 1920x1080, 1382 at 9:16). Never invent caption text in a file of your own unless the prompt gives the words; from the voice sidecar the word timing inside a sentence is estimated, so `karaoke` and `kinetic` follow the voice only roughly.
- Texture (optional root `texture`, off by default): `vignette` (true darkens the corners) and `grain` (0–0.15, static film grain per scene, seeded from the scene `id`, so renders stay identical). Both slow the render a lot (measured at 1080p: about 42 ms per frame for the vignette, 100 ms for grain, 187 ms for both, against 17–33 ms for none); add them only when the prompt asks for a filmic, grainy or vintage look.
- Scene: `id`, `duration` (0.2–60 s), `elements`, optional `background` (a colour, or `"art"` for the theme's seeded art full-bleed behind the elements), `transition` (`none`, `fade` (a 0.4 s fade-in from the background) or `crossfade` (the new scene fades in over the previous one, which stays fully visible beneath, over 0.4 s; not on the first scene); a root `transition` sets the default). Only one scene is visible at a time, except during a crossfade; scenes play back to back. Do not put `fade` on scene 1: frame 0 is the video's thumbnail and `check.mjs` warns when it is blank.
- Every element: `id` (unique in the whole spec), `type`, `x`, `y` (canvas pixels; the anchor is the element centre; a group's children measure them from the group's centre instead), optional `opacity`, `scale`, `rotate` (degrees), `keyframes`.
- Types: `text` (optional `"role": "title"`: the theme's display font and, without `keyframes`, its kinetic entrance; `"typing": true` types it out from the scene start at 0.035 s per character with a caret, its box always the full text), `counter` (`from`, `to`, `decimals`, `prefix`, `suffix`; animate `value`), `shape` (`rect`, `ellipse`, `line`; a line is horizontal of length `width`, use `rotate` to angle it; animate `draw` 0–1; `"elevated": true` makes a rect a card, `"cap": "round"` and `"arrow": "end"` shape a line), `image` (`src` relative to the spec), `video` (`src` an mp4, mov, webm or m4v relative to the spec, `width`, `height`, `fit`; optional `trimStart` and `trimEnd` (seconds into the clip), `offset` (scene seconds before it plays; it holds its first frame before and its last frame after), `mute`, `volume` 0–1; its sound joins the mix unless muted and stops when its scene ends; needs ffmpeg and ffprobe), `chart` (`vegaLite` with inline `data.values`, `width`, `height`; animate `reveal` 0–1 for a left-to-right wipe), `group` (`children`: 1–40 elements, up to 3 groups deep, each positioned relative to the group's centre; the group's own `x`, `y`, `opacity`, `scale`, `rotate` and `keyframes` move them as one, so build a card or a lower-third once and animate it as a unit; child `id`s are unique across the whole spec).
- Keyframe: `t` (seconds inside the scene, sorted, ≤ scene duration), optional `ease`, plus any animatable props for that type. Per property: it holds the first keyframe's value before it, interpolates to each later keyframe using that keyframe's `ease`, and holds the last value after. A property missing from a keyframe is interpolated across it. Frame *i* samples t = i/fps, so put the final keyframe at least one frame (1/fps s) before the scene end. A counter with no `value` keyframes counts from→to over min(2 s, 80% of the scene) with outCubic.
- Eases: `linear`, or `in|out|inOut` + `Quad|Cubic|Quart|Back|Elastic|Bounce|Sine|Expo|Circ`, or the named `enter` (entrances), `exit` (exits), `move` (from one place to another) and `land` (a small overshoot; once per clip). Prefer `enter` (or `outCubic`) for entrances.

## Choosing a theme

Nine themes exist; `dusk` is the default. Pick one (the spec's theme field, or `--theme <name>` on the render) in this order:

1. A theme the user names ("use poster") wins. Use it as given: write it as the spec's theme field. On the render, `--theme <name>` only fills in for a spec that names none, so a theme already in the spec wins over the flag.
2. Otherwise infer it from the prompt and say which theme and why in one line. Dense docs, long reads, changelogs and branch recaps: `press`. Launch decks, pitches, demos and energetic clips: `poster`. Everything else, or unclear: `dusk`.
3. If the prompt is genuinely split between two themes, ask the user in the intake round (`## Intake (one round)`), not separately, and list all three with a one-line feel each: `dusk` is soft, warm and playful; `press` is print editorial, calm and long-form; `poster` is loud, condensed and high-energy.
4. If you cannot ask, use `dusk`.

The older themes `paper`, `blueprint`, `ink` and `editorial` stay available by name; use one only when the user names it. Two more are available by name only: `mono` (terminal and engineering console, dark mode near-black with a cyan accent) and `brief` (executive, warm white with a burgundy accent); `mono` and `brief` are the plan-page themes of make-explainer (see its Plan mode).

## Style defaults

The `dusk` theme when the spec names none: its dark page colour, Host Grotesk for text, Commit Mono for `"font": "mono"`, Funnel Display for `role: "title"`; 1920x1080 sizes (titles 72–120 px, body 40–48 px, captions ≥ 28 px). Charts get a dark theme automatically; put a Vega-Lite `config` in the chart to override it. Keep entrances 0.6–0.9 s, stagger 0.09 s per word or 0.2–0.25 s per list item, and stay under 15 s unless asked. For timing, holds, the named eases and `"exit": true` (a titled text's opt-in exit before a scene cut), read `<skill-dir>/references/motion-design.md`. Fonts are bundled; never use CDN URLs. Charts must carry inline data (`data.values`, or `datasets` + `data.name`); any `url` in a chart spec is rejected. Colours must be hex, rgb()/hsl() or named; a shape `fill`/`stroke` or text `color` may instead name a theme token (`surface`, `line`, `accent`, `accentSoft`, `good`, `bad`, `warn`, `text`, `text2`, `text3`, `cat1`..`cat6`), which follows the theme. For cards use `"fill": "surface"` with `"stroke": "line"` and `"elevated": true`, not hand-picked hex.

## Degraded mode

If Node, Chromium or ffmpeg cannot be installed here, still write and validate `motion.json` (validation needs only the skill's `node_modules`: run the doctor), then give the user the exact preview and render commands above to run themselves.

## Voiceover and audio notes

What the scripts do, and why:

- `voice.mjs` disposes the ORT session (`tts.model.dispose()`) in a `finally`; on failure it sets `process.exitCode` (never `process.exit()`) and lets the event loop drain. Exiting with a live session, or calling `process.exit()`, aborts with exit 134 / `mutex lock failed`. Keep it that way if you edit or wrap the script.
- Long narration is synthesised sentence by sentence: the text is split into sentences capped at 300 characters, each goes through its own `tts.generate()` call and the clips are joined, because Kokoro truncates one call at about 27 s. Pass the text with `--text-file`, never as a quoted argument.
- `amix` takes the first input's sample rate and channel layout, so every track is normalised with `aformat=sample_rates=48000:channel_layouts=stereo` before mixing and the encode pins `-ac 2`. Without it a mono 24 kHz voice listed first collapses stereo music.

## Security

The preview server binds 127.0.0.1 only and accepts only local Host headers, and serves only this skill's own folders plus the image, video and audio files the spec names (and, for render and check, the frames decoded from those videos). The renderer aborts every non-local request and sends a strict CSP. The validator is not the offline guarantee; the CSP and the renderer's request abort (`guardNetwork()`) are. No network access at validate, preview or render time. The one exception is `voice.mjs`: its first run downloads the Kokoro voice model (about 90 MB) from huggingface.co into `<skill-dir>/.cache/models`, after which it is offline too.
