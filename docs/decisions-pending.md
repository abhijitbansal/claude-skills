# Decisions pending

Owner calls an agent parked instead of asking. Each lists the options and the
default the code ships with; change the code if you pick another.

## test-board ✕ and session-compass's `tests` segment (PR #35, 2026-10-11)

Pressing `✕` hides the test-board band but leaves `test-board.latest`
intact, so session-compass's band and pane keep showing `tests N ✓ M ✗` until
the runs expire at 60 minutes (expiry prunes `latest`, so both clear then).

- **A (default, shipped):** `✕` hides the test-board band only. Compass keeps
  the counts until the hour is up. Matches PR #35's stated intent.
- **B:** `✕` also empties `latest`, so compass's segment clears at once. One
  meaning of "closed" everywhere, but closing the band also drops the counts
  from the compass line.
- **C:** compass reads `test-board.dismissed` and hides its segment while the
  newest run is dismissed. Keeps both, at the cost of compass knowing a second
  test-board state key.

## make-diagram page: legend overlay vs the fit, and the legend in Play on phones (PR #39, 2026-10-14)

The standalone page shows the key as an HTML overlay in the stage's top-right
corner (the drawn legend is hidden there).

- **A (default, shipped):** keep the overlay on the stage. The camera fits the
  drawing (`data.drawing`, no legend band, no widening) into the stage below the
  overlay's measured height, on first paint, resize, `0`, Fit and double-click.
  Costs a full-width top band, up to about 90 px on a phone when the key wraps.
  On a phone in Play the overlay is hidden, so the stage keeps its height.
- **B:** put the legend in normal flow, a band above the stage. No camera
  reserve, never overlaps, but the band stays in Play too and takes the same
  height on a phone; the overlay's blurred-glass look goes.
- **C:** collapse the key behind a "Key" button on phones. Smallest footprint,
  one more control; the key is no longer visible at a glance.

## make-diagram legend word for a dashed graph edge (PR #39, 2026-10-14)

The key prints one word per edge style. The word for `dashed` was "optional", a
meaning no author doc gives a dashed line (the shipped examples use it for a
reply, a "no" branch, a transition and a two-way link). Sequence diagrams print
"reply" and are unaffected.

- **A (default, shipped):** "secondary". Neutral: it says the line matters less
  than the solid ones without claiming a meaning. SKILL.md and schema.md now
  state the words (`call`, `secondary`, `event`) so authors pick a style knowing
  the key. The word is about 11 px wider than "optional" in the legend row.
- **B:** "alternate". Fits a "no" branch or a fallback, less so a reply.
- **C:** "dashed". Describes the line, not a meaning; the most literal and the
  least informative.

Change `STYLE_WORD` in `scripts/lib/legend.mjs`, the pinned legend tests, the
goldens and the two docs if you pick another.
