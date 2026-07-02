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
   name: <kebab-case, symptom-oriented>
   description: <symptom first — what the user SEES (error text, crash thread,
     wrong behavior) — then "use when …". This is the trigger surface.>
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

4. **Hand off.** Invoke the `contribute` skill to branch/commit/PR:
   `claude-skills-contribute --skill <name> --plugin <plugin> --message "learn: <one-liner>"`
   for a new skill, or plain `--message` after editing an existing one.
   Surface the PR URL.

5. **Host-repo pointer (optional).** Only if the user asks, add a one-line
   pointer in the host repo's AGENTS.md lessons section — the skill is the
   source of truth, the pointer is a courtesy.

## Hard rules

- Never skip step 2. A duplicated skill is worse than no skill — it splits
  future evidence between two homes.
- Symptom-first descriptions. "SwiftData best practices" never triggers;
  "crash at launch with brk 1 on AsyncRenderer" does.
- One lesson per skill. Two root causes = two skills.
- Do not auto-merge the PR; review stays with the user.
