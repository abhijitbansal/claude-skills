---
name: background-assets-manifest-drift-blind-redownload
description: Publishing a multi-GB ML model / media pack / offline-data asset via Apple Background Assets stalls on a Manifest.json that doesn't match the docs (schema drifts by Xcode version), burns a redundant multi-GB re-download of a source model already sitting in a local cache, or silently corrupts an in-flight asset-pack version by mutating it instead of shipping a new pack id. Use when packaging or uploading a Background Assets asset pack (`xcrun ba-package`, `xcrun altool --upload-asset-pack`), writing its Manifest.json, or planning how a large downloadable asset (model weights, offline maps/dictionaries, media bundles) gets versioned and re-fetched.
---

# Background Assets: Manifest Drift, Blind Re-download, Mutable Versioning

## Symptom

- Manifest.json fields copied from a blog post or older docs don't match what
  `xcrun ba-package` actually expects for the installed Xcode version — the
  schema silently drifted between Xcode releases and there's no compile-time
  check to catch it.
- A large source model (or other multi-GB asset) gets re-downloaded from its
  origin (Hugging Face, S3, a vendor CDN) even though an identical copy from
  an earlier test/flash is already sitting in a local cache — the redundant
  fetch is only caught after the fact, by comparing hashes.
- A "new" asset-pack build reuses the same pack id/version as a prior upload,
  so distinct content is indistinguishable at the pack-id level — nothing
  enforces that a pack version is immutable once shipped.

## Root cause

Background Assets' `Manifest.json` schema is undocumented-feels: it isn't
stable across Xcode versions, so any copy-pasted or memorized schema is a
snapshot that can already be stale. There is no local step that checks a
downloadable source asset against on-disk caches by content before re-fetching
it — presence of *a* file isn't the same as presence of *this* file, so a
byte-identical snapshot from an earlier device test looks, to a naive
existence check, like "not cached." And asset-pack versions are just strings
to the tooling — nothing stops treating a version id as mutable and
re-uploading different content under the same id, which desyncs whatever
client code cached that id's hash/size.

## Fix

1. **Pull the Manifest.json schema live, don't guess it.** Run
   `xcrun ba-package template` to get the schema for the Xcode version
   actually installed, rather than copying from docs or a prior project.
2. **Package and upload through the existing ASC credentials — don't create
   new ones.** `xcrun ba-package` packages the asset pack;
   `xcrun altool --upload-asset-pack` uploads it and reuses the same App
   Store Connect API key already set up for fastlane
   (`~/.app-store-connect/`, `API_PRIVATE_KEYS_DIR`) — no separate credential
   path. Poll `--asset-pack-status` until `READY_FOR_TESTING` before treating
   the pack as available.
3. **Check the local cache by content hash before re-downloading a large
   source asset.** Before pulling a multi-GB model (or similar) from its
   origin, check the relevant local cache (e.g. `~/.cache/huggingface/hub/`
   for HF snapshots, or whatever package-manager-style cache applies) and
   verify via a content hash (sha256) — not mere presence — whether an
   already-downloaded snapshot (e.g. one already flashed to a test device) is
   byte-identical to what's about to be fetched. Do this check *before* the
   fetch, not as a post-hoc verification after burning the bandwidth and time.
4. **Treat every asset-pack version as immutable once uploaded.** A new
   model/asset generation ships as a new pack id (e.g. `<name>-v2`), paired
   with a corresponding constant bump in the client code that references it
   (e.g. `VLMConstants`) — never as a content mutation of an already-shipped
   version id. This keeps any client-side cached hash/size for that version
   id trustworthy.

## Evidence

From Cubby iOS session logs (session 0022, mined and adversarially verified):

> wrote Manifest.json... schema pulled live from `xcrun ba-package template`,
> not guessed... uploaded via `xcrun altool --upload-asset-pack` reusing the
> existing fastlane ASC API-key credentials... User caught that I'd
> re-downloaded the model from HF instead of reusing the exact snapshot
> already flashed to their phone... verified after the fact via sha256...
> identical hash... should have checked ~/.cache/huggingface/hub/... before
> re-downloading 1.2GB, not after.

> next model generation must ship as cubby-vlm-v2 (new pack id + VLMConstants
> bump), never a mutation of this version.

## Related skills

- `release` — reuses the same App Store Connect API key / fastlane
  credential setup (`~/.app-store-connect/`, `API_PRIVATE_KEYS_DIR`) that
  `xcrun altool --upload-asset-pack` piggybacks on.
- `widget-appgroup-snapshot-bridge` — another case of a shared/cached
  resource whose identity must be verified by content, not presence, before
  reuse.
