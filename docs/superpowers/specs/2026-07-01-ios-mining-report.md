# iOS Bug-Mining Report — claude-skills / ios-dev plugin

Mined from real fix-commits + convention docs across 7 apps (Paperix/doc-scan, cubby, floorprint, floorplan_scanner, sift, memekit, folix). 40 verified findings. Ranked by frequency × cross-app spread, grouped by theme.

## Theme 1 — MainActor-default runtime traps (highest impact; ships to TestFlight because sim-green ≠ safe)

The single most costly cluster. `SWIFT_DEFAULT_ACTOR_ISOLATION: MainActor` makes every unannotated service/model implicitly `@MainActor`. Three distinct *runtime* failure modes, none caught by compile or a simulator smoke build.

**1.1 Launch-watchdog SIGKILL (0x8BADF00D) + boot-loop** — apps: doc-scan, floorprint, cubby (frequency: many).
- Symptom: crash/freeze at launch when heavy work runs synchronously on main. doc-scan `fix(ai): run embedding backfill off the main actor…` names `0x8BADF00D`, the 10s scene-update watchdog, AND the boot-loop (index.upsert-after-loop non-idempotency re-triggered the block every launch). floorprint `build floor plan + quality report off the main actor`, `prewarm furniture templates off-main`. cubby `pre-load report photos off-main` (N disk reads + JPEG decodes on main in `renderer.pdfData`).
- Root cause: ML embed / floor-plan build / PDF+quality-report / photo preload silently on main, invoked from `App.init`/`.task`/`onAppear`, stalls first frame past ~10s watchdog → SIGKILL; unconditional retry of the failed work = unrecoverable boot loop.
- Fix: audit `App.init`/`.task`/`onAppear` for heavy sync work; offload to `nonisolated` in `Task.detached(.utility)`/`TaskGroup`, return `Sendable` DTOs/`PersistentIdentifier`s, hop to `@MainActor` once; make retried launch work idempotent (record progress *before* the loop, not after).

**1.2 UIColor/UIImage dynamic-provider off-main isolation trap (brk 1 on AsyncRenderer)** — apps: cubby (several).
- Symptom: intermittent `EXC_BREAKPOINT`/`brk 1`, thread `com.apple.SwiftUI.AsyncRenderer`, top frame the `Theme.Palette` dynamic-color closure, via `_swift_task_checkIsolatedSwift`→`dispatch_assert_queue`. Initially misblamed on SwiftData; the `.ips` exonerated it. Fixed b67f6b6.
- Root cause: a `UIColor { traits in … }` literal formed in `@MainActor` context inherits `@MainActor`, is cached by UIKit, later resolved OFF main → executor-isolation assertion. Compiles clean.
- Fix: make the provider `@Sendable`/nonisolated-clean, everything it calls `nonisolated`, store resolved provider as `nonisolated static let`, add a nonisolated seam for an off-main regression test. Generalize to ANY closure a UIKit/Obj-C API stores + later invokes (color/image providers, UIAction handlers, CADisplayLink/timer targets). Diagnosis reflex: `.ips` thread==AsyncRenderer + brk 1 + `_swift_task_checkIsolatedSwift` ⇒ isolation trap, NOT persistence.

**1.3 Re-entrancy across await suspension points** — apps: cubby, floorprint (several).
- Symptom: cubby `coalesce re-entrant photo-sync passes via PhotoSyncRunGuard`; floorprint `guard re-entrant viewDidAppear` (UIKit fired it twice → restarted capture session, reset elapsed clock, leaked a second timer), `lock overlay actions while a room is processing` (tap misrouted the next `didEndWith`/resurrected a stopped session).
- Root cause: `@MainActor` serializes threads but NOT logical passes across `await`; a second entry begins before the first Task finishes at its suspension point.
- Fix: explicit run/coalescing guard (`PhotoSyncRunGuard`), `isProcessing` flag that no-ops UI actions, idempotent lifecycle guards (invalidate existing timer before starting). Distinct from the exactly-once continuation idiom already in cubby's playbook.

**1.4 Heavy scan/Vision/embedding off-main as its own AGENTS.md bullet** — doc-scan, floorprint, cubby (several). The 1.1 mechanism restated at the scan/ML layer; `EmbeddingBackfillService.swift` carries the verbatim `0x8BADF00D` comment. Genuinely distinct from the Codable-isolation micro-skill.

## Theme 2 — SwiftData + CloudKit correctness (cubby-concentrated, high severity, silent data risk)

**2.1 In-memory/local-only stores must pass `cloudKitDatabase: .none`** (cubby): default `.automatic` silently begins syncing the moment the iCloud entitlement exists — escalating local-only/preview/test stores to CloudKit and defeating opt-in privacy; `.automatic` + `isStoredInMemoryOnly` is invalid. Also: `try!`/`fatalError` on a CloudKit container build bricks launch when iCloud is signed-out/unprovisioned. Fix: one throwing factory mapping a `Sendable`+`Equatable` `CloudSyncMode` enum to `.none` vs `.private(id)`; composition-root catches failure → local-only fallback + OSLog + Settings warning; relaunch prompt (backing is fixed at launch).

**2.2 @Model rules for a valid CloudKit mirror** (cubby): every stored property optional/defaulted; `@Relationship(inverse:)` on exactly one side (both sides crash the container at init); avoid NSManagedObject-reserved names (`isTrashed`, never `isDeleted`). None are compile errors — runtime container-init crash or silent non-sync.

**2.3 externalStorage sidecar↔CKAsset bridge** (cubby): `@Attribute(.externalStorage)` carries as CKAsset; bidirectional idempotent reconcile gated on sync-ON; batch save + `Task.yield()` every N so blobs flush per-batch (else the first pass holds the whole library resident); coalesce re-entrant passes.

**2.4 Centralize the schema in one `nonisolated` type** (cubby): production container, in-memory tests, AND a coexisting `NSPersistentCloudKitContainer` over the same store must agree exactly or corrupt data; build `Schema` on demand, resolve from `CubbyModelSchema` never inline.

## Theme 3 — On-device AI / OCR grounding (doc-scan + cubby, non-obvious, expensive to rediscover)

**3.1 Ground AI on Vision-layout text, never `PDFDocument.string`** (doc-scan, cubby): linear-reading-order extraction collapses multi-column labels (`Patient ID: 110331` next to `Patient Name:` → value vanishes → model confabulates). Bug hides on fresh scans (in-memory cache), appears only on the cold path (kill+relaunch). Fix: pure `nonisolated VisionLayoutFormatter` (Y-band rows, X-gap column split, `\n`/`\t`/`\n\n`), route all AI text through one `DocumentTextLoader.aiInputText` with a versioned `.aitext.v2.txt` sidecar + `searchableText` fallback. Verify on the cold path.

**3.2 Flat @Generable + clip to context window** (doc-scan, many commits): nested `@Generable` HANGS generation on iOS 26; unstructured prompting yields `[Insert X Here]`/hallucination; clip grounding text to ~4000 chars (multi-script tokenizes 2–3× heavier).

**3.3 Scan auto-naming discipline** (cubby, doc-scan): background OCR prose became an item name ("Complete the form below and"). Fix: one creation entry point (no caller-supplied name), `minNameConfidence` floor, `isSentenceLike` reject-list, OCR-name confidence cap 0.69 so OCR text never renders green.

**3.4 Soft sharpness gate** (cubby; doc-scan lacked it): variance-of-Laplacian as a SOFT signal (`.deliver`/`.warnAllowOverride`/`.autoAccept`), threshold 50 not 80, auto-accept after a retry budget so low-texture subjects don't strand the user.

## Theme 4 — Crash/interruption recovery for long captures (floorprint + cubby)

**4.1 Persist processed result BEFORE the hang-prone build step**: `ScanRecoveryStore.save` writes `CapturedRoom` JSON immediately after `RoomBuilder` succeeds and before the FloorPlanData/scene build; harden against unreadable/partial files, clear on decode-mismatch (`CapturedStructure` vs `CapturedRoom`) so there's no restart loop; time-box with graceful fallback; freeze elapsed clock across interruption; pair with an async-signal-safe crash marker (`CrashSentinel`) written before ModelContainer init.

## Theme 5 — App-Group / extension architecture (doc-scan + folix, architectural + reusable)

**5.1 Widget-over-App-Group snapshot bridge** (doc-scan, folix): a widget process can only reach the app via the shared App Group container + `reloadAllTimelines`. Full architecture (one Codable DTO compiled by both targets, atomic write with `.completeFileProtectionUnlessOpen`, pure-read widget side, relative-path IDs never absolute URLs, backfill-on-launch, optional container for Personal-Team) re-derived per app. Two invariants: (A) never clobber last-known-good — defer the write during the transient-empty launch pass, gate on a deterministic post-settle condition (`if documents.isEmpty && snapshotHasEntries() { return }`); (B) App-Lock redaction at BOTH write and read (mirror flag into the suite; widget re-checks regardless of disk) — belt AND suspenders against a stale pre-redaction snapshot.

**5.2 File-system handoff inbox needs attempt-cap + quarantine** (doc-scan): a poison batch (24MP EXIF-rotated image → ~880MB bitmap → jetsam) boot-looped the app because the drain crashed before clearing the batch, and widget timeline launches re-triggered it. Fix: persist a per-batch attempt counter BEFORE heavy work (a crash still burns an attempt), quarantine to `ShareInboxFailed/` after `maxDrainAttempts`=3; MainActor re-entrancy guard (`onAppear` + `scenePhase .active` both fire on cold launch); `manifest.json` ready marker; `UIGraphicsImageRendererFormat.scale = 1`; injectable root for CI.

**5.3 One pure deep-link resolver folding in App-Lock (drop, not defer) + path-traversal** (doc-scan, cubby): all entry points converge on `onOpenURL`; inline routing can present above the lock overlay, isn't testable, and is a path-traversal sink. Fix: `nonisolated` resolver returns an enum action, `.ignore` when locked (dropped not deferred), reject `..` before normalization + descendant check (resolve symlinks both sides, trailing slash) + known-doc whitelist; relative-path payloads only.

## Theme 6 — Release / CI / packaging gaps (the biggest plan-relevant cluster)

**6.1 No concurrency/runtime-trap guard in release pre-flight** (doc-scan, cubby, floorprint): Stage 1 checks only tree/branch/xcodegen/signing/fonts; build gates are sim-build (Stage 5) + archive (Stage 6). Neither catches 1.1 or 1.2, which shipped to TestFlight. `grep concurrency|mainactor|brk|watchdog|isolat|cold.launch` over the release skill returned nothing.

**6.2 No scanning-app permission/compliance pre-flight** (doc-scan, floorprint): camera/NFC/speech usage strings (in the GENERATED plist — XcodeGen wipes hand-edits), `ITSAppUsesNonExemptEncryption` (doc-scan landed it twice: e047a46, 9df8967), over-restrictive `UIRequiredDeviceCapabilities` (floorprint removed `lidar-depth-camera`). All surface at submission, after gates pass.

**6.3 No App-Group / extension-entitlement parity pre-flight** (doc-scan, folix): a target compiling the inbox/bridge helper but missing the entitlement fails SILENTLY (`containerURL(...)` returns nil) — surfaces only at altool validate (Stage 8). Paperix ships 5 targets; `PaperixExtractText` correctly omits the group. Invariant: "references the group id/ShareExtensionInbox/WidgetBridge ⇒ has it, else not." Paperix AGENTS.md is stale ("four targets") vs 5 real — the exact drift a pre-flight catches.

**6.4 Stage 11 site deploy is appstore-only + Paperix-hardcoded** (doc-scan, floorprint): font check hardcodes "Expected: 7"; site publishes only on appstore milestones (copy fixes never ship); zero og/favicon/CSP/deploy-key verification before force-pushing to a public repo.

**6.5 Release-notes pipeline is copy-ported and absent from the plugin** (doc-scan, floorprint, cubby): three-script pipeline (collect→LLM polish→deterministic fallback→finalize) ported Paperix→floorplan_scanner→floorprint; cubby never got it (hand-maintained `Changelog.entries`). Plugin release SKILL.md has zero notes automation (manual "edit the markdown, then paste into the web UI"). Two embedded fragilities: prompt/collector bucketing drift (89b6738), loader must nil-on-corrupt + finalize dedups-by-version then caps.

**6.6 A version bump that skips `finalize` ships with no What's New entry** (floorprint 9ac7b3a, dated today): the gate keys off bundled `WhatsNew.json` `currentVersion`, never `MARKETING_VERSION`; 2.2.0 shipped with notes topping out at 2.1. Fix: always finalize on bump + pre-flight assert `WhatsNew.json.currentVersion == MARKETING_VERSION` and `entries.first.buildNumber == CURRENT_PROJECT_VERSION`.

**6.7 Signing team resolution ladder** (doc-scan, floorprint, cubby): identical 5-step ladder duplicated in three build.sh (env → `.dev-team` → matching profile → wildcard `<TEAM>.*` → first cert). `ios-build` note 2 covers only "profile not keychain," omits wildcard acceptance + full precedence.

**6.8 Device-slice install** (cubby 8dcd2bb): `find|head-1` across mixed `Build/Products` can hand the `-iphonesimulator` slice to `devicectl` → `0xe8008014` (looks like a signing error). Fix: filter `-path '*-iphoneos/<App>.app'`. Latent in the other apps' shared build.sh.

**6.9 Xcode Cloud + XcodeGen pre-build contract** (doc-scan, floorprint, floorplan_scanner): the `.xcodeproj` is gitignored, so `ci_scripts/ci_post_clone.sh` (fixed Apple contract path, executable, `set -euo pipefail`, brew/stdlib only) must regenerate it — brew xcodegen → build-info → xcodegen generate — and every new local generation step must be mirrored in the SAME change or "CI breaks while local stays green." SPM case (floorprint 296b2b0): commit root `Package.resolved`, copy into the generated `swiftpm` dir (Xcode Cloud disables auto-resolution).

**6.10 CI Xcode/sim auto-discovery** (doc-scan): never pin Xcode version or device name in a GitHub Actions workflow — runner images rotate. Caveat: house pattern, not universal (folix uses `setup-xcode@v1`).

## Theme 7 — Site / marketing (doc-scan, floorprint, sift)

**7.1 Unfurl requires ABSOLUTE og:image + matching og:image:width/height on every page** (doc-scan, floorprint, sift): relative paths don't resolve; mismatched dimensions → small/no card. Correction to prior belief: NOT fixed at 1200×630 — floorprint ships 2400×1260; the invariant is "declared dims == on-disk pixels."

**7.2 Self-host fonts + strict CSP; progressive-enhancement JS must leave content visible** (floorprint, doc-scan): `font-src 'self'`/`script-src 'none'` breaks CDN fonts/GSAP; content that starts `opacity:0` renders blank when the CDN is blocked.

**7.3 Split-repo Pages deploy re-invented per app** (doc-scan, floorprint, floorplan_scanner, cubby): identical `deploy-site.sh` (subtree-split + force-push, `SITE_REMOTE`/`.site-remote`, uncommitted-guard, userinfo redaction) ported ≥twice. floorprint adds a hardened `deploy-site.yml`: SSH deploy key (least-privilege, NOT a PAT), host keys pinned from `api.github.com/meta`, loud-fail on missing secret.

**7.4 One idempotent icon/og/favicon generator from a master** (doc-scan, sift): `refresh-site-assets.sh` sips-downscales + regenerates og; sift added a "complete favicon set" commit after shipping without one.

**7.5 marketing/*.md canonical but site HTML / in-app catalog / ASC fields drift** (doc-scan, floorprint): 3+ parallel homes, no sync mechanism.

## What this implies for the plan (WS0–WS5)

- **WS1 (release: Fastlane + Xcode Cloud) is the highest-leverage workstream** and should absorb the most findings. The current `/release` is raw xcodebuild+altool and Paperix-shaped; rebuild it around: (a) a **runtime-trap pre-flight** (6.1) — sim-green explicitly does not clear MainActor traps, plus a device cold-launch smoke reminder; (b) **permission/compliance/capability asserts** on the GENERATED plist (6.2, 6.7-encryption); (c) **App-Group entitlement-parity** grep-and-assert (6.3); (d) **release-notes stage** wired to the extracted scripts + `WhatsNew.json == MARKETING_VERSION` assert (6.5, 6.6); (e) decouple **site deploy** from appstore-only and read font count from app.yml (6.4); (f) canonicalize the **signing ladder incl. wildcard** and **device-slice install** into ios-build (6.7, 6.8). Fastlane lanes replace the manual paste-into-ASC steps that 6.5 documents.
- **WS0 (app.yml v2)** must expose everything the release pre-flights read so nothing stays Paperix-hardcoded: font list, App-Group id, extension-target list, encryption flag, bundled-json path, marketing-copy homes. Findings 6.2/6.3/6.4/6.5 all currently hardcode Paperix's layout — app.yml v2 is what removes that.
- **WS4 (CI: local + Xcode Cloud)** owns the `ci_post_clone.sh` contract (6.9) and the "mirror every generation step in the same change" rule; add the SPM `Package.resolved`-copy sub-step and the runtime Xcode/sim discovery (6.10) as the house pattern (not forced on SPM-managed apps).
- **WS3 (site)** should ship the whole site kit as a template: `deploy-site.sh` + hardened `deploy-site.yml` (7.3), self-hosted fonts + strict CSP + visible-by-default JS (7.2), og/favicon generator + completeness lint (7.1, 7.4), and a marketing-copy-sync verifier (7.5).
- **WS2 (scaffold)** seeds a new app with: the App-Group + WidgetBridge architecture (5.1), share-inbox backstop (5.2), deep-link resolver (5.3), CloudSyncConfiguration factory + schema centralizer + @Model rules (2.1/2.2/2.4), ScanConstants + BlurGate + recovery store where the app is a scanner (3.3/3.4/4.1), and the AGENTS.md learnings library (below).
- **WS5 (learnings + contribution)** is the antidote to the pervasive "each app re-derives it" pattern (release-note trailers absent in cubby; version-bump rule re-documented 3×; deploy-site ported 4×). Ship a shared AGENTS.md learnings block the scaffold seeds so the NEXT app inherits these, plus a contribution path back.