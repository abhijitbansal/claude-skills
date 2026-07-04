---
name: parallel-ios-agent-fixes-single-sim
description: Fan out multiple subagents to fix a batch of independent code-review findings or plan tasks in an iOS repo without them stomping on each other. Use when you have several findings/tasks to fix with TDD and each one needs an xcodebuild test run to verify — naive parallelism means two agents editing the same working tree, or two xcodebuild test runs racing on the same simulator device (flaky installs, launch failures, derived-data collisions). Use when the user says "fix these findings in parallel", "knock out this task list with subagents", or after a code-review/plan-review pass produced ≥2 independent items.
---

# Parallel iOS agent fixes on a single-simulator project

## When to use

- You have a batch of independent findings (from `code-review`, `plan-review`, or a task list) to fix in an iOS repo, and want subagents working concurrently instead of one at a time.
- Every fix needs TDD verification via `xcodebuild test`, which normally means a shared simulator and a shared working tree — the two things that break under naive parallelism.
- You have (or can boot) ≥2 simulator instances. If you're stuck with exactly one simulator and can't boot a second, don't force parallelism — run the whole batch sequentially instead.
- Pairs with `superpowers:subagent-driven-development`, which already warns never to run parallel implementers in the same workspace — this skill is the iOS-specific mechanics for honoring that (worktree + sim + derived-data isolation) rather than just "different branches."

## Steps

1. **Map findings to files, then batch by disjointness.** For each finding/task, list the files it touches. Group findings whose file-sets don't overlap into one batch; anything that touches a shared core file (a root `View`, a shared store like `InventoryStore`, `AGENTS.md`) goes in a separate, sequential batch. Don't skip this step to save time — it's what makes the merges at the end trivial instead of conflicted.

2. **Give each parallel batch full isolation, not just a branch.** A separate branch alone is not enough — two `xcodebuild test` runs against the same booted simulator race on install/launch and produce flaky "test runner crashed" failures that look like real bugs. Each parallel batch needs all three:
   - a dedicated `git worktree` (own working tree, own branch)
   - a distinct booted simulator instance (`xcrun simctl boot <udid2>`), targeted by **id**, not name, in every `-destination` flag
   - a distinct `-derivedDataPath` so builds don't share caches

   ```bash
   git worktree add -b fix/pure-logic ../app-fixP HEAD
   xcrun simctl boot <UDID2>
   # subagent builds/tests in ../app-fixP with:
   #   -destination 'platform=iOS Simulator,id=<UDID2>' -derivedDataPath ../app-fixP/build
   ```

3. **Run the batches that share core files sequentially**, on the main tree and the main (first) simulator, one at a time — after all parallel batches are dispatched, or interleaved with them, but never concurrently with each other.

4. **Each subagent, before touching code, confirms the baseline is green.** If the very first `xcodebuild test` fails with something that looks like environment noise ("test runner crashed", missing scheme), don't debug it as a real failure first — `rm -rf build && xcodegen generate` and rerun. Stale incremental state is a more common cause than an actual regression.

5. **Each subagent does strict TDD and commits twice**: a RED commit (failing reproducer test), then a GREEN commit (fix + passing test). Self-verify with the full test run before reporting done, not just the one test it wrote.

6. **Merge each finished parallel batch back before dispatching the next wave.** Once a worktree batch is green:
   ```bash
   git merge fix/pure-logic --no-ff      # clean merge expected — files were disjoint by construction
   git worktree remove ../app-fixP
   xcrun simctl shutdown <UDID2>          # free the sim if you don't need it for the next batch
   ```
   Then run one **combined integration** `xcodebuild test` on the merged tree before starting the next phase — disjoint file sets don't guarantee disjoint runtime behavior (e.g. two fixes to the same protocol's callers).

7. **Keep a progress ledger** (a scratch markdown file, not committed) listing each batch, its files, its status, and its commit range. This is what lets you resume cleanly if a batch stalls or a subagent needs to be restarted — you can tell at a glance which batches are safe to re-dispatch versus already merged.

## Hard rules

- Never let two agents share a working tree. A shared branch checked out in one place with two agents editing it is not "parallel," it's a race — use `git worktree add` per parallel batch, always.
- Never let two `xcodebuild test` runs target the same simulator instance concurrently, even from different worktrees. Boot a second (third, …) simulator and target it by UDID in `-destination`; targeting by device *name* when multiple instances share a name is how you end up debugging the wrong sim's logs.
- Never merge a parallel batch until its own test run is green on its own isolated sim/derived-data — a "looks done" report from a subagent isn't verification, a clean local `xcodebuild test` is.
- Never skip the disjointness check to launch parallel work sooner. Two agents editing the same shared core file is a guaranteed merge conflict (or worse, a silent semantic conflict that both branches compile but the merge breaks); route those through the sequential path instead.
- Never skip the post-merge integration test run. Passing tests in isolation on disjoint files does not prove the merged tree passes — always re-run the full suite once on the combined tree before the next wave.
- If you only have one simulator and can't boot a second, don't fake parallelism — collapse everything to the sequential path (step 3) rather than risk racing installs on the shared sim.
