---
name: branch-explainer
description: Generate a self-contained HTML visual explainer for the current git branch — what's implemented, architecture, key files, test evidence, and next steps. Use when the user says "explain this branch", "visualize what we built", "generate a recap", "show me the architecture of this change", or invokes /explain-branch. Delegates rendering to the visual-explainer skill; scoped to one branch/PR rather than the whole repo.
---

# Branch explainer

A repo-local wrapper around `visual-explainer`, purpose-built for
claude-skills' workflow: turn a feature branch (often a multi-workstream
effort with its own spec + plans under `docs/superpowers/`) into one
shareable HTML page — not a generic whole-project recap.

## When to use vs `project-recap`

- **This skill** — "what did THIS branch/PR build", scoped by `git diff
  <base>...HEAD`. Use after finishing a branch, mid-branch for a checkpoint,
  or before opening/updating a PR.
- **`visual-explainer:project-recap`** — "what is this WHOLE repo, where did
  I leave off" — broader, git-log-wide, for context-switching back into a
  project after time away.

## Data gathering (before writing any HTML)

Run these and read the output — every claim in the page must trace to one of
them, never be invented:

1. **Branch identity:** `git rev-parse --abbrev-ref HEAD`, the base branch
   (usually `main`), `git log --oneline <base>..HEAD`, `git diff --stat
   <base>...HEAD`.
2. **PR context (if any):** `gh pr view --json title,url,state,body` on this
   branch. Use the PR body's summary/test-plan as a starting structure, not
   verbatim filler.
3. **Design docs, if this branch has them:** `docs/superpowers/specs/*.md`
   and `docs/superpowers/plans/*.md` touched in this branch's commits — these
   already contain the architecture decisions and the workstream breakdown;
   mine them rather than re-deriving from diffs.
4. **What's implemented, per area:** group the changed files by directory/
   plugin (`git diff --stat` prefixes), and for each group, one sentence of
   what it does — pull from commit subjects (`git log --oneline`) and the
   spec, not guesswork.
5. **Test evidence:** test files changed/added, and their pass state if you
   ran them this session (cite the actual command + result, e.g. "146/146
   bats"). Never claim a suite is green without having run it.
6. **Key new capability worth teaching:** if the branch introduces an
   external tool/framework/pattern the user hasn't used before (e.g.
   Fastlane, a new CI provider, a new library), add a dedicated "how it
   works" section explaining the mechanism concretely — lanes/config files
   for Fastlane, stages for a pipeline, etc. — not just "we use X now."

## Required page sections

1. **Branch header** — name, base, PR link/state, one-line goal.
2. **What's implemented** — grouped by workstream/plugin/directory, each a
   card: goal, key files, one distinguishing detail.
3. **Architecture** — Mermaid diagram (flowchart or hybrid per
   visual-explainer's 15+-element rule) showing how the new pieces connect
   (e.g. config → skill → script → external tool). Follow the skill's
   Mermaid invariants (zoom controls, `theme: 'base'`, no bare `<pre>`).
4. **New mechanism deep-dive** — if step 6 above found one, teach it here:
   concrete example config/commands, not abstract description.
5. **Files changed** — compact table, grouped, with one-line purpose each
   (not a raw diff dump).
6. **Test evidence** — what ran, what passed, what's still manual (link/embed
   a manual-test-checklist if one exists for this branch in `.scratch/`).
7. **Next steps** — only claims traceable to the PR body, TODOs, or open
   checklist items; never fabricate momentum.

## Delivery

- Load `visual-explainer` for the actual HTML/CSS/Mermaid mechanics (this
  skill only defines the content contract above).
- **Output path overrides the visual-explainer default** — per this repo's
  (and the user's global) convention, generated artifacts live IN the repo,
  not in `~/.agent/`. Write to `.scratch/branch-explainer/<branch-name>.html`
  (gitignored scratch dir; create it if missing).
- Deliver the file to the user (send + open in browser) rather than just
  reporting a path.
