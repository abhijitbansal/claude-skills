# Moving a version 1 film to version 2

make-motion 2 reads version 2 films only. A version 1 spec (one with `scenes`, or `"version": 1`) is refused with one error:

```
this is a version 1 spec; make-motion 2 reads version 2 only. See references/migrating.md
```

There is no migrator. You write the film again as a script of shots. This page says what each version 1 feature became, what is not in 2.0, and which old folders to delete.

## The three structural changes

1. **A script of shots replaces scenes and elements.** A version 1 film placed elements in scenes and keyed their properties by hand. A version 2 film is a list of shots. Each shot has an `id`, a `show` (its kind) and usually a `say` (what is spoken). The kind lays out the frame. `node scripts/make.mjs --list kinds` prints every kind with its fields and one example.
2. **Durations come from the narration.** A scene had a `duration`. A shot lasts as long as its `say` takes at the mode's pace, plus a short tail. A shot with no `say` takes `hold` (1 to 30 seconds). A shot takes `say` or `hold`, never both. `--outline` prints the timed script with no browser.
3. **A look replaces a theme.** A look is the whole style of the film: type, colour, motion and the marks a hand draws. Set `"look"` in the film. `node scripts/make.mjs --list looks` prints the looks. Each look serves the modes it names, and a look parks or excludes some kinds (see the table at the end of `SKILL.md`).

## Version 1 features

| Version 1 | Version 2 |
|---|---|
| Scenes, elements, keyframes, groups | Shots. Raw nodes with keyed tracks are the `free` kind, for what no designed kind covers |
| Scene `camera` and `shake` | Each kind runs its own camera. A `free` shot takes a `camera` object |
| `grade` (colour grade) | Not in 2.0. A `media` shot takes `treatment`: `none`, `duotone` or `halftone` |
| `texture` (vignette, grain) | Part of each look. Not a film field |
| 38 blocks and `blocks.mjs` | Sixteen kinds and `--list kinds`. Nearest kinds are in the next table |
| Nine themes and `--theme` | Seven looks and `"look"`. `--theme` is refused with a hint |
| Lottie elements | Not in 2.0. Removed by design: the package and its guard are gone |
| `video` elements | A clip in a `media` shot (`src`, `in`, `out`, `muted`) |
| Transitions (`transition` on a scene, `gl-ripple`, `gl-cube`) | Cuts: `cut` on a shot and a root `cut`. `node scripts/make.mjs --list cuts` prints them |
| Viral mode and its safe zone | `"mode": "viral"`. The safe zone is part of the mode. `viral.safeZone` is not a field |
| `viral.loop` | Root `"loop": true`. The review compares the last frame with the first |
| Root `loudness`, `--loudness`, `--true-peak` | Not in 2.0. A film is mastered to its mode's level. The flags are refused with a hint |
| `--fps`, `--size` | `fps` and `format` in the film. The flags are refused with a hint |
| `--quality draft` | Not in 2.0. `--sheets-only` writes the review stills and encodes nothing. `--preview` shows the film |
| `--contact-sheet` | Sheets are written on every run. `--sheets-only` writes them alone |
| `captions[].src` (a `.srt` or `.vtt` file as input) | Not in 2.0. Captions come from the narration (`"captions": true`). Put a caption file's words into `say`. `--subtitles srt` or `vtt` writes a subtitle file; it reads none |
| Caption styles (`plain`, `pill`, `karaoke`, `kinetic`, `boxed`, `typewriter`) | Not in 2.0. Each look draws its own caption style. `"captions": true` turns them on |
| `audio[]` (extra sound files) | `audio`: `[{ "src": "ding.wav", "at": 3 }]`, up to 20 files |
| Cues named `kenney:<name>` | Not in 2.0. The recorded samples are gone. Cues are synthesised: `pop`, `click`, `whoosh`, `chime`, `impact`, `riser`, `swoosh`, `drop`, `ding`, `sub`, `paper`, `marker`, `erase` |
| `"beat:<n>"` times | Not in 2.0. A `beat:` anchor is refused. Cut to music with `music.beats` and `music.snap` (SKILL.md, Workflow step 10) |
| Hand-drawn style (`style: "sketch"`), `erase` transition, hand tones, `sketch-icons.mjs`, Lucide icons | The `marker` look, with the `erase` cut. The icons are not in 2.0, and the marker hand has one colour: there are no hand tones |
| `check.mjs` | The review inside `make.mjs`. Findings are `mechanical` or `creative` |
| `validate.mjs` | `make.mjs` validates first. `--outline` validates and prints the outline with no browser |
| `render.mjs` | `make.mjs` |
| `preview.mjs` | `make.mjs film.json --preview [--open]` |
| `voice.mjs` (`--text-file`, a folder mode, `--list-voices`, `--phonemes`) | Narration is `say`. `--list voices` and `--phonemes` are flags of `make.mjs`. `--text-file` and the folder mode are not in 2.0 |
| `blocks.mjs` | `--list kinds` |

## Where each block went

These are the nearest kinds. A block that is not listed has no kind in 2.0.

| Version 1 block | Version 2 |
|---|---|
| `title-card` | `statement` |
| `kpi-counter`, `before-after` (two numbers) | `number`; `compare` with `"mode": "before-after"` |
| `step-flow`, `checklist`, `story-beats`, `listicle` | `list` (`"style": "steps"` or `"points"`); `diagram` for a flow |
| `quote-card`, `testimonial` | `quote` |
| `logo-outro`, `cta-close`, `cta-soft` | `end` |
| `comparison-split`, `before-after-swipe` | `compare` |
| `race` | `chart` with `"type": "race"` |
| `timeline` | `timeline` |
| `code-typing`, `code-diff`, `terminal-run` | `code` with `"mode": "type"`, `"diff"` or `"run"` |
| `map-highlight`, `flow-map` | `map` (`highlight`, `routes`) |
| `chat-thread`, `notification-stack` | `feed` |
| `browser-window` | `screen` |
| `sketch-diagram`, `sketch-steps`, `sketch-list`, `sketch-compare`, `sketch-callout` | The same kinds in the `marker` look |
| `lower-third`, `lower-third-tag`, `lower-third-social`, `lower-third-ticker` | Not in 2.0 |
| `text-behind-subject` | Not in 2.0. The `cutout` device places a picture with transparency, and `scripts/cutout.mjs` still makes one |
| `form-fields`, `tab-switch`, `button-state`, `side-panel` | Not in 2.0. Show the screen as a picture in a `screen` shot |

## Not in 2.0

- Lottie.
- Themes. A film has a look.
- Blocks. A film has shots of sixteen kinds.
- Scenes, elements, keyframes, groups and camera keyframes outside a `free` shot.
- Colour grade, and the root `texture`, `loudness` and `transition` fields.
- `--contact-sheet`, `--quality`, `--fps`, `--size`, `--loudness`, `--true-peak`, `--theme`. Each is refused with a hint that says what to do instead.
- A caption file as input, and the six caption styles.
- Recorded sample cues (`kenney:<name>`).
- `"beat:<n>"` times.
- `voice.mjs` as its own command, its `--text-file` option and its folder mode.
- Sketch icons and hand tones.
- `validate.mjs` and `check.mjs` as separate commands. Both run inside `make.mjs`.
- Lower thirds, and the `text-behind-subject`, `form-fields`, `tab-switch`, `button-state` and `side-panel` blocks.

## Old folders to delete

Version 2 writes none of these. Delete them to free the space.

- `<skill>/.cache/video`: decoded frames of version 1 `video` elements. `node scripts/doctor.mjs --fix cache` deletes it, and the cut-out cache beside it.
- The version 1 voice model: the folder `onnx-community/Kokoro-82M-v1.0-ONNX` inside the models folder. The models folder is `$CLAUDE_PLUGIN_DATA/models` when that variable is set, else `portable-artifacts/models` in the OS cache folder (`~/Library/Caches` on macOS, `~/.cache` or `$XDG_CACHE_HOME` on Linux, `%LOCALAPPDATA%\portable-artifacts\Cache` on Windows), else `<skill>/.cache/models`. Version 2 keeps its own model in `<skill>/.cache/models/onnx-community/Kokoro-82M-v1.0-ONNX-timestamped`. Keep that folder.
- The old voice packages: an install made before version 2 also holds `kokoro-js`, `@huggingface/transformers` and `sharp` under `optional/voice/node_modules`. It still works. To shrink it, delete `optional/voice/node_modules` and run `node scripts/doctor.mjs --fix kokoro`.

Do not delete `<skill>/.cache/cutout`. The cut-out tool still writes it.

## One film, before and after

Version 1 (refused):

```json
{
  "size": [1920, 1080], "fps": 30, "theme": "dusk",
  "scenes": [
    { "id": "intro", "duration": 4,
      "elements": [
        { "id": "title", "type": "text", "text": "Q3 revenue", "x": 960, "y": 380, "fontSize": 72,
          "keyframes": [ { "t": 0, "opacity": 0 }, { "t": 0.6, "opacity": 1 } ] },
        { "id": "pct", "type": "counter", "from": 0, "to": 18, "suffix": "%", "x": 960, "y": 560, "fontSize": 200 }
      ] }
  ]
}
```

Version 2 (the same idea):

```json
{
  "version": 2,
  "mode": "pro",
  "look": "desk",
  "shots": [
    { "id": "intro", "show": "statement", "say": "Q3 revenue grew *again*." },
    { "id": "pct", "show": "number", "say": "Eighteen percent.", "value": 18, "suffix": "%", "label": "Q3 growth" }
  ]
}
```

The title is a `statement`. The counter is a `number` that counts up to its `value`. Nobody writes a position, a size or a keyframe. The narration sets how long each shot lasts.
