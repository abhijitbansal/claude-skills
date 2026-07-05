# CLAUDE.md — claude-skills

Instructions for Claude when working in this repository, **and** the canonical
source of the behavioral guidelines that `setup/setup.sh` merges into the
`CLAUDE.md` of any machine or repo it runs against.

## Working in this repo

- Plugins live under `plugins/`; the machine bootstrap is `setup/setup.sh`,
  driven by `claude-setup.toml`. Tests are bats under `tests/bats/`.
- Run `bats tests/bats` after touching anything in `setup/`.
- The guideline block below (between the `claude-skills:guidelines` markers) is
  the single source of truth. `setup/merge_guidelines.py` extracts that region
  and additively merges each missing section into other `CLAUDE.md` files —
  edit the guidelines here, nowhere else.
- Site pages (`docs/`, `site/`) that show CLI/plugin commands use **per-line
  copy buttons**: `.code.cmds` wraps one `<div class="cl"><code class="ct">
  cmd</code><button class="copy" data-copy="cmd">copy</button></div>` per
  command — one button per command, never one button spanning several. A
  trailing `# comment` may stay in the visible `<code class="ct">` text for
  readability, but must **never** appear in `data-copy` — strip it. The one
  exception: full multi-line code *samples* (JSON/YAML/Swift snippets, not
  command lists) keep a single copy-all button wrapped in `.code-body`. This
  bit the site twice (PR #13) — a new page missed the per-line conversion,
  and later edits baked comments straight into `data-copy`.

<!-- claude-skills:guidelines:begin -->
Behavioral guidelines to reduce common LLM coding mistakes. Adapted from Andrej
Karpathy's CLAUDE.md (https://github.com/multica-ai/andrej-karpathy-skills).
They bias toward caution over speed; for trivial tasks, use judgment.

## Think before coding

Don't assume. Don't hide confusion. Surface tradeoffs.

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## Simplicity first

Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it. Would a senior
  engineer call this overcomplicated? If yes, simplify.

## Surgical changes

Touch only what you must. Clean up only your own mess.

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken; match existing style even if you'd
  do it differently.
- Remove imports/variables/functions that YOUR changes made unused — but leave
  pre-existing dead code alone (mention it instead of deleting it).
- The test: every changed line should trace directly to the user's request.

## Goal-driven execution

Define success criteria. Loop until verified.

- "Add validation" → write tests for invalid inputs, then make them pass.
- "Fix the bug" → write a test that reproduces it, then make it pass.
- "Refactor X" → ensure tests pass before and after.
- For multi-step tasks, state a brief plan with a verify check per step.
  Strong success criteria let you loop independently; weak ones ("make it
  work") force constant clarification.

<!-- claude-skills:guidelines:end -->
