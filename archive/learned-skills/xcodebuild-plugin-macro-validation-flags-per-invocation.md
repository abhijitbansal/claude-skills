# fastlane gym/archive lanes need their own -skipPackagePluginValidation/-skipMacroValidation flags, separate from any wrapper script

**Extracted:** 2026-07-12
**Context:** Mined from Cubby iOS session logs (0022); adversarially verified.

## Problem
An SPM dependency with a build-tool plugin and/or macros (e.g. an MLX package) makes headless xcodebuild fail with 'Plugin ... must be enabled' / 'must be enabled to be used' and run 0 tests/build steps, unless -skipPackagePluginValidation -skipMacroValidation are passed. The project's own build wrapper (build.sh) already passed these flags for local/CI builds, but the separate fastlane archive lane (gym) invoked xcodebuild independently with its own xcargs (provisioning + auth key) and had never been updated — so `fastlane archive` died on the plugin-trust prompt even though every other build path worked, and this wasn't caught until the release pipeline's archive step.

## Solution
Any place that shells out to xcodebuild independently (build script, fastlane gym xcargs, CI post-clone script, IDE scheme) needs -skipPackagePluginValidation -skipMacroValidation added individually — fixing one invocation doesn't fix the others. Do NOT reach for the machine-wide fix (`defaults write com.apple.dt.Xcode IDESkipPackagePluginFingerprintValidatation` / `IDESkipMacroFingerprintValidation`) — it silently disables plugin/macro fingerprint validation (a real supply-chain control) for every project on the machine, forever. Grep every xcodebuild/gym invocation site in the repo when adding a package with a build-tool plugin, and add the flags per-invocation.

## Evidence
Session 0022: 'First `bundle exec fastlane archive` died at "Validate plug-in 'CudaBuild' in package 'mlx-swift'" — gym's xcargs had -allowProvisioningUpdates + auth key but not -skipPackagePluginValidation -skipMacroValidation, the same headless-MLX trap build.sh already handles. The archive lane predates the MLX exception. Fixed by appending both flags to the gym xcargs (commit 6c2adde)... the machine-wide defaults write IDESkip…Validation path is security-reverted per AGENTS.md.'

## When to Use
Any Swift project that adopts an SPM package shipping a build-tool plugin or Swift macro (increasingly common: SwiftGen-style codegen, ORM macros, MLX/ML kernels) will hit this the moment it adds a second headless-build entry point (fastlane, CI, a second script) — the fix is per-invocation flags, not something that propagates from one script to another.
