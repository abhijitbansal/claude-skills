---
description: The autonomous loop primitive — fetch a Linear issue, validate it, optionally create a branch, implement the work, run verify commands, open a PR, and update Linear. Used manually with an issue key, or by the polling agent. Refuses to write code unless .claude/linear.yml has autonomy: allowed.
---

# /linear-pick

The agent loop primitive. Pick up one issue and either propose a plan or do the work.

## Usage

- `/linear-pick` — pick the highest-priority `agent-ready` issue in the configured project.
- `/linear-pick ABH-123` — jump to a specific issue (skips priority filter; still validates everything else).

## State machine

Follow these steps in order. **Every failure path must end with a clean exit** — never leave the issue in an undefined state.

### Step 1: Load config
Pre-flight checks:
```bash
if ! command -v gh >/dev/null 2>&1; then
  echo "linear-pm: gh CLI not installed. brew install gh" >&2
  exit 1
fi
if ! gh auth status >/dev/null 2>&1; then
  echo "linear-pm: gh not authenticated. Run: gh auth login" >&2
  exit 1
fi
```

Source `scripts/linear-pm/load-config.sh`. Stop on error.

### Step 2: Pick the issue
- With arg: call `mcp__claude_ai_Linear__get_issue` by key. Stop if not in configured project.
- Without arg: `mcp__claude_ai_Linear__list_issues` with `project: $LINEAR_PM_PROJECT`, `label: agent-ready`, `orderBy: priority`, `limit: 1`. If none, print "No agent-ready issues." and stop.

Save:
- `ISSUE_KEY`, `ISSUE_TITLE`, `ISSUE_BODY`, `ISSUE_ID`, `ISSUE_LABELS`, `ISSUE_STATUS`.

### Step 3: Validate Acceptance criteria
Grep the body for `^## Acceptance criteria` (case-insensitive). If absent:
1. `mcp__claude_ai_Linear__save_issue` adding label `needs-spec`.
2. `mcp__claude_ai_Linear__save_comment`: `🤖 Needs spec — Issue is missing an Acceptance criteria section. Add one with at least one observable checkbox criterion, then re-label agent-ready.`
3. Stop.

### Step 4: Autonomy gate
Check `$LINEAR_PM_AUTONOMY`:

- `disabled` → print "autonomy disabled, exiting", stop. (This shouldn't happen via the poller; defensive only.)
- `review-only` →
  1. Generate a short implementation plan from the issue body (no code changes). Use the writing-plans skill if the issue looks like a multi-step feature; otherwise produce a 5-15 line plan inline.
  2. `mcp__claude_ai_Linear__save_comment`: `🤖 Plan (review-only) — \n\n<plan>`.
  3. Stop.
- `allowed` → continue.

### Step 5: Branch creation
Generate slug: `SLUG=$(bash scripts/linear-pm/make-slug.sh "$ISSUE_TITLE")`.
Compute: `BRANCH="${LINEAR_PM_BRANCH_PREFIX}${ISSUE_KEY}-${SLUG}"`.

**Dirty-tree check (first):** Run `git status --porcelain`. If non-empty → Step 9 (block-and-exit) with reason "working tree is dirty; commit or stash before /linear-pick".

**Existence check (second):**
```bash
git rev-parse --verify "$BRANCH" 2>/dev/null && exists=1 || exists=0
git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1 && remote_exists=1 || remote_exists=0
```

If `exists` or `remote_exists` → stop with: "Branch `$BRANCH` already exists. A prior run likely started this issue. Resolve manually." (No state changes on Linear.)

To retry, delete the local + remote branch and re-run:
```bash
git branch -D "$BRANCH"
git push origin --delete "$BRANCH" 2>/dev/null || true
```
Then re-label `agent-ready` and re-run `/linear-pick`.

**Create branch (last):**
```bash
git checkout -b "$BRANCH"
```

### Step 6: Linear transition — start
1. Remove `agent-ready` label (no-op if already absent).
2. Resolve current user: call `mcp__claude_ai_Linear__get_user` with `query: "me"`. Save the returned `id` as `$LINEAR_USER_ID`.
3. Move issue to `In Progress` (look up status ID via `mcp__claude_ai_Linear__list_issue_statuses`).
4. Set `assigneeId: $LINEAR_USER_ID` on the issue.
5. Comment: `🤖 Started — branch \`$BRANCH\``

### Step 7: Implementation
This is normal Claude Code flow. Honor:
- Project skills (e.g. for Paperix, the `ios-build` skill defines how to compile; the `commit` skill defines how to commit).
- Project CLAUDE.md / AGENTS.md.
- TDD if the issue has testable behavior.

**Hard rules during implementation:**
- Never `git push` to `main` / `master`.
- Never `--no-verify`, never `--no-gpg-sign`, never force-push.
- Never `git add -A` / `git add .` — name files explicitly.
- Commit with conventional-commit messages. Use the project's `commit` skill if available.
- If you hit a genuine blocker (ambiguous spec, externally-failing test, requires real device testing) → go to Step 9 (block).
- If the session is approaching its turn cap with no PR open → Step 9 before exiting.

### Step 8: Verify before PR
Execute each verify command. Empty `$LINEAR_PM_VERIFY` means no verify step is configured.

```bash
if [[ -n "$LINEAR_PM_VERIFY" ]]; then
  while IFS= read -r cmd; do
    [[ -z "$cmd" ]] && continue
    echo "→ verify: $cmd"
    if ! eval "$cmd"; then
      # Step 9 block-and-exit with the failing command + last ~30 lines of output
      ...
    fi
  done <<< "$LINEAR_PM_VERIFY"
fi
```

Any non-zero exit → Step 9 (block) with the failing command + last ~30 lines of output as the reason.

Diff size check (compute base branch first):
```bash
BASE_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
# Fallback if origin/HEAD isn't set
[[ -z "$BASE_BRANCH" ]] && BASE_BRANCH=main
# Sum added + deleted lines from the diff
diff_lines=$(git diff "origin/$BASE_BRANCH"...HEAD --numstat | awk '{added+=$1; deleted+=$2} END {print added+deleted}')
```
If `diff_lines > $LINEAR_PM_MAX_PR_LINES` → Step 9 with reason "diff too large ($diff_lines lines > $LINEAR_PM_MAX_PR_LINES); decompose into smaller issues."

### Step 9: Block-and-exit (called from Steps 5–8 on failure)
1. Add `agent-blocked` label (don't strip others).
2. Comment: `🤖 Blocked — <reason>` (include a short error excerpt, max ~30 lines).
3. Leave the branch as-is — user inspects manually.
4. Stop.

### Step 10: Push and open PR
```bash
git push -u origin "$BRANCH"
```

Compute PR title from `$LINEAR_PM_PR_TITLE_FORMAT`, substituting `{key}` and `{title}`.

PR body — heredoc:
```
## Summary
<2-4 bullets from the issue's What section>

## Acceptance criteria
<copy from issue>

Fixes <ISSUE_KEY>

🤖 Generated by /linear-pick
```

```bash
gh pr create --title "<computed>" --body "<body>"
PR_URL=$(gh pr view "$BRANCH" --json url -q .url)
```

### Step 11: Linear transition — review
1. Move issue to `In Review`.
2. Comment: `🤖 PR opened — $PR_URL`

### Step 12: Clean exit
Print:
> Done. <key> → In Review, PR <url>.

Then run Step 13.

### Step 13: Session-rename suggestion
Whenever a /linear-pick run reaches a terminal state that has written to Linear about `$ISSUE_KEY` — i.e. Step 3 (needs-spec), Step 4 (review-only plan), any Step 9 block-and-exit (always writes `agent-blocked` + comment), or Step 12 clean exit — follow the *Session-rename suggestion* protocol in the `linear-pm` skill: scan the conversation for prior team-prefixed keys already touched in this session, dedupe, append `$ISSUE_KEY`, and emit a fenced `/rename <keys>` block as the final line.

Skip when no Linear writes happened: Step 4 `autonomy: disabled`, and Step 5 branch-already-exists.

## Side effects (`allowed` mode)
- New branch named `<branch_prefix><key>-<slug>`.
- One or more local commits.
- One pushed branch to origin.
- One new PR on GitHub.
- Linear: removed `agent-ready`, possibly added `agent-blocked` or `needs-spec`, moved status, posted 1-3 comments.
- One emitted `/rename …` suggestion line (copy-pasteable text; user runs it manually).

## Side effects (`review-only` mode)
- One Linear comment with the plan.
- One emitted `/rename …` suggestion line.

## Side effects (`disabled` mode)
- Nothing.

## Failure modes (consolidated)

| Step | Condition | Action |
|---|---|---|
| 1 | `gh` not installed or not authed | Stop with installation / auth instructions. |
| 2 | Issue not in project | Stop, no writes. |
| 3 | Missing Acceptance criteria | Label `needs-spec`, comment, stop. |
| 4 | `autonomy: disabled` | Print, stop. |
| 4 | `autonomy: review-only` | Plan comment, stop. |
| 5 | Branch already exists | Stop, no Linear writes. |
| 5 | Dirty working tree | Block-and-exit (Step 9). |
| 7 | Implementation needs human input | Block-and-exit. |
| 7 | Approaching turn cap | Block-and-exit BEFORE exhaustion. |
| 8 | Verify command non-zero | Block-and-exit. |
| 8 | Diff > max_pr_lines | Block-and-exit. |
| 10 | `git push` fails | Block-and-exit with push error. |
| 10 | `gh pr create` fails | Block-and-exit; branch is on origin already. |
| 11 | Status transition fails | Print warning but DON'T block — PR is open, that's the meaningful state. User can `/linear-sync` to fix Linear later. |

## Red flags — never do these

- ❌ Force-push
- ❌ Auto-merge
- ❌ Push to `main` / `master`
- ❌ Delete the branch on failure (user inspects manually)
- ❌ `--no-verify`
- ❌ Continue past a verify failure
- ❌ Run if `autonomy: review-only` and produce ANY code changes
- ❌ Move status to `Done` (humans do that via PR merge)
