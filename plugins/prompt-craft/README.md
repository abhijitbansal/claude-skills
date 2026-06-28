# prompt-craft

Turn rough prompts into deterministic specs and surface the right next step.
Zero config — install it and the skills are available; the guardrail hooks are
**off by default**.

## What's in it

| Piece | Kind | What it does |
| --- | --- | --- |
| `/prompt-craft:improve-prompt` | skill | Rough ask → deterministic spec: restated goal, acceptance criteria, assumptions to confirm, recommended commands. High effort/model. |
| `/prompt-craft:plan` | skill | Decompose a task → goals + per-step acceptance criteria → a TodoWrite plan. |
| `/prompt-craft:debug` | skill (lens) | Reproduce → isolate → one hypothesis → failing test → fix. Auto-invokes on bug reports. |
| `/prompt-craft:refactor` | skill (lens) | Behavior-preserving restructure, guarded by tests green before and after. |
| `/prompt-craft:review` | skill (lens) | Diff/branch review: correctness + security first, then quality, by severity. |
| `suggest_next.sh` | Stop hook | After a turn, suggests follow-up commands from git state (dirty → `/commit`/`/review`; unpushed → `/pr`). Silent when nothing applies. |
| `block_secrets.sh` | PreToolUse hook | **Opt-in.** Blocks Read/Edit/Write of secret-looking files (`.env`, `*.pem`, `id_rsa`, …). |
| `format_on_edit.sh` | PostToolUse hook | **Opt-in.** Formats the edited file with whatever formatter is installed (black/prettier/gofmt/rustfmt/shfmt). |

## Enabling the opt-in guardrails

Both guardrail hooks no-op unless their environment variable is set. Export them
in your shell profile or your project's `.claude/settings.json` `env` block:

```sh
export PROMPT_CRAFT_BLOCK_SECRETS=1    # block reads/edits of secret-looking files
export PROMPT_CRAFT_FORMAT_ON_EDIT=1   # auto-format edited files
```

The Stop-hook suggester (`suggest_next.sh`) is always on and always silent unless
there's a concrete next step; it never blocks.

## Status

Phase 1 of the intent-router epic
([RFC](../../docs/superpowers/specs/2026-06-28-intent-router-design.md)). The
catalog-based router is a **separate, evidence-gated** plugin — see the spec.
