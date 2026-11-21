---
name: learn-lesson
description: Capture a lesson from the current session (a bug fixed, a trap discovered, a pattern that worked) into the claude-skills catalog as a new or extended skill, so every other repo inherits it via plugin update. Use when the user says "remember this lesson", "capture this learning", "this should be a skill", "contribute this lesson", or invokes /learn. Dedupes against existing skills before creating; hands off to the contribute skill for the PR.
---

# Learn: capture a session lesson into the skills catalog

Turns "we just debugged something painful" into a versioned skill in
claude-skills, instead of a note in one repo's AGENTS.md that no other app
ever sees.

## Flow

1. **Distill.** From the current session, extract:
   - **Symptom** — verbatim error strings, crash signatures, or observable misbehavior.
   - **Root cause** — the actual mechanism, not the first suspicion.
   - **Fix** — what worked, as concrete code/config, plus what did NOT work if instructive.
   - **Evidence** — files touched, commit SHAs, apps affected.
   If the session has no concrete fixed bug or validated pattern, ask the user
   what the lesson is before proceeding.

2. **Dedupe (mandatory before creating anything).** Search the catalog:
   ```bash
   grep -ril "<key symptom terms>" "${CLAUDE_SKILLS_HOME:-$HOME/projects/claude-skills}"/plugins/*/skills/*/SKILL.md
   ```
   Read the description of every hit. Decision rule:
   - **Same root cause** as an existing skill → EXTEND it: add a symptom
     variant to its description and/or a `references/<case>.md` with the new
     evidence. Never fork a near-duplicate.
   - **New root cause** → NEW skill.

3. **Draft.** For a new skill, write `SKILL.md` with this shape:
   ```markdown
   ---
   name: <kebab-case, symptom-oriented; carry the literal error string or API token — on heavy installs the name is the primary trigger, because skills are listed by name only and the description is elided>
   description: <one physical line — symptom first (what the user SEES, e.g. error text, crash thread, wrong behavior), then "use when …". The secondary trigger; it still decides routing where descriptions are shown.>
   ---

   # <Title>

   ## Symptom
   ## Root cause
   ## Fix
   ## Evidence
   ## Related skills
   ```
   Keep SKILL.md ≤ ~150 lines; push long code idioms into `references/*.md`.
   Link related skills by name. iOS lessons default to the `ios-dev` plugin;
   ask which plugin when it's not obvious.

4. **Hand off.** Use the `contribute` skill's script, in this order:
   - **New skill:** on a clean claude-skills tree (the script refuses a dirty
     tree and an existing skill dir), run
     `claude-skills-contribute --skill <name> --plugin <plugin> --message "learn: <one-liner>" --no-pr`
     FIRST. It branches and scaffolds a placeholder `SKILL.md`, then runs
     bats and pytest BEFORE committing. A freshly scaffolded skill fails
     `tests/pytest/test_sweep_counts.py::test_live_tree_counts_in_sync` and
     the catalog-row invariant (counts stale, no catalog row), so expect the
     script to stop with "pytest failing — leaving branch contrib/…" and the
     scaffold UNCOMMITTED on that branch. That is the normal flow, not an
     error. Continue on that branch:
     1. Overwrite the scaffold with the drafted `SKILL.md` (and any
        `references/*.md`).
     2. Run `python3 scripts/sweep_counts.py --write`.
     3. Add the hand rows listed in the `contribute` skill's step 3 (it owns
        that list; do not copy it here).
     4. Run `bats tests/bats` and `pytest tests/pytest -q`.
     5. Commit, push, and `gh pr create`. The PR bumps the plugin once: one
        `plugin.json` version bump plus one CHANGELOG heading per PR that
        touches `plugins/<name>/**`, or `[skip-plugin-bump]` in a commit
        message for a change that ships nothing to users. CI's `plugin-version-guard` fails
        without it. AGENTS.md has the full rule.
     If the skill dir already exists, the script fails after switching to a
     new `contrib/…` branch; switch back and delete that branch.
   - **Extension to an existing skill:** do not use `--skill`, and do not use a
     bare `--message` (that is the manifest-capture path, not "commit my
     edit"). Start from an updated `main` in
     `${CLAUDE_SKILLS_HOME:-$HOME/projects/claude-skills}` on a clean tree,
     branch manually, edit, commit, push, `gh pr create`.
   Surface the PR URL.

5. **Host-repo pointer (optional).** Only if the user asks, add a one-line
   pointer in the host repo's AGENTS.md lessons section — the skill is the
   source of truth, the pointer is a courtesy.

## Hard rules

- Never skip step 2. A duplicated skill is worse than no skill — it splits
  future evidence between two homes.
- Symptom-first descriptions. "SwiftData best practices" never triggers;
  "crash at launch with brk 1 on AsyncRenderer" does.
- `description:` on one physical line — no `>-` or `|` block scalars, no
  wrapped continuation lines (the registry parser truncates them). Quote the
  value as a JSON string if it contains ": " or " #" (the strict frontmatter
  test rejects those in a plain value).
- Anonymise before you write. The catalog is public: name no private app,
  repo, person or customer in a skill, reference file or example. Write "a
  private iOS app" (or "a private web project") instead. Cubby is the only
  public exception, because the repo's AGENTS.md publishes it on purpose.
  Verbatim error strings stay; the project name around them goes.
- One lesson per skill. Two root causes = two skills.
- vs `ecc:learn`: this skill publishes to the shared catalog via PR;
  `ecc:learn` saves local patterns under `~/.claude/skills`.
- Do not auto-merge the PR; review stays with the user.
