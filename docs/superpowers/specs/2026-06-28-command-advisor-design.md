# prompt-craft: command-advisor layer

**Date:** 2026-06-28
**Status:** Design approved + adversarially hardened (5-critic review applied) — awaiting
spec-review gate → implementation plan.
**Builds on:** [intent-router RFC v2](2026-06-28-intent-router-design.md) — this is the
deferred `intent-router` component (C), **reframed** per the spike result and three new asks.
**Epic:** ABH-43 · advisor reframe of ABH-45/ABH-46.

## Why this exists (and why it is NOT a router)

The intent-router RFC built a measurement spike to decide whether a keyword router earns
its keep. The spike has been run:

```
catalog: 31 commands | prompts: 40
keyword (name-only) accuracy:      50%
description (native proxy) accuracy: 70%
GATE: DO NOT build the router
```

Claude Code's **native description-based auto-invocation beats a keyword scorer** (70% vs
50%). A hook that injects "use /x" into the *model's* context per turn would add a
maintained subsystem that performs *worse* than the free platform baseline. The
router-as-the-RFC-framed-it is dead.

But the user's request is **not** a router. Native routing helps *the model* pick a skill.
It does nothing to:

1. **Teach the user** which canonical command exists and when (discovery).
2. **Personalize** to the user's actual habits (the model's routing is generic).
3. **Hand off** a vague ask to the *real* canonical command instead of a reinvented one.

Those are the value props the platform does not cover. This feature delivers them as a
**user-facing command advisor**, not a model-facing router: surfaced to the user's eyes
(prompt-time banner + statusline + post-turn banner), learned from the user's own history,
ranked so canonical commands win over prompt-craft's own — and it makes the hand-off real
by stopping the model from auto-invoking the reinvented skills.

Load-bearing principle: **advise the human, do not re-route the model.**

## Decisions (locked with the user)

| Question | Decision |
| --- | --- |
| Value target | **User-facing advisor.** No injection into the model's context, ever. |
| Existing skills | **Keep all + add layer**, AND set `disable-model-invocation` on the prompt-craft skills that have a canonical equivalent (`plan`, `review`) so the model auto-routes to the canonical command. The prompt-craft skills stay user-invocable (`/prompt-craft:plan`). |
| Prompt-time surface | **Add a `UserPromptSubmit` hook** that emits a user-visible `systemMessage` with prompt-specific recommendations (gated to confident matches, silent otherwise). This serves the headline ask "when you write a prompt, add the right commands" — to the user, not the model. |
| CLI surfacing | **Three user-visible channels:** `UserPromptSubmit` banner (prompt-time), composed statusline segment (persistent), `Stop` banner (post-turn). |
| Learn & refresh | **Manual `/prompt-craft:refresh` + SessionStart rebuild-when-stale.** Scopes: repo-local AND machine-global commands, indexed into **one** registry artifact. |

## Verified mechanics (claude-code-guide vs live docs, 2026-06-28; corrected by review)

| Channel | User-visible? | Model? | Use |
| --- | --- | --- | --- |
| `statusLine` (settings.json) | ✅ | ❌ | Persistent next-command hint segment. Single command only; per-message + ~300ms timer. |
| Hook `systemMessage` (**top-level** key) | ✅ | ❌ | Prompt-time banner (`UserPromptSubmit`) + post-turn banner (`Stop`). |
| Hook `additionalContext` / stdout | ❌ | ✅ | **Forbidden for advisor output** (would feed the model). |
| Suggestion chips / input-box injection | — | — | **No API exists.** |

Corrected load-bearing facts (review findings):

- **Plugin cache layout is `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/…`** —
  NOT `…/<name>@<marketplace>/…`. The `name@marketplace` form is only a *key* in
  settings.json `enabledPlugins`, never an on-disk path. The global scan resolves real paths
  via `enabledPlugins` / `installed_plugins.json`, then globs `<marketplace>/<plugin>/*/` for
  the newest version dir. Transient `cache/temp_git_*` dirs are skipped.
- **Plugins cannot set the main `statusLine`.** Composition requires an explicit, confirmed,
  reversible edit to `~/.claude/settings.json`, performed only by `/prompt-craft:refresh
  --wire-statusline`. To survive plugin updates, settings.json points at a **stable shim**
  (`~/.claude/prompt-craft/statusline.sh`) that resolves the current plugin version at
  runtime — never at a version-pinned cache path.
- **`systemMessage` is a TOP-LEVEL key** in hook stdout JSON (`{"systemMessage": "…"}`),
  NOT nested under `hookSpecificOutput` (where the current `suggest_next.sh` puts
  `additionalContext`).
- **Learning source is `~/.claude/history.jsonl`**, verified schema
  `{display, pastedContents, project, sessionId, timestamp}` — one input per line. Only the
  **leading token of `display`** is read; `pastedContents` (may hold pasted secrets) is never
  read. Transcript JSONL is internal/unstable — not used.
- **Freshness** = content signature of scanned command files (count + max mtime per scope) +
  `claude --version` (graceful fallback if `claude` is off PATH) + repo-root change, all
  compared against the values stored in `registry.json`. No separate stamp file.

## Architecture

```
plugins/prompt-craft/
├── .claude-plugin/plugin.json          # bump version
├── scripts/
│   ├── build_registry.py               # scan repo + global scopes → ONE registry.json
│   ├── learn_history.py                # mine history.jsonl → profile.json
│   └── advisor.py                      # CLI: --mode={prompt|statusline|stop} → recs (the seam)
├── registry-notes.toml                 # SMALL overlay: [builtins] + prefer_over pairs only
├── hooks/
│   ├── hooks.json                      # + UserPromptSubmit(prompt_hint) + SessionStart(freshness)
│   ├── prompt_hint.sh                  # NEW: UserPromptSubmit → systemMessage (prompt-specific)
│   ├── suggest_next.sh                 # EXTEND: Stop → systemMessage (top-level), advisor-driven
│   ├── statusline_hint.sh             # NEW: hint segment, chains to base statusline (sidecar)
│   └── registry_freshness.sh           # NEW: SessionStart rebuild-when-stale
└── skills/
    ├── refresh/SKILL.md                # NEW: /prompt-craft:refresh (+ --wire/--unwire-statusline)
    ├── plan/SKILL.md                   # + disable-model-invocation: true  (defers to canonical)
    ├── review/SKILL.md                 # + disable-model-invocation: true  (defers to canonical)
    └── improve-prompt/SKILL.md         # WIRE block-5 recommendations → advisor.py --mode=prompt

# Single machine-global artifact set (NOTHING written into user repos):
~/.claude/prompt-craft/registry.json       # all commands, each scope-tagged repo|global
~/.claude/prompt-craft/profile.json        # learned usage (0600; dir 0700)
~/.claude/prompt-craft/statusline.sh       # stable shim (installed by --wire-statusline)
~/.claude/prompt-craft/base-statusline     # the prior statusLine command string (sidecar)
```

**Storage rule (corrected — YAGNI):** there is exactly **one** registry artifact, at
`~/.claude/prompt-craft/registry.json`. It indexes **both** scopes — repo commands
(`./plugins/*`, project `.claude/`) carry `scope:"repo"`, everything else `scope:"global"`.
It records the `repo_root` it was built for. No second `.prompt-craft/` file in the user's
repo (so nothing can be accidentally committed and there is no query-time merge layer).
Switching repos is handled by the freshness check (repo-root change → rebuild repo scope).

## Components

### A. `build_registry.py` (stdlib) → one `registry.json`

Scans two scopes, parses frontmatter, merges the small overlay, emits one artifact.

- **Repo scope** (`scope:"repo"`): `./plugins/*/{skills/*/SKILL.md,commands/*.md,agents/*.md}`,
  project `.claude/{skills,commands}`.
- **Global scope** (`scope:"global"`): `~/.claude/{skills,commands}`; for each plugin in
  `enabledPlugins` (settings.json) resolve `~/.claude/plugins/cache/<marketplace>/<plugin>/`,
  pick the **newest version dir**, scan `{skills,commands,agents}`; skip `temp_git_*` and
  non-plugin dirs. Plus a `[builtins]` set from the overlay (built-ins are not on disk).
- **Frontmatter parse:** promote `route_spike.py`'s `_frontmatter()` to a shared helper and
  reuse it. Extract `name`, `description`; infer `keywords` from name+description tokens.
- **Overlay merge** (`registry-notes.toml`, deliberately small): `[builtins]` declarations
  and `prefer_over` deferral pairs. `why`/`when` come from the command's own `description`
  for the long tail; the overlay only *overrides* where a description is inadequate. (Honest
  scope: "where to use" quality scales with curation — full per-command curation of a
  hundreds-strong fleet is explicitly NOT attempted.)
- **Schema:**
  ```json
  {"built_at":"<iso>", "claude_version":"x.y.z|null", "repo_root":"<abs|null>",
   "scan_signature": {"repo": {"count":N,"max_mtime":M}, "global": {"count":N,"max_mtime":M}},
   "commands": [{"name":"/ecc:plan","kind":"skill|command|agent|builtin","source":"ecc",
     "scope":"repo|global","description":"…","why":"…","when":"…",
     "keywords":["plan"],"canonical":true,"prefer_over":[]}]}
  ```
- **Robustness:** malformed single SKILL.md → skip with stderr warning (not fatal); missing
  global dirs → skip silently; dedup by qualified name; drop stale entries each rebuild.
- **Atomic write:** serialize to a temp file in `~/.claude/prompt-craft/`, `fsync`,
  `os.replace()` onto `registry.json` (readers never see a torn file). Stable sort by name →
  idempotent output modulo `built_at`.

### B. `learn_history.py` (stdlib) → `profile.json`

- **Opt-out first:** if `CLAUDE_CODE_SKIP_PROMPT_HISTORY` is truthy, write an **empty
  profile and return WITHOUT reading `history.jsonl`** — regardless of whether the file
  exists. (Do not infer opt-out from file-absence.) *(Implementation note: verify the exact
  env-var name against current Claude Code docs before coding; a wrong name silently disables
  the opt-out.)*
- Read `~/.claude/history.jsonl`, most-recent `HISTORY_MAX_ENTRIES = 5000` lines. For each
  line read **only** `display`; the command token is `display.split()[0]` when it starts with
  `/`. **Never** read `pastedContents` or other fields.
- Aggregate **only** `by_command`: `{name: {count, last_ts}}`. (Dropped per review:
  `by_project`, `sequences` — no consumer in v1; `never_used` is derived at query time in the
  advisor as `registry_names ∖ by_command`.)
- **Schema:** `{"learned_at":"<iso>", "by_command": {"/x": {"count":N,"last_ts":"<iso>"}}}`.
- **Privacy/permissions:** write only under `~/.claude/prompt-craft/`; create the directory
  `0700` and `profile.json` `0600`; atomic write (temp + `os.replace`); never written into a
  repo. Malformed lines skipped; missing history → empty profile + warning.

### C. `advisor.py` (stdlib) — the brains AND the integration seam

**CLI contract** (this is what the bash hooks and the markdown skill call — none can import
Python):

```
python3 advisor.py --mode={prompt|statusline|stop}  < context.json
```

- `context.json` (built by each caller): `{ "prompt": "<text|null>", "git_state":
  {"dirty":bool,"unpushed":int}, "cwd":"<abs>" }`. (`todo_state` and `last_command` dropped —
  no verified input source.)
- **Output by mode:**
  - `--mode=prompt` → the `systemMessage` banner string for `UserPromptSubmit`, or empty (no
    output, exit 0) when nothing confidently matches.
  - `--mode=statusline` → a single hint segment string (e.g. `next: /commit`), or empty.
  - `--mode=stop` → the `systemMessage` banner string for `Stop`, or empty.
  - (`/improve-prompt` calls `--mode=prompt` and renders the same recs in its block 5.)
- **Scoring — collapsed to 3 deterministic signals** (no 6-weight blend):
  1. **Relevance** — token overlap of the prompt against each command's **`description`**
     (the 70% proxy, the spike's stronger signal), not name/keywords alone. Drives the
     `prompt` mode. Only used when a prompt is present.
  2. **Frequency tiebreak** — `by_command[name].count` breaks ties / nudges ranking. So a
     marginal prompt match cannot outrank a command the user actually relies on.
  3. **Context fit** — explicit git-state rule table, drives the no-prompt
     (`statusline`/`stop`) modes: `dirty → /commit` (and `/prompt-craft:review` to check the
     diff first); `clean & unpushed>0 → /pr`. Ground truth, already proven in `suggest_next.sh`.
- **Canonical hand-off — ONE deterministic rule** (not weights): if a matched command is a
  prompt-craft skill whose `prefer_over` lists a canonical command **that is present in the
  registry**, surface the canonical in its place (and skip the prompt-craft one). If the
  prefer_over target is absent, do NOT demote — surface the prompt-craft command normally.
  The advisor builds the reverse map `canonical → {own commands deferring to it}` to gate this
  and to assemble the why-string (`"/ecc:plan — fits 'decompose'; /prompt-craft:plan defers
  here; you've used it 8×"`).
- **Discovery — deterministic** (no randomness): only when fewer than K real matches clear the
  relevance threshold, fill the remaining top-K slots with `never_used` **canonical** commands,
  ordered canonical-first then by name.
- **Rec object schema:** `{name, kind, scope, score, why}`. Top-K (K=3) default.
- **Degrade, never crash:** if `registry.json` / `profile.json` are missing or unparseable,
  emit empty output and exit 0 (the hot paths must never error). Only the *writers*
  (build_registry/learn_history) fail loud on a corrupt artifact they produced.
- **Data-safety:** all registry/profile/history-derived strings are DATA. The Python side
  emits them as plain strings; the bash callers render them only via `printf '%s'` — never as
  a format string, never through `eval`/unquoted expansion.

### D. `/prompt-craft:refresh` skill + `registry_freshness.sh`

- **`/prompt-craft:refresh`** (`user-invocable`): runs `build_registry.py` (both scopes) +
  `learn_history.py`; prints a summary (N commands across M plugins; top personalized recs;
  newly discovered commands since last build). Flags: `--wire-statusline` / `--unwire-statusline`
  (section E). Naming: prompt-craft's own commands are always `/prompt-craft:<name>`; bare
  forms (`/commit`, `/pr`, `/goal`, `/ecc:plan`, `/code-review`) denote external/canonical.
- **`registry_freshness.sh`** (`SessionStart`): rebuild when ANY of —
  `registry.json` missing; current repo root ≠ `registry.repo_root`; a scope's current content
  signature (count + max mtime over scanned command files, `temp_git_*` excluded) differs from
  `registry.scan_signature`; `claude --version` ≠ `registry.claude_version` (if `claude` is not
  on PATH, **skip the version dimension** — never force a rebuild and never error). Else no-op.
  Always `exit 0`.

### E. Surfacing (three user-visible channels)

- **`prompt_hint.sh`** (NEW, `UserPromptSubmit`): reads the hook stdin JSON (the typed prompt
  + cwd), builds `context.json`, calls `advisor.py --mode=prompt`. If non-empty, prints
  **top-level** `{"systemMessage": "<banner>"}` (user-visible, model context untouched);
  else `exit 0` silent. Gated to confident matches.
- **`suggest_next.sh`** (EXTEND): keep the git-state heuristics; route through
  `advisor.py --mode=stop`. Emit **top-level** `{"systemMessage": "<banner>"}` — NOT
  `additionalContext`, NOT nested under `hookSpecificOutput`. Silent when nothing fits.
  **Invariant:** no advisor/history-derived content is ever emitted via `additionalContext`
  or stdout-to-model. (Bats asserts the emitted JSON has top-level `systemMessage` and no
  `additionalContext`.)
- **`statusline_hint.sh`** (NEW) + the stable shim:
  - The shim `~/.claude/prompt-craft/statusline.sh` (installed by `--wire-statusline`)
    resolves the current installed plugin version and runs the real
    `hooks/statusline_hint.sh`. settings.json points at the **shim**, so plugin updates don't
    dangle the path.
  - `statusline_hint.sh`: **capture stdin once** (`INPUT=$(cat)`); read the base command from
    the sidecar `~/.claude/prompt-craft/base-statusline`; run it with a copy of the input
    (`base=$(printf '%s' "$INPUT" | bash -c "$BASE_CMD" 2>/dev/null)`) — **not** `exec`, since
    the base is a shell-string and we must append after it. Compute the hint in a **single**
    `python3` call (advisor `--mode=statusline`) from the same buffered input + git state.
    Print `"$base | 💡 $hint"`, handling empty `$base` the way `statusline.sh` handles empty
    segments. **Strip ANSI** from `$base` before width-measuring and append a `\033[0m` reset
    after truncation so a sliced escape can't strand the terminal color. Reuse the 140-col cap.
  - **Self-reference guard:** `--wire-statusline` refuses to capture a base command whose
    resolved path is `statusline_hint.sh`/the shim (compare resolved paths, not substrings);
    `statusline_hint.sh` aborts the chain (hint-only) if the base resolves to itself —
    preventing recursive exec on every tick.
- **Wiring** (`/prompt-craft:refresh --wire-statusline`): read `~/.claude/settings.json`; if
  `statusLine.command` already points at the shim → idempotent no-op. Else: **(1)** abort with
  a message if settings.json is unparseable (never write); **(2)** record the prior
  `statusLine.command` to the sidecar `base-statusline`; **(3)** install the shim; **(4)**
  timestamped backup `settings.json.bak.<ts>` created `0600` *before* the write and verified
  readable; **(5)** **atomic write** — serialize to a temp file in `~/.claude/`, `fsync`,
  `os.replace()` onto `settings.json` (never truncate-in-place; a torn write would corrupt
  the user's whole global config: permissions, env, hooks, model); **(6)** show before/after
  and require confirmation. `--unwire-statusline` restores `statusLine.command` from the
  sidecar/backup (atomic) and removes the shim. Manual recovery (`cp settings.json.bak.<ts>
  settings.json`) is documented in the skill + README. Backups: keep the latest few; `--unwire`
  removes the backup it created on success.

### F. `/improve-prompt` wiring

Block 5 ("Recommended commands") calls `advisor.py --mode=prompt` (via the CLI, not a Python
import) so its recommendations are real, ranked, canonical-first, and personalized. Behavior
otherwise unchanged. Note the relevance signal carries the spike's known weakness (single-
prompt overlap is noisy); the description-based relevance + frequency tiebreak mitigate it.

### G. Real hand-off — `disable-model-invocation` on dupes

Native auto-invocation would otherwise pick prompt-craft's reinvented skills directly,
bypassing the advisor entirely. So set `disable-model-invocation: true` on the prompt-craft
skills that have a canonical equivalent **always present**:

- `plan` — canonical: plan mode + `/goal` (built-ins, always available) and `/ecc:plan`.
- `review` — canonical: `/code-review` (built-in) and ecc `*-reviewer` agents.

These stay **user-invocable** (`/prompt-craft:plan`, `/prompt-craft:review`) — keep-all is
honored — but the model auto-routes to the canonical command. `improve-prompt` (unique, no
equivalent) and the `debug`/`refactor` lenses (no single always-present canonical command)
keep auto-invocation. Because the canonical fallback for `plan`/`review` is a built-in, this
is safe even when ecc is not installed.

## Data flow

```
SessionStart ─→ registry_freshness.sh ─(stale?)→ build_registry.py + learn_history.py
                                                   │            │
                                          registry.json    profile.json   (~/.claude/prompt-craft/, atomic, 0600)
prompt typed ─→ prompt_hint.sh ─→ advisor.py --mode=prompt ─→ {"systemMessage": …} to USER  (model untouched)
              └ /improve-prompt ─→ advisor.py --mode=prompt ─→ recs in block 5
statusline tick ─→ shim → statusline_hint.sh ─→ advisor.py --mode=statusline + base (sidecar) ─→ "<base> | 💡 next: /x"
turn ends ─→ suggest_next.sh ─→ advisor.py --mode=stop ─→ {"systemMessage": …} to USER
/refresh ─→ build + learn (+ optional --wire-statusline → atomic settings.json edit, backed up)
```

## Error handling

- All hooks `exit 0` on any error — an advisor fault must never block a prompt, turn, or
  statusline render. Parse stdin JSON defensively via `/usr/bin/python3` (the `statusline.sh`
  pattern).
- **Atomic writes everywhere** (registry.json, profile.json, settings.json): temp file in the
  same dir → `fsync` → `os.replace()`. Readers in hot paths treat any missing/torn/unparseable
  artifact as "degrade" (empty hint / base-only statusline); only the *writer* fails loud on a
  corrupt artifact it produced.
- `settings.json` rewire: abort (no write) if unparseable; backup before write, verified
  readable; idempotent; reversible; manual recovery documented.

## Security & privacy

- **Advisor output is user-only.** Every surface uses `systemMessage` or the statusline;
  `additionalContext`/stdout-to-model is forbidden for advisor/history-derived content (bats-
  enforced). This keeps cross-project habits out of the model context, transcripts, and
  Anthropic.
- **History read is minimal + opt-out-honoring.** Only the leading token of `display`;
  `pastedContents` (possible pasted secrets) never read; `CLAUDE_CODE_SKIP_PROMPT_HISTORY`
  checked explicitly (empty profile, no read).
- **Untrusted data is never code.** History tokens and third-party plugin descriptions flow
  to bash only as data: rendered via `printf '%s'`, no `eval`, no unquoted expansion; the base
  statusline command is run as a single controlled string, never concatenated with advisor
  data before execution; self-reference guarded against recursive exec.
- **No artifact in user repos.** Everything lives under `~/.claude/prompt-craft/`
  (`profile.json` `0600`, dir `0700`). Nothing to gitignore, nothing to accidentally commit.
- **settings.json edit** is the one mutating action: atomic, backed up (`0600`), confirmed,
  reversible. Backups can contain the `env` block — created `0600`, retention-bounded.

## Testing

- **pytest:**
  - `build_registry`: both scopes via tmp fixtures incl. a **3-level
    `marketplace/plugin/version`** cache fixture (regression for the corrected glob); newest-
    version pick; `temp_git_*` skipped; stale-entry drop; malformed-SKILL.md skip; overlay
    `[builtins]` + `prefer_over` merge; atomic-write leaves a valid file.
  - `learn_history`: frequency from a fixture `history.jsonl`; **present-but-nonempty history
    yields empty profile when the opt-out var is set**; `pastedContents` never read; cap
    honored; `0600`/`0700` perms.
  - `advisor`: description-based relevance; frequency tiebreak (a relied-on command outranks a
    marginal prompt match); context-fit table (dirty→/commit); **canonical override** (present
    prefer_over → canonical replaces the own command); **prefer_over-absent → no demotion**;
    deterministic discovery fills thin slots; rec schema; degrade-on-missing-artifact (empty,
    exit 0); each `--mode` output shape.
- **bats** (reuse `tests/bats/helpers.bash` mock-PATH + `MOCK_CALL_LOG`):
  - `prompt_hint.sh`: top-level `systemMessage` on a confident match; silent on none; exit 0;
    **no `additionalContext`**.
  - `suggest_next.sh`: top-level `systemMessage` on match; silent on none; no `additionalContext`.
  - `statusline_hint.sh`: chains to base (base output present); adds segment; **base-missing →
    hint-only**; **self-reference → hint-only** (no recursion); ANSI base → no dangling escape
    after truncation; truncates at cap; never non-zero exit.
  - `registry_freshness.sh`: rebuild on missing/repo-root-change/signature-change/version-change;
    no-op when fresh; `claude` absent → no forced rebuild; exit 0.
  - **`--wire/--unwire-statusline`** (fake `HOME`): backup created (`*.bak.*`, `0600`);
    idempotent no-op when already wired; prior command recorded to sidecar; abort-with-message
    on unparseable settings.json (no write); unwire restores; self-reference refused.
  - **data-safety:** a plugin description / history token containing `$(...)`, `;`, `` ` ``,
    `%s` is printed literally, never executed.
  - **advisor CLI smoke:** `--mode=prompt` returns a banner for a `{prompt}` context (covers
    the `/improve-prompt` path); `/refresh` build+learn+summary runs.
- **CI:** extend `.github/workflows/test.yml`; macOS + Ubuntu green; stdlib only (no new deps).

## Build order (each lands independently, repo stays green)

1. **`build_registry.py` + `registry-notes.toml` (initial `[builtins]`: `/goal`, `/model`,
   `/code-review`, `/clear`, `/compact`, … + the `plan`/`review` `prefer_over` pairs) + pytest**
   — the spine. Promote `_frontmatter()` to a shared helper. Atomic writes.
2. **`learn_history.py` + pytest** (opt-out, minimal-read, perms).
3. **`advisor.py` CLI + pytest** — consumes 1+2; the integration seam.
4. **`/prompt-craft:refresh` + `registry_freshness.sh` + hooks.json SessionStart + tests.**
5. **Surfacing — banners first (cheap, primary):** `prompt_hint.sh` (UserPromptSubmit) +
   `suggest_next.sh` → `systemMessage`; bats incl. data-safety + no-additionalContext.
6. **Statusline (heaviest, last):** stable shim + `statusline_hint.sh` + `--wire/--unwire` +
   bats incl. wire/unwire, self-reference, ANSI.
7. **Hand-off + wiring:** `disable-model-invocation` on `plan`/`review`; wire `/improve-prompt`
   block 5 → `advisor.py`; update README + hand-update `docs/skills-catalog.md`; bump version.

## Out of scope

- Per-turn injection into the **model's** context (spike: loses to native routing).
- MCP server / embedding index (no consumer).
- Auto-rewriting `docs/skills-catalog.md` (registry.json is the machine artifact; the human
  doc stays hand-curated).
- Deleting `/plan` / `/improve-prompt` / lenses (keep-all; hand-off via
  `disable-model-invocation` + advisor, not deletion).
- A second repo-local registry artifact + query-time merge (cut — one scope-tagged file).
- `sequences`/Markov next-command modeling, `by_project`, `todo_state`, a 6-weight scorer
  (cut as speculative — 3 deterministic signals + one hand-off rule).
- Parsing transcript JSONL (unstable internal format; history.jsonl only).
- Cross-repo hosted registry; non-Claude surfaces.

## Open risks

- **Statusline real estate + cost:** the chained line (caveman + branch + skill + todos +
  hint) can overflow narrow panels, and the hot path runs per message + ~300ms timer.
  Mitigation: hint is the last segment and the first dropped at the 140-col cap; one `python3`
  call for parse+hint; degrade to base-only on any failure. Statusline is the heaviest channel
  and ships last — the banners are the primary surface.
- **`history.jsonl` schema** is verified today but undocumented. Mitigation: read only
  `display`'s leading token; empty profile on any surprise; advisor degrades to registry-only.
- **`CLAUDE_CODE_SKIP_PROMPT_HISTORY` exact name** must be confirmed against current docs
  before coding — a wrong name silently disables the opt-out.
- **Built-ins / "where to use" curation** scale only with the small overlay; the long tail
  derives "why" from each command's description. Documented, not hidden.
