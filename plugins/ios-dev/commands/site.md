---
description: Manage this app's marketing site — create the standard skeleton, deploy to the public Pages repo, or lint og/CSP/favicon.
argument-hint: create|deploy|verify [--dry-run]
---

Run the `site-pages-deploy-kit` skill, routing on `$ARGUMENTS`:

- **create** — copy + render the skeleton into the app.yml `site.dir`, install
  the standalone `scripts/deploy-site.sh` and `.github/workflows/deploy-site.yml`
  from the kit templates, then walk me through `templates/RUNBOOK.md`
  (public repo, deploy key, Pages, DNS) step by step. Finish with `verify`.
- **deploy** — run `verify-site.sh` first; on pass, show me the split target
  and confirm before running `deploy-site.sh` (append `--dry-run` if I passed
  it). Force-push to the public repo is expected — it's a derivative.
- **verify** — run `verify-site.sh` and explain each FAIL with its fix (the
  rules live in skill `site-og-favicon-verify`).

If `site.repo`/`site.dir` are unset in `.claude/app.yml`, ask me and update
the file first.
