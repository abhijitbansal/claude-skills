---
name: repo-bootstrap
description: "Set up a whole new or newly-opened GitHub repo in one idempotent pass: preflight the repo state, branch protection plus CODEOWNERS (delegated), automated Claude PR review check, README skeleton, AGENTS.md and CLAUDE.md, a .scratch/ gitignore line, and a go-public secret scan when the repo is public. Use only for whole-repo setup: \"bootstrap this repo\", \"set up a new repo\", \"the usual new-repo setup\". For one concern use the sibling skill instead: branch protection or CODEOWNERS alone is github-solo-branch-protection-codeowners, a go-public secret scan or visibility flip alone is github-repo-go-public-preflight-scan. Every step is checked before it changes anything; every outward action (remote settings, push, PR) is listed and confirmed in one question before it runs."
---

# Repo bootstrap: the usual new-repo setup, checked step by step

Runs the setup the owner otherwise asks for by hand on every new repo. Each
step first checks current state and skips if already done, so a second run
changes nothing. Report the state of every step before changing any of them.

## When to use

- A repo was just created, cloned for the first time, or newly opened up to
  other contributors, and the user wants the whole usual setup.
- "Bootstrap this repo", "set up a new repo", "the usual new-repo setup".
- Not for a single concern: protection or CODEOWNERS alone, or a go-public scan
  alone, goes to the sibling skill named in the description. Do not run this
  skill for those, because it also writes README, AGENTS.md and CLAUDE.md.
- Also works as an audit on a repo that is already set up: every step reports
  done and nothing is written.

## Steps

1. **Preflight and state report.** Read-only; nothing changes yet.
   ```bash
   gh auth status
   gh repo view --json nameWithOwner,visibility,defaultBranchRef,isInOrganization,description
   ```
   - Stop and say so if `gh auth status` fails; never try to log in
     programmatically.
   - Stop with a clear message if `gh repo view` errors (no GitHub remote:
     the repo must be created or pushed first; do not create it from here).
   - Stop with a clear message if `defaultBranchRef` is null: the repo is empty,
     there is no default branch to protect and nothing to branch from. Tell the
     user to make and push an initial commit, then re-run.
   - Solo vs shared: `isInOrganization` true, or more than one collaborator with
     push rights, means shared. Count with
     `gh api --paginate repos/OWNER/REPO/collaborators --jq '.[] | select(.permissions.push) | .login'`
     (a 403 means you lack push rights: treat the repo as shared and say the
     count is unknown). Fallback if `isInOrganization` is ever missing:
     `gh api repos/OWNER/REPO --jq .owner.type` (`Organization` means shared).
   - Then collect, without writing:
     - Classic protection: `gh api repos/OWNER/REPO/branches/DEFAULT/protection`.
       Keep the JSON. 404 means no classic protection, 403 (for example a
       private repo on a free plan) means unavailable on this plan: report
       "skipped, not available" and plan no protection call.
     - Rulesets: `gh api repos/OWNER/REPO/rules/branches/DEFAULT`. A non-empty
       list means rulesets already guard the branch: report them, plan no
       classic protection on top, and let the user decide. A 403 means rulesets
       could not be checked: say "unchecked".
     - CODEOWNERS in any of the three places GitHub reads, first match wins:
       `.github/CODEOWNERS`, `CODEOWNERS`, `docs/CODEOWNERS`
       (`gh api repos/OWNER/REPO/contents/PATH`, 404 means absent there).
       Any one present counts as present; never add a second file.
     - `.github/workflows/claude-code-review.yml`, `README.md` (and whether it
       is a stub: only a title, or a title plus at most one description line),
       `AGENTS.md`, `CLAUDE.md`, and a `.scratch/` line in `.gitignore`.
     - For a public repo, or one about to go public, secret scanning state:
       `gh api repos/OWNER/REPO --jq .security_and_analysis` (null means the
       field is hidden or unavailable: report "unchecked").
   - Print one table: step, current state, planned action. Ask nothing yet.

2. **Branch protection and CODEOWNERS on the default branch.** Delegate to
   `core-workflow:github-solo-branch-protection-codeowners`; do not restate its
   payload or rules here. What this skill adds is how to apply it safely:
   - **Done means** (solo repo): classic protection exists with
     `enforce_admins.enabled` false, `required_pull_request_reviews.require_code_owner_reviews`
     true and `required_approving_review_count` at least 1, and a CODEOWNERS
     file exists in one of the three places. Report "done" only when all hold.
   - **Protection exists but differs: merge, never wipe.** The delegated PUT
     replaces the whole config. Build the PUT from the protection read in step 1:
     keep `required_status_checks` (its `strict` and contexts), `restrictions`,
     `required_linear_history`, `required_signatures` and every other existing
     field as they are, and change only the fields the target needs
     (`enforce_admins`, `require_code_owner_reviews`, review count at least 1,
     `allow_force_pushes` false, `allow_deletions` false,
     `required_conversation_resolution`). The GET shape differs from the PUT
     shape (nested `{enabled: ...}`, `url` fields): translate it, do not paste
     it. Use the delegated payload as is only when no protection exists.
     Compute a before/after diff of the changed fields for the step 7 question.
   - **Shared or org repo.** Its `enforce_admins: false` and single-owner
     CODEOWNERS model may not fit. Do not apply it blindly: ask for the review
     count and owners in the step 7 question. A CODEOWNERS owner is a user or
     an `@org/team`; a bare `@org` is not valid, and the org login is not a
     default.
   - Rulesets present, or 403 on protection: apply no classic protection call;
     say so in the report.
   CODEOWNERS only counts once it is on the default branch, so it ships in the
   step 7 branch and PR. Protection is applied and read back at once; code-owner
   enforcement starts when that PR merges, so the bootstrap PR itself may need
   the admin merge hand-over.

3. **Automated Claude PR review.** Check for
   `.github/workflows/claude-code-review.yml` on the default branch
   (`gh api repos/OWNER/REPO/contents/.github/workflows/claude-code-review.yml`,
   404 means absent). If absent, tell the user to run Claude Code's
   `/install-github-app` in this repo: it installs the workflow and sets the
   secret. Never write the workflow by hand and never create, read or print a
   secret. If present, report it and move on.

4. **README skeleton.** Never overwrite an existing `README.md`, stub or not.
   - Missing: write the skeleton below with the real repo name and the one-line
     description from step 1 (ask in the step 7 question when it is empty).
   - Present and a stub (only a title, or a title plus one description line):
     keep every existing line where it is and offer to append the missing
     sections below it. Append only.
   - Present and substantive, or unsure: leave it, report it, change nothing.
   ```markdown
   # <repo name>

   <One line: what this repo is.>

   ## Install

   <How to install or set up. TODO if unknown.>

   ## Usage

   <Smallest working example. TODO if unknown.>

   ## License

   See [LICENSE](./LICENSE). <Say "no license yet" if the file is absent.>
   ```
   Do not pick a licence for the user: that is a legal choice, so flag a
   missing `LICENSE` and stop there.

5. **Agent instructions.** Create only what is absent:
   - `AGENTS.md`: short; repo purpose, how to build and test (from what the
     repo shows, otherwise TODO lines), and the branch and commit conventions
     the owner uses. Do not invent commands: cite only scripts and targets that
     exist.
   - `CLAUDE.md` containing the single line `@AGENTS.md` so Claude Code loads
     the shared file. If `CLAUDE.md` exists, leave it and report whether it
     imports `AGENTS.md`.
   - Suggest running Claude Code's `/init` afterwards to flesh out
     project-specific guidance. Do not run it for the user.
   - Add `.scratch/` to `.gitignore` when no such line exists (create the file
     if needed; append, never reorder existing lines).

6. **Go-public check.** When `visibility` is `PUBLIC`, or the user says the repo
   is about to go public, run `core-workflow:github-repo-go-public-preflight-scan`
   first and stop on any finding. It covers the history scan, the visibility
   flip and the secret-scanning PATCH; do not duplicate its commands here. A
   private repo with no go-public plan skips this step.

7. **Apply: one question, then everything it covers.**
   Nothing outward-facing runs, and no file is written, before this question is
   answered.
   - **One `AskUserQuestion` call** covers every outward action: the remote
     settings, pushing the branch and opening the PR. Put in its text, with
     `OWNER`, `REPO` and the default branch filled in:
     - each remote call that will run: the branch-protection `PUT` from step 2
       with the before/after diff of what changes (or "no existing protection"),
       and, only when step 1 shows secret scanning is not already enabled on a
       public repo, the secret-scanning `PATCH` from the go-public skill;
     - the files that will be created, the `chore/repo-bootstrap` branch, the
       push and the PR.
     Other inputs the skill needs (empty description, review count and owners
     for a shared repo) go in as extra questions in the same call, not in
     separate calls. Options, recommended first: "Apply everything listed",
     "Remote settings only", "Branch, files, push and PR only", "Apply nothing
     (print the plan and commands)".
   - **If `AskUserQuestion` is unavailable** (headless run, subagent): apply
     nothing, write nothing, print the table and the exact commands, and say
     the run was a dry plan.
   - **Remote settings, once approved.** Write the PUT body to the session
     scratchpad, never into the repo. With no scratchpad, make sure `.scratch/`
     is ignored first (`git check-ignore .scratch`; if not ignored, append it to
     `.git/info/exclude`) and write `.scratch/bp.json` there. Run the PUT
     (`gh api -X PUT repos/OWNER/REPO/branches/DEFAULT/protection ... --input <file>`),
     then read protection back (`gh api repos/OWNER/REPO/branches/DEFAULT/protection`)
     and report `enforce_admins.enabled`,
     `required_pull_request_reviews.require_code_owner_reviews` and
     `required_status_checks` from the read-back, not the PUT response. If the
     PUT fails (403 plan limit, ruleset conflict), report the error and the
     step as not applied.
   - **Local files, once approved: on a branch.** Create the files from steps 2
     (CODEOWNERS), 4 and 5 on a `chore/repo-bootstrap` branch (never on the
     default branch), one logical commit each, then push and open a PR per the
     repo's git workflow. Merging is the owner's step; hand over the one-line
     command rather than running a `--admin` merge.

## Hard rules

- Check before change, every step. A step that is already done is reported
  "done", not redone.
- Never write, read, echo or rotate a secret. Step 3 stops at telling the user
  to run `/install-github-app`.
- Never overwrite an existing README, `AGENTS.md` or `CLAUDE.md`. A README stub
  gets appended sections only.
- Never replace existing branch protection wholesale: read it first and keep
  every field the target does not change.
- Never apply a remote setting, push a branch or open a PR before the user has
  seen the exact calls and answered. Local file creation never lands on the
  default branch.
- Do not pick a licence, add third-party dependencies, or flip visibility from
  this skill; the go-public skill owns visibility and asks for its own consent.
- Report what is true: a step the user declined or you could not check is
  listed as skipped or unchecked, never as done.

## Related skills

- `core-workflow:github-solo-branch-protection-codeowners` — step 2, protection
  payload and the admin-merge hand-over.
- `core-workflow:github-repo-go-public-preflight-scan` — step 6, secret scan
  and visibility flip.
