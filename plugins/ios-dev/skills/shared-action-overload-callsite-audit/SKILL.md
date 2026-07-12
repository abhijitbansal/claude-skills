---
name: shared-action-overload-callsite-audit
description: Adding a side effect to a shared deep-link action, widget tap-target enum case, App Intent, or routing key (e.g. "also auto-start hardware capture") to satisfy one new caller silently changes behavior for every other UI surface that reuses the same case for its plain "just navigate" meaning, and the new caller's passing unit test doesn't catch it because it only asserts the new caller's intent, not whether existing reuse sites still behave correctly. Use before widening what an existing shared action/case does, when a new widget/screen/Siri shortcut wants to reuse an existing deep-link or enum case but needs one extra behavior on top, or when reviewing a PR that adds a flag/side-effect to a case matched on by more than one call site.
---

# Shared Action Overload: Audit Every Callsite Before Widening Intent

## Symptom

A PR adds one new caller that wants slightly more than "just navigate" out of
an existing shared identifier — a deep-link action, a widget `Link` tap
target, a routing enum case, a Siri shortcut/App Intent. The fix looks small:
reuse the existing case and bolt on a flag (e.g. "also start hardware capture
automatically"). The new caller's test passes. Ship it.

Then every *other* surface that already matched on that same case — a
different widget, a summary tile, a totally unrelated screen — silently
starts exhibiting the new side effect too, because they all shared one
identifier for what used to be a single, narrower meaning.

## Root cause

The shared identifier was never actually one intent — it was two (or more)
intents that happened to want the same navigation destination, collapsed
into one case because that was the smaller diff at the time. Widening that
case's behavior for one caller widens it for all of them, because a `switch`
or `if case` match can't distinguish "the RackBinWidget scan pill wants
auto-trigger" from "the zero-state tile just wants to open the scan screen."

A test suite doesn't catch this because tests are written against the new
caller's intent ("tapping the new pill fires auto-scan"), not against the
full set of existing reuse sites' intent ("tapping the unrelated zero-state
tile must NOT fire auto-scan"). A green test suite here is evidence the new
behavior works, not evidence the old behavior at other call sites survived
unchanged.

## Fix

Before widening a shared action/case's behavior:

1. **Grep every call site** that constructs or matches on the identifier —
   not just where it's *handled*, but every place it's *created* (deep-link
   URL builders, widget `Link(destination:)` sites, App Intent/Siri shortcut
   definitions, any `switch`/`if case` that branches on it).
2. **Classify each site's actual intent**: navigate-only vs.
   navigate-and-trigger-side-effect. Do this by reading what each surface is
   actually trying to accomplish, not by assuming the case's name still
   describes all of them.
3. **If intents diverge, split into distinct cases/actions** — one per
   intent — rather than overloading the existing one with a flag. This is a
   bigger diff than bolting on a parameter, but it's the only way each call
   site keeps its original, narrower meaning. Repoint only the call sites
   that genuinely want the new behavior; leave the rest matching the
   original, unwidened case.
4. A reviewer or advisor pass that traces call-site *intent* — not just
   call-site *existence* — is what catches this class of bug. Enumerating
   "here are the 3 places this case is used" is necessary but not
   sufficient; the audit has to ask "does this specific site's behavior
   change too, and is that change wanted?" for each one.

## Evidence

From the source session (Cubby iOS, session 0011, Phase 6): `RackBinWidget`
reused `WidgetLink.scan` and combined it with `.scan` now setting
`pendingAutoScan` — "this was broader than 'just the new widget' —
`WidgetLink.scan` is ALSO the tap target for SmallOverview's whole widget
body, the totalMetric/'Items' count tile ... and the lock widget's 'all
clear' zero-state. My sim test had 'confirmed' the mechanism fires via
`cubby://scan`, but never checked whether firing was right for every surface
using that link — the same 'tests pin shallow behavior, not intent' trap."
Fixed by splitting into `.scan` (navigate-only, reverted to its original
behavior) and a new `.scanNow` (carries the auto-trigger flag), repointing
only the two genuine "Scan" pills that actually wanted auto-trigger.

## Related skills

- `query-derived-typeahead-vocabulary` — a different flavor of the same
  "shared component/identifier reused by callers with different needs"
  shape: there it's solved by making the shared dependency *optional* per
  call site; here the fix is *splitting* the shared identifier into distinct
  cases when intents genuinely diverge.
