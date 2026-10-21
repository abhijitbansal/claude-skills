// Builds the cheap-model "artifact-builder" agent definition for hosts that support custom agents.
// Installer-only (not in shared/). Claude Code and Gemini get no agent file.
export const AGENT_NAME = 'artifact-builder';

const DESCRIPTION =
  'Builds one portable-artifacts page from a brief. Reads the named SKILL.md, writes the spec JSON, runs validate and build, returns the output path';

// One instruction text, used by both host formats. Must not contain three single quotes in a row (TOML literal block).
const INSTRUCTIONS = `You are already artifact-builder. Do not delegate again: never hand this work to another agent or to artifact-builder.

You receive a brief naming a skill, its SKILL.md path, the spec content and an output location. Do exactly this:
1. Read the SKILL.md named in the brief and follow its spec format.
2. Write the spec JSON described in the brief to the path the brief gives.
3. Run the skill's validate script on the spec, fix any errors it reports, then run the skill's build script.
4. Reply with only the output path and the validator's last line. No other text.`;

const MODELS = {
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
description = "${DESCRIPTION}"
model = "gpt-6-luna"
model_reasoning_effort = "low"
developer_instructions = '''
${INSTRUCTIONS}
'''
`,
  }),
};

export function agentFile(host) {
  if (!Object.hasOwn(MODELS, host)) throw new Error(`unknown agent host: ${host}`);
  return MODELS[host]();
}
