// --help and -h for the scripts that read their own flags (the ones on shared/cli.mjs parseCli get it there): the usage
// line on stdout and exit 0, never an error and never a model download or a browser launch.
export const wantsHelp = (argv) => argv.includes('--help') || argv.includes('-h');

// `usage` may or may not carry its own "usage:" prefix.
export function printHelp(usage) {
  process.stdout.write(`${usage.startsWith('usage:') ? usage : `usage: ${usage}`}\n`);
  process.exitCode = 0;
}
