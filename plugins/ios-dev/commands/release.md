---
description: Release this iOS app to TestFlight or the App Store — gated pre-flight, Fastlane build+upload, tag, site deploy.
argument-hint: testflight|appstore [--dry-run]
---

Run the `release` skill for this repo in the mode given by `$ARGUMENTS`
(ask which mode if empty; `--dry-run` stops after validate, before upload).

Drive the stages exactly as the skill defines them, and:

1. **Stop at every FAIL gate** in stage 1 and consult me — never bypass with
   `--force` on your own. Report WARN gates too (especially `runtime-trap`,
   which names the skill with the fix).
2. **Never** perform the stage-6 upload without my literal `upload`
   confirmation, and never push tags without my explicit yes.
3. If `.claude/app.yml` is missing or fails validation, run `/ios-init`
   (or `--migrate`) first.
4. At the end, summarize: version/build shipped, gates that warned, tag
   created, and the remaining ASC web-UI checklist items for appstore mode.
