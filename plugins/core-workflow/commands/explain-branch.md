---
description: Generate a self-contained HTML visual explainer for the current branch — what's implemented, architecture, key files, tests, next steps.
argument-hint: [base-branch, default main]
---

Build the branch page with the `portable-artifacts:make-explainer` skill and its
`recap` preset, for the current branch diffed against `$ARGUMENTS` (default
`main`; pass a non-default base as `--base`). Then read the `branch-explainer`
skill for what the preset does not carry: the PR link, design-doc mining and the
test-evidence rules. Every claim must trace to a command you actually ran or a
file you actually read.

The builder writes under `<repo>/.scratch/` and prints a `file://` line; deliver
that file to the user.

If `portable-artifacts` is not installed, tell the user to run
`/plugin marketplace add abhijitbansal/portable-artifacts` and
`/plugin install portable-artifacts@portable-artifacts`. It lives in its own repo,
<https://github.com/abhijitbansal/portable-artifacts>, which also covers other hosts.
