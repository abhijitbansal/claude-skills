# Reading an untrusted git repo from a script

A repo's own `.git` can name programs that git runs. That `.git` reaches you
through an unpacked archive, a copied or shared checkout, or a bare repository
embedded in the tree of a clone (a plain `git clone` does not copy the remote's
`.git/config`). The dubious-ownership check gives no protection: an unpacked
archive is owned by the current user.

**Rule 1: read commits, not the work tree.** Use only `config` (listing),
`rev-parse`, `merge-base`, `symbolic-ref`, `for-each-ref`, `ls-tree`,
commit-to-commit `diff` with `--numstat` or `--name-status`, and `log` with an
explicit `--format`. The one work-tree read allowed is `status`, behind the
fail-closed gate below. Never run a work-tree `diff`: it runs filter drivers and
hooks that the flags do not stop. Any other command (`archive`, `checkout`,
`blame`, `grep`, `ls-files`, `cat-file --textconv`, ...) needs its own marker test
first.

**Rule 2: flags are not enough.** Check the config first and fail closed.

**Rule 3: this list is what we found, not a proof.** Three rounds of review each
found another route. For a repo you expect to be hostile, use a sandbox or a
container with no network as well.

Measured on git 2.54.0 (Apple Git-157), 2026-11-23, unless a row says otherwise.
"Shipped" means make-explainer's `git.mjs` in portable-artifacts 2.4.0; make-scene's
`history-rows.mjs` shares the env scrub, the partial-clone check and the timeout,
and runs `log` only. The "Pin" column is the test in make-explainer's
`git-hardening.test.mjs`: "marker" is a plant with a control proving plain git
runs it. "Not shipped" rows have no test in that repo.

## Routes

| Route | Mitigation | Pin and note |
|---|---|---|
| `core.fsmonitor` names a program that runs on `git status` | `-c core.fsmonitor=false` | Marker. Carries into submodule children through `GIT_CONFIG_PARAMETERS` |
| Hook files: an index refresh runs `post-index-change` from `.git/hooks` or `core.hooksPath` | Env `GIT_OPTIONAL_LOCKS=0` (shipped) plus `-c core.hooksPath=/dev/null` (not shipped) | No marker test. Either one closed `status`; only `core.hooksPath` closed a work-tree `diff` |
| Config hooks: `[hook "x"]` with `event = post-index-change` and a `command` in the repo's config | `GIT_OPTIONAL_LOCKS=0`; no work-tree `diff`; `^hook\.` in the gate below (not shipped) | `core.hooksPath=/dev/null` does not stop these: a work-tree `diff` with every flag here ran the command. `status` with `GIT_OPTIONAL_LOCKS=0` did not |
| `log.showSignature=true` plus `gpg.program` (or `gpg.ssh.program`, `gpg.x509.program`) runs on `git log` of a signed commit | `-c log.showSignature=false`; an explicit `--format` on every `log`; never `--show-signature`, `%G*` or `%(signature)` formats, `verify-commit` or `verify-tag` | No test. With the flag set, `--format=%G?` still ran the program, and so did a plain `log` under the repo's own `format.pretty=%G?`. Shipped code always passes `--format` |
| A diff `textconv` driver | `--no-textconv` | Marker. Mandatory for patches and `log -S` / `-G` (both ran it without the flag), and `blame` runs it too; defence in depth for `--numstat` / `--name-status`, which did not |
| An external diff driver (`diff.external`, `diff.<driver>.command`, `GIT_EXTERNAL_DIFF`) | `--no-ext-diff` | No test |
| `diff.submodule=diff` starts a child `git diff` inside the submodule, and the two flags above do not carry into it | `--numstat` or `--name-status` only; add `--submodule=short` to anything that prints a patch | Not shipped: shipped code prints no patch. A patch diff between two commits ran the submodule's textconv |
| Merge drivers through `log.diffMerges` | Never pass `-m`, `--remerge-diff` or `--diff-merges=on`; use `--no-merges` or `--diff-merges=first-parent` | Not shipped as a flag in make-explainer, whose `log` prints no diff; make-scene uses `--no-merges`. The three forms ran the driver, the two safe ones did not |
| `core.pager` | `--no-pager` | No test. Runs only on a TTY, so defence in depth for a spawned child |
| Partial clone: a missing object triggers a lazy fetch that runs `remote.<name>.uploadpack`, `core.sshCommand`, a credential helper or a transport | Refuse it from config (next section) before any object read; `GIT_NO_LAZY_FETCH=1` as a second layer | Marker. The variable arrived in 2.45.0 and was backported (2.39.4, 2.43.4 and 2.44.1 have it; 2.44.0 and 2.39.3 do not: read from git's sources). Do not suggest a fetch in the refusal: it runs the same hostile remote config |
| A FIFO hangs git forever: at `.gitattributes`, `.gitignore`, `.mailmap`, an excludes file, an `include.path` target, `.git/packed-refs`, `.git/objects/info/alternates` or a `diff.orderFile` target, among others | A timeout on every spawn, the config listing included (60 s, SIGKILL), plus `-c log.mailmap=false` | Timeout tests for `.gitattributes` and `.mailmap`; the others were measured in review |
| A global git-lfs filter runs the repo's own `lfs.extension.<name>.clean` | Skip the work-tree read when the repo defines `lfs.extension.*` or has a `.lfsconfig` (work tree root or HEAD) | Tested without real git-lfs. A `.lfsconfig` only in the index is not seen. Ordinary repos with a `.lfsconfig` lose the check too |
| Option-shaped ref: a file `.git/refs/heads/--output=x` is listed as a branch and, passed as a revision, makes `git diff` write a file | Pass full refs (`refs/heads/...`) or resolved SHAs, reject a leading `-`, put `--end-of-options` before revisions (with `rev-parse`, only together with `--verify`, or it prints the option as an extra line) | Shipped rejects a leading `-` in a user-supplied base. A trailing `--` did not help; `--end-of-options` did |
| `core.worktree` points git at another folder, whose file names then reach your output | Refuse when the repo's config sets it | Not shipped. Comparing `--show-toplevel` is not enough: a parent such as `/` passes. This also refuses a submodule checkout, where git sets the key itself |
| A `.git` file (`gitdir: <elsewhere>`) or `.git/commondir` shows another repo's commits, and the top level still looks right | Compare `rev-parse --absolute-git-dir` and `--git-common-dir`, both through realpath, with the requested folder; refuse when they leave it | Not shipped. Linked worktrees and submodules legitimately leave it: allow them only when the owner asks |
| `refs/replace/*` makes `log` print a forged commit | Env `GIT_NO_REPLACE_OBJECTS=1` | Not shipped. Integrity, not execution |
| A bare repository embedded in the tree, entered as the working folder | `-c safe.bareRepository=explicit` | Not shipped. Control ran the plant; the flag refused with exit 128 |

## Environment

Pass a scrubbed environment to every spawn.

| Variables | Do | Why |
|---|---|---|
| `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_COMMON_DIR`, `GIT_NAMESPACE`, `GIT_CEILING_DIRECTORIES`, `GIT_DISCOVERY_ACROSS_FILESYSTEM` (shipped), plus the rest of `git rev-parse --local-env-vars`: `GIT_GRAFT_FILE`, `GIT_SHALLOW_FILE`, `GIT_REPLACE_REF_BASE`, `GIT_IMPLICIT_WORK_TREE`, `GIT_PREFIX` (not shipped) | Drop | They point git at another repo, index or object store than the one you checked; a git hook or another tool's child sets them |
| `GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_n`, `GIT_CONFIG_VALUE_n`, legacy `GIT_CONFIG` | Drop | The first four inject config. `GIT_CONFIG` pointed the config read at another file and made the check fail open |
| `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM` | Keep for `status` in repos that need `safe.directory` or lfs (make-explainer); set both to the null device for `log` only (make-scene) | `safe.directory` counts only from system, global or command-line config. Keeping them trusts whoever set the parent env, which is already trusted |
| `GIT_OPTIONAL_LOCKS=0`, `GIT_TERMINAL_PROMPT=0`, `GIT_NO_LAZY_FETCH=1` (shipped), `GIT_NO_REPLACE_OBJECTS=1` (not shipped) | Set | Index hooks on `status`, prompts, lazy fetch, forged commits. An inherited `GIT_NO_LAZY_FETCH=0` must not win |

## The assembled call

Every spawn uses this base, an argument array (never a shell string), the scrubbed
environment above and the 60 s timeout. The steps below add only the part after it.

```
git --no-pager -c core.quotepath=off -c core.fsmonitor=false
    -c core.hooksPath=/dev/null -c log.showSignature=false -c log.mailmap=false
    -c safe.bareRepository=explicit
```

| Job | Arguments after the base |
|---|---|
| Config listing | `config --includes --show-scope --name-only --get-regexp <pattern>` |
| Resolve a revision | `rev-parse --verify --quiet --end-of-options <full ref>^{commit}` |
| Commits | `log -z --format=%H%x1f%cs%x1f%s <sha>..<sha> --` |
| Changed files | `diff -z --no-ext-diff --no-textconv --submodule=short --numstat <sha> <sha> --` |
| `.lfsconfig` at HEAD | `ls-tree --name-only HEAD .lfsconfig` |
| Dirty or not (gated) | `status --porcelain --ignore-submodules=all` |

`core.hooksPath` and `safe.bareRepository` are not in the shipped base.
Measured as a whole: nine plants (hook file, config hook, fsmonitor, filter,
textconv, `diff.external`, `diff.<driver>.command`, `log.showSignature`,
`format.pretty`) ran under plain git, and none ran under these steps plus the gate
below.

## The config check: fail closed, do not blank

List what the repo itself defines. Listing config runs nothing, but it can hang
(FIFO include), so it gets the timeout too. The two patterns (`hook\.` is not in
the shipped one):

```
git config --includes --show-scope --name-only --get-regexp '<pattern>'

^(extensions\.partialclone|remote\..*\.(promisor|partialclonefilter))$
^(filter\.|lfs\.extension\.|hook\.)
```

1. Drop the lines whose scope (first tab-separated field) is `global` or `system`:
   those are the user's own. `--local` is not a substitute: it misses
   `config.worktree` and, without `--includes`, include files.
2. Exit 1 with no output means no match. Any other failure counts as a hit:
   `--show-scope` needs git 2.26, and older git must fail closed.
3. Hit on the first pattern: refuse the repo, before any object read.
4. Hit on the second, or a `.lfsconfig` in the work tree root (`lstat`) or at HEAD
   (`ls-tree`): skip the work-tree read and warn that the uncommitted-changes
   state is unknown. The user's own drivers stay active, so a global driver that
   itself reads repo files is trusted.
5. Otherwise run the `status` line from the table above.

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

From the follow-up and unfixed-findings lists of
abhijitbansal/portable-artifacts#11, not exhaustive:

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
| filter | `.gitattributes` `* filter=probe`, local `filter.probe.clean` writing a marker, then a same-length edit | `git status --porcelain` |
| filter names | the same with `a=b` and with an empty name | `git status --porcelain` |
| submodule filter | the filter only in the submodule's own config | `git status --porcelain` |
| hook | executable `.git/hooks/post-index-change`; change a tracked file's mtime before each run | `git status` |
| config hook | `[hook "x"]` with `event = post-index-change` and `command`; change a tracked file's mtime first | `git status` |
| fsmonitor | local `core.fsmonitor` | `git status` |
| gpg | a commit object with a `gpgsig` header and `gpg.program`; once with `log.showSignature=true`, once with `format.pretty=%G?` | `git log -1` |
| partial clone | source repo with `uploadpack.allowFilter=true`; `git clone --no-checkout --filter=blob:none file://...`; set `remote.origin.uploadpack` to a marker script in the clone | `git diff --numstat HEAD~1 HEAD` |
| option-shaped ref | copy a SHA into `.git/refs/heads/--output=pwn` | `git diff --output=pwn HEAD --` writes `pwn` |
| global driver | a filter in global config only | must keep working, with no skip |

Report the marker results, not an assumption.
