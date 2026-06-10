---
name: linear-pm
description: Linear project management conventions and slash commands. Auto-loads when the user invokes any /linear-* command or asks about Linear issues, statuses, labels, or the agent-ready workflow. Encodes the label vocabulary, status taxonomy, branch/PR naming, issue template, and the `.claude/linear.yml` per-repo policy file. Companion to the six /linear-* commands.
---

# Linear PM — Conventions

This skill documents the vocabulary every `/linear-*` command relies on. The commands themselves are at `.claude/commands/linear-*.md`. The per-repo policy lives at `.claude/linear.yml`.

See the [design doc](../../../docs/superpowers/specs/2026-05-19-linear-pm-skill-design.md) for the rationale behind every rule in here.

## Labels (created by /linear-init if missing)

| Label | Purpose | Set by |
|---|---|---|
| `agent-ready` | Pick up autonomously | User |
| `agent-blocked` | Agent tried, needs human input | Agent (and user, manually) |
| `needs-spec` | Issue too vague to act on | Agent |
| `bug` | Type: defect | User / /linear-new |
| `feature` | Type: new capability | User / /linear-new |
| `chore` | Type: maintenance, deps, infra | User / /linear-new |
| `docs` | Type: documentation only | User / /linear-new |

Per-repo `default_labels` from `.claude/linear.yml` are added on top of these on every `/linear-new` issue.

## Statuses

Uses Linear's built-in workflow — no custom states required.
- `Backlog` / `Todo` — agent picks up from here
- `In Progress` — agent or human is working
- `In Review` — PR open, awaiting review
- `Done` — PR merged (set manually for now)
- `Cancelled` — won't do

## Branch naming

`<branch_prefix><issue-key>-<slug>` where `<slug>` is kebab-case truncation of the issue title (~40 chars, `[a-z0-9-]`).

Default `branch_prefix` for autonomous work: `agent/`.
Manually-created branches can use any prefix; `/linear-sync` parses the issue key from anywhere in the branch name.

## PR conventions

- Title: `<key>: <issue title>` (matches `pr_title_format` in `.claude/linear.yml`).
- Body must include `Fixes <key>` so Linear auto-attaches and moves status on merge.
- One PR = one Linear issue.

## Issue template (used by /linear-new)

```
## Why
<motivation in one or two sentences>

## What
<concrete description of the change>

## Acceptance criteria
- [ ] <observable thing #1>
- [ ] <observable thing #2>

## Notes
<links, context, conversation excerpts>
```

`/linear-pick` refuses to act on issues missing **Acceptance criteria**. That section is the contract.

## Agent comment prefixes (greppable)

- 🤖 Started — branch `<branch-name>`
- 🤖 PR opened — `<url>`
- 🤖 Blocked — `<reason>`
- 🤖 Needs spec — `<what's unclear>`
- 🤖 Plan (review-only) — `<markdown plan>`

## Session-rename suggestion

`/linear-new` and `/linear-pick` emit a copy-pasteable `/rename` command at the end of any terminal path that wrote to Linear about an issue. Goal: the user can name their Claude Code session after the issue(s) they're working so the session list is scannable.

### Why a suggestion, not an automatic rename

Claude Code's `/rename` is a built-in slash command. The model cannot invoke built-in slash commands from a tool call (the Skill tool explicitly excludes them, and there's no other IPC path). So the only way to set the session title from inside a command is to emit a `/rename …` line that the user copy-pastes.

### Protocol

When a /linear-new or /linear-pick run is about to print its final user-facing message and it has written to Linear about `$ISSUE_KEY` (created an issue, posted any 🤖 comment, transitioned state, etc.):

1. **Scan the current conversation** for prior keys this session has touched. Look for matches of the team prefix from `$LINEAR_PM_TEAM` followed by `-\d+` in:
   - Prior `Created <KEY>: …` lines emitted by /linear-new.
   - Prior `Done. <KEY> →` lines emitted by /linear-pick.
   - Prior `🤖 Started — branch <branch-prefix><KEY>-…` agent comments.
   - Prior `/rename` lines this protocol emitted earlier in the same conversation.
2. **Dedupe + accumulate.** Collect all keys found, dedupe in first-seen order, then append `$ISSUE_KEY` if not already present.
3. **Emit** as a fenced block immediately after the command's normal output:

   ```
   /rename <KEY1>[, <KEY2>, …]
   ```

   Prefix the block with one short line, e.g. `Session rename — run this to label this session:`. Don't nag if the user has clearly already accepted the suggestion in a previous turn; the protocol fires once per terminal Linear-touching path.

### When to emit (per command)

| Command / terminal state | Emit? |
|---|---|
| `/linear-new` success | yes |
| `/linear-pick` autonomy `disabled` (no Linear writes) | no |
| `/linear-pick` autonomy `review-only` (plan comment posted) | yes |
| `/linear-pick` needs-spec (label + comment) | yes |
| `/linear-pick` branch-already-exists (no Linear writes) | no |
| `/linear-pick` block-and-exit, Step 9 (always writes `agent-blocked` + comment) | yes |
| `/linear-pick` PR opened (clean exit) | yes |

### Known limitations

- **Within-session scan only.** If the session was resumed and the existing session title `ABH-6` came from an earlier conversation no longer in context, the scan won't see it and the emitted command will clobber it with just the newest key. The user can manually edit the `/rename` line before running it.
- **Surface support.** `/rename` is supported across Claude Code surfaces (CLI, VS Code extension, web). On any surface where the slash doesn't fire, the emitted line is harmless text — the user simply doesn't run it. AC #5 of the originating ticket (no-op if unavailable) is satisfied by the suggestion being inert when ignored.

## Per-repo config: .claude/linear.yml

Required. See `templates/linear.yml.template`. Keys:

| Key | Required | Default | Purpose |
|---|---|---|---|
| `team` | yes | — | Linear team key |
| `project` | yes | — | Linear project name or ID |
| `branch_prefix` | no | `agent/` | Prefix for /linear-pick branches |
| `pr_title_format` | no | `{key}: {title}` | PR title template |
| `autonomy` | no | `review-only` | `disabled` / `review-only` / `allowed` |
| `verify` | no | `[]` | Shell commands /linear-pick must run green |
| `max_pr_lines` | no | `500` | Self-block threshold for diff size |
| `default_labels` | no | `[]` | Added to /linear-new issues |
| `poll.enabled` | no | `false` | Polling agent picks up from this repo |
| `poll.interval_minutes` | no | `15` | Poll interval |

The skill refuses to write to Linear or git if `.claude/linear.yml` is missing or required keys are absent.

## Red flags — never do these

- ❌ Force-push, --no-verify, push to main/master
- ❌ Auto-merge any PR
- ❌ Delete branches
- ❌ Modify `.claude/linear.yml` outside `/linear-init`
- ❌ Run the polling agent or `/linear-pick` if `autonomy: disabled` (user-initiated `/linear-new`, `/linear-status`, `/linear-sync`, `/linear-block`, `/linear-init` remain available — `autonomy` gates the code-writing loop, not human-driven Linear edits)
- ❌ Write code if `autonomy: review-only`
- ❌ Run /linear-pick if Acceptance criteria section is missing
- ❌ Continue past a verify failure (treat all verify failures as agent-blocked)
