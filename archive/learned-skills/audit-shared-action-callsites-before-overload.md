# Before changing what a shared action/link/enum-case does, enumerate every UI surface that reuses it — a 'tests pass' shallow check doesn't prove the new behavior is right everywhere

**Extracted:** 2026-07-12
**Context:** Mined from Cubby iOS session logs (0011); adversarially verified.

## Problem
A single shared identifier (a deep-link action, a widget tap-target enum case, a routing key) is reused across multiple, semantically-different UI surfaces that happen to want the same navigation target. Adding new behavior to that shared case (e.g. 'also auto-start hardware capture') to satisfy one new caller silently changes behavior for every other caller that reused the same case for its plain 'just navigate' meaning — and a unit test that asserts 'the action fires X' doesn't catch this, because it only tests the new caller's intent, not whether every existing reuse site still behaves correctly.

## Solution
Before widening a shared action/case's behavior, grep every call site that constructs or matches on it and classify each one's actual intent (navigate-only vs. navigate-and-trigger-side-effect). If intents diverge, split into two distinct cases/actions (one for each intent) rather than overloading one — even though it's a smaller diff to overload. A reviewer or advisor pass that traces call-site *intent*, not just call-site *existence*, is what catches this; a passing test suite alone will not, because the tests were written for the new caller's shallow behavior.

## Evidence
Session 0011, Phase 6 (00:35): 'RackBinWidget reusing WidgetLink.scan combined with .scan now setting pendingAutoScan ... this was broader than "just the new widget" — WidgetLink.scan is ALSO the tap target for SmallOverview's whole widget body, the totalMetric/"Items" count tile ... and the lock widget's "all clear" zero-state. My sim test had "confirmed" the mechanism fires via cubby://scan, but never checked whether firing was right for every surface using that link — the same "tests pin shallow behavior, not intent" trap.' Fixed by splitting into `.scan` (navigate-only, reverted) and a new `.scanNow` (carries the auto-trigger flag), repointing only the two genuine 'Scan' pills.

## When to Use
This is a general iOS/SwiftUI architecture trap wherever a deep-link URL, App Intent, widget `Link`, or Siri shortcut enum case is reused across multiple screens/widgets that each expect 'just take me there' but one caller wants an added side effect — common in any app with widgets + Siri + in-app navigation sharing one router.
