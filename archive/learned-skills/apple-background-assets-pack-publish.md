# Publishing a large on-device model via Apple Background Assets: ba-package/altool workflow, snapshot reuse, and immutable versioning

**Extracted:** 2026-07-12
**Context:** Mined from Cubby iOS session logs (0022); adversarially verified.

## Problem
Shipping a multi-GB ML model as an Apple-hosted Background Assets asset pack (so it downloads from Apple's CDN post-install rather than bloating the binary or requiring a custom server) has an undocumented-feels workflow: the Manifest.json schema isn't obvious, the ASC numeric app id isn't recorded anywhere in a typical repo, and it's easy to blindly re-download the multi-GB source model instead of checking whether an identical local snapshot (e.g. already flashed to a test device) already exists on disk.

## Solution
Pull the Manifest.json schema live from `xcrun ba-package template` rather than guessing/copying from docs (schema drifts by Xcode version). Package with `xcrun ba-package`, upload with `xcrun altool --upload-asset-pack` — this reuses the same App Store Connect API key credentials already set up for fastlane (`~/.app-store-connect/`, `API_PRIVATE_KEYS_DIR`), no separate credential. Poll `--asset-pack-status` until READY_FOR_TESTING. Before re-downloading a large source model, check the local package-manager/HF-style cache (verify via a content hash like sha256, not just presence) — an existing local snapshot used for an earlier device test is very likely byte-identical to what you're about to re-fetch. Treat each asset-pack version as immutable once uploaded: a new model generation ships as a new pack id (e.g. `<name>-v2`), never a mutation of an existing version's contents.

## Evidence
Session 0022: 'wrote Manifest.json... schema pulled live from `xcrun ba-package template`, not guessed... uploaded via `xcrun altool --upload-asset-pack` reusing the existing fastlane ASC API-key credentials... User caught that I'd re-downloaded the model from HF instead of reusing the exact snapshot already flashed to their phone... verified after the fact via sha256... identical hash... should have checked ~/.cache/huggingface/hub/... before re-downloading 1.2GB, not after.' and 'next model generation must ship as cubby-vlm-v2 (new pack id + VLMConstants bump), never a mutation of this version.'

## When to Use
Any iOS/macOS app shipping large downloadable assets (ML model weights, media packs, offline map/dictionary data) via Apple's Background Assets framework hits the same three friction points — schema discovery, credential reuse, and avoiding redundant multi-GB re-downloads — regardless of what the asset actually is.
