---
name: background-assets-apple-hosted-packs
description: A Background Assets asset pack fails to download or EXTRACT on device or TestFlight — ProcessingPipelineError, AssetPackManagerError, STExtractionService faults, a pack stuck at downloading/failed, works dev-signed but fails on TestFlight (or vice versa), or external testers can't download despite READY_FOR_TESTING. Also for building/uploading Apple-hosted packs (ba-package, altool --upload-asset-pack, AssetPackManager) beyond what the base skill covers. Prerequisite: read ios-dev:background-assets-manifest-drift-blind-redownload first — it owns manifest-schema drift, the local content-cache check before re-downloading multi-GB sources, and pack-version immutability (new content = new pack id/version + client constant bump); this skill adds only the delivery/extraction sharp edges it lacks.
promotion_target: Fold into ios-dev:background-assets-manifest-drift-blind-redownload as an "extraction failures + install channels" section — this file carries only the delta.
---

# Apple-hosted Background Assets: delivery & extraction sharp edges

Evidence base: Cubby BUG-038 (a 4-day multi-session investigation ending in a
confirmed OS-version-specific platform regression), sessions 0051/0052.

## 1. Strip ALL dotfiles before packaging

`ba-package`'s recursive directory selector has **no exclude mechanism** — every
hidden file in the source tree ships in the pack. Sweep for ALL dotfiles/hidden
directories, not just the obvious caches: Cubby excluded `.cache/huggingface/` and
still shipped `.gitattributes` in the first "clean" rebuild. Verify with a listing of
the packaged contents, not the source dir.

## 2. Install channels resolve manifests differently

The BackgroundAssets framework distinguishes (verified via `strings` on the framework
binary) at least three manifest-resolution configurations: **App Store (TestFlight)**,
**App Review**, and **local-cache/development-override** (dev-signed direct installs).

Consequence: **a dev-signed repro proves nothing about TestFlight** and vice versa —
Cubby saw `AssetPackManagerError` on dev installs but `ProcessingPipelineError` on the
TestFlight path for the same pack. Test the channel you ship through.

## 3. ASC has a separate external-testing approval state

`xcrun altool --asset-pack-status` reporting `READY_FOR_TESTING` is **not** the whole
story: App Store Connect tracks a distinct Ready-for-Internal vs Ready-for-External
state, and external testing needs its own submit/approval flow. Check the ASC web UI
(TestFlight → Asset Packs) — the CLI status alone doesn't confirm external testers can
download.

## 4. The error enums are private — capture Console.app live

`ProcessingPipelineError`, `AssetPackManagerError` and friends are private Apple enums;
their code numbers are not recoverable from public docs. The decisive diagnostic that
worked:

- **Live Console.app**, System → Errors and Faults, unfiltered, watching at the exact
  failure moment (e.g. `STExtractionService.privileged` faults, `StreamingZip`
  extraction errors).
- `log collect --device` was repeatedly unreliable ("Device not configured",
  regardless of lock state) — don't burn time on it.
- Console's plain-text search bar does NOT accept typed boolean predicates — filter by
  eye or not at all.

## 5. When to stop fixing your app and file Apple Feedback

Escalation heuristic that saved the investigation: when (a) ≥2 well-reasoned app-side
fixes (clean pack rebuild, full app reinstall) fail with **byte-identical** failure
signatures, and (b) a cross-OS A/B test isolates the OS version (identical pack +
device model: iOS 26.6 failed every attempt, 26.5.2 succeeded cleanly) — conclude
platform bug. File Apple Feedback with the full evidence chain (error strings, A/B
matrix, Console captures) and/or a Developer Forums post; stop guessing app-side.

## 6. CLI quirk: the upload wait-flag never exits

`altool --upload-asset-pack`'s wait option can poll past terminal state without
exiting. Poll `--asset-pack-status` separately and kill the wait process once the
terminal state is confirmed.

## 7. ba-serve local dry-runs are not free

`xcrun ba-serve` (self-hosted local dry-run) requires its own build-variant setup —
materially more work than runbooks imply. Budget it as a real investigation task in
the host project before promising a "quick local test" of pack delivery.
