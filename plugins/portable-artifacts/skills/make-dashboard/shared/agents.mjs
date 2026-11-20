// Builds the cheap-model "artifact-builder" (the operator) agent definition for hosts that support custom
// agents, and writes it. Gemini gets no agent file.
// It lives in shared/ so every skill folder carries it: bin/install.mjs imports it, and
// `doctor --fix builder_agent` runs it as a CLI, which is how an install made with the skills CLI
// (skill folders only, no bin/) gets the agent file.
//   node agents.mjs write <claude|copilot|codex> <agents-dir>     writes the file, keeps an existing one
// The Claude Code text is also shipped as the plugin's agents/artifact-builder.md; a test holds the two equal.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const AGENT_NAME = 'artifact-builder';

const DESCRIPTION =
  'Runs one portable-artifacts make.mjs command on a finished spec, fixes only mechanical findings in it, and returns the report';

// The operator's one instruction text, used by all three host formats. It operates; it never directs: no spec,
// no theme or look, no wording. Must not contain three single quotes in a row (TOML literal block).
export const INSTRUCTIONS = `You are already artifact-builder. Never delegate: do not hand this work to another agent or to artifact-builder again.

The brief gives you the skill directory, the spec path (the file already exists), and optionally an output path. Do exactly this:
1. Run: node <skill-dir>/scripts/make.mjs <spec> --json
   Use the real paths from the brief. Add --out <output path> when the brief gives one.
2. The command prints one JSON report. If it has findings of kind "mechanical", change only the JSON paths those findings name in the spec file (apply the finding's fix when it has one), then run the same command again. Do this at most 2 times. A mechanical finding with an empty path names nothing you may change: stop and report it.
3. Never create a spec. Never change wording, theme, look, layout, or data. Never act on a "creative" finding: leave it in the report.
4. Reply with only the last report, as JSON. No other text.

If the command cannot run (it prints an error, or no report), reply with its error line and stop. Never report an output path for a build that did not run.`;

// TOML basic string: JSON string escapes are valid TOML escapes.
export const tomlString = (s) => JSON.stringify(s);

const BUILDERS = {
  // tools: no subagent tool (it cannot delegate again) and no Write (it cannot create a spec). Edit only changes an existing file.
  claude: () => ({
    fileName: `${AGENT_NAME}.md`,
    content: `---
name: ${AGENT_NAME}
description: ${DESCRIPTION}
model: haiku
tools: Read, Edit, Bash
---

${INSTRUCTIONS}
`,
  }),
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

// Text every current agent file carries and no earlier one did (they told the builder to write the spec and run two scripts).
// The doctor uses it to tell an outdated file from a current one.
export const CURRENT_MARKER = 'make.mjs';

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
