---
name: subagent-buildverify-tool-grant-check
description: Before delegating a task to a subagent whose acceptance test requires running a build, test suite, simulator/device action, or any other shell-gated verification, check that the subagent type actually has a Bash (or equivalent shell) tool. Use this whenever you're about to spawn a subagent/Task/Agent to "implement and verify" something, especially in iOS/Xcode, compiled-language, or any project where "done" means "it builds and the tests pass" or "the sim/device shows the right screen" — a subagent given that acceptance test but no shell access will not fail fast, it will silently stall for many minutes producing zero output while looking "busy."
---

# Check a Subagent's Tool Grant Before Delegating Build/Verify Work

## Symptom

You spawn a subagent (general-purpose or a named agent type) to implement a
fix or feature and verify it — "implement X, then run the build/tests to
confirm it works." The subagent runs for a very long time (tens of minutes),
shows almost no CPU/token usage, produces zero file edits, and never reports
progress. It isn't crashed and isn't obviously erroring — it just never
finishes. This happened **twice in the same session, with two different
model tiers**, before the pattern was recognized as systemic rather than a
one-off fluke.

## Root cause

The subagent's tool list did not include `Bash` (or the project's equivalent
shell-execution tool). Its task description asked it to satisfy an acceptance
test that structurally requires running a shell command — `xcodebuild`,
`./build.sh`, `xcrun simctl`, `npm test`, `cargo test`, whatever the project's
"prove it works" step is. A subagent in this position doesn't have a clean way
to say "I cannot do this, I have no shell" — it keeps trying, re-reading
files, re-reasoning about how to verify without the tool it needs, and burns
enormous wall-clock time never converging. This is a **silent capability
mismatch**, not a bug in the subagent's reasoning: it was simply asked to do
something it has no tool to do, and the harness doesn't surface that as a
hard error the way a missing file or a permission denial would.

## Fix

**Before spawning a subagent for a task whose "done" condition is build- or
verify-gated, check what tools that subagent type actually has.** Two ways to
do this safely:

1. **Look up the agent type's declared tool list** (shown alongside its name
   and description wherever available agent types are listed) before
   dispatching. If `Bash` isn't in the list, don't hand it a task whose
   acceptance test needs a shell.
2. **When in doubt, split the work by capability, not by feature.** Give the
   subagent a *pure* read/edit/logic task with an acceptance test it can
   actually check itself (a diff that compiles by inspection, a self-contained
   unit of logic, a reasoning-checkable transformation) — and reserve every
   build, test-run, and simulator/device step for the **main loop**, which
   does have the shell tool. The subagent implements; you build and verify.

```
# WRONG — subagent has no Bash, acceptance test needs one
Agent("Implement the RealityKit fix in RackMapFullScreenView.swift, then run
./build.sh and xcrun simctl to confirm the full-screen 3D scene renders.")
# → subagent wedges: it has Read/Edit/Write/Grep/Glob but no way to build or
#   drive the simulator, and never says so — it just never finishes.

# RIGHT — split by capability
Agent("Implement the RealityKit fix in RackMapFullScreenView.swift per this
root-cause analysis: <analysis>. Return when the edit is made; do not attempt
to build or run a simulator — you don't have those tools.")
# main loop, after the subagent returns:
./build.sh --no-launch && xcrun simctl io <udid> screenshot ...
```

If a task's acceptance test is inherently build/sim-gated and can't be
usefully split (e.g., "make this 3D view render — you'll know it works when
the screenshot shows boxes, not black"), the pragmatic call is often to **do
the whole task in the main loop** rather than force an artificial split,
especially for RealityKit/UI work where the fix only becomes obvious by
looking at what actually rendered.

## When to use

- Any time you're about to dispatch a subagent whose task description
  includes "build", "run the tests", "verify on the simulator/device", or
  similar, in a project where those steps require shell access.
- Especially relevant for Xcode/Swift projects (`xcodebuild`, `xcrun simctl`),
  but the same failure mode applies to any compiled or test-gated stack.
- If a previously-dispatched subagent has been running far longer than its
  task should plausibly take with near-zero CPU/token movement and zero file
  changes, suspect this before assuming it's "just thinking hard" — check its
  tool grant and consider stopping it.

## Related skills
- `parallel-ios-agent-fixes-single-sim` — a different failure mode in the same
  neighborhood: subagents that **do** have Bash but contend over the same
  simulator device. This skill is about subagents that have **no** shell at
  all; that one is about isolating shell-capable subagents from each other.
- `realityview-fullscreencover-black-defer-mount` — the diagnostic/fix cycle
  this check most concretely applies to: "screenshot and verify a 3D render"
  is exactly the kind of acceptance test a no-Bash subagent silently stalls
  on.
- `superpowers:subagent-driven-development` — general subagent-dispatch
  guidance; this skill sharpens one specific pre-flight check it doesn't spell
  out explicitly: verifying the tool grant matches the acceptance test before
  dispatch, not after a stall.
