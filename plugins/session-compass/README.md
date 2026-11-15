# session-compass

A Claude Code mod. Come back to a session and see what it is building, where it stands
and everything it has produced, without scrolling back.

```
Cubby · worktrees/claude-mods (feat/session-mods) · Goal: Ship the session mods · Now: PR review · 7 artifacts · tests 412 ✓ 0 ✗
```

## What it adds

### Compass band

One line above the prompt: `repo · worktree (branch) · Goal · Now · N artifacts · tests`.

- It is always up, from the moment the session starts, and updates as the goal, step
  and artifacts change. Only a survey on screen takes its place. After `/clear` or a
  resume it is blank until the next prompt or tool call opens the new session's record.
- With no goal set, it shows your first prompt dimmed and `(no goal set)`.
- `tests` appears when [test-board](../test-board) is installed and has recent runs. It
  clears when those runs leave test-board 60 minutes after they finished; closing the
  test-board band with `✕` leaves it up. A run test-board restored from history at
  session start is not counted.
- With failing tests, `tests N ✓ M ✗` moves to the front of the line so the failed count
  survives any terminal width.
- Narrow terminals drop the artifact count, then `tests`, then shorten the worktree path.
  Widths are counted in terminal cells, so wide characters cannot overflow the line.
- Outside a branch (no branch name) the `(branch)` part is left out.
- Runs with a tool error, an interruption, a reported nonzero exit, incomplete output,
  or unavailable/invalid/conflicting counts carry a warning. Failed tests already show
  in the `✗` count, an unknown command status is the normal case for a live run, and
  restored history is not trouble, so none of those warn. Counts are
  summed separately; malformed counts do not contribute. The warning count is
  placed first so dropping optional segments cannot hide it on narrow terminals.
  The `/compass` pane also shows the warnings; Test Board provides the details.

### `/compass` pane

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
PR, done), not every turn. A field left out keeps its value and an empty string clears
it; a call with no field is refused. It is for the main session only: a subagent's call
is refused.

The record follows the session id. After `/clear` or a resume the session goes on under
a new id; the next prompt, tool call or `compass_status` opens the record for that id
(a resumed session gets its stored goal and artifacts back).

## What counts as an artifact

Captured automatically from successful tool calls:

- `Artifact` publishes (claude.ai URLs; opens, reads and lists are ignored).
- `SendUserFile` deliveries (attachments that uploaded without error).
- `Write` of an `.html`, `.md`, `.pdf`, `.png`, `.svg`, `.mp4`, `.gif` or `.webm` file
  under `.scratch/`, `docs/`, `reports/` or `test-checklists/`, or under a Claude
  scratchpad directory.
- Output of a portable-artifacts builder (`make-explainer`, `make-diagram`,
  `make-dashboard`, `make-motion`, `make-scene`) whose `scripts/build.mjs` or
  `scripts/render.mjs` runs through Bash: the path on its `wrote <path>` line, its
  `file://` line or its `--json` `out` field (and, for `make-motion` render, its bare
  output path line), when the file has one of the extensions above. Any folder counts
  here. A command that only lists or searches a make-* folder records nothing.
- Git commits, pushes and created pull requests, as reported by the Bash tool. Pull
  requests are told apart by URL, so `#12` in two repos is two entries.

A git `checkout`, `switch`, `worktree`, `commit` or `push` (also as `git -C <dir> …`),
`gh pr checkout`, or an `EnterWorktree` / `ExitWorktree` call from the main session also
refreshes the recorded worktree and branch. A subagent's do not.

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
