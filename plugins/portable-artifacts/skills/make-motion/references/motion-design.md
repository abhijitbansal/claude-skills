# Motion design for make-motion

Rules of thumb for timing a clip so it reads well. They are guidance: `scripts/check.mjs` enforces only the safe area, overlapping text and empty scene endings (see the end of this page). Look at the contact sheets for everything else.

Timing numbers adapted from whaleyxbt/claude-motion, MIT.

## Entrances and exits

- **Entrances take 0.6–0.9 s** with the `enter` ease: the element covers most of its way early and settles softly. A title with `"role": "title"` and no keyframes already gets its theme's entrance (dusk rise 0.9 s, press ink-in 1.1 s, poster slam 0.5 s); ink-in and slam sit outside the range on purpose, as the slow and the snappy character of their themes.
- **Exits take about half as long as the entrance** with the `exit` ease: they start slowly and speed away, so the eye has already let go. Fade out, or move a short way and fade; do not fly text across the frame.
- **Moves from one place to another** use `move` (symmetric: eases in and out).
- **Linear is only for continuous motion**: a slow drift, a progress bar, a ticker. Never for an entrance or an exit.
- **`land` overshoots about 1 % before it settles.** Use it for at most one moment per clip, the hero moment, never as the default. Never use `land` on a counter's `value`: the number would show past its target (1,009 for a count to 1,000) for several frames.

## Opt-in title exits: `"exit": true`

Set `"exit": true` on a `role: "title"` text that has no `keyframes`, and it leaves before the cut with its theme's exit, in the `exit` ease:

| Theme (entrance) | Exit | Length |
|---|---|---|
| dusk (rise) | fades as it drops 0.35 × `fontSize` | 0.45 s |
| press (ink-in) | fades as it grows back to 104 % | 0.55 s |
| poster (slam) | fades as it snaps down to 85 % | 0.25 s |

The exit lands one frame before the scene ends and never starts before 90 % of the scene, so the 85 % contact-sheet frame always shows the title fully in. When the full length does not fit after 90 %, the exit starts at 90 % and is shortened to fit, and it is dropped only when the entrance has not finished by then. There is no exit on the last scene of the spec (the video ends on the title), on a scene so short the entrance is still running at 90 %, or on a title with its own `keyframes` (yours win). Themes without an entrance preset (`paper`, `ink`, `blueprint`, `editorial`) have no exit either.

A title card that exits this way may leave its scene empty: `check.mjs` counts an applied `exit` as intended. A scene emptied by your own fade-out keyframes is still reported.

## Stagger

- **Words: 0.09 s apart** when a line builds word by word (one text element per word).
- **List items, cards, bars: 0.2–0.25 s apart.** A wider gap reads as separate beats; a smaller one as a single blur.

## Reading holds

Give the viewer time to read before anything else moves:

- **Hold at least 1 s, plus 0.25 s for every word beyond three.** A six-word line needs about 1.75 s fully on screen.
- **Hold the closing frame at least 2 s**: the last thing the viewer sees should stay put.

Holds are not checked by `check.mjs`. Count them yourself from the keyframe times.

## Layout and emphasis

- **Safe area: 60 px at 1080 on the short side**, on every side (60 × min(width, height) / 1080: 60 px at 1920x1080, 1080x1080 and 1080x1920, 120 px at 3840x2160). Keep text and counters inside it while they are still. `check.mjs` reports visible text or a counter outside it while it is not moving.
- **One accent colour.** The theme's accent marks the one thing that matters in a scene (the number, the highlighted bar). Everything else uses the text colours.
- **One hero moment per clip.** Pick the beat the clip is about and give it the biggest type, the accent, and the `land` ease if any (on its position or scale, never on a counter's `value`). Other beats stay quieter.

## Scene changes

- **A hard cut is the default.** Between related scenes (the same chart, the next step of a list) a hard cut reads as continuous; a `"transition": "crossfade"` (0.4 s, the new scene fading in over the previous one, which stays fully visible beneath) suits a change of subject. Set root `"transition": "crossfade"` to make it the default and put `"transition": "none"` on the scenes that should cut.
- **Motion transitions are for a change of place or step.** `push` and `slide` suit a sequence (step 1 to step 2), `wipe` and `iris` a reveal, `zoom` a move closer, `blur` a soft change of subject; keep them 0.3–0.6 s and use one or two kinds per video, not one per scene.
- **Not on scene 1.** `fade` on the first scene makes frame 0, the video's thumbnail, blank; `crossfade`, `push`, `slide`, `wipe`, `zoom`, `blur` and `iris` there are errors. `check.mjs` warns when scene 1 shows nothing at t = 0.
- **Keep the outgoing text clear of the incoming text's position** (or end it with an `exit`): during the window (0.4 s unless `duration` is set) both scenes are on screen. In a `crossfade` the old text is fully visible and the new text fades in over it; in `zoom` and `blur` the new scene fades in over the old one; in `wipe`, `slide` and `iris` in the new scene covers the old one from an edge or the centre, and in `iris` out the old scene closes to a circle over the new one; only `push` keeps them apart. Two lines in one spot read as a smear. `check.mjs` warns about it (not for a `push`).

## Camera

- **A slow push-in is the cheapest way to make a still scene feel alive**: `zoom` 1 to 1.05–1.15 over the whole scene with an `inOutQuad` ease. It also keeps `check.mjs` quiet about a dead stretch.
- **Settle where the text is safe.** `check.mjs` judges text where the camera rests, so end a push at a zoom the text still fits at (a 1.2 zoom throws anything within 12% of the edge out of frame), or finish the move back at 1.
- **Pan to a place, then stop.** Ease a `x` pan out (`outCubic`) so the camera lands on the card it is showing; pair a small `rotate` with it for a handheld feel and return it to 0.
- **Shake is for a hit.** `amount` 6–14 px at `hz` 10–14 on the scene where something lands; more than that reads as a fault. A shake runs for the whole scene, so give the hit a short scene of its own. The same `seed` always shakes the same way.
- **The background stays put.** The camera moves the elements over a still colour or art plate; that is what keeps a pan or a shake from ever showing the edge of the picture.
- **One camera idea per scene.** A push-in with a pan and a roll at once reads as drift.

## Texture and typing

- **Texture is a look, not a default.** `texture.vignette` suits a single focal subject (a title, a card) and does nothing for a full-bleed chart; `texture.grain` 0.05–0.10 reads as film, above 0.12 as noise. Both cost render time (see schema.md), so keep them off for long clips unless asked.
- **Type short lines.** `"typing": true` at 0.035 s per character runs a 30-character command in about a second; past about 60 characters it becomes a wait. Give the line the scene's first beat, or delay it with `value` keyframes, and hold the finished line for the reading time below.
- **Place the full line, not the typed part.** The element's `x` is the centre of the whole text, so the line grows rightward from its left edge; the first characters appear left of `x`.

## Sound cues

Cues (`"cues"` in the spec) are opt-in sound design for a clip that is meant to have sound; a silent clip stays silent.

- **One `impact` and one riser (`whoosh`) per clip.** Put the `whoosh` just before the hero moment and the `impact` on it, so the sound marks the beat the clip is about. More than that stops being emphasis.
- **Continuous motion stays silent.** A drift, a counter running up or a chart reveal needs no sound; cue the arrival (a `pop` or `chime` when a card lands or a number settles), not the travel.
- **A `pop` or `click` per list item only when the items are staggered 0.2 s or more apart**; faster than that reads as a buzz.
- **Anchor with `scene` and `at`** so retiming an earlier scene keeps the sound on its beat.
- **Keep the level where it is.** Cues peak at -6 dBFS; use `volume` 0.4–0.8 under a voiceover. The loudness line after a render tells you where the mix landed.

## Shapes and charts

- **Cards, not hex.** Draw a card as a `rect` with `"fill": "surface"`, `"stroke": "line"` and `"elevated": true`; the theme tokens keep the border visible on dark themes and follow a theme change.
- **Bars are a `chart`, not thick `line`s.** A chart gets the rounded ends, the band gap and the axes for free; a row of thick lines needs all of it by hand. A thick `line` that stays a line takes `"cap": "round"`, and a pointer takes `"arrow": "end"`.
- **Drop an axis title that repeats the chart title** (`"title": null` on the axis): the title above already says it.
- **No long dead holds on a chart scene.** The chart reveal plus a short stagger is the motion; after that a 5 s stare reads as a frozen frame. Cut to the next scene once the figure has been read (see Reading holds).

## What `check.mjs` checks

Run `node <skill-dir>/scripts/check.mjs motion.json` after looking at the contact sheets. It reports only:

- visible text or a counter outside the safe area while it is not moving;
- two visible texts or counters overlapping while neither is moving or fading;
- a scene that ends with nothing on screen (a title leaving through an applied `exit: true` counts as intended).

It also warns (exit stays 0) when the first scene shows nothing at t = 0. It does not check timing, holds, stagger, eases, colour or what happens at the start of later scenes, and, during a transition window, only whether text of the two scenes overlaps at the window's midpoint (a warning).
