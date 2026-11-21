// Decides what to do with a prompt the user just submitted.
//   allow  — send it, say nothing
//   warn   — send it, print the cold-rewrite price
//   refuse — drop it once; the next send in the same cold episode goes through

export const MODES = ["refuse", "warn", "off"];

/** An expired cache, or a switch to a model with the current conversation context. */
export const episodeKey = (snap) => snap.reason === "model-switch"
  ? `${snap.model}@switch:${snap.lastCallAt}` : `${snap.model}@${snap.expiresAt}`;

// Built-in commands the host handles itself, without a model call. This is an allowlist because
// skill commands (`/name args`) share the slash syntax and do call the model. `/compact` is not
// here: it summarizes with the model. The list is unverified against a real host: the names after
// "cache-clock" come from memory of Copilot CLI's built-ins, not from a probe. A built-in missing
// here is guarded like a prompt, which fails safe but can spend a cold episode's single question.
export const LOCAL_COMMANDS = new Set([
  "help", "clear", "model", "exit", "quit", "experimental", "resume", "cwd", "add-dir",
  "login", "logout", "usage", "session", "theme", "cache-clock",
  "mcp", "agent", "share", "feedback", "context", "list-dirs", "reset-allowed-tools", "user", "terminal-setup",
]);

// A command and its arguments on one line; text after a newline is a prompt the host may send to the model.
const SLASH_COMMAND = /^\/([A-Za-z][\w-]*)([ \t][^\n]*)?$/;

/**
 * What a submitted text is, for the guard and for keep-warm's turn tracking:
 *   "shell"         — a `!` escape; never reaches the model
 *   "local-command" — a built-in slash command; never reaches the model
 *   "prompt"        — anything else, including skill commands and pasted paths like `/etc/hosts is broken`
 * With `interactive` false (`-p`) the host may send slash text to the model as plain text, so
 * every slash text counts as a prompt; `!` escapes stay shell.
 */
export function classifyPrompt(text, { interactive = true } = {}) {
  const trimmed = String(text ?? "").trim();
  if (trimmed.startsWith("!")) return "shell";
  const name = SLASH_COMMAND.exec(trimmed)?.[1];
  if (interactive && name && LOCAL_COMMANDS.has(name.toLowerCase())) return "local-command";
  return "prompt";
}

export function decide({ snap, prompt, config, refusedKey = null, busy = false, interactive = true }) {
  if (classifyPrompt(prompt, { interactive }) !== "prompt") return { action: "allow" };
  if (config.mode === "off" || !snap) return { action: "allow" };
  if (snap.reason && snap.extraUsd === null) return { action: "warn" };
  if (snap.state !== "cold" && snap.reason !== "model-switch") return { action: "allow" };
  // A cold send with no known price cannot be guarded, so say so instead of staying silent.
  if (snap.state === "cold" && !snap.reason && snap.extraUsd === null) return { action: "warn", key: episodeKey(snap), unpriced: true };
  if (snap.extraUsd === null || snap.extraUsd < config.minUsd) return { action: "allow" };
  const key = episodeKey(snap);
  // A prompt queued while a turn runs must not abort that turn: warn only.
  if (config.mode === "refuse" && refusedKey !== key && !busy) return { action: "refuse", key };
  return { action: "warn", key };
}
