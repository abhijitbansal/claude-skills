# Linear PM — User Guide

A small set of `/linear-*` slash commands that turn Linear into the source of truth for "what to build next," and let Claude pick up an issue, branch it, implement it, run your verify commands, and open a PR — without leaving the repo.

Skill internals (label/status/branch conventions) live in [`SKILL.md`](SKILL.md). Per-repo policy lives in [`.claude/linear.yml`](../../linear.yml).

## Prerequisites — run the bootstrap

From the repo root:

```bash
./.claude/skills/linear-pm/scripts/bootstrap.sh
```

It checks `git`, `gh` (installed + authenticated), this being a git repo, and `.claude/linear.yml` having the required keys. For each missing piece it prints the exact command to fix it. Idempotent — run it whenever you suspect setup drift. **It does not install anything for you** (so it can never accidentally `brew install` something on the wrong machine) — it just diagnoses.

What it can't check:
- **Linear MCP server connection.** This is configured inside Claude Code, not via shell. If `/linear-new` errors with "Linear MCP not available," add the connector in Claude Code's MCP settings (search for "Linear" in the Claude Code MCP picker, sign in with your Linear account).

---

## Flows (recipes)

Each flow is a numbered punch list. Pick the flow that matches what you're trying to do.

### Flow 1 — File a feature, then have Claude pick it up

The everyday loop.

1. **File the issue from Claude Code:**
   ```
   /linear-new "Add dark-mode toggle to settings"
   ```
   Answer the prompts: type (`feature`), Why (one sentence), What (one or two sentences), Acceptance criteria (at least one checkbox). Claude returns `Created ABH-XXX: <title> — <linear url>`.

2. **Mark it `agent-ready` in the Linear web UI.** Open the URL from step 1 → Labels → add `agent-ready`. This is the human gate that says "an agent may touch this." Claude does not add this label itself.

3. **Trigger the pickup:**
   ```
   /linear-pick ABH-XXX
   ```
   (or just `/linear-pick` to grab the highest-priority agent-ready issue.)

4. **Review what comes back.** Current repo is in `autonomy: review-only`, so you'll get a 5–15 line plan as a Linear comment (prefixed `🤖 Plan (review-only) —`). No branch, no code, no PR. Read the plan in Linear; if it makes sense, go to Flow 2.

### Flow 2 — Switch from review-only to letting Claude actually write code

After you've reviewed the plan from Flow 1 and want execution.

1. **Edit `.claude/linear.yml`:** change `autonomy: review-only` → `autonomy: allowed`. Commit this (it's a deliberate policy change for the repo).

2. **Re-label and re-pick:** in Linear, ensure `agent-ready` is still on the issue, then in Claude Code:
   ```
   /linear-pick ABH-XXX
   ```

3. **What happens automatically:**
   - Branch `agent/ABH-XXX-<slug>` is created.
   - Claude implements the change, committing as it goes.
   - `./build.sh` (your configured `verify`) runs — if it fails, the issue is auto-labeled `agent-blocked` with the failing command + tail of output as a Linear comment, and Claude stops.
   - On success: branch is pushed, PR is opened with title `ABH-XXX: <title>` and body `Fixes ABH-XXX`. Linear issue moves to `In Review`.

4. **You merge.** The skill never merges PRs. Review the PR on GitHub, merge there, and Linear auto-closes via the `Fixes` keyword.

### Flow 3 — File quickly without a prompt round-trip

If you've just been discussing a bug in Claude Code and want to capture it without retyping context.

1. While the relevant discussion is fresh in the conversation, run:
   ```
   /linear-new
   ```
   (no argument)

2. Claude auto-fills the **What** and **Notes** sections from the recent conversation context (file paths, error messages, stack traces if mentioned). You still need to supply the title, type, and Acceptance criteria.

### Flow 4 — Check what's in flight ("status digest")

When you're context-switching back to the project and want to know what the agent (and you) left behind.

1. ```
   /linear-status
   ```

2. You get a single-screen digest grouped by:
   - **In Progress** (with PR links if any)
   - **In Review** (with PR links)
   - **agent-blocked** (with the last Linear comment that explains why)
   - **agent-ready** queue (what's pickable next)
   - **Recently shipped** (last few Done issues)

3. Common follow-ups: jump into a blocked one to unblock, or `/linear-pick <key>` the next agent-ready item.

### Flow 5 — Sync work you started manually

If you created a branch and started coding without `/linear-pick` (e.g., you knew the change off the top of your head), use this to bring Linear up to date.

1. Make sure your branch name contains the Linear issue key somewhere (e.g., `abhi/ABH-123-quick-fix` or `agent/ABH-123-foo`). `/linear-sync` parses the key out of the branch name.

2. ```
   /linear-sync
   ```

3. What it does:
   - Posts a comment on the Linear issue linking the PR (if one is open) or the branch.
   - Moves status: `In Progress` if no PR, `In Review` if PR open.
   - **Does not write code.** Pure reconciliation.

### Flow 6 — Block an issue when you're stuck

When you (the human) need to flag an issue as blocked so it doesn't get picked up by `/linear-pick`, and so `/linear-status` surfaces it.

1. ```
   /linear-block ABH-XXX "Need design clarification on the toggle position"
   ```

2. What it does:
   - Adds the `agent-blocked` label.
   - Posts a Linear comment with the reason (prefixed `🤖 Blocked —`).
   - Removes `agent-ready` if present (so the agent stops trying).

3. To unblock later: remove `agent-blocked`, re-add `agent-ready` in Linear, re-run `/linear-pick`.

### Flow 7 — Run two `/linear-pick` sessions in parallel (worktrees)

The default `/linear-pick` flow uses `git checkout -b` in the current working tree — so two simultaneous picks from the same checkout will collide. For genuine parallel work (e.g., one issue on your phone via Remote Control, one on your laptop), use git worktrees.

1. **Before** triggering `/linear-pick`, create a worktree for the issue:
   ```bash
   git worktree add ../doc-scan-ABH-123 -b agent/ABH-123-dark-mode
   ```

2. **Start a fresh Claude session in the worktree:**
   ```bash
   cd ../doc-scan-ABH-123
   claude --remote-control "ABH-123 dark mode"
   ```

3. **Inside that session, run `/linear-pick`:**
   ```
   /linear-pick ABH-123
   ```
   Because the branch is already checked out in this worktree, `/linear-pick` operates within it. A second worktree at `../doc-scan-ABH-456/` can run in parallel without colliding.

4. **When the PR is merged, clean up:**
   ```bash
   git worktree remove ../doc-scan-ABH-123
   git branch -d agent/ABH-123-dark-mode    # if GitHub didn't auto-delete on merge
   ```

**Worktree gotchas:**
- **Xcode DerivedData is shared** across all worktrees of the same project — two simultaneous `./build.sh` invocations can race. Stagger them, or use the `app-preview` skill's `--no-build` path on one.
- **`.imessage-to` is gitignored**, so each fresh worktree starts without it. Recreate per worktree: `echo 'you@example.com' > .claude/skills/app-preview/.imessage-to`.
- **`.claude/linear.yml` is tracked**, so all worktrees share the same `autonomy:` policy — you can't have one worktree at `review-only` and another at `allowed`.

### Flow 8 — Recover from an `agent-blocked` issue

When `/linear-pick` self-blocked (verify failed, diff too large, ambiguous spec, etc.).

1. **Read why:** `/linear-status` shows the last Linear comment for each blocked issue. Or open the issue in Linear directly — the `🤖 Blocked —` comment has the reason.

2. **Fix the underlying problem** (clarify the spec, fix the failing test, split into smaller issues if diff was too large, etc.). The branch from the failed attempt is still around — inspect it locally.

3. **Decide:** retry from the existing branch or start fresh?
   - **Retry:** keep the branch, push fixes, run `/linear-sync` to update Linear.
   - **Start fresh:** delete the branch (`git branch -D agent/ABH-XXX-...` + `git push origin --delete agent/ABH-XXX-...`), remove `agent-blocked` in Linear, re-add `agent-ready`, re-run `/linear-pick ABH-XXX`.

---

## Reference

### All commands at a glance

| Command | Purpose | Writes to Linear? | Writes to git? |
|---------|---------|-------------------|----------------|
| `/linear-init` | Bootstrap `.claude/linear.yml` and create label vocabulary in Linear. Run once per repo. | yes (labels) | no |
| `/linear-new` | File a new issue with the Why/What/Acceptance template. | yes (issue) | no |
| `/linear-status` | Show a digest of In Progress / In Review / agent-blocked / agent-ready / recently shipped. | no | no |
| `/linear-pick` | The agent loop — pick an issue, plan or implement. Modes set by `autonomy:`. | yes (status + comments) | yes (branch, commits, PR — only in `allowed` mode) |
| `/linear-sync` | Reconcile current branch/PR with its Linear issue (backfills when you started work outside `/linear-pick`). | yes (status + comment) | no |
| `/linear-block` | Add `agent-blocked` label + a comment with the blocker. | yes (label + comment) | no |

### Knobs in `.claude/linear.yml`

The full list is in [`SKILL.md`](SKILL.md#per-repo-config-claudelinearyml). The ones you'll touch most:

```yaml
autonomy: review-only        # disabled | review-only | allowed
verify:                      # commands /linear-pick must run green before opening a PR
  - ./build.sh
max_pr_lines: 500            # diff size beyond which /linear-pick self-blocks
default_labels:              # labels added to every /linear-new issue on top of the type label
  - paperix
poll:
  enabled: false             # if true, an external polling agent wakes /linear-pick on a schedule
  interval_minutes: 60
```

### What this skill won't do

- **Won't merge PRs.** Humans merge.
- **Won't force-push, push to main, or use `--no-verify`.** Hard-coded refusal.
- **Won't auto-create labels at runtime.** `/linear-init` is the only place labels are created — if a `default_label` is missing in Linear, `/linear-new` fails with a pointer back to `/linear-init`.
- **Won't continue past a verify failure.** Any non-zero exit blocks the issue with the failing command + tail of output. You unblock manually by fixing and re-labeling `agent-ready`.
- **Won't write code in `review-only` mode**, period. Plan-only.

### Known limitations

- **`/linear-pick` does not auto-create git worktrees.** For parallel sessions, use the manual worktree workflow in Flow 7. Adding `use_worktrees: true` to `.claude/linear.yml` and wiring `/linear-pick` to honor it is a reasonable extension — ask Claude to add it if the manual flow starts to bite.
- **No automatic issue cleanup.** `.worktrees/` directories aren't pruned for you; do `git worktree prune` periodically.
- **Bootstrap script doesn't verify the Linear MCP connection** — that's configured inside Claude Code, not via shell.
