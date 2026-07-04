---
name: github-solo-branch-protection-codeowners
description: Configure GitHub branch protection on a solo-owner (or owner-led) repo so that OTHER people's PRs require the owner's approval before merge, while the owner can still merge their OWN PRs solo. Use when the user asks to "require approval on PRs but let me still self-merge", "make it so at least I have to approve any other PR", is hardening a repo just before making it public (forks will open PRs from strangers), or hits GitHub's "Pull request review is not required for administrators" / cannot approve own PR wall after turning on required reviews. Also fires when `required_approving_review_count: 1` locks the owner out of their own PRs, or a CODEOWNERS file "does nothing" on a feature branch.
---

# GitHub branch protection: require others' approval, keep owner self-merge

## When to use

- "At least I should have to approve everyone else's PRs" on a repo with one
  real maintainer (possibly with occasional contributors).
- Hardening `main` before flipping a repo public — once it's public, anyone
  can fork and open a PR, and you want a real gate on those, not just on
  paper.
- You turned on "require 1 approval" and now your own PRs are stuck, because
  GitHub refuses to let you approve your own pull request. A naive
  single-approval rule locks out a solo maintainer by construction.
- You added a `CODEOWNERS` file on a feature branch and code-owner review
  isn't being enforced — it looks like the setting is ignored.

## Steps

1. **Put `CODEOWNERS` on the default branch, not a feature branch.**
   GitHub reads code-owner assignments from the PR's *base* branch. A
   `CODEOWNERS` file sitting only on a feature branch is inert until that
   branch is merged into `main` — verify it there, not on the branch that
   introduced it.
   ```bash
   printf '* @your-username\n' > .github/CODEOWNERS
   # commit, PR, and merge this to main before relying on it
   ```

2. **Turn on required reviews AND require them from a code owner.**
   `required_approving_review_count: 1` alone just needs *someone's* approval
   — any write-collaborator can rubber-stamp it. Add
   `require_code_owner_reviews: true` so it specifically has to be you (or
   whoever `CODEOWNERS` names).

3. **Set `enforce_admins: false`.** This is the mechanism that reconciles
   "others need my approval" with "I can still merge without a second
   approver": admins (i.e. the owner) get an explicit bypass —
   "merge without waiting for requirements" — while everyone else is still
   blocked by step 2. Apply the full protection payload in one PUT (the
   classic API requires all four top-level keys present, even when `null`):
   ```bash
   cat > /tmp/bp.json <<'JSON'
   {
     "required_status_checks": null,
     "enforce_admins": false,
     "required_pull_request_reviews": {
       "required_approving_review_count": 1,
       "dismiss_stale_reviews": true,
       "require_code_owner_reviews": true
     },
     "restrictions": null,
     "required_linear_history": true,
     "allow_force_pushes": false,
     "allow_deletions": false,
     "required_conversation_resolution": true
   }
   JSON
   gh api -X PUT repos/OWNER/REPO/branches/main/protection \
     -H "Accept: application/vnd.github+json" --input /tmp/bp.json
   ```

4. **Merge your own PRs with the admin bypass explicitly.**
   `required_linear_history: true` forbids merge commits, so use squash or
   rebase. The bypass isn't automatic in the UI/CLI without the flag:
   ```bash
   gh pr merge N --squash --admin
   ```

5. **Verify the resulting behavior, not just the API response:**
   - A PR from anyone else → blocked until a code owner (you) approves it.
     No bypass for them.
   - A PR from you → you can't self-approve (GitHub forbids it), but
     `enforce_admins: false` lets you merge anyway via `--admin`.

## Hard rules

- Only the owner should hold `admin` on the repo. Any collaborator with
  `admin` inherits the same `enforce_admins: false` bypass and can self-merge
  around the review requirement too — grant everyone else `write` at most.
- Don't trust a `CODEOWNERS` file added on a branch until it's merged to the
  default branch and you've confirmed enforcement there; it has zero effect
  before that.
- The classic protection API rejects a PUT that's missing any of
  `required_status_checks`, `enforce_admins`, `required_pull_request_reviews`,
  `restrictions` — include all four, `null` where you want no restriction.
- If a `gh api ... -q` jq filter errors with "expected an object but got:
  boolean", that's a response-parsing issue (nested objects, not bare
  booleans) — re-fetch and parse with Python instead of assuming the PUT
  failed; it likely already succeeded.
- To also gate merges on your own CI, add the check name(s) to
  `required_status_checks.contexts` once that check actually runs on PRs —
  don't add a context that never posts a status, or it blocks forever.
