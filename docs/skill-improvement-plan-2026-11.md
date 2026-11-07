# Skill improvement plan (2026-11): session mining and deep review

**Status: proposed, nothing executed.** This branch adds only this plan and its [register](skill-improvement-plan-2026-11-register.md). No skill, hook, setting or `CLAUDE.md` was changed. Sequence and owner decisions are below.

**Scope asked for:** all past sessions in all repos, including explainers and portable artifacts; what can become a skill; what improves the existing skills, especially portable artifacts; a deep review of the existing skills.

---

## TL;DR

1. **Delivery is the biggest problem, not skill content.** In a live session listing, only 2 of 91 repo skills reached the model with a description; the rest are bare names. Better descriptions cannot fix that. Fix the listing budget first (Phase 1).
2. **Almost no new skills are justified.** 24 candidates were examined. After two skeptics reviewed each one, the recommendation is **zero new `SKILL.md` files now**, one slash command, two scripts and one hook. Most candidates shrank to a few lines in an existing skill. With descriptions not reaching the model, a new lesson skill would rarely load anyway.
3. **Portable artifacts have one main routing hole.** Checklists are hand-written HTML because `branch-test-checklist` hedges on `make-explainer`: a skeptic's rescan found only 8 of 196 checklist files carry the `make-explainer` marker. No doc says when to use the Artifact tool, and hand-written pages won by default for hosted work.
4. **The artifact skills pass their own checks on pages with visible defects.** Cold dogfooding found `check.mjs` reporting `ok` on a clipped embedded diagram, a dropped chart label and diagram text about 5 px tall. The agent gets no screenshot to look at.
5. **Git shows which `ios-dev` skills matter.** Failed-save handling is the fastest-growing fix cluster, and a known widget defect shipped as a privacy bug. Only 3 of 3,009 commits name an `ios-dev` skill.
6. **Fix a few safety problems first.** `capture` mode can push unscrubbed dotfiles to this public repo, and `contribute.bats` pushes real branches into the checkout whenever `bats tests/bats` runs.

| Result | Count |
|---|--:|
| Proposals after dedup | 319 |
| Confirmed by both skeptics | 267 |
| Contested (one refuted) | 48 |
| Refuted by both | 4 |

These are measured from the two workflow results. "Confirmed" means the item survived, usually in a narrower form. The register shows the narrowed form.

---

## Method and evidence

Two Workflow runs. Scripts built the corpus, so scraping used no model tokens. Agents then mined shards, reviewed each plugin, clustered by root cause, and two fresh skeptics tried to refute every proposal. A critic listed what round one missed, and round two closed the gaps most relevant to the scope.

| Source | Size | Measured by |
|---|--:|---|
| Top-level transcripts | 1,411, of which 104 are real interactive sessions | transcript extractor |
| Subagent transcripts | 2,700, scanned for portable-artifact commands and errors only | transcript extractor |
| End-of-session summaries | 782 | summary shard script |
| Typed prompt history, from 2026-05-02 | 3,438 | history shard script |
| Auto-memory notes | 130 across 20 project dirs | manual count from file listings |
| Fix commits since 2026-05-01, six iOS repos | 809 analysed; 795 with fix subjects | `git log`; a 45-row audit agreed about 87% |
| Repo-local skills, commands, agents and hooks | Every repo under `~/projects` that has them | listing and diff scripts |
| Published claude.ai artifacts | 47; Docs bodies of 7 not readable, classified by title | Artifact list and read |
| Failed portable-artifact commands | 1,527 rows | transcript extractor |
| Cold dogfood | Each of the 5 skills, then plan, slides, Simple English, a hand-drawn film and a diagram story | agent's commands, exit codes and viewed screenshots |

**Baselines on `main` at `153711dd` (measured):** `pytest tests/pytest` gave 250 passed. `bats` over 25 of the 26 files gave 184 passed. `contribute.bats` was excluded on purpose (CAT-12). The Node suites were not run locally because they launch browsers and take a long time.

**Spend (measured):** round one used 18.1M subagent tokens. 62 Fable verifiers took 8.0M (44%), 20 Sonnet miners 3.2M, 14 Opus reviewers 4.1M and 3 Fable clusterers 1.5M. Round two's checking stage ran on Opus at medium effort after the owner asked for this; the resumed run reported 2.3M, and the interrupted part was not measured separately. See [User-level `CLAUDE.md` additions](#user-level-claudemd-additions).

### Limits of this evidence

- **Transcripts reach back only to about 2026-10**, with a few from August. iOS work before that exists only as prompts, memory notes and git history. This is why zero recorded use is never treated as a reason to delete a skill.
- **Skill-tool counts understate use** and miss sessions where a skill was read directly. 76 of 92 skills show no recorded use from either Skill calls or typed commands.
- **Digests truncate** long commands and last messages. Six digests dropped prompts; most were teammate relays.
- **Error rates are floors.** Interactive sessions had 136 errors in 2,777 portable-artifact commands (4.9%) and teammates 58 in 1,222 (4.7%). Subagent errors have no command count behind them, so they are quoted only as a count.
- **Some counts remain estimates.** The listing-budget replay table (CAT-104) comes from a script no skeptic re-ran. Skeptics corrected many first-pass recurrence figures, and the register carries the corrected wording.
- **Not reviewed:** the non-Claude host transcripts in depth, and `docs/catalog.html` and `docs/architecture.html` line by line. Neither mod was run live, so their findings come from code reading. Swift snippets flagged as not compiling (CAT-54, CAT-65, CAT-70) were read, not compiled; run `xcrun swiftc -typecheck` before rewriting them.
- **Open PRs may overlap** this plan. See G-72.

---

## What can become a skill

| Candidate | Evidence | Verdict |
|---|---|---|
| Inventory-first cleanup of merged branches (NEW-09) | Asked in 6 repos | **Build as a slash command** `core-workflow:cleanup-branches`. Hands the owner one delete line, because the guard blocks branch deletion. |
| Local site preview (NEW-15) | 16 sessions | **Script, not a skill:** `scripts/site-preview.sh` staging exactly what `pages.yml` deploys. |
| Screenshot a local page (NEW-16, G-06) | 4 repos; the same traps re-learned in 6 | **Script, not a skill:** `shared/shot.mjs` plus a traps reference. |
| Load a lesson skill when its exact error appears (CAT-108) | Blast-radius, worktree-guard and Xcode-licence errors recur while the skills stay unloaded | **Hook, not a skill:** a three-row table of exact strings in `core-workflow`. |
| Ship a PR (NEW-11) | 20+ dates | **Extension only:** a deploy-verify step and a PR-template checkbox. The rest of the ritual already has an owner. |
| Portable-artifacts release checklist (NEW-12, NEW-40) | 3 cited sessions; showcase bundle in 2 | **`AGENTS.md` section**, plus a gallery rebuild helper. |
| Contributor PR loop (NEW-43) | 3 sessions | **Three bullets** in `AGENTS.md`. |
| SDD task loop (NEW-18) | About 290 to 330 teammate sessions | **No wrapper.** Add a bullet to `subagent-dispatch`; superpowers already owns the loop. |
| Mutation proof (NEW-49) | 2 repos | **Lines in** `agent-autonomy.md`. |
| App Store screenshot pack (NEW-54) | 2 repos | **Preflight gate** in `ios-dev:release`. |
| macOS UI-test preflight (NEW-53) | 4 sessions, 1 repo | **Repo script.** |
| Session status and handoff (NEW-24) | 15 sessions | **Contested.** Compass and existing handoff tools cover most of it. Default: no skill, add a remaining-work field to compass. |
| Speech lifecycle (G-38), unsaved-work guard (G-39) | Real fix clusters, mainly one repo | **Watch.** Revisit if a second app hits the same cluster, as a symptom-named skill. |
| Notarized Mac DMG release (G-28) | 2 differently shaped repos | **Watch.** Real gap, no shared shape yet. |
| Session log (G-48) | 4 repos | **No plugin skill.** Repo-level copies stay, re-synced with their porting doc. |
| Public-repo figure scrubbing (NEW-37), social posts (NEW-41, G-03), form filling (NEW-56, G-55) | Each already handled in its private repo | **Keep private.** Small edits in those repos. |
| Cloud DNS go-live (NEW-38), browser-extension publish (NEW-55), live-acceptance suites (NEW-51), recorder-first testing (NEW-50), session forensics (NEW-29) | 1 or 2 sessions, or a runbook already exists | **No.** |
| Angle review (NEW-42) | Refuted: the fan-out was `/code-review max`, not hand-rolled | **No.** |

Promotions from private repos are limited. `record.sh` should return to `ios-dev:app-preview` (G-44), and two failed-save rules should move from an app's `AGENTS.md` into `ios-dev` (G-29, G-34). A public `ios-dev:swift-reviewer` agent is deferred until a run actually fails (G-47).

---

## User-level `CLAUDE.md` additions

The owner asked for the first of these. They are proposed text only; `~/.claude/CLAUDE.md` is untouched. Apply them in one edit and log it in `~/.claude/harness-changelog.md`.

```markdown
- **Pick each Workflow stage's tier by the job.** No judgment needed (scraping, digests, sweeps): script first, then Haiku. Breadth mining: Sonnet at medium. Reviewers: Opus at medium. Use Fable for clustering and the hardest few verifications, never a whole verify fleet. State the planned agent count and tiers before fanning out.
- **One integration branch per plan, wave or topic.** Phases are commits on it. A second branch only on request; follow-ups go on the existing branch.
- **A question dialog can hide the text above it.** If the user must read something to answer, put it in the question or its preview, or end the turn on the text.
- **Batch questions up front with a recommended option.** After design approval, run to completion and list judgment calls afterwards.
```

Items: G-26, NEW-19 (tier rule), CAT-102, NEW-13, G-04 (branch rule), G-02 (dialog), NEW-30 (batching). The branch rule says "per plan, wave or topic", not "per session", because memory notes show one-integration-branch habits and stacked milestone branches by owner choice.

**Make the tier names agree at the same time (NEW-81, step 1).** `AGENTS.md` says chore tier is Haiku and still names Fable 5. `subagent-dispatch` says Sonnet at low, with Haiku only for zero-judgment sweeps. `code-review.md` names model versions. Keep one editable mapping line in `AGENTS.md`, have the skill defer to it, and add the verifier cap to `subagent-dispatch`.

---

## Portable artifacts: what the evidence says

**How it is used (measured).** `make-explainer` leads with 19 invocations, then `make-motion` 9 and `make-diagram` 5; `make-dashboard` and `make-scene` have 1 each. The plan-page round trip, the Simple English toggle and the hand-drawn film all worked in cold runs. A real older page rebuilt on 1.2.0 fixed its own KPI wrapping, and 3 of 3 videos on a real showcase page reached `readyState 4` and played in headless Chromium.

**Where it hurts, in priority order:**

1. **Agents cannot run the docs as written.** `SKILL.md` gives no plain-command rule, and README quick starts teach `$SKILL` variables. The largest failure class is harness and guard refusals of compound forms, not skill bugs. One short block in each skill removes this class (PA-15, NEW-04).
2. **First-run failures are raw.** A missing `node_modules` gives a stack trace; the stale-copy warning cannot fire there (PA-08). Each version bump repeats installs and model downloads, leaving about 1.3 GB of orphans (PA-09). The doctor calls a working dev checkout "missing" (G-66).
3. **Docs are too large for the Haiku tier they pin.** `make-motion/SKILL.md` is 62,573 bytes and `schema.md` 137,775 bytes (PA-35). Its first validate call passes 8 of 16 times, and undocumented id and colour rules lead the errors (PA-36).
4. **Pages land out of sight.** The default output is outside the repo (PA-05), and builds do not print a clickable path (PA-07).
5. **Hosted work bypasses the skills.** Of 47 hosted artifacts, at least 4 are the plugin's own showcase pages; almost all pages for real work are hand-written. Plugin docs never mention the Artifact tool (G-57, PA-06).
6. **Checklists.** See the TL;DR. The preset lacks steps, expected result, group intro and tags, and has no way to return results to the agent (PA-01 to PA-04, G-58).
7. **`check.mjs` passes what a person would reject.** It needs a `--shots` output and gates for the failures found (PA-21, G-07, G-08). The skeptics corrected this: some scrolling is by design, so gates must look for "no visible cue" rather than any overflow.
8. **Skills overlap.** `core-workflow:branch-explainer` delegates to `visual-explainer`, which is not enabled (PA-51, CAT-01).

Per-skill quality items are in Phase 4 of the register. Examples: `make-dashboard` validation (`valid` does not mean buildable, PA-27) and silent misleading charts (PA-31); `make-diagram` Play story stopping after one beat (PA-23) and fit legibility (PA-22); `make-motion`'s flaky determinism test (PA-42) and silent-film surprise (PA-38); `make-scene` data correctness (PA-47).

**Do not build yet:** new presets for what-changed reports, guides and decisions. A `commands` section plus short recipes covers those shapes (G-59, contested). The `review` preset and `diff` section stay, because the description already promises "diff review" (PA-61).

---

## Execution plan

Each phase is one PR or a small set. Effort is stated as surface and risk. Full item text and proof steps are in the [register](skill-improvement-plan-2026-11-register.md). Dependencies are marked with "after".

### Phase 0: Safety and repo hygiene (small; low risk; verified by bats and grep)

- CAT-13: stop `capture` from committing and pushing without review. Security-relevant because this repo is public.
- CAT-12: point `contribute.bats` at a bare temp repo. Prove it by watching the current test fail. Until then, do not run `bats tests/bats` whole.
- CAT-24: secret scan misses common token shapes and prints matches. CAT-18: remove private residue and add an anonymisation rule to `learn-lesson`.
- CAT-50: scripts accept misspelled flags, and `deploy-site.sh` force-pushes on a `--dry-run` typo. CAT-73: force-push deploy drops the custom domain.
- CAT-90: Linear issue text reaches a shell command. CAT-79: `wind` trusts config from any cwd. PA-33: dashboard hardening gaps. CAT-84: statusline wiring can hide the user's statusline.
- CAT-97, PA-68: remove stale untracked `make-*` copies that shadow the plugin here. **Owner confirms deletion** (D10).
- G-72, G-73, CAT-110: reconcile open PRs, parked decisions and a stale plan status.

### Phase 1: Skill delivery (small to medium; high leverage; verified by counting the next session's listing)

1. CAT-104: owner decides listing budget (D1). Then count described entries in a new session.
2. G-01: run the probe, then use `@AGENTS.md` imports where repos only link to it. Weigh the context cost here first.
3. CAT-105 (fix the gate), then CAT-106 and PA-50 (descriptions), gated on the fixed `route_spike`. This picks up catalog review Phase 5 by name.
4. CAT-108: error-string hook. G-33 and NEW-80: about 10 symptom-to-skill rows in a path-scoped rule. CAT-107: one-skill `paths:` spike.
5. The `CLAUDE.md` additions above, plus NEW-81 step 1.

### Phase 2: Portable artifacts, the agent path (medium; verified by unit tests with a seeded failure first)

PA-15 and NEW-04 (plain-command block), PA-08 (preflight), PA-36, PA-16, PA-17, G-67, PA-18, G-62, PA-20, PA-24 (errors and CLI contract), PA-14, G-66, PA-11, PA-12 (doctor), PA-09, PA-10 (install reuse; large), PA-35 (doc size, with a byte-budget test), PA-05 and PA-07 (output and report, after D2).

### Phase 3: Portable artifacts, routing and seeing the output (medium; needs one serial browser run)

- Checklists: PA-02, PA-03 first, then PA-01, PA-04, G-58, NEW-74.
- Sharing: G-57, PA-06. Overlap: PA-51, CAT-01, after D4.
- Seeing it: NEW-16 and G-06 (`shot.mjs`), then PA-21, G-07, G-08, NEW-73. After PA-53.
- Diagrams: PA-22, PA-23, G-68.

### Phase 4: Portable artifacts, per-skill quality (large; split per skill; each needs viewed output)

`make-explainer`: PA-61, G-59, PA-63, G-63, G-61. `make-dashboard`: PA-27, PA-28, PA-29, PA-30, PA-31, PA-32, PA-34. `make-motion`: PA-38, PA-39, PA-40, PA-41, PA-42, G-74. `make-scene`: PA-47, PA-48, PA-49. Shared: PA-52, PA-53, PA-44, PA-45. Note PA-46: the Haiku pin is backed only by a validity gate, so measure it through the real frontmatter path.

### Phase 5: Evals, docs and release process (medium; billed runs need D3)

D3 first: a small billed baseline on 1.2.0, before Phase 2 lands if possible, so there is a before-picture. Then PA-54, PA-55, PA-56 (evals), PA-58 (doc drift with a facts test), PA-60 and NEW-12 (gallery rebuild, release checklist), NEW-40, PA-43 (browser tests against the one-browser rule).

### Phase 6: `ios-dev` correctness (medium; compile-check or device-test per item)

Ranked by git fix counts first, then by session evidence:

1. **G-31, CAT-71:** widget and App Lock defect that shipped as a privacy bug (5 fixes on 2026-11-03).
2. **G-29, CAT-66:** failed-save contract. STORE-FAILURE has 66 commits (W0 4, W1 28, W2 34), nearly all one repo and review-driven. Run CAT-66's two-context test before rewriting, since it disputes the skill's thesis against Apple's docs.
3. **G-30, CAT-70:** CloudKit relationship rules; recurred 10 days after the skill.
4. **G-35, CAT-65:** capture-delivery reference code; 4 recurrences after the skill.
5. **G-36:** extend the existing heavy-work grep. No new script.
6. **CAT-61:** iOS 27 re-verification; 3 SDK fixes just landed.
7. Then CAT-67, CAT-62, CAT-69, CAT-72, CAT-68 with G-21, CAT-63, G-37, G-41, CAT-58.

`ios-dev` skills with no matching fix cluster are a watch list (G-42), not a delete list. Sheet and navigation fixes fell from 10.2% to 1.9% of all fixes between the two later windows, the release-signing cluster fell after bring-up, and these figures do not show whether the skills caused the fall.

### Phase 7: `ios-dev` release, scaffold and site tooling (medium; verified by bats and a scratch app)

CAT-41, CAT-42, CAT-43 with G-16, G-17, G-24; G-14 (alpha icon gate); NEW-54 (screenshot sizes); CAT-44 holds, CAT-45 falls in rank; CAT-47, CAT-48 with G-18; CAT-51 and G-49 (scaffold ships `build.sh` and a guard); G-23, CAT-74; G-44.

### Phase 8: `core-workflow`, dispatch, other plugins, mods, setup (large; split per plugin)

- **Critical:** CAT-77 (`second-wind` limit patterns miss current messages, so the watcher never fires), with CAT-78. Needs a real captured pane.
- **Broken as written:** CAT-83 (`prompt-craft` fix no longer works on current models), CAT-88, CAT-89 (`linear-pm` env vars and pick gates), CAT-21 (launchd fix fails its own scenario).
- **Conflicting rules:** CAT-03 (`rm` rules against the Blast Radius hold), CAT-07 (trailers), NEW-23.
- **Mods:** CAT-33 (CI never runs their tests), CAT-32, CAT-34, CAT-35, CAT-37, CAT-39. Run each live.
- **Setup:** CAT-99 (split per skeptic: fix the marketplace check and dry-run first), CAT-94.
- **Additions:** NEW-09 (`cleanup-branches`), NEW-11, NEW-15, NEW-39, NEW-43, G-10, G-11, G-12.

### Phase 9: Owner-run harness and other repos

Under `~/.claude` or in private repos, so each is the owner's call. Listed in the register by id only where public: NEW-17, CAT-05, CAT-09 (report delivery and dispatch blocks), NEW-01 (worktree rule hook), NEW-06, CAT-04 (`rm` hold), NEW-07, G-09 (merge flow), G-13 (bash-guard source of truth), G-43 (project forks shadow plugins), CAT-100 (backup; D6). Private-repo items are in the private register.

---

## Owner decisions

Each is parked with a default. The plan proceeds on the default except where it spends money, deletes or publishes.

| # | Decision | Options | Default |
|---|---|---|---|
| D1 | Skill listing budget (CAT-104) | Turn off unused third-party skills with `skillOverrides`; raise `skillListingBudgetFraction`; both | **Both**, measured on the next session. The replay table is an estimate. |
| D2 | Default output path (PA-05) | `<git root>/.scratch/<slug>.html` in a repo; `<spec dir>/out` | **`.scratch` in a repo** |
| D3 | Billed eval baseline on 1.2.0 | Run; skip | **Ask before spending.** Without it no before-picture exists (PA-56). |
| D4 | `branch-explainer` (PA-51) | Redirect; delete | **Redirect** |
| D5 | Agent merges and branch deletes (NEW-07, NEW-08, G-09) | Agent runs them under a rule; owner runs one handed-over line | **Owner runs.** Settle conflicting allow-rule evidence with one fresh test. |
| D6 | Back up `~/.claude` and `~/.agents` (CAT-100) | Private dotfiles repo; none | **Private repo.** Nothing else holds these hooks, rules and skills. |
| D7 | Move `branch-test-checklist` and `subagent-dispatch` to `core-workflow` (PA-01, NEW-81) | Move after scrub; keep user-level | **Keep user-level** until the rewrite settles |
| D8 | Open PRs (G-72) | #51: port and close, or rework. #52: split. #54 and #55: order, licence wording. #24: merge or close | **Keep #51 open** until its browser-launch race is ported or tested. A contributor authored it, so closing is your call. |
| D9 | Simple English default (PA-63) | Default-on with a number-parity warning (G-63); opt-in | **Default-on with the warning**, reviewed after evals |
| D10 | Delete untracked `.agents/`, `.claude/skills/`, `skills-lock.json`, `.scratch-placeholder/` (CAT-97) | Delete; gitignore | **Delete, on your confirmation.** Keep `.claude/worktrees/`. Gitignoring hides the shadowing. |
| D11 | Split the two largest repo rulebooks (G-52) | Move process text to on-demand docs; leave | **Split one**, because the Cubby file is at 99.7% of its size ceiling |
| D12 | Parked items in `docs/decisions-pending.md` (G-73) | As listed there | **Keep shipped defaults** |

---

## Contested and dropped items

48 items were contested and 4 refuted. Defaults:

- **Fold into a sibling:** G-69 into PA-41, G-70 into PA-38, G-71 into PA-60, G-75 into CAT-110, CAT-82 into the items it names.
- **Keep as a small fix:** PA-64, G-64 (promote the thin-plan warning to an error; the sticky save control already exists), NEW-08 (facts are true, policy goes to D5).
- **Drop unless you say otherwise:** PA-13, PA-25, PA-57, PA-62, PA-67, CAT-111, NEW-14, NEW-21, NEW-25, NEW-28, NEW-29, NEW-32, NEW-35, NEW-46, NEW-48, NEW-51, NEW-52, NEW-64, NEW-75, NEW-76, G-05, G-15, G-19, G-27, G-46, G-76.
- **Watch:** G-28, G-38, G-39, G-40 (CAT-72 only for now), NEW-24.
- **Refuted, do not re-propose:** NEW-42, NEW-44 (one private repo), G-32 (skill already generalised), G-60.

---

## How this improves the next mining run

- Filter teammate idle notifications out of user prompts and corrections (CAT-103), and filter one-prompt summary calls.
- Keep the extractor and classifier as a committed tool with a high-water mark, instead of re-specifying scope (NEW-31).
- Give the verifier stage the tier rule above. Use the checks that found the most here: read git history, read memory notes and actually run the skills.
