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

Trend over three independent reviews: desk ship-after-fixes, ship-after-fixes, ship-after-fixes (high findings fell to one, in a cut the director chose); pop not-yet, ship-after-fixes, ship.
