# Reading an untrusted git repo from a script

A skill script that runs `git status`, `git diff` or `git log` inside a repo the
user did not write (an unpacked archive, a cloned third-party repo) runs that
repo's own configuration. Close each route below.

## Flags and env, with the reason

| Route | Mitigation | Note |
|---|---|---|
| `core.fsmonitor` in the repo's `.git/config` names a program that runs on `git status` | `git -c core.fsmonitor=false ...` | Does not cover clean filters (see the open item below) |
| A diff `textconv` driver runs on content diffs | `--no-textconv` | In the measurement, `--numstat` and `--name-status` did not run textconv on this git, so here it is defence in depth |
| An external diff driver (`diff.external`, `GIT_EXTERNAL_DIFF`) | `--no-ext-diff` | |
| `GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_n`, `GIT_CONFIG_VALUE_n` in the environment inject command-line-level config | Drop all four families from the child env | |
| `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM` | Keep them. Do not null them | `safe.directory` is honoured only from system, global or command-line config. Nulling them breaks repos owned by another user |

## Open item: repo-local clean filters (MEASURED)

A repo-local `filter.<name>.clean` command, bound by `* filter=<name>` in
`.gitattributes`, runs during `git status --porcelain` when a tracked file is
stat-dirty at the same size. It ran even with `core.fsmonitor=false`. Unpacked
archives leave every file stat-dirty, so a scan of an unpacked archive hits it on
every file.

Mitigation, verified on git 2.54.0 (Apple Git-157) by tests that failed first:

- List the drivers with
  `git config -z --name-only --get-regexp '^filter\..*\.(clean|smudge|process)$'`
  (reading config runs nothing; parse the name up to the last `.clean`, `.smudge`
  or `.process`, because driver names can contain dots).
- On every later call, pass `-c filter.<name>.clean= -c filter.<name>.smudge=
  -c filter.<name>.process= -c filter.<name>.required=false`. An empty command
  means git applies no filter, so the marker is never written and `git status`
  still reports the file dirty.
- Fallback if a git version ignores the empty override: skip the
  content-comparing dirty check whenever the repo defines a filter driver.

Shipped in portable-artifacts 2.4.0 (branch `fix/skills-security-scan`, commit
"fix: make-explainer gather neutralises repo-local git filter drivers"), with
tests for a clean driver, a process driver and a dotted driver name.

## How to re-measure (a sketch, not a recorded procedure)

1. In a temp directory (never the repo checkout), create a repo with a tracked
   file, a `.gitattributes` line `* filter=probe`, and a config
   `filter.probe.clean` that writes a marker file.
2. Make the file stat-dirty at the same size (touch it, or unpack from an archive).
3. Run the hardened `git status --porcelain` and check for the marker.
4. Repeat after adding the override. Report the marker result, not an assumption.
