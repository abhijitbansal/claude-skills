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
- "Located in `~/.gemini/commands/`." / "Located in `<your-project-root>/.gemini/commands/`."; required TOML field `prompt` ("The prompt that will be sent to the Gemini model when the command is executed.").
- Optional: "`description` (String): A brief, one-line description of what the command does."
- Args: "If your `prompt` contains the special placeholder `{{args}}`, the CLI will replace that placeholder" (with what the user typed after the command).
- Code: skills `.gemini/skills` both scopes, TOML commands in `.gemini/commands`, invoke `/name` (via the generated command). MATCH. Note: the creating-skills page does not mention `.gemini/commands`; that path is confirmed by the custom-commands page only.

## agents (generic)
- `.agents/skills` is the shared alias documented by Codex, Copilot and Gemini above. MATCH.

## Claude Code
- URL: https://code.claude.com/docs/en/skills (verified 2026-10-15)
- Personal: "`~/.claude/skills/<skill-name>/SKILL.md`" (all projects on this machine). Project: "`.claude/skills/<skill-name>/SKILL.md`".
- Invoke: "Claude uses skills when relevant, or you can invoke one directly with `/skill-name`."
- Code: user+project `.claude/skills`, invoke `/name`. MATCH.
