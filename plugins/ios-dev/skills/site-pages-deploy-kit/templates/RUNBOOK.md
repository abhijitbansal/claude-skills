# Site setup runbook (one-time per app)

Standard: site source in the app repo (`site/`), public Pages repo serves it.

## 1. Create the public repo

```bash
gh repo create <user>/<app>-site --public
```

Set `site.repo: <user>/<app>-site` in `.claude/app.yml`.

## 2. Deploy key (CI auth — least privilege)

```bash
ssh-keygen -t ed25519 -N "" -C "<app>-site deploy" -f <app>-site-deploy
```

- **Public half** (`.pub`) → Deploy key **with write access** on the PUBLIC
  site repo (Settings → Deploy keys).
- **Private half** → Actions secret `SITE_DEPLOY_KEY` on the APP repo
  (Settings → Secrets → Actions).
- Delete both local key files afterwards.

Never use a PAT here — a deploy key is scoped to the one repo.

## 3. First deploy + Pages

```bash
./scripts/deploy-site.sh          # from the app repo root
```

Then enable Pages on the public repo. In the UI: Settings → Pages → Source =
"Deploy from a branch" → `main` / root. The same step with `gh api` (this
changes repo settings, so run it only as this explicit step):

```bash
gh api -X POST repos/<user>/<app>-site/pages \
  -f 'source[branch]=main' -f 'source[path]=/'      # enable (409 = already enabled)
gh api repos/<user>/<app>-site/pages                 # inspect source + status
gh api -X POST repos/<user>/<app>-site/pages/builds  # trigger a build now
```

First publish takes ~1 minute. Then compare the live file with the local one
(the byte counts must match):

```bash
curl -s https://<user>.github.io/<app>-site/index.html | wc -c
wc -c < site/index.html
```

Same-repo variant (Pages serving `/docs` of a repo instead of this split
repo): switch the source with `gh api -X PUT repos/<user>/<repo>/pages -f
'source[branch]=main' -f 'source[path]=/docs'`, then POST `pages/builds` — a
path change does not trigger a build by itself. A private repo can serve
public Pages only on a paid plan.

## 4. Custom domain (optional)

DNS: CNAME `www` (or apex ALIAS/A per registrar) → `<user>.github.io`.
Pages → Custom domain → enter it → wait for the TLS cert → Enforce HTTPS.
Set `site.domain` in `.claude/app.yml`.

**Commit `site/CNAME` containing the domain** (the skeleton ships a
`CNAME` template; `{{SITE_DOMAIN}}` renders into it). Every deploy is a
force-push of the subtree, and GitHub clears the custom domain whenever the
pushed tree has no CNAME file. `deploy-site.sh` and `verify-site.sh` both fail
when `site.domain` is set and CNAME is missing.

## 5. Verify

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/site-pages-deploy-kit/scripts/verify-site.sh" site
```

Then check the live site (a manual check, not part of the lint). The
skeleton ships `.nojekyll`, which Pages needs to publish the `.well-known/`
directory, and `/privacy` and `/support` are excluded from the association
file:

```bash
curl -sI https://<domain>/.well-known/apple-app-site-association   # expect 200
curl -s  https://<domain>/.well-known/apple-app-site-association   # the same JSON you committed
```

Finally paste the live URL into Teams/iMessage and check the unfurl (rules:
skill `site-og-favicon-verify`).

## Per-app migration notes (2026-07)

- **cubby-site / a second app site (a private document-scanner app)** — already split-repo; align pages to the
  skeleton (CSP meta, og dims, favicon set), add the deploy-site.yml workflow
  + deploy key, keep existing content. The second app site: refresh stale assets via
  the scanner app's `refresh-site-assets.sh` first.
- **a private floor-plan scanner app** — already fully on this model (it IS the model). Nothing to do.
