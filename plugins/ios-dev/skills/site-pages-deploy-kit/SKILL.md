---
name: site-pages-deploy-kit
description: Create, deploy, and verify an app's marketing/legal site using the portfolio standard — site/ source dir in the app repo, split-repo public GitHub Pages target, subtree force-push over an SSH deploy key. Use when the user says "set up the site", "deploy the site", "create a marketing site for this app", or invokes /site. Covers the one-time Pages/deploy-key runbook and the og/CSP/favicon lint.
---

# Site kit (floorprint model)

**The standard:** the site source lives in the app repo (`${SITE_DIR}`,
default `site/`); a separate PUBLIC repo (`site.repo` in app.yml) serves it
via GitHub Pages. Deploys force-push a `git subtree split` of the site dir —
the public repo is a derivative, never edited directly.

## Commands

```bash
# deploy (local): guards uncommitted site changes, redacts tokened remotes
bash "${CLAUDE_PLUGIN_ROOT}/skills/site-pages-deploy-kit/scripts/deploy-site.sh" [--dry-run]

# verify: og:image absolute + true pixel dims, CSP meta, self-hosted assets, favicon set
bash "${CLAUDE_PLUGIN_ROOT}/skills/site-pages-deploy-kit/scripts/verify-site.sh" [site-dir]
```

Remote precedence: `SITE_REMOTE` env > `.site-remote` file > app.yml
`site.repo`. Always `verify-site.sh` before deploying.

## Create (new site)

1. Copy `templates/site-skeleton/` into `${SITE_DIR}`, rendering
   `{{APP_NAME}}`, `{{SITE_DOMAIN}}`, `{{APP_TEAM_ID}}`, `{{APP_BUNDLE_ID}}`
   tokens (sed). Generate `og-card.png` (1200×630), `favicon.ico`,
   `apple-touch-icon.png` — see floorprint's `build-og-card.sh` pattern for an
   idempotent generator.
2. Install the CI deploy path: render `templates/deploy-site.sh` into
   `scripts/deploy-site.sh` (standalone — CI has no plugin) and
   `templates/deploy-site.yml` into `.github/workflows/deploy-site.yml`.
3. Follow `templates/RUNBOOK.md` for the one-time public repo + deploy key +
   Pages + DNS setup.
4. `verify-site.sh` must pass before the first deploy.

## Security invariants (do not regress — floorprint security review)

- **SSH deploy key, never a PAT** — key is scoped to the one public site repo.
- **Host keys pinned from `api.github.com/meta`** (TLS-verified), not
  ssh-keyscan trust-on-first-use.
- **Loud-fail when `SITE_DEPLOY_KEY` secret is missing.**
- **Userinfo redaction** — a tokened remote URL never lands in logs.
- **Deploys cut from HEAD** — uncommitted site changes abort.

## Related

- Skill `site-og-favicon-verify` — the unfurl/CSP knowledge behind the lint.
- Release skill stage 8 delegates here in appstore mode.
