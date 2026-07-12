---
name: declarative-hook-rules-inert-without-dispatcher
description: A compliance report or workflow recommends "promote this to a hook," and the obvious move is to write a declarative hook-rule file (e.g. .claude/hookify.*.local.md) in whatever format a rule-authoring skill defines — but if nothing in the settings stack (project settings.json, global settings, every installed plugin's hooks.json) actually reads that rule-file glob, the file is inert: it silently does nothing, and the failure mode only shows up much later as "the hook didn't fire," with no error anywhere. Use before authoring any hook-rule-file content, or when auditing why a hook that "should" be firing per a rule file never actually runs.
---

# Verify a Hook-Rule-File Mechanism Has a Dispatcher Before Authoring Rules

## Symptom

A compliance report recommends "promote to hooks" for a failing workflow
step. The obvious move is to write a declarative rule file (e.g.
`.claude/hookify.*.local.md`) in the format a rule-authoring skill defines.
The rule file gets written, looks correct, and nothing happens — the
behavior it describes never fires, with no error, no warning, nothing in any
log pointing at the rule file at all.

## Root cause

A skill that defines a rule-file **format** is not the same as a mechanism
that **loads and dispatches** that format at runtime. Native Claude Code
hooks are wired through `PreToolUse`/`Stop`/`SessionStart` entries in
`settings.json` (project or global) or a plugin's `hooks.json` — a
declarative rule-file convention is a separate, optional layer that only
works if something in that settings stack was specifically built to glob for
the rule-file pattern and read it. If no such loader exists, the rule-file
skill only defines a *format*, not working automation, and authoring content
in that format produces a file that looks configured but is functionally
dead weight.

## Fix

**Before authoring any hook-rule-file content, grep the whole settings
stack** for a reference to the rule-file glob/loader:

```bash
grep -rn "hookify" .claude/settings.json ~/.claude/settings.json \
  ~/.claude/plugins/*/hooks.json 2>/dev/null
```

- If nothing loads the rule-file pattern, **do not author rule-file
  content** expecting it to run. Implement the behavior as a native
  `PreToolUse`/`Stop`/`SessionStart` entry in `settings.json` instead — the
  pattern any working `guard-*.sh`-style hook script in the repo already
  uses.
- If a dispatcher *is* found, confirm it's actually wired into the active
  settings (not just present in an example/template file) before trusting
  the rule-file format for anything that matters.

## Evidence

Session 0010: "hookify rule-files (`.claude/hookify.*.local.md`) are inert in
this repo — no dispatcher is wired in project settings, global settings, or
the ecc plugin's `hooks.json` to read them (grepped; zero refs). So the
report's 'promote to hooks' recommendation was implemented as native
`.claude/settings.json` hooks."

## Related skills

- `hook-merge-base-diff-command-regex-anchoring` — a different hook-reliability
  failure mode in the same neighborhood: hooks that DO fire but compute the
  wrong result (diff range, command regex), rather than hooks that never fire
  at all.
