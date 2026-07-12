# Architecture decisions and diagnostic protocol

Product/architecture calls made when shipping a windowed RealityView
feature, and the diagnostic protocol used to confirm the flagship
`fullScreenCover` black-render bug before picking a fix. Apply the same
reasoning, not necessarily the same choice, to a different app's
constraints.

## Architecture decisions — building the *feature*, not just the view

**Tiered fidelity: ship the unlit tier first; treat lit PBR as
separately-risked, optional polish.**
A `UnlitMaterial`/emissive-only scene cannot go dark or blank from a lighting
problem — it has no lighting dependency to break. A scene built from
`PhysicallyBasedMaterial` + `DirectionalLight`/`PointLight` entities can
render solid black or fully dark if a light entity fails to attach, a shadow
setting misbehaves, or ambient/IBL isn't configured — and that failure mode is
much harder to diagnose than "the render is dim." When a fully-lit,
shadowed, particle-effects tier is the *stated* goal, still ship the unlit
structural tier as the safe baseline first (translucent materials, flat
color, no light entities at all can still look intentional and premium — see
`ScanConstants`-style hex-matched colors pulled from a design reference), and
gate the lit tier as an explicit, separately-tested follow-up. This is a
direct trade of "matches the mockup exactly" against "cannot regress to a
worse state than before the feature existed" — bias toward the latter for a
first ship.

**The 2D view stays the accessible source of truth; 3D is a sighted-only enhancement.**
If the feature has both a flat/2D representation and a 3D one, keep them
backed by the **same** data-model and layout-building code (one
`RackMapBuilder`/`RackMapLayout`-equivalent used by both renderers, so they
can never disagree about what exists or where it sits), mark the 3D scene's
container `.accessibilityHidden` where appropriate, and never let a
capability (tap-to-open, quick placement, drag) exist in 3D-only. Users with
VoiceOver, Reduce Motion, or devices where the 3D tier degrades should get a
fully-functional experience from the 2D view alone.

**Tier-honesty: when you ship less than the chosen tier, say so explicitly.**
If a user picks "Full fidelity" (lit PBR, shadows, particles) but the safe
unlit tier is what actually ships this round, that is a legitimate
engineering call given the tiered-fidelity decision above — but say so as an
explicit accept-vs-attempt decision ("delivered X of the 5 Full-tier items;
Y/Z deferred because <risk>") rather than silently reporting the lesser tier
as "Full re-skin done." Catching your own tier-downgrade before the user does
is cheaper than them catching it on device.

## Diagnostic protocol (don't skip this before picking a fix)

When a RealityView renders wrong in only *some* mounts:
1. List every mount (inline card, sheet, `List` row, `fullScreenCover`, etc.)
2. Force the feature on and screenshot **each** mount independently (a debug
   seed + forced `UserDefaults` flag + `xcrun simctl io <udid> screenshot` is
   usually the fastest harness).
3. Record exactly which mounts render and which don't — the pattern (e.g.
   "only the fullScreenCover fails") tells you the cause; guessing from the
   code alone before this step reliably picks the wrong hypothesis first
   (the `GeometryReader` sizing theory documented as the flagship bug's
   red herring).
4. Only then change code, and re-screenshot the *specific* mount you fixed
   with ≥6s settle (see Gotcha 8 in
   [references/windowed-realityview-gotchas.md](windowed-realityview-gotchas.md))
   before calling it done.
