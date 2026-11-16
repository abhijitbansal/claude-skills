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

## make-motion: the two unused `@fontsource` npm deps (branch feat/portable-artifacts-design-refresh, 2026-10-17)

`skills/make-motion/package.json` still pins `@fontsource/inter` and
`@fontsource/jetbrains-mono` (5.3.0). make-motion no longer reads either since
`dusk` became its default look: every theme now loads its faces from the
bundled `shared/fonts/` (which still carries JetBrains Mono for the `press`
theme). The deps only cost install size; nothing imports them.

- **A (was the default):** keep both in `package.json` and
  `package-lock.json`. Installs stay byte-identical to before the branch.
- **B (recommended):** remove both and regenerate `package-lock.json`.
  Smaller installs; nothing in the skill reads them.

**Resolved 2026-11-15: B.** The security pins change (docs/superpowers/plans/2026-11-15-pa2-security-pins.md, Task 1)
removed both packages from `skills/make-motion/package.json` and its lockfile, and the Inter row from the plugin
README's licence table.

## make-motion 2: look findings left after the gate (branch worktree-New-Motion, 2026-11-15)

The look gate closed on the owner's choice of one targeted fix pass and no fourth review
(`docs/superpowers/plans/2026-11-15-pa2-gate-report.md`). These were left; each has a default the work proceeds on.

- **Motion smear on slide and punch cuts.** Two builds read as echoes, not blur.
  - **A (default, shipped):** off in `desk` and `pop`, opt-in by look data; films use hard cuts.
  - **B:** build a real blur in the WebGL post pass (velocity along the cut direction) in the showreel plan.
- **`pop` stack lines of unequal size ("NO ACCOUNT." smaller than its neighbours, wider gap in "NO CLOUD.").** Review 1
  disliked three equal centred lines; reviews 2 and 3 disliked the unequal ones.
  - **A (default, shipped):** each line fitted to the safe width, flush left.
  - **B:** one size for the block, ragged right, with only the emphasised line larger.
- **`desk` push slices content at the frame edge** (a "459" tile reads "59", faint under the paper scrim).
  - **A (default, shipped):** paper scrim at 0.8 over everything outside the region.
  - **B:** an author field for the push window, as `crop` is for the establishing window.
- **Statement shots share one layout in both looks; no end card or lockup.** Default: left for the showreel plan,
  with the remaining shot kinds and looks.
- **Sheet labels and slug text are about 5 px tall at phone size in `desk`.** Default: accepted as furniture; nothing
  essential is set in them.

## make-motion 2 voice and sound: where the build differs from the design (2026-11-16)

Each has a default the work proceeds on; all are one-value changes in mode data unless noted.

- **Captions in the viral mode.** The design (section 7) says on by default.
  - **A (default, shipped):** opt-in in every mode (`"captions": true`). On by default they changed the approved `pop`
    test film (a smaller picture, spoken-word captions beside the author's own caption line), which would have
    bypassed the look gate.
  - **B:** on by default in viral, after the `pop` clipping composition is revised to make room and re-reviewed.
- **Pause before an emphasised word.** The design (6.2, 9.2) asks for a short pause before it.
  - **A (default, shipped):** no pause and no call split; emphasis is stress promotion, a 2 dB lift and the picture's
    own emphasis. Each split restarts the voice's prosody.
  - **B:** `emphasisPause` above 0 in mode data (built, off). Decide after listening.
- **Voice pace.** The design says 1.08 in viral and 0.96 in pro. Shipped: 1.1 and 1.0 (`voiceSpeed`). Decide after
  listening.
- **Music duck depth.** The design says 8 dB in viral and 10 dB in pro. Shipped: 9 dB in both, one constant. Default:
  keep until the listening pass; then move it into mode data if the two modes should differ.
- **Loudness true-peak ceilings.** As designed (-1 and -1.5 dBTP). No decision needed.
- **Motion of a music bed against cuts.** The design says cuts land on beats. For a voiced film the cuts are fixed by
  the narration, so the bed's tempo and phase are fitted to them and the report says how many cuts landed (3 of 4 in
  both example films). Default: keep; the alternative is to let a bed nudge shot tails, which changes film length.
- **Word-timing claim for the README.** The only sentence the measurement supports is in the gate record's Voice
  section. Default: use it verbatim, or say nothing.

## Parked from the same branch (2026-11-15)

- **Docs site typography lint findings** ("single font", "flat type hierarchy" on feature pages) come from the shared
  stylesheet. Default: untouched; fix once in the stylesheet in the visual refresh of the other skills.
- **Unpinned `npx skills`, `npx playwright install chromium` and `npm install -g cartoon-wrap` in docs.** Default:
  allowed in docs only by the dependency rule tests; pin if the owner wants docs commands reproducible.
- **Workflow actions pinned to tags, not commit SHAs.** Default: left; SHA pinning is a repo-wide choice.
- **session-compass: old stored goals are not re-stripped of control characters on display**, and the hover reveal is
  not built (`/compass more` expands instead). Default: left.
- **make-motion 2 cut-outs with alpha (people) are not supported yet.** Default: later plan, with the optional
  cut-out package.
- **cache-clock keep-warm ceiling is per session and resets if the ledger file is deleted.** Default: documented;
  a machine-wide ceiling would need a shared ledger.

## Shot kinds, first wave: look review 3 leftovers (2026-11-16)

Both all-kinds films got "ship after fixes" from the third independent reviewer; no kind failed. The two allowed revision rounds are used, so these are open. Default: ship the kinds as they are and fix the first group in the next fix wave; the owner may ask for more.

- Fix in the next wave (defects, not taste): the last shot of a film holds its final state for under half a second (hold 1.5 to 2 s); a number under 10 opens on a bare grey 0 and the digit jitters sideways as it counts (land on the value, or count with fixed advances); desk chart plot is about 20 percent of the frame height (make it about twice as tall, drop the axis and gridlines when marks are labelled directly, no olive frame in the colour change); desk compare arrow tail meets the left card; desk quote text nearly touches the card edge; pop quote breaks "FALLS / SHORT" and sets the last line smaller; pop list items come out at different sizes; a pop clipping caption sits under the picture shadow; several first frames show half-entered parts.
- Owner taste: pop on tall frames leaves the lower 35 to 55 percent empty in most shots (type is width-limited; options: allow word-per-line breaks for short hooks, or centre the block lower); every statement, quote and end card uses the same grey-to-ink word reveal; desk mono labels are small at phone size (raising them breaks the 3x hero rule on some frames).
- Copy of the example films (mine): "nine kinds of shot" over a film that shows eight; "every stage added tests" over running totals; a quote attributed to the product; asks that name no destination.

## Cut-over timing (2026-11-16)

The cut-over plan (docs/superpowers/plans/2026-11-16-pa2-cutover.md) deletes the version 1 engine. Version 2 today has 9 of 16 designed shot kinds and 3 of 7 looks, and no counterpart for: preview, vars and --batch, --poster, --workers, storyboard, footage, maps, code, .srt captions, the hand-drawn style, themes, the beats command. The design puts the remaining kinds and looks before the cut-over.

- Default taken for the unattended run: do the parts that remove nothing a user has (Task 1: version 2 stands on its own files; the voice half of Task 4: drop kokoro-js and @huggingface/transformers from optional/voice, which version 2 no longer imports). Do NOT delete version 1 (Tasks 2, 3, 5, 6) until the owner says so or the remaining kinds and looks exist.
- Options for the owner: (a) wait for the remaining kinds and looks, then cut over (the design order); (b) cut over now and list every dropped feature in migrating.md and the CHANGELOG; (c) ship version 2 beside version 1 behind the spec version field for one release.
- The plan lists 12 smaller decisions with defaults (shiki and atlas packages, optional/cutout, the sketch template, version number timing, site clips).
