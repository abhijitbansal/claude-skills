# Verify a hook-rule-file mechanism actually has a dispatcher before authoring rules

**Extracted:** 2026-07-12
**Context:** Mined from Cubby iOS session logs (0010-2026-07-05-compliance-hooks); adversarially verified.

## Problem
A `skill-comply` compliance report recommended 'promote to hooks' for failing workflow steps. The obvious move is to write `.claude/hookify.*.local.md` rule files (the format the `hookify-rules` skill defines). But in this repo nothing reads those files — no dispatcher is wired in project settings, global settings, or the plugin's `hooks.json`. Writing rule-file content would have silently done nothing; the failure mode only shows up much later as 'the hook didn't fire' with no error.

## Solution
Before authoring any hook-rule-file content, grep the whole settings stack (project `.claude/settings.json`, global settings, every installed plugin's `hooks.json`) for a reference to the rule-file glob/loader. If nothing loads them, the rule-file skill only defines a *format*, not working automation — implement the behavior as a native `PreToolUse`/`Stop`/`SessionStart` entry in `settings.json` instead (the pattern the repo's existing `guard-*.sh` scripts already use).

## Evidence
Session 0010: 'hookify rule-files (.claude/hookify.*.local.md) are inert in this repo — no dispatcher is wired in project settings, global settings, or the ecc plugin's hooks.json to read them (grepped; zero refs). So the report's "promote to hooks" recommendation was implemented as native .claude/settings.json hooks.'

## When to Use
Any Claude Code repo with multiple hook-related plugins/skills installed can accumulate a rule-file convention with no live consumer. This is a general 'verify the mechanism is wired before trusting its format' check, applicable to any declarative config that depends on an unverified runtime loader — not iOS-specific at all.
