---
name: branch-explainer
description: Generate a self-contained HTML visual explainer for the current git branch — what's implemented, architecture, key files, test evidence, and next steps. Use when the user says "explain this branch", "visualize what we built", "generate a recap", "show me the architecture of this change", or invokes /explain-branch. Delegates rendering to the visual-explainer skill; scoped to one branch/PR rather than the whole repo.
---

# Branch explainer (redirect)

This skill no longer renders anything. A branch page is built by
`portable-artifacts:make-explainer` with its `recap` preset, and
`/explain-branch` invokes that. What stays here is what the preset does not
carry: the three-part short answer, design-doc mining, and the rules for test
evidence.

## Short answer first

When the user asks "what was wrong", "how did we fix it" or "what did this
branch do" in plain words, open the reply with three parts, before any tool
call or action, and keep each to one or two sentences:

1. **Symptom** — what the user saw, in their terms.
2. **Root cause** — the mechanism, not the first suspicion.
3. **Fix and test** — what changed, and the test or command that proves it.

Every part traces to a commit, a diff or a command you ran. Bugfix PR bodies
open with the same three parts. Offer the full page afterwards; do not build it
unasked.

## Full page

Load `portable-artifacts:make-explainer` and follow its `recap` preset
(`gather.mjs git`, then `scaffold.mjs recap`, then build). Pass the base branch
as `--base` when it is not `main`. The builder prints the `file://` path and
writes under `<repo>/.scratch/`; deliver that file to the user rather than only
reporting a path.

Fill in what the gathered facts lack:

1. **PR context, if any:** `gh pr view --json title,url,state,body`. Link the PR
   in the header; use its summary as a starting structure, not verbatim filler.
2. **Design docs, if the branch has them:** `docs/superpowers/specs/*.md` and
   `docs/superpowers/plans/*.md` touched in this branch's commits already hold
   the architecture decisions and the workstream breakdown. Mine them rather
   than re-deriving from diffs.
3. **Test evidence:** test files changed or added, and their pass state only if
   you ran them this session. Cite the command and its result (for example
   "146/146 bats via `bats tests/bats`"). Never claim a suite is green without
   having run it, and list what is still manual.
4. **New mechanism worth teaching:** if the branch brings in a tool, framework
   or pattern the user has not used before, add a "how it works" section with a
   concrete example, not just "we use X now".
5. **Next steps:** only claims traceable to the PR body, TODOs or open checklist
   items. Never fabricate momentum.

## Scope

"What did THIS branch build" is scoped by `git diff <base>...HEAD`. For "what is
this whole repo, where did I leave off", use a repo-wide recap instead.
