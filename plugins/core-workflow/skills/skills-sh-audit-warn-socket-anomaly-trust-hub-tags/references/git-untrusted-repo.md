# Reading an untrusted git repo from a script

A repo's own `.git` can name programs that git runs. That `.git` reaches you
through an unpacked archive, a copied or shared checkout, or a bare repository
embedded in the tree of a clone (a plain `git clone` does not copy the remote's
`.git/config`). The dubious-ownership check gives no protection: an unpacked
archive is owned by the current user.

**Rule 1: read commits, not the work tree.** Use only `git config` (listing),
`rev-parse`, `for-each-ref`, commit-to-commit `diff` with `--numstat` or
`--name-status`, and `log`. A work-tree read (`status`, `diff`, `diff HEAD`,
`ls-files -m`) runs filter drivers and index hooks, so it goes behind the
fail-closed gate below. Any other command (`archive`, `checkout`, `blame`, `grep`,
`cat-file --textconv`, ...) needs its own marker test first.

**Rule 2: flags are not enough.** Check the config first and fail closed.

Measured on git 2.54.0 (Apple Git-157), 2026-11-23, unless a row says otherwise.
"Shipped" means portable-artifacts 2.4.0 (make-explainer `git.mjs`, make-scene
`history-rows.mjs`). The "Pin" column is the test in make-explainer's
`git-hardening.test.mjs`: "marker" is a plant with a control proving plain git
runs it. Rows marked "not shipped" were measured while reviewing this lesson and
have no test in that repo.

## Routes

| Route | Mitigation | Pin and note |
|---|---|---|
| `core.fsmonitor` names a program that runs on `git status` | `-c core.fsmonitor=false` | Marker. Carries into submodule children through `GIT_CONFIG_PARAMETERS` |
| Hooks: an index refresh runs `post-index-change` from `.git/hooks` or `core.hooksPath` | Env `GIT_OPTIONAL_LOCKS=0` (shipped) plus `-c core.hooksPath=/dev/null` (not shipped) | No marker test. `GIT_OPTIONAL_LOCKS=0` closes `status` only; a work-tree `diff` still ran the hook until `core.hooksPath` was set |
| `log.showSignature=true` plus `gpg.program` (or `gpg.ssh.program`, `gpg.x509.program`) runs on `git log` of a signed commit | `-c log.showSignature=false`; never `--show-signature`, `%G*` or `%(signature)` formats, `verify-commit` or `verify-tag` | No test. `--format=%G?` ran the program with the flag set |
| A diff `textconv` driver | `--no-textconv` | Marker. Mandatory for patches and `log -S` / `-G` (both ran it without the flag), and `blame` runs it too; defence in depth for `--numstat` / `--name-status`, which did not |
| An external diff driver (`diff.external`, `GIT_EXTERNAL_DIFF`) | `--no-ext-diff` | No test |
| `diff.submodule=diff` starts a child `git diff` inside the submodule, and the two flags above do not carry into it | `--numstat` or `--name-status` only; add `--submodule=short` to anything that prints a patch | Not shipped: shipped code prints no patch. A patch diff between two commits ran the submodule's textconv |
| Merge drivers through `log.diffMerges=remerge` | Never pass `-m` or `--remerge-diff`; use `--no-merges` or `--diff-merges=first-parent` | Review probe, not re-run. make-scene uses `--no-merges` |
| `core.pager` | `--no-pager` | No test. Runs only on a TTY, so defence in depth for a spawned child |
| Partial clone: a missing object triggers a lazy fetch that runs `remote.<name>.uploadpack`, `core.sshCommand`, a credential helper or a transport | Refuse it from config (next section) before any object read; `GIT_NO_LAZY_FETCH=1` as a second layer | Marker. The variable arrived in 2.45.0 and was backported (2.39.4, 2.43.4 and 2.44.1 have it; 2.44.0 and 2.39.3 do not: read from git's sources). Do not suggest a fetch in the refusal: it runs the same hostile remote config |
| A FIFO at `.gitattributes`, `.gitignore`, `.mailmap`, an excludes file or an `include.path` target hangs git forever | A timeout on every spawn, the config listing included (60 s, SIGKILL), plus `-c log.mailmap=false` | Timeout tests for `.gitattributes` and `.mailmap`. The `include.path` hang was measured here |
| A global git-lfs filter runs the repo's own `lfs.extension.<name>.clean` | Skip the work-tree read when the repo defines `lfs.extension.*` or has a `.lfsconfig` (work tree root, index or HEAD) | Tested without real git-lfs. Shipped code checks work tree and HEAD, not the index. Ordinary repos with a `.lfsconfig` lose the check too |
| Option-shaped ref: a file `.git/refs/heads/--output=x` is listed as a branch and, passed as a revision, makes `git diff` write a file | Pass full refs (`refs/heads/...`) or resolved SHAs, reject a leading `-`, put `--end-of-options` before revisions | Shipped rejects a leading `-` in a user-supplied base. A trailing `--` did not help; `--end-of-options` did |
| `core.worktree` points git at another folder, whose file names then reach your output | Refuse when the repo's config sets it, or when `--show-toplevel` is neither the requested folder nor a parent of it | Not shipped |
| A bare repository embedded in the tree, entered as the working folder | `-c safe.bareRepository=explicit` | Not shipped. Control ran the plant; the flag refused with exit 128 |

## Environment

Pass a scrubbed environment to every spawn.

| Variables | Do | Why |
|---|---|---|
| `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_COMMON_DIR`, `GIT_NAMESPACE`, `GIT_CEILING_DIRECTORIES`, `GIT_DISCOVERY_ACROSS_FILESYSTEM` | Drop | They point git at another repo, index or object store than the one you checked; a git hook or another tool's child sets them |
| `GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_n`, `GIT_CONFIG_VALUE_n`, legacy `GIT_CONFIG` | Drop | The first four inject config. `GIT_CONFIG` pointed the config read at another file and made the check fail open |
| `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM` | Keep for `status` in repos that need `safe.directory` or lfs (make-explainer); set both to the null device for `log` only (make-scene) | `safe.directory` counts only from system, global or command-line config. Keeping them trusts whoever set the parent env, which is already trusted |
| `GIT_OPTIONAL_LOCKS=0`, `GIT_TERMINAL_PROMPT=0`, `GIT_NO_LAZY_FETCH=1` | Set | Index hooks on `status`, prompts, lazy fetch. An inherited `GIT_NO_LAZY_FETCH=0` must not win |

## The config check: fail closed, do not blank

List what the repo itself defines. Listing config runs nothing, but it can hang
(FIFO include), so it gets the timeout too. The two patterns:

```
git config --includes --show-scope --name-only --get-regexp '<pattern>'

^(extensions\.partialclone|remote\..*\.(promisor|partialclonefilter))$
^(filter\.|lfs\.extension\.)
```

1. Drop the lines whose scope (first tab-separated field) is `global` or `system`:
   those are the user's own. `--local` is not a substitute: it misses
   `config.worktree` and, without `--includes`, include files.
2. Exit 1 with no output means no match. Any other failure counts as a hit:
   `--show-scope` needs git 2.26, and older git must fail closed.
3. Hit on the first pattern: refuse the repo, before any object read.
4. Hit on the second, or a `.lfsconfig`: skip the work-tree read and warn that
   the uncommitted-changes state is unknown. The user's own lfs driver stays
   active.
5. Otherwise run `git status --porcelain --ignore-submodules=all`. A work-tree
   `diff` needs `--ignore-submodules=all` as well.

Why not blank the drivers. A filter driver (`filter.<name>.clean`, `.smudge`,
`.process`, bound by `* filter=<name>` in `.gitattributes`) runs on every
stat-dirty file whose size is unchanged, and every file of an unpacked archive
is stat-dirty. Blanking each one with `-c filter.<name>.clean=` was bypassed three
ways in review and broke a fourth case:

- a driver name containing `=`: `git -c` splits at the first `=`, so
  `-c filter.a=b.clean=` sets `filter.a` and driver `a=b` keeps running;
- an empty driver name (`[filter ""]`, `* filter=`) never matched the parser;
- `git status` enters submodules, whose own `.git/modules/<n>/config` defines
  filters the top-level listing never saw;
- blanking global drivers such as git-lfs made `status` report false changes.

## Known gaps in what shipped

From the follow-up list of abhijitbansal/portable-artifacts#11:

- promisor keys in global or system config are ignored by make-explainer's check;
- a `.lfsconfig` present only in the index is not seen;
- SIGKILL on timeout can orphan git's children;
- Windows, not reproduced: spawning with the repo as working folder may run a
  planted `git.exe`; resolve git's absolute path outside the repo first.

The "not shipped" rows above are further candidates for that repo.

## How to re-measure

Work in a fresh temp directory, never a repo checkout. Every case needs a control:
plain git must write the marker file, or the probe proves nothing.

| Case | Plant | Control that must write the marker |
|---|---|---|
| filter | `.gitattributes` `* filter=probe`, local `filter.probe.clean` writing a marker, then a same-length edit | `git status --porcelain` and `git diff HEAD` |
| filter names | the same with `a=b` and with an empty name | `git status --porcelain` |
| submodule filter | the filter only in the submodule's own config | `git status --porcelain` |
| hook | executable `.git/hooks/post-index-change`; change a tracked file's mtime before each run | `git status` |
| fsmonitor | local `core.fsmonitor` | `git status` |
| gpg | a commit object with a `gpgsig` header, `gpg.program`, `log.showSignature=true` | `git log -1` |
| partial clone | source repo with `uploadpack.allowFilter=true`; `git clone --no-checkout --filter=blob:none file://...`; set `remote.origin.uploadpack` to a marker script in the clone | `git diff --numstat HEAD~1 HEAD` |
| option-shaped ref | copy a SHA into `.git/refs/heads/--output=pwn` | `git diff --output=pwn HEAD --` writes `pwn` |
| global driver | a filter in global config only | must keep working, with no skip |

Report the marker results, not an assumption.
