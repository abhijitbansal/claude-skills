---
description: Scaffold .claude/app.yml (schema v2) for this iOS app — detects scheme/bundle-id/team/extensions from project.yml or xcodebuild, fills the rest with TODOs; --migrate upgrades a v1 file in place
argument-hint: [--force | --migrate]
---

Set up the `ios-dev` plugin for this repo by generating `.claude/app.yml` — the per-app config every ios-dev skill (`/preview`, `/fix`, build, release) reads.

Run the scaffolder, then verify and finish the config with me:

1. **Detect + write.** Run:
   `bash "${CLAUDE_PLUGIN_ROOT}/skills/_lib/init_app_config.sh" $ARGUMENTS`
   (If `${CLAUDE_PLUGIN_ROOT}` is unset because this is a project-local copy rather than a plugin install, use `.claude/skills/_lib/init_app_config.sh` instead.)
   It auto-detects from an XcodeGen `project.yml` when present (name, bundle id, team, extension targets, deployment target), otherwise from `xcodebuild -list`, and leaves anything it can't find as `TODO`. It refuses to overwrite an existing `.claude/app.yml` unless `--force` was passed. With `--migrate` it upgrades an existing v1 file to schema v2 in place, preserving every existing value and appending only the missing sections.

2. **Read the result.** Open the written `.claude/app.yml` and report the detected values back to me in a short table (name, bundle_id, scheme, team_id, url_scheme, extensions, min_os).

3. **Fill the gaps.** For every field still set to `TODO` (or an obviously wrong guess), ask me for the value — most commonly `team_id` (the 10-char Apple Developer Team ID) and `url_scheme` (the app's custom URL scheme, if it has deep links). Then walk the v2 sections worth configuring now:
   - `targets.app_group` — if the app has widget/share extensions (detected extensions imply one), the App Group id, usually `group.<bundle_id>`.
   - `release.usage_strings` — scan the repo's Info.plist/project.yml for `*UsageDescription` keys and propose the list.
   - `release.encryption_exempt` — confirm true unless the app uses non-exempt encryption.
   - `release.whatsnew_file` — path to the App Store Connect release-notes file (e.g. a what's-new JSON), if the app has one.
   - `release.inapp_changelog_file` — path to the in-app changelog/feature-catalog data file (e.g. a Swift `ChangelogEntry` list), if the app has an in-app What's New screen. This is a separate surface from `whatsnew_file` — see skill `release-inapp-vs-asc-whatsnew-surfaces`. Optional; leave blank if the app has no in-app changelog.
   - `release.asc_app_id` — the numeric App Store Connect app id, if the app is already registered.
   - `site.repo` / `site.domain` — if a marketing site exists or is planned.
   - If the repo uses Linear, also offer `linear.team_key`.
   Apply my answers by editing the file directly.

4. **Validate + confirm.** Run `bash "${CLAUDE_PLUGIN_ROOT}/skills/_lib/validate_app_config.sh"` and report the result. Once it prints `ok:` with no ERROR lines, tell me the plugin is ready and that I can now run `/preview`, `/fix`, or `/release`.

If the scaffolder reports it found no `project.yml` and no Xcode project, tell me — this repo may not be an iOS app, or I may need to run from a different directory.
