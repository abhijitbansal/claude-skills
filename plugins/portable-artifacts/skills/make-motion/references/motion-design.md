# Motion design for make-motion

Rules of thumb for timing a clip so it reads well. They are guidance: `scripts/check.mjs` enforces only the safe area, overlapping text and empty scene endings (see the end of this page). Look at the contact sheets for everything else.

Timing numbers adapted from whaleyxbt/claude-motion, MIT.

## Entrances and exits

- **Entrances take 0.6–0.9 s** with the `enter` ease: the element covers most of its way early and settles softly. A title with `"role": "title"` and no keyframes already gets its theme's entrance (dusk rise 0.9 s, press ink-in 1.1 s, poster slam 0.5 s).
- **Exits take about half as long as the entrance** with the `exit` ease: they start slowly and speed away, so the eye has already let go. Fade out, or move a short way and fade; do not fly text across the frame.
- **Moves from one place to another** use `move` (symmetric: eases in and out).
- **Linear is only for continuous motion**: a slow drift, a progress bar, a ticker. Never for an entrance or an exit.
- **`land` overshoots about 1 % before it settles.** Use it for at most one moment per clip, the hero moment, never as the default.

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
- **One hero moment per clip.** Pick the beat the clip is about and give it the biggest type, the accent, and the `land` ease if any. Other beats stay quieter.

## What `check.mjs` checks

Run `node <skill-dir>/scripts/check.mjs motion.json` after looking at the contact sheets. It reports only:

- visible text or a counter outside the safe area while it is not moving;
- two visible texts or counters overlapping while neither is moving or fading;
- a scene that ends with nothing on screen (a title leaving through an applied `exit: true` counts as intended).

It does not check timing, holds, stagger, eases, colour or what happens on the first frame of a scene.
