# In-App What's New Pop-up + About Build-Info Reference Skill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one `ios-dev` reference/pattern skill that codifies the in-app "What's New" launch pop-up and the Settings/About build-info screen, so new app repos build both from the SKILL.md alone.

**Architecture:** A single new `SKILL.md` (documentation with paste-ready Swift/shell lifted verbatim from Paperix + Cubby's invariant tests), plus the repo's cross-file bookkeeping (plugin.json version bump, skill-count sweep, bidirectional cross-link with the sibling skill). No code generation, no `app.yml` changes, no release-gate wiring.

**Tech Stack:** Markdown (SKILL.md), JSON (plugin.json), HTML/Markdown catalog + site pages. Validation via `pytest tests/pytest` (registry parser) and `bats tests/bats`.

## Global Constraints

- Skill dir: `plugins/ios-dev/skills/inapp-whatsnew-popup-and-about-buildinfo/SKILL.md`.
- Frontmatter `description` MUST be a **single physical line** — the registry parser (`plugins/prompt-craft/scripts/registry_lib.py`) truncates folded scalars (`>-`) to `">-"`. Verbatim single-line description in the spec.
- `plugins/ios-dev/.claude-plugin/plugin.json` `version` `2.3.0` → `2.4.0` (CI requires a plugin version bump for a changed plugin — repo commit `2bd837a`).
- True `ios-dev` skill count is **50** (51 dirs minus non-skill `_lib/`); target after add = **51**. Count strings: `docs/architecture.md:18`, `docs/architecture.html:98`, `docs/features/ios-dev.html:39`, `site/index.html:117`. Any global cross-plugin total (if present in `docs/catalog.html`/`site/`) bumps by 1 too — grep and reconcile.
- Per-skill listing additions: `docs/skills-catalog.md` (table), `docs/catalog.html` (`.crow` card), `docs/features/ios-dev.html` (`.inv .row`).
- Sibling skill: `release-inapp-vs-asc-whatsnew-surfaces` — add a "Related" pointer both directions.
- Canonical code is lifted from session-verified sources: Paperix `WhatsNewGate.swift`, `WhatsNew.swift`, `WhatsNewSheet.swift`, `AboutView.swift` (buildSection), `scripts/generate-build-info.sh`; Cubby `CubbyTests/ChangelogTests.swift`. De-theme Paperix `Theme`/`t.*`/`SectionKicker`/`DashedRule` tokens to plain SwiftUI so blocks compile in a fresh project.
- Surgical changes only; atomic scripted count sweep, never hand-edit each site (AGENTS.md cross-file-invariant rule).

---

### Task 1: Author the SKILL.md

**Files:**
- Create: `plugins/ios-dev/skills/inapp-whatsnew-popup-and-about-buildinfo/SKILL.md`

**Interfaces:**
- Produces: a skill named `inapp-whatsnew-popup-and-about-buildinfo` discoverable by the registry parser; referenced by Task 2's cross-links and catalog entries.

**Section structure (per the approved spec):**
1. Frontmatter (`name` + single-line `description` — verbatim from spec).
2. Title + "When to use" (symptom/trigger-first, sibling style).
3. "Two surfaces, one skill" — Pattern A (pop-up) vs Pattern B (build-info); one-line pointer to sibling for release-time gating.
4. Data-source decision table (external `WhatsNew.json` vs hardcoded Swift `[ChangelogEntry]`).
5. Pattern A — paste-ready, de-themed: `WhatsNew.json` schema; `WhatsNew`/`WhatsNewEntry` Codable + nil-safe `bundled` loader; `WhatsNewGateDecider` (the spec's verbatim block); `WhatsNewGateModifier` + `.whatsNewGate()`; minimal `WhatsNewSheet`; gate unit tests.
6. Pattern B — paste-ready: `generate-build-info.sh` (idempotent, atomic, gitignored output, non-repo fallback) as a build phase; `BuildInfo` enum; About "Build" card rows + version/build from `CFBundleShortVersionString`/`CFBundleVersion`.
7. Invariant tests to copy (Cubby `ChangelogTests`).
8. Gotchas/rationale: `seed`-on-fresh-install, downgrade-no-clobber, marketing-version-only gate, gitignore the non-deterministic `BuildInfo.swift`, single root arm site.
9. Canonical references (Paperix + Cubby files).
10. Related: `release-inapp-vs-asc-whatsnew-surfaces`, `ios-dev:release`.

- [ ] **Step 1: Write the SKILL.md** with all ten sections, assembling the de-themed code from the session-verified sources and the spec's canonical `WhatsNewGateDecider` block. Description on one physical line.

- [ ] **Step 2: Verify the registry parser accepts it**

Run: `cd ~/projects/claude-skills && python3 -m pytest tests/pytest/test_registry_lib.py tests/pytest/test_build_registry.py -q`
Expected: PASS (no folded-scalar/`">-"` description regression).

- [ ] **Step 3: Confirm the description is one physical line**

Run: `awk '/^description:/{c++} END{print c}' plugins/ios-dev/skills/inapp-whatsnew-popup-and-about-buildinfo/SKILL.md` and visually confirm the description key holds no embedded newline.
Expected: exactly one `description:` line; no `>-`/`|` block scalar.

- [ ] **Step 4: Commit**

```bash
git add plugins/ios-dev/skills/inapp-whatsnew-popup-and-about-buildinfo/SKILL.md
git commit -m "feat(ios-dev): add inapp-whatsnew-popup-and-about-buildinfo reference skill"
```

---

### Task 2: Register the skill (version bump + count sweep + cross-links)

**Files:**
- Modify: `plugins/ios-dev/.claude-plugin/plugin.json` (version `2.3.0` → `2.4.0`)
- Modify: `docs/architecture.md:18`, `docs/architecture.html:98`, `docs/features/ios-dev.html:39`, `site/index.html:117` (count `50` → `51`)
- Modify: `docs/skills-catalog.md` (new table row after the sibling)
- Modify: `docs/catalog.html` (new `.crow` card near the sibling; bump any global total)
- Modify: `docs/features/ios-dev.html` (new `.inv .row` in the Skills block)
- Modify: `plugins/ios-dev/skills/release-inapp-vs-asc-whatsnew-surfaces/SKILL.md` (Related pointer to the new skill)

**Interfaces:**
- Consumes: the skill name from Task 1.
- Produces: consistent skill count across all docs/site; discoverable catalog entries; bidirectional cross-link.

- [ ] **Step 1: Bump plugin.json version** `2.3.0` → `2.4.0`.

- [ ] **Step 2: Grep every count + global total, then sweep to 51**

Run: `grep -rn "50 skills\|ios-dev — 50\|50 · \|>50<\|skills · 6 cmds" docs/ site/` — capture the full set (including any all-plugins total), then update each hit that refers to ios-dev's skill count to `51`. Verify no `50` referring to ios-dev remains.

- [ ] **Step 3: Add the per-skill listing entries** — one row in `docs/skills-catalog.md`, one `.crow` card in `docs/catalog.html` (with lowercased `data-search`), one `.inv .row` in `docs/features/ios-dev.html`, each matching the surrounding format exactly (copy the sibling entry as the template).

- [ ] **Step 4: Add the bidirectional cross-link** — a "Related" pointer in the sibling `release-inapp-vs-asc-whatsnew-surfaces/SKILL.md` to the new skill (the new skill already links back per Task 1 §10).

- [ ] **Step 5: Verify count consistency**

Run: `grep -rn "ios-dev" docs/architecture.md docs/architecture.html docs/features/ios-dev.html site/index.html | grep -o "5[0-9] skills" | sort -u`
Expected: only `51 skills`.

- [ ] **Step 6: Commit**

```bash
git add plugins/ios-dev/.claude-plugin/plugin.json docs/ site/ plugins/ios-dev/skills/release-inapp-vs-asc-whatsnew-surfaces/SKILL.md
git commit -m "chore(ios-dev): register inapp-whatsnew skill — version bump, count sweep, cross-link"
```

---

### Task 3: Full verification + PR

**Files:** none (verification + git).

- [ ] **Step 1: Run the repo test suites**

Run: `cd ~/projects/claude-skills && bats tests/bats && python3 -m pytest tests/pytest -q`
Expected: all pass. (Docs/JSON change touches no shell; pytest exercises the registry parser against the new frontmatter.)

- [ ] **Step 2: Acceptance check** — read the finished SKILL.md top to bottom; confirm a reader with no Paperix access could stand up both the pop-up and the About build-info screen from it alone (every referenced type/function/script is defined inline).

- [ ] **Step 3: Push + open PR**

```bash
git push -u origin feat/ios-dev-inapp-whatsnew-buildinfo-skill
gh pr create --fill
```

---

## Self-Review

- **Spec coverage:** Pattern A pop-up (Task 1 §5), Pattern B build-info (Task 1 §5-6), decision table (§4), invariant tests (§7), non-goals honored (no gating/scaffold/app.yml touched), footprint items all mapped to Task 2. ✅
- **Placeholder scan:** no TBD/TODO; code source is the session-verified files + spec block. ✅
- **Type consistency:** names used across tasks — `inapp-whatsnew-popup-and-about-buildinfo`, `WhatsNewGateDecider`, `.whatsNewGate()`, `BuildInfo`, sibling `release-inapp-vs-asc-whatsnew-surfaces` — consistent throughout. ✅
- **Count correction vs spec:** spec called the 50-vs-51 a "pre-existing drift"; it is not — `_lib/` is a non-skill dir, docs correctly say 50. Authoritative target is **51**. ✅
