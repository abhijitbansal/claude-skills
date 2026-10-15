# Install targets vs host docs (accessed 2026-10-15)

Audit of `bin/install.mjs` HOSTS against each host's official docs. Result: all targets match; no code change.

## Codex
- URL: https://developers.openai.com/codex/skills.md (308 -> https://learn.chatgpt.com/docs/build-skills.md)
- "Codex scans `.agents/skills` in every directory from your current working directory up to the repository root."
- User: `$HOME/.agents/skills` ("Any skills checked into the user's personal folder.")
- Invoke: "In Codex CLI or the IDE extension, run `/skills` or type `$` to mention a skill."
- Code: user+project `.agents/skills`, invoke `$name`. MATCH.

## Copilot CLI
- URL: https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills
- Project: "create a `.github/skills`, `.claude/skills`, or `.agents/skills` directory in your repository."
- Personal: "create a `~/.copilot/skills` or `~/.agents/skills` directory in your local home directory."
- Invoke: "include the skill name in your prompt, preceded by a forward slash."
- Code: user `.copilot/skills`, project `.github/skills`, invoke `/name`. MATCH.

## Gemini CLI
- URL: https://geminicli.com/docs/cli/creating-skills.md
- "User Skills: `~/.gemini/skills/` or the `~/.agents/skills/` alias." / "Workspace Skills: `.gemini/skills/` or the `.agents/skills/` alias."
- Skills are model-activated by description (user approves); no documented `/name` for skills themselves.
- Commands URL: https://geminicli.com/docs/cli/custom-commands.md
- "Located in `~/.gemini/commands/`." / "Located in `<your-project-root>/.gemini/commands/`."; required TOML field `prompt`.
- Code: skills `.gemini/skills` both scopes, TOML commands in `.gemini/commands`, invoke `/name` (via the generated command). MATCH. Note: the creating-skills page does not mention `.gemini/commands`; that path is confirmed by the custom-commands page only.

## agents (generic)
- `.agents/skills` is the shared alias documented by Codex, Copilot and Gemini above. MATCH.

## Claude Code
- Not re-fetched (own product, `.claude/skills`, `/name`); Copilot docs above also list `.claude/skills`. Unverified this run.
