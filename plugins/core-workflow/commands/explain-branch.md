---
description: Generate a self-contained HTML visual explainer for the current branch — what's implemented, architecture, key files, tests, next steps.
argument-hint: [base-branch, default main]
---

Invoke the `branch-explainer` skill for the current branch, diffing against
`$ARGUMENTS` (default `main`). Follow its data-gathering and required-sections
contract exactly — every claim must trace to a command you actually ran or a
file you actually read.

Write the output to `.scratch/branch-explainer/<branch-name>.html` (create the
dir if missing) and deliver it to the user.
