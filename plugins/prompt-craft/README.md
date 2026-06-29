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
| `/prompt-craft:refresh` | skill | Re-scan skills and rebuild `~/.claude/prompt-craft/registry.json` + `profile.json` on demand. |
| `suggest_next.sh` | Stop hook | After a turn, suggests follow-up commands from git state (dirty → `/commit`/`/code-review`; unpushed → `/pr`). Routed through the advisor. Silent when nothing applies. |
| `prompt_hint.sh` | UserPromptSubmit hook | Before each prompt, surfaces the most relevant command suggestion as a user-only `systemMessage` banner. Never feeds the model. |
| `registry_freshness.sh` | SessionStart hook | On session start, rebuilds the registry when stale (repo change, scan-signature change, or Claude version change). |
| `statusline_hint.sh` | statusLine command | Provides a statusline segment (`💡 next: /x`) appended to your existing statusline. Chains to the recorded base command; capped at 140 chars. |
| `block_secrets.sh` | PreToolUse hook | **Opt-in.** Blocks Read/Edit/Write of secret-looking files (`.env`, `*.pem`, `id_rsa`, …). |
| `format_on_edit.sh` | PostToolUse hook | **Opt-in.** Formats the edited file with whatever formatter is installed (black/prettier/gofmt/rustfmt/shfmt). |

## Command advisor

The advisor layer watches which skills are installed, learns which commands you
use most, and surfaces the most relevant next step — before each prompt, after
each turn, and in the statusline — without ever feeding suggestions into the
model context.

### How it works

1. **Registry** (`~/.claude/prompt-craft/registry.json`, `0600`, `0700` dir) —
   built automatically on session start by `registry_freshness.sh`. Scans repo
   and global skill directories, merges a hand-curated `registry-notes.toml`
   overlay, and writes an atomic, signature-stamped JSON file. Nothing enters
   the registry from repos checked into version control; the file lives only in
   `~/.claude/`.

2. **History profile** (`~/.claude/prompt-craft/profile.json`) — learned from
   `~/.claude/history.jsonl`. Only the leading command token of
   each `/slash-command` turn is recorded (never prompt text). Cap of 5000
   entries. Opt out by setting:

   ```sh
   export CLAUDE_CODE_SKIP_PROMPT_HISTORY=1
   ```

3. **Advisor** (`scripts/advisor.py`) — combines relevance (keyword overlap),
   frequency (your history), and context fitness (git state) to rank commands.
   Outputs at most 3 recommendations per call. Degrades to empty if artifacts
   are missing — never raises.

### User-visible surfaces

All surfaces are **user-only** (`systemMessage` / statusline). Advisor output
never reaches the model as `additionalContext` or stdout.

| Surface | Hook | When |
| --- | --- | --- |
| Banner before prompt | `prompt_hint.sh` (UserPromptSubmit) | Shown to user as a system message before each turn. Silent on no match. |
| Banner after turn | `suggest_next.sh` (Stop) | Shown after a turn completes; biased toward git-state commands. Silent on no match. |
| Statusline segment | `statusline_hint.sh` | Live `💡 next: /x` appended to your statusline; capped at 140 chars. |

### Refreshing the registry on demand

```
/prompt-craft:refresh
```

Rebuilds `registry.json` and `profile.json` immediately. Use after installing
new skills or plugins.

### Wiring the statusline

The statusline segment requires one-time wiring. The convenient entry point is
the `/prompt-craft:refresh` skill, which runs the same wiring commands below.
For direct use:

```sh
python3 plugins/prompt-craft/scripts/wire_statusline.py --wire
```

This atomically updates `~/.claude/settings.json`, backs up the prior file to
`~/.claude/settings.json.bak.<ts>` (mode `0600`), and records your original
`statusLine.command` in a sidecar so it can be chained and restored.

To remove:

```sh
python3 plugins/prompt-craft/scripts/wire_statusline.py --unwire
```

Manual recovery if needed:

```sh
cp ~/.claude/settings.json.bak.<ts> ~/.claude/settings.json
```

Both operations are idempotent and abort without writing if `settings.json`
is unparseable.

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
