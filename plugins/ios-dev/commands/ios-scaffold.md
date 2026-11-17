---
description: Standardize this iOS app repo — marketing home, Fastlane, ci_post_clone, release hooks, architecture checklist (idempotent, drift-reporting).
argument-hint: "[--check]"
---

Run the `ios-scaffold` skill with `$ARGUMENTS`:

1. If `.claude/app.yml` is missing, run `/ios-init` first (interview me for
   the gaps), then come back.
2. Run `bash "${CLAUDE_PLUGIN_ROOT}/skills/ios-scaffold/scripts/scaffold.sh" $ARGUMENTS`
   (only `--check` is accepted; anything else exits 2 and writes nothing) and
   show me the CREATE/OK/DRIFT/SKIP report. `--check` fails only for a missing
   managed file; DRIFT does not fail it.
3. For every `DRIFT:` line, show me the diff between the rendered template and
   the file, and ask: adopt template, keep as-is, or merge manually. Apply my
   choice per file — never bulk-overwrite.
4. For every `CREATE:` line with TODO fields (marketing listing), offer to fill
   them with me now. If `.claude/settings.json` printed `SKIP`, add the
   `guard-generated.sh` PreToolUse hook entry to it with me (see the skill's
   managed-set table).
5. Finish by listing what was created and any DRIFTs consciously kept.
