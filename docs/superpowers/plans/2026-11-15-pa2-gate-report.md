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

## Revision 1 (in progress)

Decisions sent to the implementer, as art direction:

- desk: statements sized to carry the frame (up to 300 units, block up to 64% of the height, centred); the kicker becomes a taped slug card at a fixed place in the top-right with the shot number; highlight bands contain their words' ink and never touch neighbouring lines; a review finding when emphasis covers more than 40% of a statement's words; quieter, larger paper blotches; a motion smear on slide and punch cuts; the number rebuilt as a hero numeral up to 820 units with a label in the label face beside it and no rule; the clipping push eased back, the dim lightened, the marker frame thinner and drawn in two passes.
- pop: wider word spaces; statements become a flush-left stack in which each line is scaled to fill the safe width; every statement shows its words as ghosts and lights them as spoken; a region highlight changes the close-up's hard shadow instead of adding a frame; the establishing picture is a 4:5 crop around the region; the number and its tags flush left; a kicker is a tag.
- The films' scripts were revised by the director: fewer emphasised words, hard cuts instead of repeated slides, no competing devices in one frame, no placeholder kicker copy.
