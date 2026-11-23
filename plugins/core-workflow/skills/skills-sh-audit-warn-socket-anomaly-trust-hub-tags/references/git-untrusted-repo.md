# Reading an untrusted git repo from a script

A skill script that runs `git status`, `git diff` or `git log` inside a repo the
user did not write (an unpacked archive, a cloned third-party repo, a shared
checkout) runs that repo's own configuration. The dubious-ownership check gives
no protection here: an unpacked archive is owned by the current user. Close each
route below. Measured on git 2.54.0 (Apple Git-157); every row the shipped code
relies on has a marker-script test that failed first, with a control proving
plain git runs the plant.

## Flags and env, with the reason

| Route | Mitigation | Note |
|---|---|---|
| `core.fsmonitor` names a program that runs on `git status` | `-c core.fsmonitor=false` | Carries into submodule children through `GIT_CONFIG_PARAMETERS` |
| `log.showSignature=true` plus `gpg.program` (or `gpg.ssh.program`, `gpg.x509.program`) runs on `git log` of a signed commit | `-c log.showSignature=false`, never `--show-signature` | |
| A diff `textconv` driver | `--no-textconv` | `--numstat` / `--name-status` did not run textconv on this git; the test pins only the flagged path, so treat it as defence in depth |
| An external diff driver (`diff.external`, `GIT_EXTERNAL_DIFF`) | `--no-ext-diff` | |
| `core.pager` | `--no-pager` | Runs only on a TTY, so defence in depth for a spawned child |
| Partial clone: a missing blob triggers a lazy fetch that runs `remote.<name>.uploadpack` (and reaches the network) | Read config first and refuse a repo whose own config sets `remote.<n>.promisor`, `remote.<n>.partialclonefilter` or `extensions.partialclone`, before any object-reading call; `GIT_NO_LAZY_FETCH=1` as a second layer | The env variable alone works only on git 2.44+, and a diff ran before the check, so older git still ran the plant. Do not suggest a fetch in the refusal: fetching runs the same hostile remote config |
| A FIFO at `.gitattributes`, `.gitignore`, `.mailmap` or an excludes file hangs git forever | A timeout on every git spawn (60 s, SIGKILL), plus `-c log.mailmap=false` | |
| A global git-lfs filter runs the repo's own `lfs.extension.<name>.clean` command | Skip the dirty check when a repo scope defines `lfs.extension.*` or the tree has a `.lfsconfig` | Not run against real git-lfs; fails closed, so ordinary repos with a `.lfsconfig` lose the dirty check too |
| `GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_n`, `GIT_CONFIG_VALUE_n`, and the legacy `GIT_CONFIG` in the inherited env | Drop them from the child env | `GIT_CONFIG` pointed the config read at another file and made a config-based check fail open |
| `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM` | Keep them | `safe.directory` is honoured only from system, global or command-line config, so nulling them breaks allow-listed repos owned by another user. Keeping them trusts whoever set the parent env, which is already trusted |

## Filter drivers: fail closed, do not blank

A filter driver (`filter.<name>.clean`, `.smudge`, `.process`, bound by
`* filter=<name>` in `.gitattributes`) runs during `git status --porcelain`
whenever a tracked file is stat-dirty at the same size, even with
`core.fsmonitor=false`. Every file of an unpacked archive is stat-dirty.

Blanking each driver with `-c filter.<name>.clean=` looked right and was
bypassed four ways in review, all reproduced:

- a driver name containing `=`: `git -c` splits at the first `=`, so
  `-c filter.a=b.clean=` sets `filter.a` and driver `a=b` keeps running;
- an empty driver name (`[filter ""]`, `* filter=`) never matched the parser;
- `git status` recurses into submodules, whose own `.git/modules/<n>/config`
  defines filters the top-level listing never saw;
- blanking global drivers such as git-lfs made `status` report false changes.

What shipped instead (portable-artifacts 2.4.0, make-explainer `git.mjs`):

1. Before the dirty check, list drivers with
   `git config --includes --show-scope --name-only --get-regexp '^filter\.'`.
   Reading config runs nothing. `--show-scope` (not `--local`) also catches
   `config.worktree` and include files.
2. If any driver comes from a scope other than `global` or `system`, or the
   command fails with anything but exit 1 (no match), skip the
   uncommitted-changes check and warn. The user's own lfs driver stays active.
3. Run `git status` with `--ignore-submodules=all`.

A tracked file with a same-length content edit is reported dirty; a touched-only
file is reported clean once filters are out of the picture.

## How to re-measure

1. In a temp directory (never a repo checkout), create a repo with a tracked
   file, `.gitattributes` `* filter=probe`, and a local `filter.probe.clean`
   that writes a marker file.
2. Make a same-length content edit to the file.
3. Control: plain `git status --porcelain` writes the marker.
4. Run the hardened path and check the marker is absent. Repeat for a name with
   `=`, an empty name, a submodule, a partial clone (`git clone
   --filter=blob:none` from a `file://` remote with `uploadpack.allowFilter`), and
   a global-only driver that must keep working. Report the marker result, not an
   assumption.
