# Reading an untrusted git repo from a script

A repo's own `.git` can name programs that git runs. That `.git` reaches you
through an unpacked archive, a copied or shared checkout, or a bare repository
embedded in the tree of a clone (a plain `git clone` does not copy the remote's
`.git/config`). The dubious-ownership check gives no protection: an unpacked
archive is owned by the current user.

**Rule 1: read commits, not the work tree.** Use only the jobs in the recipe below:
`config` (listing), `rev-parse`, `ls-tree`, commit-to-commit `diff` with `--numstat`
or `--name-status`, and `log` with an explicit `--format`. The one work-tree read
allowed is `status`, behind the fail-closed gate. Never run a work-tree `diff`: it
runs filter drivers and hooks that the flags do not stop. Any other command
(`merge-base`, `for-each-ref`, `archive`, `checkout`, `blame`, `grep`, `ls-files`,
...) needs its own marker test first.

**Rule 2: flags are not enough.** Check the config first and fail closed.

**Rule 3: this list is what we found, not a proof.** Most rounds of review
found another route. For a repo you expect to be hostile, use a sandbox or a
container with no network as well.

Measured on git 2.54.0 (Apple Git-157), 2026-11-23, unless a row says otherwise.
"Shipped" means make-explainer's `git.mjs` in portable-artifacts 2.4.0 (2.4.1 closes
several "not shipped" rows; see its changelog); make-scene's
`history-rows.mjs` shares the env scrub, the partial-clone check and the timeout,
and runs only `config`, `rev-parse --show-prefix` and `log`. The "Pin" column is the test in make-explainer's
`git-hardening.test.mjs`: "marker" is a plant with a control proving plain git
runs it. "Not shipped" rows have no test in that repo.

## Routes

| Route | Mitigation | Pin and note |
|---|---|---|
| `core.fsmonitor` names a program that runs on `git status` | `-c core.fsmonitor=false` | Marker. Carries into submodule children through `GIT_CONFIG_PARAMETERS` |
| Filter drivers: `filter.<name>.clean`, `.smudge` or `.process`, bound in `.gitattributes`, run on any work-tree read | Gate step 4 | Marker, seven cases. See "Why not blank" |
| Hook files: an index refresh runs `post-index-change` from `.git/hooks` or `core.hooksPath` | Env `GIT_OPTIONAL_LOCKS=0` (shipped) plus `-c core.hooksPath=/dev/null` (not shipped) | No marker test. Either one closed `status`; only `core.hooksPath` closed a work-tree `diff` |
| Config hooks: `[hook "x"]` with `event = post-index-change` and a `command` in the repo's config | `GIT_OPTIONAL_LOCKS=0`; no work-tree `diff`; `hook.` in the gate below (not shipped) | `core.hooksPath=/dev/null` does not stop these: a work-tree `diff` with every flag here ran the command. `status` with `GIT_OPTIONAL_LOCKS=0` did not |
| `log.showSignature=true` plus `gpg.program` (or `gpg.ssh.program`, `gpg.x509.program`) runs on `git log` of a signed commit | `-c log.showSignature=false`; an explicit `--format` on every `log`; never `--show-signature`, `%G*` or `%(signature)` formats, `verify-commit` or `verify-tag` | No test. With the flag set, `--format=%G?` still ran the program, and so did a plain `log` under the repo's own `format.pretty=%G?`. Shipped code always passes `--format` |
| A diff `textconv` driver | `--no-textconv` | Marker. Mandatory for patches and `log -S` / `-G` (both ran it without the flag), and `blame` runs it too; defence in depth for `--numstat` / `--name-status`, which did not |
| An external diff driver (`diff.external`, `diff.<driver>.command`, `GIT_EXTERNAL_DIFF`) | `--no-ext-diff` | No test |
| `diff.submodule=diff` starts a child `git diff` inside the submodule, and the two flags above do not carry into it | `--numstat` or `--name-status` only; add `--submodule=short` to anything that prints a patch | Not shipped: shipped code prints no patch. A patch diff between two commits ran the submodule's textconv |
| Merge drivers through `log.diffMerges` | Never pass `-m`, `--remerge-diff` or `--diff-merges=on`; use `--no-merges` or `--diff-merges=first-parent` | Not shipped as a flag in make-explainer, whose `log` prints no diff; make-scene uses `--no-merges`. The three forms ran the driver, the two safe ones did not |
| `core.pager` | `--no-pager` | No test. Runs only on a TTY, so defence in depth for a spawned child |
| Partial clone: a missing object triggers a lazy fetch that runs `remote.<name>.uploadpack`, `core.sshCommand`, a credential helper or a transport | Refuse it from config (the gate below) before any object read; `GIT_NO_LAZY_FETCH=1` as a second layer | Marker. The variable arrived in 2.45.0 and was backported (2.39.4, 2.43.4 and 2.44.1 have it; 2.44.0 and 2.39.3 do not: read from git's sources). Do not suggest a fetch in the refusal: it runs the same hostile remote config |
| A FIFO hangs git forever: at `.gitattributes`, `.gitignore`, `.mailmap`, an excludes file, an `include.path` target, `.git/packed-refs`, `.git/objects/info/alternates` or a `diff.orderFile` target, among others | A timeout on every spawn, the config listing included (60 s, SIGKILL), plus `-c log.mailmap=false` | A timeout test for `.gitattributes` and a test that `.mailmap` is not read; the others were measured in review |
| A global git-lfs filter runs the repo's own `lfs.extension.<name>.clean` | Skip the work-tree read when the repo defines `lfs.extension.*`, holds any value with a line break, or has a `.lfsconfig` (work tree root or HEAD); use git-lfs 3.8.1 or later | Tested without real git-lfs. A `.lfsconfig` only in the index is not seen. Ordinary repos with a `.lfsconfig` lose the check too |
| Option-shaped ref: a file `.git/refs/heads/--output=x` is listed as a branch and, passed as a revision, makes `git diff` write a file | Pass full refs (`refs/heads/...`) or resolved SHAs, reject a leading `-`, put `--end-of-options` before revisions (with `rev-parse`, only together with `--verify`, or it prints the option as an extra line) | Shipped rejects a leading `-` in a user-supplied base. A trailing `--` did not help; `--end-of-options` did |
| `core.worktree` points git at another folder, whose file names then reach your output | Refuse when the repo's config sets it (gate step 3) | Not shipped. Comparing `--show-toplevel` is not enough: a parent such as `/` passes. This also refuses a submodule checkout, where git sets the key itself |
| A `.git` file (`gitdir: <elsewhere>`) or `.git/commondir` shows another repo's commits, and the top level still looks right | The checks after job 3 | Not shipped, and make-explainer must accept linked worktrees. They also cover a symlinked `.git`, `objects` or `refs`, alternates and a `files://` ref storage |
| `refs/replace/*` or `.git/info/grafts` makes git show forged history | Env `GIT_NO_REPLACE_OBJECTS=1` and `GIT_GRAFT_FILE` set to the null device | Not shipped. Integrity, not execution |
| The dirty flag is the repo's own claim: skip-worktree bits, `.git/info/exclude` and submodule edits can hide changes | None | Integrity, not execution |
| Repo settings that change the output: `status.showUntrackedFiles`, `i18n.logOutputEncoding`, `diff.relative`, `diff.renames` | The explicit options in jobs 5, 6 and 8 | Not shipped, except `-M` and `--no-color`. Integrity, not execution |
| Another git call in the same workflow. The gathering step was hardened, and the next step, a page builder, asked `git check-ignore` with the repo's config in force, which ran `core.fsmonitor` | Grep every script for spawns of git and send them all through one hardened runner. For this question: `check-ignore --no-index` | Not in 2.4.0; 2.4.1 fixes it, marker. |
| A `git` found inside the repo: a relative or empty `PATH` entry, or an absolute one such as `<repo>/node_modules/.bin` (what `npm run` adds, from memory) | Resolve git to one absolute path outside the repo, once, or drop such entries | Not in 2.4.0. 2.4.1 drops them up to the nearest `.git`; outer repos, linked worktrees and superprojects stay open. Other programs looked up by name (ffmpeg) have the same problem |
| The user's own global filter loads code from the working folder, for example `python -m <module>` with that module planted in the repo | Skip job 8, or use a sandbox | Open in 2.4.1. Control and `status` both ran the plant |
| A bare repository embedded in the tree, entered as the working folder | `-c safe.bareRepository=explicit` | Not shipped. Control ran the plant; the flag refused with exit 128 |

## Environment

Pass a scrubbed environment to every spawn.

| Variables | Do | Why |
|---|---|---|
| `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_COMMON_DIR`, `GIT_NAMESPACE`, `GIT_CEILING_DIRECTORIES`, `GIT_DISCOVERY_ACROSS_FILESYSTEM` (shipped), plus the rest of `git rev-parse --local-env-vars`: `GIT_SHALLOW_FILE`, `GIT_REPLACE_REF_BASE`, `GIT_IMPLICIT_WORK_TREE`, `GIT_PREFIX` (not shipped) | Drop | They point git at another repo, index or object store than the one you checked; a git hook or another tool's child sets them |
| `GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_n`, `GIT_CONFIG_VALUE_n`, legacy `GIT_CONFIG` | Drop | The first four inject config. `GIT_CONFIG` pointed the config read at another file and made the check fail open |
| `GIT_EXTERNAL_DIFF`, `GIT_ATTR_SOURCE`, `GIT_TRACE*`, `GIT_SSH_COMMAND`, `GIT_ASKPASS`, `GIT_ICASE_PATHSPECS` and the other `GIT_*_PATHSPECS` (not shipped) | Drop | Not needed for these jobs; they come from the parent, which is trusted |
| `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM` | Keep (within the next-to-last row's rule), as make-explainer does; make-scene, which never runs `status`, sets both to the null device | `safe.directory` counts only from system, global or command-line config. Keeping them trusts whoever set the parent env, which is already trusted |
| `HOME`, `XDG_CONFIG_HOME`, `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM`, `GIT_EXEC_PATH` (not in 2.4.0) | Drop unless absolute and outside the repo | A value inside the repo makes git read a repo file as `global`, which the gate trusts; a planted filter ran. 2.4.1 drops relative values only |
| `GIT_OPTIONAL_LOCKS=0`, `GIT_TERMINAL_PROMPT=0`, `GIT_NO_LAZY_FETCH=1` (shipped); `LC_ALL=C`, `GIT_NO_REPLACE_OBJECTS=1`, `GIT_GRAFT_FILE` = null device (not shipped) | Set | Index hooks on `status`, prompts, lazy fetch, stable output, forged history. An inherited `GIT_NO_LAZY_FETCH=0` must not win |

## The recipe

Every spawn uses this base, an argument array (never a shell string), the scrubbed
environment above, the null device as stdin and the 60 s timeout. Jobs 1 and 2 run
in the requested folder, the rest in the root that job 2 printed.

```
git --no-pager -c core.quotepath=off -c core.fsmonitor=false
    -c core.hooksPath=/dev/null -c log.showSignature=false -c log.mailmap=false
    -c safe.bareRepository=explicit -c advice.graftFileDeprecated=false
```

Run the jobs in this order:

| # | Job | Arguments after the base |
|---|---|---|
| 1 | List the config, then apply the gate | `config --list --includes --show-scope -z` |
| 2 | Work tree root | `rev-parse --show-toplevel` |
| 3 | Git dirs | `rev-parse --path-format=absolute --git-dir`, then the same with `--git-common-dir` |
| 4 | Resolve each revision | `rev-parse --verify --quiet --end-of-options <full ref>^{commit}` |
| 5 | Commits | `log -z --no-color --encoding=UTF-8 --format=%H%x1f%cs%x1f%s <sha>..<sha> --` |
| 6 | Changed files | `diff -z -M --no-color --no-relative --no-ext-diff --no-textconv --submodule=short --numstat <sha> <sha> --` |
| 7 | `.lfsconfig` at HEAD | `ls-tree --full-tree --name-only HEAD .lfsconfig` |
| 8 | Dirty or not, only if the gate allows | `status --porcelain --untracked-files=normal --ignore-submodules=all` |

**Failures.** A non-zero exit, a signal or a timeout in jobs 1 to 7 is a refusal. In
job 8 it means the uncommitted-changes state is unknown. Empty output is an answer
only after exit 0. (An unknown revision in job 4 is an error for the user.)

**After job 3,** refuse unless `<root>/.git` is a real directory (`lstat`, not a
symlink) and both git dirs equal `realpath(root)` plus `/.git`. Refuse when
`objects`, `refs`, `HEAD`, `packed-refs` or `config` inside it is a symlink, or when
`objects/info/alternates` exists.

### The gate: match in your script, on bytes, and fail closed

Listing config runs nothing, but it can hang (FIFO include), so it has the timeout
too. Match in your script rather than with `--get-regexp`, so that "no match" and
"could not tell" stay apart. Job 1 prints one `scope NUL key LF value NUL` record per
entry (no `LF value` for a key without one). Drop the empty piece after the final
NUL, split each record at its first LF, and compare the raw bytes of the key,
lowercased.

1. A failed job 1, an odd number of fields, or no `core.repositoryformatversion` in
   scope `local` means the listing cannot be trusted: refuse.
2. Entries whose scope is `global`, `system` or `command` (your own `-c`) are the
   user's. Everything else belongs to the repo, Apple Git's `unknown` included.
   `--local` is not a substitute: it misses `config.worktree` and, without
   `--includes`, include files.
3. Refuse the repo on a repo-owned `core.worktree`, `extensions.partialclone` or
   `extensions.refstorage` whose value holds `://`, and on a `remote.` key ending in
   `.promisor` or `.partialclonefilter` in any scope. Do it before any object read.
4. Skip job 8, and warn that the uncommitted-changes state is unknown, on a
   repo-owned key starting with `filter.`, `lfs.extension.` or `hook.`, on any
   repo-owned value that holds LF or CR, or on a `.lfsconfig` in the work tree root
   (`lstat`) or at HEAD (job 7). The user's own drivers stay active and are trusted
   only as far as they parse repo data safely: git-lfs before 3.8.1 reads
   `git config -l` line by line (the class of CVE-2026-105802), which the value check
   covers. Update git-lfs as well.

**What this refuses or skips, so you can say so:** linked worktrees, submodule
checkouts, `clone --separate-git-dir`, clones with alternates (`--shared`,
`--reference`) and partial clones are refused; repos with local filter drivers
(git-crypt, git-annex, `git lfs install --local`), a `.lfsconfig` or a branch
description (`git branch --edit-description` writes a line break) lose only job 8.
Needs git 2.31 (`--path-format`); refuse older git. `safe.bareRepository` needs 2.38
and is ignored before it.

**What it assumes:** nobody writes the repo during the run, because the gate is
check-then-use. Copy a shared checkout first, or use a sandbox.

Measured as a whole on git 2.54.0, with the parent in a UTF-8 locale and the spawns
under `LC_ALL=C`: twelve plants (hook file, config hook, fsmonitor, four filter
driver names, textconv, `diff.external`, `diff.<driver>.command`,
`log.showSignature`, `format.pretty`) ran under plain git and none ran under this
recipe. A global filter that parses config line by line ran a forged command under
plain git and was not reached here. The refusals were tried once each, except
`extensions.refstorage` and the failure of jobs 2 to 7. Not run: Linux, other git
versions, real git-lfs.

Those runs used a `PATH` of absolute entries outside the repo and no planted config
folder. The recipe does not enforce that, so apply the `PATH` row and the environment
table as well.

It is stricter than the shipped 2.4.0 code in several places. Copy this recipe, not
that code. Test every flag: `log.showSignature=false` had no test, and with it removed
234 tests still passed while both tools ran the repo's `gpg.program`.

### Why not blank the filter drivers

A filter driver (`filter.<name>.clean`, `.smudge`,
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

## Other known gaps in what shipped

From the follow-up and unfixed-findings lists of
abhijitbansal/portable-artifacts#11, not exhaustive:

- promisor keys in global or system config are ignored by make-explainer's check (the
  gate above counts them);
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
| filter names | the same with `a=b`, with an empty name and with a name of unusual bytes | `git status --porcelain` |
| forged lfs line | a global filter script that reads `git config -l` line by line; a repo value with a line break naming an `lfs.extension` command | `git status --porcelain` |
| diff drivers | `.gitattributes` `* diff=probe` with `diff.probe.textconv`, then `diff.probe.command`; `diff.external` | `git diff HEAD~1 HEAD` |
| refusals | symlinked `.git`, `objects`, `refs`; alternates; `gitdir:` file; `commondir`; `core.worktree` | plain `git log` shows the other repo |
| submodule filter | the filter only in the submodule's own config | `git status --porcelain` |
| hook | executable `.git/hooks/post-index-change`; change a tracked file's mtime before each run | `git status` |
| config hook | `[hook "x"]` with `event = post-index-change` and `command`; change a tracked file's mtime first | `git status` |
| fsmonitor | local `core.fsmonitor` | `git status` |
| gpg | a commit object with a `gpgsig` header and `gpg.program`; once with `log.showSignature=true`, once with `format.pretty=%G?` | `git log -1` |
| partial clone | source repo with `uploadpack.allowFilter=true`; `git clone --no-checkout --filter=blob:none file://...`; set `remote.origin.uploadpack` to a marker script in the clone | `git diff --numstat HEAD~1 HEAD` |
| option-shaped ref | copy a SHA into `.git/refs/heads/--output=pwn` | `git diff --output=pwn HEAD --` writes `pwn` |
| global driver | a filter in global config only | must keep working, with no skip |

Report the marker results, not an assumption.
