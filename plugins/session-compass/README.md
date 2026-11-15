# session-compass

A Claude Code mod. Come back to a session and see what it is building, where it stands
and everything it has produced, without scrolling back.

```
Cubby · worktrees/claude-mods (feat/session-mods) · Goal: Ship the session mods · Now: PR review · 7 artifacts · tests 412 ✓ 0 ✗
```

## What it adds

### Compass band

Up to two lines above the prompt: `repo · worktree (branch) · Goal · Now · N artifacts · tests`.

- It is always up, from the moment the session starts, and updates as the goal, step
  and artifacts change. Only a survey on screen takes its place, or you hide it (below).
- **Two lines.** It stays on one line while it fits, dropping optional segments as before.
  Otherwise it wraps onto a second line at a space or at a ` · ` separator, using the
  width the host gives the band. Only the end of line two is ever cut, with an `…`.
- **Full text.** When line two is cut, it ends in `▸ /compass more` (`▸ more` on narrow
  terminals; nothing under 24 columns). Click it, or type `/compass more`, to show the
  repo, worktree, branch, goal, step and next in full, wrapped and unshortened. Click
  `▾ fold` or type `/compass more` again to fold it. `/compass more` works even when
  nothing is cut, since it also shows `next`, which the band never does. An expanded band
  taller than the space above the prompt scrolls: focus it with ctrl+x tab.
- **Hide.** `/compass hide` removes the band until the goal changes (a `compass_status`
  call with a different `goal`). `/compass show` brings it back at once. A hidden band
  and an expanded band are kept for this session only: they are not stored, so they do
  not carry into another session.
- With no goal set, it shows your first prompt dimmed and `(no goal set)`.
- `tests` appears when [test-board](../test-board) is installed and has recent runs. It
  clears when those runs leave test-board 60 minutes after they finished; closing the
  test-board band with `✕` leaves it up.
- Narrow terminals drop the artifact count, then `tests`, then shorten the worktree path;
  only when the goal still does not fit on one line does the band take a second line.
- Runs with a tool error, an interruption, a reported nonzero exit, incomplete output,
  or unavailable/invalid/conflicting counts carry a warning. Failed tests already show
  in the `✗` count, an unknown command status is the normal case for a live run, and
  restored history is not trouble, so none of those warn. Counts are
  summed separately; malformed counts do not contribute. The warning count is
  placed first so dropping optional segments cannot hide it on narrow terminals.
  The `/compass` pane also shows the warnings; Test Board provides the details.

### `/compass` pane

`/compass` with no argument opens the pane. `/compass more`, `hide` and `show` drive the
band (above); any other argument is refused with the accepted list.

- **This session** tab: repo, worktree and branch; goal; step and next; how long ago
  the status was set; Test Board's pass/fail tally; and every artifact, grouped as
  Published artifacts, Files sent, Documents, Commits, Pushes and Pull requests.
  Press an entry to copy it (URL for artifacts and PRs, path for files and documents,
  the commit sha as the Bash tool reports it, branch name for pushes).
- **All sessions** tab: the other recorded sessions, most recently active first, up to
  50. Press a row to copy `claude --resume <id>`.

### `compass_status` tool

The model sees it as `mcp__session-compass__compass_status` with optional `goal`,
`step` and `next` strings. A short standing reminder in the prompt asks Claude to call it when
the goal is first clear and whenever the phase changes (spec, plan, implement, review,
PR, done), not every turn. A call with no non-empty field is refused.

## What counts as an artifact

Captured automatically from successful tool calls:

- `Artifact` publishes (claude.ai URLs; opens, reads and lists are ignored).
- `SendUserFile` deliveries (attachments that uploaded without error).
- `Write` of an `.html`, `.md`, `.pdf`, `.png` or `.svg` file under `.scratch/`, `docs/`,
  `reports/` or `test-checklists/`, or under a Claude scratchpad directory.
- Git commits, pushes and created pull requests, as reported by the Bash tool.

A git `checkout`, `switch`, `worktree`, `commit` or `push` from the main session also
refreshes the recorded worktree and branch. A subagent's git commands do not.

## Install

```
/plugin marketplace add abhijitbansal/claude-skills
/plugin install session-compass@claude-skills
```

## Limits

Goal 80 characters, step and next 60, 100 artifacts per session, 50 sessions. Longer
text is truncated; past the caps the oldest artifacts and sessions are dropped.

## Data

Records live in the plugin's local store. Nothing leaves the machine and the plugin
makes no model calls. It reads Test Board's latest runs when Test Board is installed.
The store keeps the first 80 characters of a session's first prompt, worktree paths, commit
subjects and artifact URLs until the session ages out of the 50-session cap; avoid pasting
secrets into a first prompt.

## Develop

```
claude plugin validate plugins/session-compass
claude plugin test plugins/session-compass
claude --plugin-dir plugins/session-compass      # lays .claude-plugin/types (gitignored)
npx -y -p typescript@5.6.3 tsc -p plugins/session-compass
```
