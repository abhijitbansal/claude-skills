// Builds the cheap-model "artifact-builder" agent definition for hosts that support custom agents,
// and writes it. Claude Code and Gemini get no agent file.
// It lives in shared/ so every skill folder carries it: bin/install.mjs imports it, and
// `doctor --fix builder_agent` runs it as a CLI, which is how an `npx skills add` install
// (skill folders only, no bin/) gets the agent file.
//   node agents.mjs write <copilot|codex> <agents-dir>     writes the file, keeps an existing one
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const AGENT_NAME = 'artifact-builder';

const DESCRIPTION =
  'Builds one portable-artifacts page from a brief. Reads the named SKILL.md, writes the spec JSON, runs validate and build, returns the output path';

// One instruction text, used by both host formats. Must not contain three single quotes in a row (TOML literal block).
export const INSTRUCTIONS = `You are already artifact-builder. Do not delegate again: never hand this work to another agent or to artifact-builder.

The brief gives you three inputs: the skill directory, the spec path (where to write the JSON), and optionally an output folder. Do exactly this:
1. Read the SKILL.md in the skill directory named in the brief and follow its spec format.
2. Write the spec JSON from the brief to the spec path.
3. Run the skill's validate script on the spec, then its build script. Run both commands exactly as SKILL.md shows them. If validation reports errors, fix the spec and rerun it, up to 2 times. If the brief gives an output folder, pass it to the build script's --out option.
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

export const AGENT_HOSTS = Object.keys(BUILDERS);

// Write one agent file without ever following a symlink at the target (lstat, not exists).
// Returns 'written', 'kept' (something is already there and force is off) or 'not-file' (a directory etc.).
// A symlink under force is unlinked, never written through, so its target is untouched.
export function writeAgentFile(dir, file, content, force) {
  let st = null;
  try {
    st = fs.lstatSync(file);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  if (st && !st.isSymbolicLink() && !st.isFile()) return 'not-file';
  if (st && !force) return 'kept';
  if (st) fs.unlinkSync(file);
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.writeFileSync(file, content, { flag: 'wx' }); // wx: lose a create race by keeping, not overwriting
  } catch (e) {
    if (e.code === 'EEXIST') return 'kept';
    throw e;
  }
  return 'written';
}

const USAGE = `usage: node agents.mjs write <${AGENT_HOSTS.join('|')}> <agents-dir>`;

function cli(argv) {
  const [command, host, dir, ...rest] = argv;
  if (command !== 'write' || !AGENT_HOSTS.includes(host) || !dir || dir.startsWith('-') || rest.length) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  const { fileName, content } = agentFile(host);
  const file = path.join(path.resolve(dir), fileName);
  try {
    const result = writeAgentFile(path.resolve(dir), file, content, false);
    if (result === 'not-file') {
      process.stderr.write(`agent: ${file} is not a file\n`);
      return 1;
    }
    process.stdout.write(result === 'kept' ? `agent: kept existing ${file}\n` : `agent: ${file}\n`);
    return 0;
  } catch (e) {
    process.stderr.write(`agent: could not write ${file} (${e.message})\n`);
    return 1;
  }
}

// Run the CLI only when this file is the entry point. argv[1] can name a path that does not exist
// (`node -e ... foo`), and importing this module must never throw because of that.
function isEntryPoint() {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isEntryPoint()) process.exitCode = cli(process.argv.slice(2));
