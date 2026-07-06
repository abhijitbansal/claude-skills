# Skill audit & consolidation — plan of action

**Status:** proposal, awaiting approval. No skills refactored yet.
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
| **Favicon / site metadata** | `site-og-favicon-verify` + `pillow-favicon-set-no-rasterizer` | **MERGE** → `site-metadata-unfurl-favicon`; pillow becomes `references/generate-favicon-no-rasterizer.md` | pillow is a sub-procedure of og-verify's favicon step and already cross-refs it; overlapping domain |
| **Swift 6 compile-time isolation** | `swift6-mainactor-migration` + `nonisolated-struct-codable-mainactor` | **MERGE** → `swift6-mainactor-compile-fixes`; per-diagnostic `references/` | the struct-Codable case is a narrow instance of the general migration; same fix idiom (nonisolated at type decl) |
| **MainActor runtime traps** | `mainactor-runtime-isolation-trap`, `mainactor-launch-watchdog-audit`, `avfoundation-capture-delivery-watchdog` | **KEEP SEPARATE** | disjoint symptoms, explicit "NOT the other" cross-refs; merging fights triggering. Delegate code individually; optional shared `references/` dir |
| **Vision / scan pipeline** | `vision-layout-ocr-grounding`, `vision-barcode-cidetector-fallback`, `scan-capture-quality-gates`, `scan-crash-recovery-store` | **KEEP SEPARATE** | distinct failure modes (OCR grounding vs barcode fallback vs blur gate vs crash recovery). Delegate each |
| **Site deploy** | `site-pages-deploy-kit`, `github-pages-flat-deploy-subdir-404`, `legal-pages-css-scoping-bleed` | **KEEP SEPARATE** | deploy-kit is a driver; flat-deploy is "NOT the subtree model"; css-bleed is unrelated |
| **SwiftData** | `swiftdata-cloudkit-model-rules`, `swiftdata-inmemory-test-harness` | **KEEP SEPARATE** | model/CloudKit rules vs test-harness setup — different tasks. Delegate each; may share `references/` |
| **App-group bridges** | `widget-appgroup-snapshot-bridge`, `file-handoff-inbox-backstop` | **KEEP SEPARATE** | widget rendering vs share-extension inbox drain — different symptoms |
| **Command / driver** | `release`, `app-preview`, `ios-build`, `ios-scaffold`, `site-pages-deploy-kit` | **KEEP SEPARATE, no merge** | invoked by name, carry scripts |

Net effect of Lever 2: **35 → 33** `ios-dev` skills (two merges). The value is
in Lever 1's per-skill slimming, not the count.

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

### Worked example B — the favicon MERGE (Lever 2)

Before: two skills.
```
site-og-favicon-verify/SKILL.md              (55 lines — checklist)
pillow-favicon-set-no-rasterizer/SKILL.md    (110 lines — how to raster w/o rsvg)
```
After: one skill, pillow demoted to a reference.
```
site-metadata-unfurl-favicon/
  SKILL.md            # og/CSP/favicon checklist (from og-verify) + a short
                      #  "no rasterizer? see references/…" pointer
  references/
    generate-favicon-no-rasterizer.md   # all of pillow's Pillow-based recipe
```
**Merged `description` MUST retain both trigger surfaces** — og-verify's
("link unfurl shows no image / stretched / generic card; favicon missing;
fonts blocked by CSP") *and* pillow's specific tooling symptom
(`"rsvg-convert: command not found"`, `"convert: command not found"`,
`"No module named 'cairosvg'"`). If the merged description can't hold both
without becoming a grab-bag, **abort the merge and keep them separate** — the
eval gate (below) decides.

---

## Guardrails (every phase)

1. **Trigger-accuracy eval gate.** Any skill whose `description` is merged or
   rewritten runs a before/after trigger eval via the repo's `skill-creator`
   (its eval/variance benchmarking). **Merge only ships if trigger accuracy
   does not regress.** This is how "likelier to trigger" becomes measurable
   instead of asserted.
2. **Description byte-identical under pure delegation.** Lever 1 must not touch
   frontmatter. Diff-check `description` unchanged.
3. **Cross-reference sweep.** Renames/merges break `## Related skills` links and
   in-body "see X" refs across the plugin — grep-sweep and fix in the same
   commit.
4. **Atomic inventory-count sweep.** Combining changes counts in
   `docs/skills-catalog.md`, `docs/architecture.*`, `docs/catalog.html`,
   `site/*`, plugin `README`s, and `.claude-plugin/marketplace.json` /
   `plugin.json`. One scripted sweep, never hand-edit each site (per AGENTS.md).
5. **CI is the gate.** `test.yml` asserts every skill dir has `SKILL.md` and
   runs shellcheck/bats/pytest across macOS+Ubuntu. Green before merge.
6. **Do-not-touch:** the 5 command/driver skills' structure; the MainActor
   runtime family's separateness.

---

## Phased execution (with tier / effort per AGENTS.md)

| Phase | Work | Mode / tier / effort |
|---|---|---|
| **0 — Baseline & lock clusters** | Run `skill-creator` eval on the merge candidates + 3 fattest skills to get a trigger-accuracy baseline; lock the cluster table | Solo orchestrator, **planner (Fable), high** |
| **1 — Reference delegation (LOAD-BEARING)** | Delegate code out of the ~12 fat lesson skills into `references/`. Per-skill, independent → fan out with the `parallel-ios-agent-fixes-single-sim` discipline (isolated worktrees). Verify: description byte-identical, body shrinks, refs resolve, CI green | Workflow, **executor (Sonnet), medium** |
| **2 — The two merges + eval gate** | Merge favicon pair and swift6-compile pair; rewrite merged descriptions; run before/after eval; abort any merge that regresses. Cross-ref sweep | Workflow, judging at **planner (Fable), high**; edits **executor, medium** |
| **3 — Inventory & cross-ref sweep** | Atomic count sweep across catalog/architecture/site/manifests; fix all broken `## Related` links; CI green | Single agent, **chore (Haiku), low** |
| **4 — Description tightening (eval-driven)** | Only skills the Phase-0 eval flags as weak triggers get description edits; re-eval | Single agent, **executor, medium** |

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
- **Does not start the refactor.** Awaiting approval on the cluster table and
  phase plan before any skill is edited.
