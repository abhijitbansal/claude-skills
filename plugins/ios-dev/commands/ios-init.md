---
description: Scaffold .claude/app.yml for this iOS app — detects scheme/bundle-id/team from project.yml or xcodebuild, fills the rest with TODOs
argument-hint: [--force]
---

Set up the `ios-dev` plugin for this repo by generating `.claude/app.yml` — the per-app config every ios-dev skill (`/preview`, `/fix`, build, release) reads.

Run the scaffolder, then verify and finish the config with me:

1. **Detect + write.** Run:
   `bash "${CLAUDE_PLUGIN_ROOT}/skills/_lib/init_app_config.sh" $ARGUMENTS`
   (If `${CLAUDE_PLUGIN_ROOT}` is unset because this is a project-local copy rather than a plugin install, use `.claude/skills/_lib/init_app_config.sh` instead.)
   It auto-detects from an XcodeGen `project.yml` when present, otherwise from `xcodebuild -list`, and leaves anything it can't find as `TODO`. It will refuse to overwrite an existing `.claude/app.yml` unless `--force` was passed.

2. **Read the result.** Open the written `.claude/app.yml` and report the detected values back to me in a short table (name, bundle_id, scheme, team_id, url_scheme).

3. **Fill the gaps.** For every field still set to `TODO` (or an obviously wrong guess), ask me for the value — most commonly `team_id` (the 10-char Apple Developer Team ID) and `url_scheme` (the app's custom URL scheme, if it has deep links). If the repo uses Linear, also offer to set `linear.team_key`. Apply my answers by editing the file directly.

4. **Confirm.** Once no `TODO` remains in `app:`, tell me the plugin is ready and that I can now run `/preview` or `/fix`.

If the scaffolder reports it found no `project.yml` and no Xcode project, tell me — this repo may not be an iOS app, or I may need to run from a different directory.
