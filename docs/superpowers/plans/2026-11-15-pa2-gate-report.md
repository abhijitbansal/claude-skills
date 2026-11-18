# make-motion 2 look gate: record

Plan: `docs/superpowers/plans/2026-11-15-pa2-motion-engine-core.md`, Task 13. Films: `plugins/portable-artifacts/skills/make-motion/references/examples/v2/gate-desk.json` and `gate-pop.json`.

The bar: zero mechanical findings, zero creative findings, and an independent reviewer who has not seen the design passes every frame. At most two revision rounds; if the bar is still not met, the frames go to the owner.

## Round 1 (first render)

Command, run by the controller from the skill directory, for each film:
`ALLOW_BROWSER_RUN=1 node scripts/make.mjs references/examples/v2/<film>.json --json`

| Film | Exit | ok | Findings | Frames | Render | MP4 |
|---|---|---|---|---|---|---|
| gate-desk | 0 | true | 0 | 607 | 34.7 s, 57.2 ms per frame | 70.4 MB |
| gate-pop | 1 | false | 1 mechanical (hook text outside the safe area), 2 creative (text does not fit) | 357, 259 captured | 13.3 s | 15.1 MB |

All figures measured from the command's JSON report and `ls -la`.

Director's notes from the sheets:

- desk: a highlight over several words appeared at full width before the later words arrived; a region push began before the cut ended, so the whole picture was never seen; a match cut between a statement and a number shrank the type; the MP4 was about 28 Mbit/s.
- pop: "SOMETHING." was wider than the safe width at the size floor; an emphasis pulse overlapped its neighbour; the hook was not fully on screen at frame 0; the post halftone was drawn over the picture.

## Round 2 (after engine fixes and one narration edit)

| Film | Exit | ok | Findings | Frames | Render | MP4 |
|---|---|---|---|---|---|---|
| gate-desk | 0 | true | 0 | 665 | 37.9 s, 56.9 ms per frame | 13.96 MB, 5.04 Mbit/s |
| gate-pop | 0 | true | 0 | 357, 268 captured | 13.7 s, 38.4 ms per frame | 7.33 MB, 4.93 Mbit/s |

Measured the same way. The encoder is crf 23 with `-tune film`; post grain is 0.02 in both looks.

### Independent look review (fresh agent, sheets only)

Verdict: **desk: ship after fixes. pop: not yet** ("clean but indistinct; the hand of a stock caption template"). Weakest frame: the desk `count` shot.

Findings, condensed:

- desk: every text shot is the same top-left block with the bottom half empty; a highlight covering half a sentence emphasises nothing; a descender hangs out of its highlight band; the kicker is unreadable at phone width and its height drifts between shots; the paper blotch reads as a smudge in the same corner; three identical un-blurred slide cuts with a nearly blank mid-frame; the close-up crops a number at the frame edge and the dim is muddy; the marker frame is too heavy and too clean; the `count` shot has an off-family caption, a stray rule, an underline that points at nothing and about 70% dead space.
- pop: word spaces about 7% of cap height, so words run together; everything is centred on the same point; three nested outlines around the close-up; coarse halftone behind type; the establishing picture is unreadable; uneven gaps in the number stack; three equal lines with no hero; caption logic differs between shots; slide cuts show two half blocks side by side.

The bar is not met. This counts as revision round 1 of 2.

## Revision 1 (commit `6eb70a1c`)

Decisions sent to the implementer, as art direction:

- desk: statements sized to carry the frame (up to 300 units, block up to 64% of the height, centred); the kicker becomes a taped slug card at a fixed place in the top-right with the shot number; highlight bands contain their words' ink and never touch neighbouring lines; a review finding when emphasis covers more than 40% of a statement's words; quieter, larger paper blotches; a motion smear on slide and punch cuts; the number rebuilt as a hero numeral up to 820 units with a label in the label face beside it and no rule; the clipping push eased back, the dim lightened, the marker frame thinner and drawn in two passes.
- pop: wider word spaces; statements become a flush-left stack in which each line is scaled to fill the safe width; every statement shows its words as ghosts and lights them as spoken; a region highlight changes the close-up's hard shadow instead of adding a frame; the establishing picture is a 4:5 crop around the region; the number and its tags flush left; a kicker is a tag.
- The films' scripts were revised by the director: fewer emphasised words, hard cuts instead of repeated slides, no competing devices in one frame, no placeholder kicker copy.
- Rulings made during the revision: the emphasis finding fires when emphasised words are half or more of a statement's words, or when one highlight run is laid out over more than one line (highlight looks only); the motion smear draws its centre sample at full opacity with four outer samples at one-fifth; a `pop` stack is one group of per-line text nodes and counts as one size class in the review.

Results on the committed tree, measured by the controller after the implementer was stopped:

| Check | Result |
|---|---|
| v2 suite (`node --test --test-concurrency=1 "test/v2/**/*.test.mjs"`, tap file) | 742 tests, 742 pass, 0 fail, 0 skipped |
| gate-desk | exit 0, ok, 0 findings, 623 frames, render 42.1 s, 12.84 MB, 4.95 Mbit/s |
| gate-pop | ok, 0 findings, 362 frames (228 captured), render 11.7 s, 5.30 MB. Measured before the implementer's last three desk-only fixes; the implementer reports the file byte-identical afterwards (not re-measured by the controller) |

### Second independent look review (fresh agent, sheets only)

Verdict: **desk: ship after fixes. pop: ship after fixes, close to not yet** ("the type shots are clean; on a showreel it would read as a template"). Strongest frame: desk `problem` at 3.93 s. Weakest: pop `proof` at 2.53 s, then the desk slide smear.

Findings, condensed:

- desk: slug numbers read 01, 03, 05 because two shots have no slug; on `count` the change tag sits above the label so it reads in the wrong order, and the label is too small at phone size; the push slices words at the frame edge and the dim looks muddy; the smear reads as stepped echoes, not blur; the proof beat shows no words; a red underline is a second emphasis device; one-word lines ("machine.") and a two-line tail; the product name hyphen-wrapped on a slug; the slug sits closer to the edge than the text.
- pop: the establishing crop slices panels and is unreadable; the close-up holds with no words; one blank frame after a hard cut; the same stepped smear; unspoken words too close to white; the change tag's plate barely separates from the ground; "spec" in one film and "file" in the other.

The bar is not met. This counts as revision round 2 of 2.

## Pass rule for the last review

After revision 2 a third fresh reviewer sees the sheets. The gate passes only if its verdict is SHIP for both films. Any other verdict sends the frames and all three reviews to the owner, and engine work on the look stops until the owner answers. Individual findings under a SHIP verdict are recorded as follow-ups, not argued.

## Revision 2 (commit `31e7ef0`)

Director's rulings that stand against the second review, recorded so they are not flipped a third time:

- `pop` statements stay a flush-left stack with each line scaled to the safe width. Round 1 criticised three equal centred lines with no hero; round 2 criticised the unequal lines. The stack is the look.
- `pop` number and close-up stay flush left on the same edge as the stack.
- The establishing shadow in accent 2 turning to the accent on the highlight is the device; it stays.
- No handle or address on the `pop` end card: the films carry no invented contact details. An end lockup belongs to the showreel plan.

Film scripts, revised by the director: one word ("file") in both films; the `desk` underline replaced by the look's own highlight; every `desk` shot carries a slug with a section name; a line of words on the proof beat in both films.

Engine decisions sent to the implementer:

- `desk` number: label in ink at a larger step beside the numeral, change text under the label.
- Clipping: a slug in editorial looks; a caption that stays in the frame for the whole shot; an optional author crop for the establishing window; a stronger dim outside the region.
- No shot may open on an empty frame; the review reports one that does.
- The smear becomes a true average of many samples over half a frame. If the mid-cut frame still reads as echoes, the gate films use hard cuts and the smear is parked.
- Line breaking avoids one-word lines when a size within 15% allows.
- Unspoken words dimmer; the slug's right margin matches the text's left margin; a shot fades out as one group.
- Sheets sample every shot at least every 1.2 s so a reviewer can judge motion.

Decisions made during the revision:

- Frame furniture (the texts inside a slug card or a caption card) is left out of the size-class and hero-ratio review rules only; every other rule still judges it.
- The smear is parked. A 12-sample average still read as separate echoes at full size, and tinted the `pop` punch cut. It is opt-in by look data and off in both looks; the two slide cuts in the gate films became hard cuts.
- The code review of revision 1 (0 critical, 5 important, 16 minor) fed this revision: a `pop` number kicker is now drawn; a text's rest scale is the scale it holds on most frames; text over a slug or caption card is a mechanical finding; the kinds tests were split into files under 800 lines (81 tests before and after, by the implementer's count). One important finding was void: the closing line's markup is the director's own.

Results on the committed tree, measured by the controller after the implementer was stopped:

| Check | Result |
|---|---|
| v2 suite, tap file | 773 tests, 773 pass, 0 fail, 0 skipped |
| gate-desk | exit 0, ok, 0 findings, 638 frames, render 40.6 s, 12.50 MB, 4.70 Mbit/s |
| gate-pop | exit 0, ok, 0 findings, 362 frames (236 captured), render 12.1 s, 5.31 MB, 3.52 Mbit/s |

### Third independent look review (fresh agent, sheets only)

Verdict: **desk: ship after fixes. pop: ship.** Strongest frame: desk `count` at 17.03 s (the weakest frame of round 1). Weakest: the desk how-to-count cut at 15.10 s.

- desk, 1 high, 6 medium, 10 low. High: the `match` cut from `how` to `count` dissolves the numeral through the outgoing sentence, and the two slug cards sit on each other at half opacity for about five frames. Medium: the cut treatment differs from cut to cut; the first slug nearly touches the headline; in the push the picture's white mount stays bright while the picture is dimmed; the push cuts a figure ("459" reads "59"); the caption card covers the chart's one red bar; the picture arrives through a speckled dissolve.
- pop, 0 high, 4 medium, 9 low. Medium: the establishing card's top edge enters the top band by about 2% of the height as it lands; the "NO CLOUD." line has a wider word gap than its neighbours; unspoken words are see-through, so the halftone shows inside the letters; four of five shots share one layout.

## Outcome

The pass rule asked for SHIP on both films. `pop` passed; `desk` did not, on one high finding. Both revision rounds are used, so the frames and the three reviews go to the owner, and no further look work is done until the owner answers.

## Owner's decision and the targeted fix pass

The owner chose one targeted fix pass with the director's own check and no fourth review.

- Film script (director): the cut into `count` is a hard cut.
- desk: the picture's surroundings, mount and tape included, go under a paper scrim at 0.8 instead of an ink dim; the caption card sits under the highlighted region after the push; the picture enters on a clean fade and is at least half visible on its first frame; text clears the slug by two gutters.
- pop: the establishing card stays inside the safe area through its spring; unspoken words are an opaque mix of ink into paper.
- From the code review of revision 2 (0 critical, 3 important, 18 minor): a text's rest scale counts only frames where it is on screen; the film's first frame is judged in a mode that hooks from frame zero (other modes may open on the field, by the director's ruling), and a punch arrival is judged on its first frame; overlays pinned over a picture stay on top through a punch, with a new `covered` finding; three weakened tests restored. The `free` example's reveal now starts visible, because the new first-frame rule caught it.

Measured on the final tree by the controller, implementer stopped:

| Check | Result |
|---|---|
| v2 suite, tap file | 793 tests, 793 pass, 0 fail, 0 skipped |
| gate-desk | exit 0, ok, 0 findings, 638 frames, render 38.7 s, 12.63 MB |
| gate-pop | exit 0, ok, 0 findings, 362 frames (230 captured), render 11.8 s, 5.48 MB |

Director's check of the sheets: the high finding is gone (the cut into `count` is clean); the dimmed surroundings read as paper; the caption no longer covers the chart's bars at rest. Known and left: the sliced "59" at the frame edge is still faintly legible under the scrim; the caption card crosses the chart while the push runs; the slug and caption card fade in from near zero after a hard cut; `pop` "NO CLOUD." keeps its wider word gap (the stack ruling); the smear is parked. Not reviewed by a fourth independent reviewer, by the owner's choice. The version 1 suite was not run in the gate rounds; no version 1 file was changed.

The gate is closed on the owner's decision. Remaining look findings from the third review are follow-ups for the showreel plan.

Trend over three independent reviews: desk ship-after-fixes, ship-after-fixes, ship-after-fixes (high findings fell to one, in a cut the director chose); pop not-yet, ship-after-fixes, ship.

## Voice (plan `2026-11-15-pa2-voice-sync.md`, record of 16 November 2026)

Machine: Apple M4 Pro, macOS, Node 24.7.0, ffmpeg 8.1.1. Model: `onnx-community/Kokoro-82M-v1.0-ONNX-timestamped` at commit `dd4401a9`, `model_quantized.onnx` SHA-256 `c0c02b32…1132c`, voice `af_heart`. Nobody has listened to any of this audio yet.

### Voiced films, rendered by the controller through the real optional install

Command: `node scripts/make.mjs references/examples/v2/voiced-<look>.json --json` (after `npm ci --ignore-scripts` in `optional/voice`; the model was downloaded and hash-checked on first use).

| Film | Exit | Findings | Timed | Voice | Frames | Audio (measured in the finished file) |
|---|---|---|---|---|---|---|
| voiced-desk | 0 | 0 | measured | 17.4 s | 546 | -16.2 LUFS, true peak -2.0 dB (target -16, ceiling -1.5) |
| voiced-pop | 0 | 0 | measured | 13.2 s | 399 | -14.0 LUFS, true peak -3.2 dB (target -14, ceiling -1); measured before the last mastering change, not re-rendered since |

The first real render exposed a defect no test had: on measured times two shots opened on an empty frame after a hard cut. The film's own review reported it; a shot's first narrated word is now shown from the shot's first frame.

### Word timing

Command: `node scripts/v2/voice/accuracy.mjs --json --speed <n>` with the local runtime and model.

| Figure | Speed 1 (controller run) | Speed 1.1 (implementer run) |
|---|---|---|
| Held-out lines, words that follow a silence, shot-first words excluded | n=13, median 9 ms, p90 27 ms, max 250 ms | n=12, median 7 ms, p90 18 ms, max 21 ms |
| Self-check on the same audio: +100 ms, -100 ms except first words, label one word back, one word forward (median) | 98, 104, 278, 113 ms | 97, 103, 141, 109 ms |
| Mid-phrase s and sh onsets, against chance at -150 and +200 ms | 10 ms against 34 and 75 | 9 ms against 34 and 69 |
| Emphasised mid-phrase words, against chance | 13 ms against 51 and 96 | 19 ms against 37 and 63 (weak) |

What this supports, in the reviewer's words: on the held-out fixture lines, for the word starts that follow a silence, the predicted start was a median 9 ms from the onset ffmpeg's silence detector found. What it does not support: per-word sync for all words; "independent" without saying the start constants were fitted with this same detector (on the other fixture lines, one voice); mid-phrase or emphasised figures quoted as accuracy; word ends; the own-recording path; anything implying a person listened.

Known in the numbers: one mispaired word at -250 ms in the speed 1 headline (the median is robust to it); the speed 1.1 sample sits exactly on the minimum of 12; an error confined to a single line can still pass the median gate; the smallest margin between the lead-in trim's cut and a measured voice onset is 26 ms (on "So,").

The first version of the script reported 9 ms too, and a review showed it would have reported the same for a one-word shift. That version's figure was never published.

After the whole-plan review's fix wave the lead-in kept before a shot's first word went from 75 to 110 ms. Re-measured by the controller at speed 1: the held-out figure is unchanged (n=13, median 9 ms, p90 27 ms), and the smallest margin between the trim's cut and a measured voice onset is now 61 ms (was 26 ms).

## Sound (plan `2026-11-16-pa2-sound-captions.md`, record of 16 November 2026)

Rendered by the controller through the real optional install, `node scripts/make.mjs references/examples/v2/sound-<look>.json --json`. Nobody has listened yet.

| Film | Exit | Findings | Frames | Cues | Bed (fitted tempo, cuts on a beat) | Audio (measured in the finished file) | Size |
|---|---|---|---|---|---|---|---|
| sound-desk (voice, cues on, drift bed, captions on) | 0 | 0 | 556 | 5 | 94.48 bpm asked 92, 3 of 4 | -16.1 LUFS, true peak -4.6 dB | 11.26 MB |
| sound-pop (voice, cues by default, pulse bed) | 0 | 0 | 409 | 10 | 124.37 bpm asked 124, 3 of 4 | -14.0 LUFS, true peak -3.5 dB | 6.39 MB |

Whole version 2 suite with the real voice model, controller run on the same tree: 1373 tests, 1373 pass.

Director's note from the desk sheet: with captions on, a clipping that also carries the author's own caption line shows two taped cards side by side, which reads as clutter. The example film drops the author's line; the engine allows both and the review does not object. Captions are opt-in in every mode: on by default they changed the approved pop test film.

For the owner's listening pass: cue level against the voice, the bed's ducking under words, whether the bed helps or distracts, caption timing.

## Shot kinds, first wave (end, list, quote, compare, chart) — 2026-11-16

Two films use every shipped kind: `references/examples/v2/kinds-desk.json` (pro, 16:9) and `kinds-pop.json` (viral, 9:16). Both render valid with no mechanical or creative findings (controller, real voice model, commit 9ea68e6; whole v2 suite 1755 tests, 1755 pass).

Three independent look reviews, each by a fresh reviewer who saw only the contact sheets:

| Review | Desk | Pop | After it |
|---|---|---|---|
| 1 | ship after fixes (3 of 8 shots pass) | ship after fixes (2 of 8 pass) | revision 1, 14 rulings |
| 2 | ship after fixes (2 of 8 pass) | not yet: five of eight vertical shots left 39 to 56 percent of the frame empty | revision 2, 13 rulings, then a two-item polish |
| 3 | ship after fixes (1 pass, 7 fix, 0 fail) | ship after fixes (2 pass, 6 fix, 0 fail) | none: the two revision rounds are used |

Decision (controller, under the owner rule for the unattended run): no kind failed in either look, so none is parked. The fix items of review 3 are not done and are listed in `docs/decisions-pending.md` and in `.superpowers/sdd/2026-11-16-pa2-shot-kinds-a/look-review-3.md`. The reviewers passed different shots each time, so a pass count is one reviewer judging one render, not a trend.

Known weak points a viewer will see: final states hold too briefly before the film ends; a single-digit number rolls up from a bare grey 0; pop on tall frames still leaves the lower 35 to 55 percent of the frame empty (type is limited by width); desk sets too much in small mono for phone size; the desk chart plot is squat.

## The cosmos look — 2026-11-16: PARKED as experimental

Gate films: `references/examples/v2/gate-cosmos.json` (pro, 16:9, 7 shots) and `gate-cosmos-viral.json` (viral, 9:16, 6 shots). Both render valid with no mechanical or creative findings (controller, real voice model, commit d97c07d; whole v2 suite 1831 tests, 1831 pass). Render cost against desk: 1.20 times per frame on these films (implementer, one run each); on a still shot the drifting stars stop held frames from being reused (2.13 times per output frame, measured at Task 2).

Three independent look reviews, each by a fresh reviewer who saw only the contact sheets:

| Review | 16:9 | 9:16 | Shots failing | After it |
|---|---|---|---|---|
| 1 | not yet | not yet | compare in both (equal cards for an 11 to 1 scale) | revision 1: sun motif, compare drawn to scale, OKLab fades |
| 2 | not yet | not yet | 16:9 compare; 9:16 number and chart | revision 2: one sun drawn as light, tall-frame compositions, minimum secondary size |
| 3 | not yet | not yet | 16:9 number and compare; 9:16 number | none: the two revision rounds are used |

Decision (controller, under the owner rule for the unattended run): the look is parked. It stays on the branch marked experimental: a film can name it, but it is left out of the looks list and of the docs. What review 3 blocks on: the sun is drawn on the edge of the orbit ellipse instead of at its centre (a science error in the composition the controller asked for); the to-scale compare is complete on its first frame and static; the Earth group sits outside title-safe; the sun is drawn two ways. What the reviewers credited: the two films hold together as one; gold used only for light is an idea with character; the vertical hook passed in review 2. Frames: `.scratch/cosmos/gate-r0`, `gate-r1c`, `gate-r2c` (scratch, not committed). Reviews: `.superpowers/sdd/2026-11-16-pa2-look-cosmos/gate-review-1.md` to `gate-review-3.md`.

## The cosmos look — gate review 4 (2026-11-16, run 2): SHIP AFTER FIXES, un-parked

After the owner asked to finish it, one more round fixed what review 3 blocked on (the Sun drawn on an orbit edge became a measured Sun-to-Earth line with travelling light; one Sun drawing; a reveal on the to-scale compare; no blur filters; the contrast check sees light). A fresh reviewer (review 4, sheets only) gave both films ship after fixes, with no shot failing (16:9: 2 pass, 5 fix; 9:16: 2 pass, 4 fix). The look comes off the experimental list. Open fix items (planned for the looks phase, when cosmos also gets the second-wave kinds): list spacing by orbital distance and the Sun carried across cuts; a plain to-scale Earth disc in the compare (the ringed dot reads as a radio button); the chart restyled for the look and without bar overshoot; tighter closing quote mark; hook line breaks at 9:16; glow only on light; stars masked behind type; capped ghost-word phases; the 9:16 compare Sun clear of the caption zone. Report: .superpowers/sdd/2026-11-16-pa2-look-cosmos/gate-review-4.md.

## ledger (2026-11-17): SHIP AFTER FIXES, listed

Gate films: references/examples/v2/gate-ledger.json (16:9, 8 shots, 7 kinds) and gate-ledger-tall.json (9:16, 7 shots, 6 kinds), all figures from the bundled Ridgeline Prints data (regions 182/121/97/59 of 459; new orders per quarter 6/46/130/277). Before the gate: two pre-gate fix passes (axis ticks, map hero, quote attribution, tall source lines; a region-off-frame finding).

- Review 1 (fresh reviewer): 16:9 NOT YET, 9:16 NOT YET. Fails: an off-topic quote and a dashboard screen (removed from the film by the controller), the map (blue routes, a stray arc), compare (cards, a hand VS). Revision 1 rulings, binding on later rounds: no hand-drawn device in ledger (compare hairline columns, ruled region box, feed ruled rows); routes in ink anchored to cities; every line and area point labelled; shots open set (claim, tag, axes on frame 0; marks may grow after); 16:9 statement and list fill the frame.
- Review 2 (fresh reviewer): 16:9 SHIP AFTER FIXES, 9:16 NOT YET (fail: the tall feed). Revision 2 rulings: the feed title is a slug, messages are the hero; holds of 1.2 s (charts) and 1.6 s (statements) before a cut; timeline dates under the title; only the origin pin in the accent; bars grow in their final colour; compare values as the hero.
- Review 3 (fresh reviewer): both SHIP AFTER FIXES, no shot failing: listed (the cosmos precedent ruled for this plan). Render: 16:9 1170 frames, 13.1 ms per frame (about 0.22x desk), 1.6 MB, -16 LUFS; 9:16 913 frames, 12.2 ms per frame, 1.2 MB, -16 LUFS (make --json, controller). Fix items: stray minus and dot on the bar charts, the leader tick reading as a minus, the map source line (serif, Source:, aligned), the Denver to Kyoto route over the Pacific, the 16:9 lede lower 40 percent empty, small text at phone size on the 16:9 film; lower: red used unevenly, the stepping list twice per film. Kind parked in ledger: number (no clean tall fill). Reports: .superpowers/sdd/2026-11-16-pa2-run2/gate-ledger-1.md to -3.md.

## poster (2026-11-17): SHIP AFTER FIXES, listed with feed parked

Gate films: references/examples/v2/gate-poster.json (16:9 pro, 7 kinds) and gate-poster-tall.json (9:16 viral, 6 kinds), about make-motion itself (16 kinds from --list kinds; the test-suite figures from kinds-desk.json, marked as running totals).

- Review 1: 16:9 NOT YET (fail: code, a monospace card with no hero), 9:16 SHIP AFTER FIXES with a failing chart (bars about 1 percent of the height, grey on black). Revision 1 rulings: code gets a condensed-caps hero; chart heroes and bars filling the plot at 3:1; shots open set with holds of 1.2 s; the viral hook may end a row on a weak word only when the next row is the starred word alone; fill for diagram, quote, compare, feed and close; turned type in the 16:9 film; a cover cut in the next ground; flat grounds; the close ask at least secondary.min and on screen 1.5 s.
- Review 2: 16:9 SHIP AFTER FIXES, 9:16 NOT YET (fail: the hook, static with no dominant word). Revision 2 rulings: the starred word dominates the hook, then motion after a complete frame 0; viral reads upright (turned type is a pro composition); one designed strike per shot so no shot is still over 2 s; viral text above 72 percent of the height; grounds rotate with no repeat on consecutive shots and red in the 9:16 film; secondary text at least a third of the hero.
- Review 3: 16:9 SHIP AFTER FIXES with no shot failing; 9:16 NOT YET with one fail, the chat (the reply card blank 1.3 to 2.2 s). Controller decision: the plan (Global Constraints, kinds) parks a kind that cannot be made clean in that look alone without blocking the look, so feed is parked in poster and poster is listed; every other 9:16 shot was fix or pass. The fails were a different shot in each round (code, chart, hook, chat). The owner may overrule (re-park the look). Render: 16:9 784 frames, 26.50 ms per frame against desk 59.25 on the same film (0.45x); 9:16 661 frames, 26.75 ms per frame (make --json, implementer). Fix items: red offsets on chips and the close curl read as shadows; the chart hero at poster scale with condensed-caps labels; compare hierarchy at 3x and its empty quadrant; the cover cut that stalls on a same-colour sheet; the hook leading; the tall how and swap; the 16:9 film uses one top-left layout in most shots and turns type only in the quote. Kinds parked in poster: number, feed. Reports: .superpowers/sdd/2026-11-16-pa2-run2/gate-poster-1.md to -3.md.

## keynote (2026-11-18): SHIP AFTER FIXES, listed

Gate films: references/examples/v2/gate-keynote.json (16:9 pro, 7 shots, 6 kinds) and gate-keynote-tall.json (9:16 pro, 6 shots, 6 kinds), launching the Ridgeline Prints orders dashboard from the bundled data and its screenshot (light ground only, as ruled). Before the gate: screen un-parked as the signature kind; a flush weight sweep (real-glyph drift 41 px to 1).

- Review 1: 16:9 SHIP AFTER FIXES; 9:16 NOT YET (fail: the tall screen shown whole and unreadable on a phone). Copy: an unfair Q1 against Q4 compare dropped (Q1 held one month of trading); one brand name. Revision 1 rulings: the tall screen lifts its region to the safe width (the engine text floor governs set text, not screenshot pixels); the 16:9 push centred with the ring exactly on the region; charts open set and fill; soft cuts chosen in turn.
- Review 2: 9:16 SHIP AFTER FIXES; 16:9 NOT YET at film level (one left-aligned type layout in four of six shots, the product shown once, no payoff). Copy: a second screen shot (Orders by month), the order-flow diagram instead of a list naming unseen panels. Revision 2 rulings: layout variety per kind; a full-width timeline with the spoken event as hero; a product close; region cards lifted at both formats (the whole browser card cannot reach 80 percent at 16:9); the light band under all text and marks; type cuts dip or wipe; the chart accent stays the look's own (amber text fails contrast on the light ground).
- Review 3: both SHIP AFTER FIXES with no shot failing: listed. Render: 16:9 894 frames, 53.46 ms per frame; 9:16 671 frames, 54.08 ms per frame (make --json, implementer); about 0.85x desk on the same film (earlier measure). Fix items: the two hard wipes cut words (make them soft); dash and month share one framing back to back; crops catch a UI strip; the close's product card too small and its headline touching it; the tall Ship card 6 percent from the bottom; pale rectangles outside the tall ring; the year shot type-only for 9 s. Copy fix after the review: the tall list item naming an unseen query replaced by "Largest first". Kinds parked in keynote: number, clipping. Reports: .superpowers/sdd/2026-11-16-pa2-run2/gate-keynote-1.md to -3.md.

## marker (2026-11-18): SHIP AFTER FIXES, listed

Gate films: references/examples/v2/gate-marker.json (16:9 pro, 6 kinds) and gate-marker-tall.json (9:16 pro, 6 kinds): how one Ridgeline Prints order travels. Before the gate: the drawing-hand spike passed; a per-element hand speed model (the hand-speed cap unchanged at 2600 units a second); nine kinds clean.

- Review 1: both NOT YET. Fails: every shot's first element was already on the board (from the plan ruling "frame 0 opens with the first element written"), the diagram drew arrows before boxes, the photo went full bleed, hard cuts into it. RULING REVISED (replaces that plan ruling): in marker the hand draws every element, titles, hero lines, kickers and badges included; frame 0 shows the pen down with the first stroke begun; boards change by erase or pan. Revision 1: drawFirst, story order, a pinned picture card, erase and pan cuts, compare bars to scale.
- Review 2: both NOT YET; all ten cuts failed (the erase a hard band uncovering unwritten text, two hands in pans, a badge undrawn). Revision 2: a felt eraser removing an ink layer so the board keeps its tone and frame, one hand in pans, badges drawn last.
- Review 3: both SHIP AFTER FIXES with no sheet failing: listed. Render: 16:9 926 frames, 43.3 ms per frame, 3.6 MB; 9:16 1001 frames, 41.7 ms per frame, 3.3 MB (make --json, controller); about 0.72x desk (earlier measure). Fix items: the eraser wipes the pinned photo like ink; the resting pen touches a final ? or full stop; the hand turns flat over text in learned and close; the URL and stamp too small at phone size; the tall photo crop halves the sun; all wipes identical; finished boards held under 1 s. Copy fixes after the review: the list claims only the North against the West it shows; compare gets the kicker Orders by region. Kinds parked in marker: chart (race as ruled), feed, number, timeline, free; screen and code excluded. Reports: .superpowers/sdd/2026-11-16-pa2-run2/gate-marker-1.md to -3.md.
