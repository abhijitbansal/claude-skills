---
name: github-repo-go-public-preflight-scan
description: Scan for secrets in BOTH the working tree and the full git history before flipping a GitHub repo from private to public. Use when the user asks to run "gh repo edit --visibility public", "make this repo public", "open-source this", "publish this repo" on a repo that was ever private, or is about to accept the "--accept-visibility-change-consequences" prompt. Also fires when open-sourcing an internal/forked project, or publishing a repo other people have committed to. A working-tree-only scan (or a prior code review of just the diff) is not enough — secrets committed and later deleted remain fully cloneable/indexable the instant the repo goes public, and flipping back to private does not undo it.
---

# GitHub repo private → public: scan history, not just HEAD

## When to use

- Any request to run `gh repo edit --visibility public` (or the GitHub UI
  equivalent) on a repo that was ever private.
- Open-sourcing an internal tool or a fork.
- Publishing a repo that other people also committed to — you likely don't
  know everything they added and removed.
- Anywhere `gh` is about to require `--accept-visibility-change-consequences`.
  That flag existing at all is the signal this is a one-way door: treat it
  like a production deploy gate, not a formality.

Do this even if a code review "already found nothing" — that review almost
certainly covered the current diff or `HEAD`, not every commit ever made.

## Steps

1. **Scan the current tree** for high-signal secret shapes and sensitive
   filenames still present today:
   ```bash
   git grep -nIE '(AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|ghp_[A-Za-z0-9]{36}|xox[baprs]-[0-9A-Za-z-]{10,}|sk-(live|proj|ant)[A-Za-z0-9_-]{16,})'
   git ls-files | grep -iE '(^|/)(\.env($|\.)|.*\.(pem|p12|key|keystore)$|id_rsa|secrets?\.(json|ya?ml|toml))'
   ```

2. **Scan the full history**, across all branches, for any sensitive file
   path that was *ever added* — including files later deleted. This is the
   step a working-tree-only scan skips entirely:
   ```bash
   git log --all --diff-filter=A --name-only --pretty=format: \
     | sort -u \
     | grep -iE '(^|/)(\.env($|\.)|.*\.(pem|p12|key|keystore)$|id_rsa|credential|secrets?\.(json|ya?ml|toml))'
   ```

3. **PII sweep** — emails other than the intended public contact, anywhere in
   history:
   ```bash
   git grep -hoIE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' \
     | sort -u | grep -viE '(your-public-contact@|noreply|example\.com)'
   ```

4. **Prefer a real scanner over the greps above when one is installed** —
   `gitleaks detect` or `trufflehog` (both scan full history by default) catch
   secret shapes the regexes above don't enumerate. Treat the greps as the
   always-available fallback, not the ceiling.

5. **If anything turns up in history**: stop before flipping visibility.
   - Rotate the exposed credential regardless of how old the commit is —
     assume it's burned the moment it could go public.
   - Remove it from history (`git filter-repo` or equivalent) or recreate the
     repo from a clean history before publishing. Deleting the file in a new
     commit is not sufficient; the old commit is still reachable.

6. **Only once both scans are clean**, flip visibility with explicit consent
   and verify it took effect:
   ```bash
   gh repo edit OWNER/REPO --visibility public --accept-visibility-change-consequences
   gh repo view OWNER/REPO --json visibility -q .visibility   # expect PUBLIC
   ```

## Hard rules

- Never treat a working-tree/diff scan as sufficient for this decision — the
  threat model is "every commit ever made," not "what's on disk now."
- Never flip visibility while step 2 (history scan) is still pending or has
  unresolved hits.
- If history contains a secret, rotating it is mandatory even if you plan to
  scrub history — don't rely on the scrub alone.
- This step is irreversible in practice: flipping back to private after
  exposure does not un-clone, un-cache, or un-index the history that was
  public in the interim. Treat it as a one-way door and get explicit user
  confirmation before proceeding, not just before typing the command.
