# Skill audit & consolidation — plan of action

**Status:** executed on branch `feat/skill-audit-exec` (reference delegation +
swift6 merge, commit `f8d2414`). Counts below reflect the tree at planning time
(49 skills / ios-dev 35); post-merge the repo has 48 / 34.
**Scope:** all 49 skills across 5 plugins; primary target `ios-dev` (35 skills).
**Goal (as set):** make skills more deterministic and likelier to trigger, and
cut context load — especially in `ios-dev` — by combining where sensible and
using reference delegation with code samples.

---

## TL;DR — the honest reframe

The stated premise was "combine skills *so context load is also less*." The
data says the context win comes almost entirely from **reference delegation**,
not from combining. So this plan **leads with delegation** and treats combining
as a separate, smaller, riskier move applied only to genuine overlaps.

Two independent levers, do not conflate them:

| Lever | What it cuts | Effect on triggering | Verdict |
|---|---|---|---|
| **1. Reference delegation** — move copy-paste code out of `SKILL.md` body into `references/*.md` | **On-trigger body** (the ~30%, up to 53%, that is fenced code) | **None** — triggering is matched on `description`, which is untouched | **Do it broadly.** This is the load-bearing context win. |
| **2. Combining** siblings into one skill | **Always-loaded description catalog** only | **High-risk** — a merged description must keep *every* member's trigger phrases or triggering degrades | **Do it narrowly**, only for true overlaps, gated on an eval. |

Combining barely helps context (a merged description is roughly the sum of the
members' trigger phrases minus a shared preamble) and can *hurt* triggering. It
is worth doing only where two skills genuinely compete for the same symptom.

**Honesty about ambient load:** Lever 1 cuts only *on-trigger* body; Lever 2
saves ~nothing. The **always-loaded description catalog — 35 long `ios-dev`
descriptions, several already over 800 chars (avfoundation ~1086, swiftdata-
cloudkit longest) — is untouched by either lever.** The only knob that shrinks
ambient load is **description tightening (Lever 3)**, which is also the riskiest
edit (it directly changes what matches). This plan treats ambient reduction as a
bounded, eval-gated Phase 4, not a headline promise.

---

## Evidence

49 skills: `core-workflow` 6, `ios-dev` 35, `linear-pm` 1, `prompt-craft` 6,
`second-wind` 1.

`ios-dev` bodies total **3,971 lines, of which ~1,221 (30%) sit inside code
fences.** The fattest lesson skills are 40–53% code — that fenced code is the
delegation target:

| Skill | body | code | code% |
|---|--:|--:|--:|
| widget-appgroup-snapshot-bridge | 149 | 76 | 51% |
| vision-layout-ocr-grounding | 176 | 76 | 43% |
| scan-capture-quality-gates | 139 | 75 | 53% |
| avfoundation-capture-delivery-watchdog | 156 | 72 | 46% |
| file-handoff-inbox-backstop | 141 | 70 | 49% |
| swiftdata-cloudkit-model-rules | 143 | 65 | 45% |
| scan-crash-recovery-store | 136 | 64 | 47% |
| mainactor-runtime-isolation-trap | 140 | 58 | 41% |
| ondevice-generable-anti-hallucination | 141 | 57 | 40% |
| query-derived-typeahead-vocabulary | 155 | 57 | 36% |
| deep-link-resolver-applock-pathtraversal | 131 | 51 | 38% |
| swiftdata-inmemory-test-harness | 142 | 51 | 35% |

Two archetypes in `ios-dev`, kept firewalled in this plan:

- **Command / driver skills** (invoked by name, carry `scripts/`): `release`,
  `app-preview`, `ios-build`, `ios-scaffold`, `site-pages-deploy-kit`.
  **Never combined.** Reference-delegate only where a body has inline code.
- **Lesson / gotcha skills** (~29, symptom→root-cause→fix): the delegation +
  selective-merge targets below.

Two skills already use `references/` (`swiftdata-cloudkit-model-rules`,
`xcode-cloud-post-clone-contract`) — the pattern to generalize.

---

## The combining discriminator (why most "families" stay separate)

Combining helps triggering only when siblings share **overlapping trigger
conditions**. It hurts when it forces **disjoint symptoms that merely share a
root cause** into one grab-bag description. The tell is already in the repo:
skills that were deliberately separated say **"this is NOT the other one"** and
cross-link. Grep confirmed:

- `avfoundation-capture-delivery-watchdog` → *"This is NOT the 0x8BADF00D
  launch-time watchdog SIGKILL (see mainactor-launch-watchdog-audit)"*
- `github-pages-flat-deploy-subdir-404` → *"NOT the git-subtree-split model"*

So the **5-skill MainActor family — the biggest line-count consolidation one
would reach for — is the *highest* risk to triggering, not the safest.** Those
skills fire on distinct `.ips` frames / distinct compiler diagnostics; merging
them dilutes each trigger. They stay separate and get slimmed via Lever 1.

Every lesson skill already carries a `## Related skills` section → **any
rename/merge requires a cross-reference sweep** (guardrail below).

### Cluster decisions

| Cluster | Members | Decision | Rationale |
|---|---|---|---|
| **Favicon / site metadata** | `site-og-favicon-verify` + `pillow-favicon-set-no-rasterizer` | **DEFER — optional catalog hygiene, NOT a merge win** | Fails the discriminator: **zero trigger competition** (og-verify fires on unfurl/CSP symptoms; pillow on literal tool errors `rsvg-convert: command not found`). Relation is checklist↔fallback, already covered by mutual `## Related`. Slim pillow via Lever 1 instead; only fold if a Phase-0 eval shows they mis-route to each other |
| **Swift 6 compile-time isolation** | `swift6-mainactor-migration` + `nonisolated-struct-codable-mainactor` | **MERGE → `swift6-mainactor-compile-fixes`** (benefit is **disambiguation, not context**) | Genuine competition: near-identical diagnostic prose, same build setting, same fix idiom; struct-Codable self-describes as "the narrower case." Note: `migration` has **0 code fences** (pure process) — only struct-Codable's ~28 lines delegate. Constraints: merged `description` must keep **both literal diagnostic strings** and stay within char budget (see guardrail 7) or the merge aborts |
| **MainActor runtime traps** | `mainactor-runtime-isolation-trap`, `mainactor-launch-watchdog-audit`, `avfoundation-capture-delivery-watchdog` | **KEEP SEPARATE** | disjoint symptoms, explicit "NOT the other" cross-refs; merging fights triggering. Delegate code individually; optional shared `references/` dir |
| **Vision / scan pipeline** | `vision-layout-ocr-grounding`, `vision-barcode-cidetector-fallback`, `scan-capture-quality-gates`, `scan-crash-recovery-store` | **KEEP SEPARATE** | distinct failure modes (OCR grounding vs barcode fallback vs blur gate vs crash recovery). Delegate each |
| **Site deploy** | `site-pages-deploy-kit`, `github-pages-flat-deploy-subdir-404`, `legal-pages-css-scoping-bleed` | **KEEP SEPARATE** | deploy-kit is a driver; flat-deploy is "NOT the subtree model"; css-bleed is unrelated |
| **SwiftData** | `swiftdata-cloudkit-model-rules`, `swiftdata-inmemory-test-harness` | **KEEP SEPARATE** | model/CloudKit rules vs test-harness setup — different tasks. Delegate each; may share `references/` |
| **App-group bridges** | `widget-appgroup-snapshot-bridge`, `file-handoff-inbox-backstop` | **KEEP SEPARATE** | widget rendering vs share-extension inbox drain — different symptoms |
| **Command / driver** | `release`, `app-preview`, `ios-build`, `ios-scaffold`, `site-pages-deploy-kit` | **KEEP SEPARATE, no merge** | invoked by name, carry scripts |

Net effect of Lever 2: **35 → 34** `ios-dev` skills (one merge; favicon
deferred). The value is in Lever 1's per-skill slimming, not the count.

---

## Reference-delegation pattern (Lever 1, the load-bearing move)

For each fat lesson skill, `SKILL.md` keeps everything that drives a *decision*
and demotes everything that is *copy-paste bulk*:

**Stays in `SKILL.md`** (loads on trigger — must be small and decision-dense):
- frontmatter `description` — **byte-identical, never touched by delegation**
- Symptom / when-this-fires
- Root cause (the "why")
- The **rules / decision points** (thresholds, the do/don't)
- A minimal signature or ~5-line skeleton showing the shape of the fix
- `See references/<topic>.md` pointer + `## Related skills`

**Moves to `references/<topic>.md`** (loads only when Claude opens it):
- Full copy-paste implementations, the 20–40-line fixed versions, alternates

**Two boundary rules that keep delegation outcome-neutral (not just trigger-neutral):**
- **Promote load-bearing rules out of code comments into body prose *before*
  demoting the code.** Several skills bury a rule inside a comment — e.g.
  pillow's "apple-touch-icon must be FULL-BLEED + OPAQUE — iOS applies its own
  mask", scan-capture's "per-glyph OCR confidence says 'read correctly', not
  'is a name' — cap it". Demoting the code block silently loses these unless
  lifted to prose first.
- **Use imperative pointer language.** `references/` loads only if Claude opens
  it; a thin body skeleton invites reconstruction-from-memory (e.g. rebuilding
  `laplacianVariance` vImage/rowBytes handling wrong). Write "**Read
  `references/blur-gate.md` before implementing**", not a passive "see also".

### Worked example A — delegate a fat skill (`scan-capture-quality-gates`, 53% code)

```
skills/scan-capture-quality-gates/
  SKILL.md                       # ~65 lines: symptom, root cause, the gate
                                 #  rules (sharpnessThreshold, retry cap,
                                 #  OCR-name reject list), a 5-line BlurGate
                                 #  signature, pointer to references/
  references/
    blur-gate.md                 # full BlurGate.outcome(...) impl + tests
    ocr-name-scoring.md          # full reject-list + confidence-cap impl
```
Body drops from 139 → ~65 lines on trigger; description unchanged →
triggering unchanged; the code is one click away when actually implementing.

### Worked example B — the swift6 MERGE (the one Phase 2 ships)

Before: two skills competing for the same compiler-diagnostic symptom.
```
swift6-mainactor-migration/SKILL.md            (67 lines, 0 code fences — process)
nonisolated-struct-codable-mainactor/SKILL.md  (98 lines, ~28 code lines)
```
After: one skill; the narrow struct-Codable case folds in, its code delegated.
```
swift6-mainactor-compile-fixes/
  SKILL.md            # both diagnostics + the shared fix idiom (nonisolated at
                      #  the type declaration, cascade through callees)
  references/
    synthesized-conformance-codable.md   # struct-Codable's ~28-line fix + note
```
**Merged `description` MUST keep both literal diagnostic strings verbatim** —
`"main actor-isolated X cannot be called from outside of the actor"` *and*
`"main actor-isolated conformance of 'X' to 'Decodable' cannot be used in
nonisolated context"` — inside the char budget (guardrail 7). If both can't fit
without a grab-bag, abort — the two-stage gate (guardrail 1) decides.

**Counter-example (why favicon is NOT here):** `site-og-favicon-verify` and
`pillow-favicon-set-no-rasterizer` share a *domain* but **no trigger** —
og-verify fires on "unfurl shows no image", pillow on `"rsvg-convert: command
not found"`. Merging them would build a grab-bag description with no
disambiguation gain, so pillow is slimmed via Lever 1 and left standalone.

---

## Guardrails (every phase)

1. **Two-stage trigger gate.**
   - **Free deterministic pre-gate (always):** extend
     `tests/fixtures/intent-router/labeled-prompts.json` with labeled prompts
     for every trigger surface of each merged/rewritten description, and require
     `scripts/route_spike.py` (CI-gated by `tests/pytest/test_route_spike.py`)
     to not regress. Cheap, runs in CI, spend it before any model eval.
   - **Model eval (merges + description rewrites):** before/after trigger-
     accuracy eval via the **`skill-creator` plugin** (variance benchmarking).
     Note `skill-creator` is an **externally installed plugin, not in this
     repo** — verify it is available at execution time; if absent, the
     route-spike pre-gate is the floor. **A merge/rewrite ships only if trigger
     accuracy does not regress.**
2. **Description byte-identical under pure delegation.** Lever 1 must not touch
   frontmatter. Diff-check `description` unchanged.
3. **Repo-wide cross-reference sweep.** Renames/merges break refs well beyond
   the plugin — confirmed targets include `## Related skills` links,
   `plugins/ios-dev/commands/site.md`, `docs/skills-catalog.md`,
   `docs/catalog.html`, `docs/features/ios-dev.html`, and the intent-router
   fixture (`labeled-prompts.json:35` hard-codes `swift6-mainactor-migration`
   → renaming it fails `test_route_spike.py`). Grep **repo-wide** and fix in the
   same commit as the rename. **Archived `docs/superpowers/` specs/plans:
   leave as historical record** (point-in-time), do not rewrite.
4. **Atomic inventory-count sweep.** Combining changes counts in
   `docs/skills-catalog.md`, `docs/architecture.*`, `docs/catalog.html`,
   `site/*`, plugin `README`s, and `.claude-plugin/marketplace.json` /
   `plugin.json`. One scripted sweep, never hand-edit each site (per AGENTS.md).
5. **CI is the gate.** `test.yml` asserts every skill dir has `SKILL.md` and
   runs shellcheck/bats/pytest across macOS+Ubuntu. Green before merge.
6. **Do-not-touch:** the 5 command/driver skills' structure; the MainActor
   runtime family's separateness.
7. **Merged-description char budget.** The swift6 pair's descriptions are
   ~650–700 chars each; a naive union blows past a sane budget (several existing
   descriptions already run 850–1100 chars). Compress the merged description to
   the union of *trigger-distinct* phrases — **both literal diagnostic strings
   must survive verbatim** — and if it can't hold both without becoming a
   grab-bag, abort the merge (guardrail 1 decides).

---

## Phased execution (with tier / effort per AGENTS.md)

| Phase | Work | Mode / tier / effort |
|---|---|---|
| **0 — Baseline & lock clusters** | Build the route-spike fixture and run the trigger baseline across **all 35 `ios-dev` descriptions** (all 49 if cheap — it's one eval-harness run, not per-skill labor); flag weak/mis-routing descriptions; lock the cluster table | Solo orchestrator, **planner (Fable), high** |
| **1 — Reference delegation (LOAD-BEARING)** | Delegate code out of the ~12 fat lesson skills into `references/`; promote code-comment rules to prose first (delegation boundary rules). Per-skill independent → plain **git-worktree fan-out**. Verify: description byte-identical, body shrinks, refs resolve, CI green | Workflow, **executor (Sonnet), medium** |
| **2 — The swift6 merge + all rename edits** | Merge only the swift6-compile pair (favicon deferred); rewrite merged description within char budget; **do the repo-wide cross-ref sweep + manifest/inventory-count edits in this phase** (they touch SKILL.md bodies + manifests → executor tier, not chore); route-spike + eval gate, abort if regressed | Workflow, judging at **planner (Fable), high**; edits **executor (Sonnet), medium** |
| **3 — Scripted count sweep + verify** | Run the atomic inventory-count script across catalog/architecture/site; verify all links resolve; confirm CI green. No SKILL.md/manifest content edits (those landed in Phase 2) | Single agent, **chore (Haiku), low** |
| **4 — Description tightening (eval-driven)** | Only descriptions the **Phase-0 full baseline** flagged as weak get rewrites; re-run route-spike + eval | Single agent, **executor (Sonnet), medium** |

Fable is the fast planner-tier default for the orchestration/judging phases
(0 and 2); Sonnet does the mechanical delegation edits; Haiku does the
inventory sweep.

---

## Other plugins — deliberately light touch (KISS/YAGNI)

`core-workflow` (6, 39–96 lines), `prompt-craft` (6, 29–48 lines),
`linear-pm` (1), `second-wind` (1) are small, low-code-share, mostly
command/workflow skills. **No restructuring.** At most, a Phase-0 eval pass
flags any weak `description`; fix only those. Do not invent families here.

---

## What this plan explicitly does NOT do

- Does not merge the MainActor runtime family (triggering risk).
- Does not touch command/driver skill structure.
- Does not combine for count's sake — Lever 1 is the context win.
- ~~Does not start the refactor.~~ Approval landed; the refactor was executed
  on this same branch (`feat/skill-audit-exec`) — see Status at the top.
