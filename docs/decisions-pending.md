# Decisions pending

Owner calls an agent parked instead of asking. Each lists the options and the
default the code ships with; change the code if you pick another.

**Resolved 2026-11-15 (plan item G-73, decision D12):** the owner chose the
shipped defaults for the four entries from PR #35 to the design-refresh branch
below: test-board close (A), diagram legend overlay (A), the dashed legend word
"secondary" (A) and the two `@fontsource` deps kept (A). The entries stay as a
record of what shipped and the other options. The fontsource recommendation (B)
was not taken, so no lockfile change was made.

## Open: machine setup (plan item CAT-99, 2026-11-15)

`setup/setup.sh` was fixed where the fix is mechanical: the self-marketplace
check matches the name line exactly, and a `--dry-run` writes no backup. These
four calls are the owner's. Until you pick, setup does what it did before.

### Which CLAUDE.md the `dotfiles` and `guidelines` steps write

The steps use `~/CLAUDE.md`. Claude Code reads `~/.claude/CLAUDE.md` for every
project, and the owner's live file is that one.

- **A (default, shipped):** keep `~/CLAUDE.md`. No behaviour change.
- **B:** write `~/.claude/CLAUDE.md` and leave `~/CLAUDE.md` alone. Matches where
  Claude Code looks; an existing file there gets the additive guideline merge
  only, never a copy over it.

### Which plugins a fresh machine enables

`claude-setup.toml` lists the plugins the seed installs. A 2026-11 comparison
found 19 plugin specs enabled on the owner's machine that the file does not
list (measured by the mining pass, not re-run here), and the self-marketplace
step installs all eight of this repo's plugins.

- **A (default, shipped):** the toml as it is; the self-marketplace step still
  installs all eight.
- **B:** refresh the toml from a scrubbed `capture.sh` run, then trim it to the
  set you want enabled.
- **C:** install only what the toml names and make the self-marketplace step
  respect it.

### Folder or GitHub source for this repo's own marketplace

`step_local_plugins` adds the checkout (`claude plugin marketplace add
<checkout path>`), so installed plugins track the working tree.

- **A (default, shipped):** a folder source. Right for the owner's dev machine.
- **B:** the GitHub source (`abhijitbansal/claude-skills`) unless a dev flag is
  passed. Right for a machine that only consumes the plugins.

### Site wording that invites strangers to run the machine seed

`site/index.html` and the README present `setup.sh` next to the plugin
installs, though `templates/` and `claude-setup.toml` are the owner's seed data.

- **A (default, shipped):** leave the wording; the README already says public
  users can ignore `templates/` and the toml.
- **B:** reword the site line so the seed reads as the owner's machine setup,
  and keep the plugin install as the public path.

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

- **A (default, shipped):** keep both in `package.json` and
  `package-lock.json`. Installs stay byte-identical to before the branch; no
  network install was needed to land it.
- **B (recommended):** remove both and regenerate `package-lock.json` in a
  follow-up that can run a network `npm install`. Smaller installs; nothing
  in the skill reads them.

To pick B: drop the two lines from `skills/make-motion/package.json`, run
`npm install` in `skills/make-motion`, commit the lockfile, and drop the
"still pinned" note from the Inter row of the plugin README's font table.
