---
name: ondevice-model-eval-harness-kill-criteria
description: Picking an on-device/edge AI model by vendor or paper benchmarks is unreliable — published latency/quality numbers are vendor or blog claims, not measurements on your target hardware and data — and committing straight to integration engineering (runtime loader, container/asset delivery, UI wiring) on a paper-picked model risks discovering late that it underperforms, or is simply unusable for reasons unrelated to model quality (a broken inference library, an unloadable quantization, an incompatible processor). Use when adding an on-device or edge-deployed AI/ML model (VLM, speech, embedding, classifier) where multiple candidate models exist and integration cost is nontrivial — run the eval harness as its own gated phase before writing any integration code.
---

# On-Device AI Model Selection: Empirical Offline Eval Harness With Pre-Committed Kill Criteria

## Symptom

A model is picked by paper benchmarks or vendor claims, integration
engineering begins (runtime loader, container/asset delivery, UI wiring —
multi-phase, expensive work), and only late in the process does it become
clear the model underperforms on real data, or simply doesn't work for
reasons that have nothing to do with model quality — a broken inference
library, an unloadable quantization, an incompatible processor. Sunk cost by
that point makes it hard to cut losses on a "pretty good" candidate.

## Root cause

Published latency/quality numbers for on-device/edge models are vendor or
blog claims, not measurements on your target hardware and data distribution
— there is typically no published benchmark for your specific task (e.g.
household-object naming). Without a dedicated, gated evaluation phase run
*before* integration, model selection either never gets re-measured against
reality, or gets re-measured only after expensive integration work has
already been sunk into one candidate — at which point sunk-cost pressure
biases the decision toward keeping the already-integrated model rather than
the actually-best one.

## Solution

Gate all integration engineering behind a standalone offline evaluation
phase (Cubby called it M0):

1. **Curate a small ground-truth set representative of real usage** plus an
   existing baseline to beat (Cubby: 31 curated images with ground-truth
   names, later scaled to 50-100; baseline = macOS Vision framework's
   closed-set classifier).
2. **Pre-commit kill criteria before running the harness, not after seeing
   results** (Cubby: "no candidate clearly beats Vision on ≥60% of eval
   photos → stop the feature"). Locking the bar first blocks motivated
   reasoning / sunk-cost creep once time has already gone into a "pretty
   good" candidate.
3. **Score every candidate on the same three axes**: hit-rate/quality
   (blind-scored against the baseline, not self-graded by the model),
   latency (tokens/s or seconds/image on real hardware), and peak memory
   (RSS) — never accuracy alone.
4. **Produce a written, committed scorecard artifact** (Cubby:
   `scripts/vlm-eval/results/scorecard.md`), not just a verbal/chat
   decision — makes the choice auditable and the harness reusable for the
   next model generation or a re-eval.
5. **Expect strong-on-paper candidates to be eliminated by broken tooling,
   not model quality** — budget harness time for this. Cubby's M0: Qwen3-VL
   had the better paper numbers but broken Python `mlx-vlm` inference
   (instant-EOS/repetition loop) — eliminated pre-integration and cheaply,
   instead of discovered mid-engine-build. A quantized variant was
   unloadable; another candidate's processor was incompatible. Decision
   recorded explicitly: "Model = Qwen2-VL-2B (working everywhere today) over
   Qwen3-VL (better paper numbers, broken Python inference) — empirical M0
   rule followed."
6. **Re-measure on the actual deployment target, not just the harness
   machine.** Cubby's M0 ran on a Mac (M4 Pro) to pick a model cheaply; the
   next phase (M1) re-measured the M0 winner's p50/p90 latency and memory
   on-device, with its *own* separate pre-committed kill criterion (p90 >
   3s or jetsam on target tier → try the next candidate once, then stop the
   feature). Harness-machine numbers and on-device numbers are not
   interchangeable.

## Evidence

Roadmap doc (2026-07-07): "Selection is empirical, not paper-driven. Nearly
all iPhone latency numbers in this space are vendor or blog claims. Phase M0
builds an offline evaluation harness (real Cubby-style item photos, blind A/B
against the Vision baseline) and picks the model by measured naming quality ×
latency × RSS on target hardware. Kill criteria are pre-committed." / "No
published Vision-vs-small-VLM benchmark for household-object naming exists —
hence M0's harness... every number the plan depends on gets re-measured in
M0/M1." M0 table row: "Offline eval harness (Mac): 50-100 representative item
photos... blind-score naming vs Vision baseline; measure tokens/s + peak RSS
at 4-bit → Written scorecard picks ONE model (or kills the feature if none
beats Vision meaningfully)."

Session 0018: "M0 eval run (`f0c6b34`, `6c3bd8a`): harness + 31-image curated
CC set (ground-truth names) + macOS Vision baseline. Verdict: Qwen2-VL-2B-
Instruct-4bit, 84% hit rate vs baseline 29% (avg 0.74 vs 0.23; 2.6 s/img M4
Pro; 2.1 GB peak). Gemma-4-E2B = documented fallback (55%, 4× faster). Churn
log: Qwen3-VL broken in Python mlx-vlm (instant-EOS/repetition — stays a
Swift-side candidate), OptiQ quant unloadable, SmolVLM processor
incompatible; mlx-vlm pinned to git rev in pyproject." Decision log: "Model =
Qwen2-VL-2B (working everywhere today) over Qwen3-VL (better paper numbers,
broken Python inference) — empirical M0 rule followed; Qwen3-VL re-eval noted
for the M1 device spike."

## When to Use

Any app or service adding an on-device or edge-deployed AI/ML model (VLM,
speech, embedding, classifier) where multiple candidate models exist and
integration cost (runtime engine, delivery mechanism, UI) is nontrivial. Run
the eval harness as its own gated phase *before* writing integration code —
treat it as a go/no-go and model-picking gate, not a post-hoc justification
step for a model already chosen. Generalizes beyond iOS/MLX to any
edge/on-device model-selection decision (Android, embedded, browser-side WASM
models).

## Related skills

Distinct from — and upstream of — the implementation-phase skills from the
same Cubby VLM wave: once this skill's eval harness picks a model,
`ml-actor-lazy-load-graded-eviction` (runtime loading/eviction),
`background-assets-manifest-drift-blind-redownload` (shipping the winner's
weights), and `async-enrichment-silent-loss-outcome-states` (surfacing its
results) take over. Also related to the existing on-device-AI family:
`ondevice-generable-anti-hallucination` and `vision-layout-ocr-grounding` are
integration-time lessons for an already-chosen model; this skill is the
selection-methodology step upstream of both — cross-link, don't merge.
