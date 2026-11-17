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
   git grep -lIE '(AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,}|xox[baprs]-[0-9A-Za-z-]{10,}|sk-(live|proj|ant)[A-Za-z0-9_-]{16,}|sk_live_[A-Za-z0-9]{16,}|AIza[0-9A-Za-z_-]{35})'
   git ls-files | grep -iE '(^|/)(\.env($|\.)|.*\.(pem|p12|key|keystore)$|id_rsa|secrets?\.(json|ya?ml|toml))'
   ```
   The regex covers AWS access keys, PEM private keys, GitHub tokens
   (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`, `github_pat_`), Slack, `sk-`
   style keys, Stripe `sk_live_` and Google `AIza` keys. It is a fallback
   list, not the ceiling (step 5). `-l` prints file names only: a finding
   never echoes the secret into the transcript. Open the file to judge it.

2. **Scan the full history**, across all branches, for any sensitive file
   path that was *ever added* — including files later deleted. This is the
   step a working-tree-only scan skips entirely. Fetch every remote ref first
   (`git fetch --all --prune`; for a repo others have pushed to, scan a fresh
   `git clone --mirror` instead), or branches you never checked out are
   invisible to `--all`:
   ```bash
   git fetch --all --prune
   git log --all --diff-filter=A --name-only --pretty=format: \
     | sort -u \
     | grep -iE '(^|/)(\.env($|\.)|.*\.(pem|p12|key|keystore)$|id_rsa|credential|secrets?\.(json|ya?ml|toml))'
   ```

3. **Scan the full history for secret CONTENT.** Step 2 checks file *names*
   only; a secret committed in an ordinary file and later removed is invisible
   to it. List the commits whose diffs add or remove the same secret shapes as
   step 1, as commit and path only (never `-p`: it prints the secret line, and
   a transcript is not a safe place for a live key):
   ```bash
   git log --all --format='%h %s' --name-only -G'(AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,}|xox[baprs]-[0-9A-Za-z-]{10,}|sk-(live|proj|ant)[A-Za-z0-9_-]{16,}|sk_live_[A-Za-z0-9]{16,}|AIza[0-9A-Za-z_-]{35})'
   # or, per-commit tree search, file names only (same regex as above):
   git rev-list --all | xargs -n 50 git grep -lIE '(AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,}|xox[baprs]-[0-9A-Za-z-]{10,}|sk-(live|proj|ant)[A-Za-z0-9_-]{16,}|sk_live_[A-Za-z0-9]{16,}|AIza[0-9A-Za-z_-]{35})'
   ```
   `git log -G` already reads its pattern as an extended regex. The `-E` in the
   `xargs git grep` form is required: without it, `git grep` treats `(`, `|`
   and `{16}` literally and matches nothing. In the `xargs` form, do not read
   the exit status: `xargs` exits 123 when ANY batch exits 1, and `git grep`
   exits 1 on no match. Judge by printed output: any printed line is a finding.
   Probed on a throwaway repo with a planted fake `sk_live_`, `AIza`,
   `github_pat_` and `gho_` token (committed, then removed): the `git log`
   form listed both commits with the path and no token text.

4. **PII sweep** — emails other than the intended public contact. Plain
   `git grep` reads the current tree, not history; for history, reuse the
   step 3 `git log --all --format='%h %s' --name-only -G'<email regex>'` form.
   Commit author and committer emails are public the moment the repo is, so
   list those too:
   ```bash
   git grep -hoIE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' \
     | sort -u | grep -viE '(your-public-contact@|noreply|example\.com)'
   git log --all --format='%ae%n%ce' | sort -u
   ```
   Also check what git does not hold: issue and PR bodies, release assets,
   the wiki, Actions logs, and any file that is gitignored but sits in the
   directory you are about to publish.

5. **Prefer a real scanner over the greps above when one is installed** —
   `gitleaks detect` or `trufflehog` (both scan full history by default) catch
   secret shapes the regexes above don't enumerate. Treat the greps as the
   always-available fallback, not the ceiling. Before you trust a clean result
   from a scanner, plant a fake token in a throwaway repo and confirm the
   scanner finds it; a scanner that has only ever printed nothing is unproven.

6. **If anything turns up in history**: stop before flipping visibility.
   - Rotate the exposed credential regardless of how old the commit is —
     assume it's burned the moment it could go public.
   - Remove it from history (`git filter-repo` or equivalent) or recreate the
     repo from a clean history before publishing. Deleting the file in a new
     commit is not sufficient; the old commit is still reachable.

7. **Only once all scans above are clean**, flip visibility with explicit consent
   and verify it took effect:
   ```bash
   gh repo edit OWNER/REPO --visibility public --accept-visibility-change-consequences
   gh repo view OWNER/REPO --json visibility -q .visibility   # expect PUBLIC
   ```

8. **After it is public, turn on GitHub's own scanning.** Secret scanning and
   push protection are not available through the API while the repo is
   private (the call returns 422), so enable them now. This changes repo
   settings, so run it only as an explicit step the user has seen:
   ```bash
   gh api -X PATCH repos/OWNER/REPO -f 'security_and_analysis[secret_scanning][status]=enabled' -f 'security_and_analysis[secret_scanning_push_protection][status]=enabled'
   ```
   Command written from the GitHub REST docs shape; not run against a real
   repo here. Check the response (or Settings, Code security) shows both
   `enabled`.

## Hard rules

- Never treat a working-tree/diff scan as sufficient for this decision — the
  threat model is "every commit ever made," not "what's on disk now."
- Never flip visibility while steps 2-3 (history scans) are still pending or
  have unresolved hits.
- Never print a secret value into the transcript. Use commands that list
  commit and path (`git log --format='%h %s' --name-only -G…`, `git grep -l`),
  not `-p` or `-o`. Open a flagged file only to judge it, and do not paste
  its line into a report.
- If history contains a secret, rotating it is mandatory even if you plan to
  scrub history — don't rely on the scrub alone.
- This step is irreversible in practice: flipping back to private after
  exposure does not un-clone, un-cache, or un-index the history that was
  public in the interim. Treat it as a one-way door and get explicit user
  confirmation before proceeding, not just before typing the command.

## Related skills

- `core-workflow:github-solo-branch-protection-codeowners` — harden `main`
  at the same go-public moment.
