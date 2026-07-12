---
name: github-pages-flat-deploy-subdir-404
description: A GitHub Pages deploy is green in CI but a linked doc page 404s live — usually a page that lives in a subdirectory (e.g. docs/second-wind/index.html), while top-level docs (docs/machine-setup.html) work fine. Use when a Pages workflow stages a landing page plus companion docs into one flat _site/ root with `cp docs/*.html _site/` and `sed`-rewritten cross-links, and a new subdir page's link breaks after deploy despite the build passing. Root cause is shell-glob semantics (`*.html` doesn't descend into subdirs) combined with a link-rewrite that only touches top-level `_site/*.html`. This is the flat-copy `_site/` deploy model — NOT the git-subtree-split model (see Related).
---

# GitHub Pages flat-deploy: subdirectory pages silently 404

## Symptom

CI is green, the artifact uploads, the homepage loads fine — but a specific
link 404s on the live site: `/second-wind/index.html`, or any doc that lives
one level deeper than the rest. It only shows up after deploy, never in the
build log, because "build succeeded" here just means "the artifact was
produced," not "every link in it resolves."

## Root cause

Two independent glob blind spots in a workflow that flattens `site/` +
`docs/*.html` into one `_site/` root and rewrites relative links to work at
the flattened depth:

1. **The copy glob skips subdirectories.** `cp docs/*.html _site/` matches
   `docs/machine-setup.html` but not `docs/second-wind/index.html` — `*.html`
   is one directory level, full stop. The page is simply absent from the
   deployed artifact.
2. **The link-rewrite glob skips subdirectories too.** A rewrite such as
   `sed -i 's#\.\./site/index.html#index.html#g' _site/*.html` only touches
   files directly in `_site/`. Anything copied into `_site/<sub>/` never gets
   rewritten, so `../site/...` or `../docs/...` back-links inside it stay
   broken even if you fix (1).

The two compound: the landing page's link `../docs/second-wind/index.html`
gets flattened by a `sed 's#\.\./docs/##g'` rewrite to `second-wind/index.html`
— which then has nowhere to resolve, because the copy step never created
`_site/second-wind/` in the first place.

## Fix

Explicitly `mkdir` + `cp` each subdirectory page (globs won't find them for
you), and keep subdir pages self-contained so the missing rewrite never
matters:

```yaml
# WRONG — glob silently drops subdir pages, no error, no CI failure
- name: Stage site
  run: |
    mkdir -p _site
    cp site/index.html _site/index.html
    cp docs/*.html _site/
    sed -i 's#\.\./docs/##g' _site/index.html

# CORRECT — subdirs created and copied explicitly
- name: Stage site
  run: |
    mkdir -p _site _site/second-wind
    cp site/index.html _site/index.html
    cp docs/*.html _site/ 2>/dev/null || true
    # the glob above misses this — copy each subdir page by hand
    cp docs/second-wind/index.html _site/second-wind/index.html 2>/dev/null || true
    # link rewrites only ever touch top-level _site/*.html — by design,
    # because subdir pages below are self-contained (no rewrite needed)
    sed -i 's#\.\./docs/##g'                      _site/index.html
    sed -i 's#\.\./site/index.html#index.html#g'  _site/*.html
```

Make every subdir page self-contained — inline CSS, no `../` back-links or
asset paths — so the fact that the rewrite step doesn't reach it is a
non-issue. Confirm with:

```bash
grep -n 'href="\.\.\|src="\.\.' docs/<sub>/*.html   # expect no output
```

**Verify before trusting it, two cheap checks:**

```bash
# A. Locally simulate staging; confirm every flattened href has a matching file
grep -oE 'href="[^"]+\.html"' _site/index.html | cut -d'"' -f2 | \
  while read f; do test -f "_site/$f" || echo "MISSING: $f"; done

# B. After deploy, curl every linked path for 200 — not just the homepage
for u in / /machine-setup.html /second-wind/index.html /og.png; do
  echo "$(curl -s -o /dev/null -w '%{http_code}' https://USER.github.io/REPO$u)  $u"
done
```

## Evidence

Found in a Pages workflow that staged a landing page (`site/index.html`) plus
companion docs (`docs/*.html`) into a flat `_site/` root, adding a new doc
page nested one directory deeper (`docs/second-wind/index.html`) that then
404'd live while CI stayed green. The trap is generic shell-glob semantics —
`*.html` never descends into subdirectories — so it reproduces in any
rsync/cp-based static-site staging step, not anything GitHub Pages-specific.

## Related skills

- `site-pages-deploy-kit` — a **different deploy model**: the site source
  lives in `site/` in the app repo and CI force-pushes a `git subtree split`
  of that one directory straight to a public repo's Pages branch. There is no
  flat `_site/` staging step and no cross-directory `cp`/`sed` flattening, so
  this glob-blind-spot bug does not apply there — don't assume subtree
  deploys need this fix, and don't apply subtree remediation to a flat-copy
  workflow.
- `site-og-favicon-verify` — checks that pages which *do* deploy render
  correctly (unfurl/favicon/CSP); orthogonal to whether a page reaches the
  artifact at all.
- `subpage-nav-anchor-baseurl-ssr-label-drift` — the base-path/subdirectory
  deploy context this bug family lives in; a different failure mode
  (in-page nav anchors, not the deploy artifact itself) on the same kind of
  site.
