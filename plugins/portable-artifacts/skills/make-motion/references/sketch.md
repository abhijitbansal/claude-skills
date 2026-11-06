# Hand-drawn style

A hand draws each scene on a white board, one stroke at a time. `SKILL.md` says when to use it. This file has the details. `<skill-dir>` is the folder that holds `SKILL.md`.

## Start from a film

Copy one of these from `references/examples/` and change the words. Each one validates, passes `check.mjs` and renders.

| file | shows | transition |
|---|---|---|
| `sketch-architecture.json` | a diagram over three boards: a request flow, the same flow with a cache, one rule | `erase` |
| `sketch-concept.json` | a list, then two call-outs | `push` |
| `sketch-steps.json` | a process of four steps, then a tip | `erase` |
| `sketch-mixed.json` | a standard title, a drawn board, a standard closing ask | `crossfade`, `fade` |

`references/examples/blocks/sketch-steps.json` is a different file: the one-block example for `blocks.mjs`.

## Spec fields

```json
{
  "style": "sketch",
  "sketch": { "hand": { "tone": "medium", "scale": 1 }, "seed": 1, "pace": 1 },
  "scenes": [ { "id": "flow", "duration": 11, "elements": [] } ]
}
```

- `style`: `standard` (default) or `sketch`. At the root it sets the default for every scene. A scene can write its own.
- `sketch.hand.tone`: `light`, `medium` (default), `tan`, `brown` or `dark`.
- `sketch.hand.scale`: 0.5 to 1.2, default 1. It scales with the short side of the canvas.
- `sketch.seed`: a whole number. The same seed draws the same wobble. Each element's wobble comes from the seed and its `id`, so adding an element does not change the others.
- `sketch.pace`: 0.5 to 2, default 1. It speeds up or slows down all drawing.
- A mixed film: leave the root `style` out and write `"style": "sketch"` on the drawn scenes. The root `theme` still styles the standard scenes.
- Ids are unique in the whole film. Two scenes cannot both have an element `title`. Write `title-flow` and `title-cache`.

## What a drawn scene allows

| element | what it does |
|---|---|
| `text` | Written in a handwriting font, left to right. Default `fontSize` 72 (at 1080), larger than standard text because handwriting reads small. It wraps at 80% of the width. `maxWidth` and `align` work. |
| `shape` | `rect` and `ellipse` are outlined by the hand. `"fill": "scribble"` hatches them in the accent colour. `line` has `to` (`{ "x", "y" }`) and `bow` to bend it. `"arrow": "end"` adds a head. |
| `icon` | A line icon, drawn stroke by stroke. Fields: `name`, `size`, `color`. |
| `group` | Its children are drawn in order. |
| `block` | The sketch blocks only: `sketch-diagram`, `sketch-steps`, `sketch-list`, `sketch-compare`, `sketch-callout`. |

Any other element type is an error that says to use a standard scene: `chart`, `image`, `video`, `lottie`, `code`, `counter` and every standard block. A sketch block in a standard scene is an error too.

These are errors in a drawn scene because the drawing decides how things appear: `keyframes`, `typing`, `role`, `exit`, `font`, `fontWeight`, `scale` and `rotate` on an element, and the scene's `camera` and `"background": "art"`. Still allowed: `opacity`, `hold` and `drawAt`.

The font has Latin letters only. A character it lacks is an error that names it.

Run `node <skill-dir>/scripts/blocks.mjs show <name>` for the params of a block and the place to put it (`x 960, y 451` at 16:9). The drawing may sit lower, for example `y 540` under a title at `y 170`, if nothing overlaps.

## The look

Board `#fdfcf8`, ink `#1d2330`, accent `#e8590c`, inside drawn scenes only. The tokens `text`, `line`, `accent` and `surface` take these colours there. A scene `background` colour replaces the board.

Plain lines (an underline, a rule) wander by about 3 px at 1080. Arrows wander less, about 1.3 px, so they stay straight. Box outlines wander by about 2.6 px.

## Timing

- Elements are drawn in document order, one after another. The hand travels between strokes. Put a title first.
- Pace at 1080 on the short side: 2700 px per second for lines and 22 characters per second for writing, times `sketch.pace`.
- `drawAt` (seconds inside the scene) starts an element later.
- A scene needs at least the time its drawing takes plus the time the hand takes to leave (0.65 s). `validate.mjs` names it: `this drawing needs a scene of at least 14.2s`. Add about 2 s so the finished board can be read.
- A transition into a scene delays its drawing until the transition ends. `erase` takes 0.8 s, any other 0.4 s unless you set `duration`. The needed time already includes this.
- Silent boards: `check.mjs` reports a finished, unchanging board that stays more than 3 s, except in the last 3 s of the film. With a voice track the board may sit while the narration plays.
- The thumbnail: frame 0 of a film that opens on a drawn scene is a blank board. `check.mjs` warns once. This is expected. Take the thumbnail from a drawn moment with `node <skill-dir>/scripts/render.mjs motion.json --poster <seconds>`.

## Voice sync

A drawn scene whose voice track has a sidecar draws its elements during the sentences. No timing to write.

1. Write the narration to `voice/<scene-id>.txt`, one sentence for each top-level element, in drawing order.
2. `node <skill-dir>/scripts/voice.mjs --text-file voice/<scene-id>.txt --out voice/<scene-id>.wav --phonemes` writes the wav and `voice/<scene-id>.json` (sentence times). Check the phonemes as in `SKILL.md` Workflow step 2.
3. Add the track: `{ "src": "voice/<scene-id>.wav", "scene": "<scene-id>", "at": 1 }`. `at` is scene seconds. Start it after the transition into the scene ends. The scene must last past the end of the narration.
4. Never write `narration` in a scene. It is resolved from the sidecar. A written one is an error.

Rules:

- Element k is drawn during sentence k. A block counts as one element, and its parts share its window.
- With a different number of elements and sentences, the elements share the whole narration, each in proportion to how long its drawing takes.
- `"drawAt": "sentence:<n>"` pins an element to a sentence. `n` counts from 0. The element starts at that sentence. Pins must not go backwards: a pin that comes before an earlier pin is an error. Elements after a pin go with the sentences from the pin on, until the next pin.
- Inside its window a drawing is stretched, down to half the normal pace. A drawing that is too long for its window is squeezed, up to twice the normal pace.
- A drawing that still does not fit at twice the pace is an `overruns` problem. Only `check.mjs` reports it, with the element and the seconds it needs. `validate.mjs` does not, because a voiced scene follows its voice. Run `check.mjs` on every narrated drawn film. Fix it with a longer sentence (more words), a shorter drawing or a different pin.

## Hand tones and icons

- Tones: `light`, `medium`, `tan`, `brown`, `dark`. Pick the one the user asked for. When unsure, use `medium`.
- Icons come from the Lucide set. Find a name with `node <skill-dir>/scripts/sketch-icons.mjs search <word>`. `node <skill-dir>/scripts/sketch-icons.mjs list` prints every name. An unknown name is an error with a did-you-mean.

## Transitions

- `erase`: the hand sweeps across and the board clears. Only between two drawn scenes. Any other pair is an error that says so. It takes 0.8 s.
- `push`, `slide`, `wipe`, `crossfade`, `fade` and the rest work between two drawn scenes and between a standard scene and a drawn one. Use `fade` or `push` into a standard scene, not `crossfade` when text of both scenes would overlap: `check.mjs` warns about that.
- The hand is off screen when a drawn scene ends, so no transition shows it cut off.

## What `check.mjs` adds

- The hand does not count as an element for overlap or contrast.
- Text being written counts as moving, so it is judged after it finishes.
- A drawing in progress counts as change for the dead-stretch audit.
- A warning when writing is not finished at the end of a scene.
- A blank first frame is a warning that suggests `--poster`.

Viral mode (a platform) does not take drawn scenes. A drawn scene in a `"mode": "viral"` spec is an error.
