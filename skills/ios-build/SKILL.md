---
name: ios-build
description: Build ${APP_NAME} for a simulator or a connected iPhone via build.sh. Use when the user asks to build, compile, run, or install the iOS app — including phrasings like "build for sim", "build on my phone", "ship it to the device", or just "build". Encodes the project's signing/profile-detection rules so generated commands don't drift back to assumptions about Xcode paths or keychain certs.
---

# iOS Build

**Requires `.claude/app.yml`** in the app repo root with `app.scheme`, `app.bundle_id`, optionally `app.build_script` (default `build.sh`). The build wrapper sources `skills/_lib/load_app_config.sh`.

Run the project's `./build.sh` rather than constructing `xcodebuild` invocations from scratch — the script already handles xcodegen regeneration, device UDID detection, provisioning-profile-based team ID resolution, and devicectl install.

## Mode selection

| User intent | Command |
|---|---|
| Default / "build" / "build for sim" | `./build.sh` (iPhone 15 Pro Max) |
| Specific simulator | `./build.sh -s "iPhone 16 Pro"` |
| Real device (connected iPhone) | `./build.sh -d` |
| Inspect what would happen without building | `./build.sh -d --debug` |

## Hard rules — do NOT regress these

These are house rules earned through past debugging. Violating them will reintroduce specific bugs we've already fixed:

1. **Xcode 16+ provisioning profiles live at `~/Library/Developer/Xcode/UserData/Provisioning Profiles/`.** Older path `~/Library/MobileDevice/Provisioning Profiles/` may not exist on fresh installs. Always check both.

2. **Resolve team ID from a provisioning profile, not from the keychain.** `security find-identity` may return a stale cert from a prior Apple ID. Read `TeamIdentifier` from the profile whose `Entitlements.application-identifier` matches `<TEAM>.<bundle-id>`.

3. **`plutil -extract` keypaths are unquoted dotted names.** `'Entitlements.application-identifier'` works; `'Entitlements."application-identifier"'` silently fails with no value.

4. **`set -euo pipefail` + grep/awk/sed = silent script death.** Detection pipelines that legitimately may match nothing must end with `|| true`, or capture into a variable and check `[[ -z … ]]`.

5. **`project.yml` values are unquoted YAML.** Don't parse with `awk -F'"'`; use `awk '{print $2}'` or yq. (This skill assumes XcodeGen-style project.yml; adjust if your app uses an Xcode project directly.)

## When the user reports a device-build failure

Do not start patching xcodebuild flags. Instead, run the failing command with `tee` to a log file, then:

1. Check whether the failure is **profile-related** ("No profiles for X were found", "No Account for Team Y") — if so, the bootstrap from Xcode UI hasn't completed yet. Tell the user to plug in iPhone, enable Developer Mode, select device in Xcode toolbar, and press ⌘R once. Do not try to fix this from CLI.

2. Check whether it's a **detection bug in build.sh** — if the script picked the wrong team ID or didn't find the profile, fix the detection logic in `build.sh`, not the project file.

3. Check whether it's a **signing setup gap** (missing cert) — the `.dev-team` file is the gitignored escape hatch (legacy escape hatch; new apps drive team via `app.yml app.team_id` instead).

## When the user wants to rebuild after editing Swift files

`xcodebuild` is incremental by default — no need for clean builds. Only suggest `rm -rf build ~/Library/Developer/Xcode/DerivedData/${APP_NAME}-*` when the build genuinely produces stale results (e.g., after editing project.yml).

## Output expectations

- Simulator builds finish in 5–60s and end with `** BUILD SUCCEEDED **`.
- Device builds end with `App installed: • installationURL: …`. The "No provider was found" warning during install is benign for Personal Team.
- Surface any new shellcheck or compiler warnings to the user; don't silence them.
