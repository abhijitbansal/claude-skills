#!/usr/bin/env bash
# Xcode Cloud post-clone: materialize the gitignored .xcodeproj.
# Contract (see skill xcode-cloud-post-clone-contract):
#   1. every local generation step is mirrored here, in the same order
#   2. the committed Package.resolved is copied into the generated project so
#      Xcode Cloud resolves pinned SPM versions (it disables auto-resolution)
#   3. brew + stdlib only — this runs before any credential setup
set -euo pipefail

cd "$CI_PRIMARY_REPOSITORY_PATH"

brew install xcodegen

# >>> mirror local generation steps here (build-info, asset gen), THEN:
xcodegen generate

if [[ -f Package.resolved ]]; then
  RESOLVED_DST="{{APP_NAME}}.xcodeproj/project.xcworkspace/xcshareddata/swiftpm"
  mkdir -p "$RESOLVED_DST"
  cp Package.resolved "$RESOLVED_DST/Package.resolved"
fi
