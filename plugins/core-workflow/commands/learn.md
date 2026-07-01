---
description: Capture a lesson from this session into claude-skills as a new or extended skill (dedupes first, then opens a PR).
argument-hint: [topic hint, e.g. "the AsyncRenderer crash we just fixed"]
---

Invoke the `learn-lesson` skill with `$ARGUMENTS` as the topic hint (empty is
fine — the skill distills the lesson from the session itself).

Follow the skill's flow exactly: distill → dedupe against
`plugins/*/skills/*/SKILL.md` → extend-or-create → hand off to the
`contribute` skill for the branch + PR. Report back the dedupe verdict
(extended which skill, or created which new one) and the PR URL.
