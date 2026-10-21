// Builds the cheap-model "artifact-builder" agent definition for hosts that support custom agents.
// Installer-only (not in shared/). Claude Code and Gemini get no agent file.
export const AGENT_NAME = 'artifact-builder';

const DESCRIPTION =
  'Builds one portable-artifacts page from a brief. Reads the named SKILL.md, writes the spec JSON, runs validate and build, returns the output path';

// One instruction text, used by both host formats. Must not contain three single quotes in a row (TOML literal block).
export const INSTRUCTIONS = `You are already artifact-builder. Do not delegate again: never hand this work to another agent or to artifact-builder.

The brief gives you three inputs: the skill directory, the spec path (where to write the JSON), and optionally an output folder. Do exactly this:
1. Read the SKILL.md in the skill directory named in the brief and follow its spec format.
2. Write the spec JSON from the brief to the spec path.
3. Run the skill's validate script on the spec, then its build script. Run both commands exactly as SKILL.md shows them. If the brief gives an output folder, pass it to the build script's --out option.
4. Reply with only the output path and the validator's last line. No other text.

If validation still fails after 2 fix attempts, stop. Reply with the spec path and the validator's last line, and say it failed. Never report an output path for a build that did not run.`;

// TOML basic string: JSON string escapes are valid TOML escapes.
export const tomlString = (s) => JSON.stringify(s);

const BUILDERS = {
  copilot: () => ({
    fileName: `${AGENT_NAME}.agent.md`,
    content: `---
name: ${AGENT_NAME}
description: ${DESCRIPTION}
model: ['Claude Haiku 5.5', 'GPT-5.4 nano']
---

${INSTRUCTIONS}
`,
  }),
  codex: () => ({
    fileName: `${AGENT_NAME}.toml`,
    content: `name = "${AGENT_NAME}"
description = ${tomlString(DESCRIPTION)}
model = "gpt-6-luna"
model_reasoning_effort = "low"
developer_instructions = '''
${INSTRUCTIONS}
'''
`,
  }),
};

export function agentFile(host) {
  if (!Object.hasOwn(BUILDERS, host)) throw new Error(`unknown agent host: ${host}`);
  return BUILDERS[host]();
}
