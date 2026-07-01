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

Then on the public repo: Settings → Pages → Source = "Deploy from a branch"
→ `main` / root. First publish ~1 minute.

## 4. Custom domain (optional)

DNS: CNAME `www` (or apex ALIAS/A per registrar) → `<user>.github.io`.
Pages → Custom domain → enter it → wait for the TLS cert → Enforce HTTPS.
Set `site.domain` in `.claude/app.yml`.

## 5. Verify

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/site-pages-deploy-kit/scripts/verify-site.sh" site
```

Then paste the live URL into Teams/iMessage and check the unfurl (rules:
skill `site-og-favicon-verify`).

## Per-app migration notes (2026-07)

- **cubby-site / paperix-site** — already split-repo; align pages to the
  skeleton (CSP meta, og dims, favicon set), add the deploy-site.yml workflow
  + deploy key, keep existing content. paperix-site: refresh stale assets via
  doc-scan's `refresh-site-assets.sh` first.
- **floorprint** — already fully on this model (it IS the model). Nothing to do.
