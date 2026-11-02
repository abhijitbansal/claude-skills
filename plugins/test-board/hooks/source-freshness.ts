import type { SourceMatch, SourceSnapshot } from '../types'
import { isTestCommand } from './parse'
import { scanPipeline } from './shell-scan'
import type { Stage } from './shell-scan'
import { CARTOON_C, cartoonInner, resolveDir, splitCommand } from './suite'

export const SOURCE_SCOPE = 'git-tracked+untracked-nonignored'

// Mirrors the collector's single-scan byte cap: `max_bytes` in scripts/source_snapshot.py `capture()`.
// Keep the two equal, or a repo the collector reports available is rejected here as invalid_capture.
export const MAX_SOURCE_BYTES = 128 * 1024 * 1024

const reasons = new Set(['deadline', 'unsupported_host', 'git_output_limit', 'git_unavailable',
  'invalid_listing', 'unsupported_index', 'file_limit', 'unsupported_path', 'unsupported_file',
  'byte_limit', 'changed_during_capture', 'not_worktree_root', 'unavailable', 'invalid_arguments'])
const silent = new Set(['unavailable', 'invalid_capture'])
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const count = (v: unknown, max: number): boolean => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max
const exactKeys = (v: Record<string, unknown>, keys: string[]): boolean =>
  Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k))

export const unknownSource = (reason = 'unavailable'): SourceSnapshot =>
  ({ version: 1, scope: SOURCE_SCOPE, status: 'unknown', reason })

function available(v: unknown): v is Extract<SourceSnapshot, { status: 'available' }> {
  return object(v) && v.version === 1 && v.scope === SOURCE_SCOPE && v.status === 'available'
    && exactKeys(v, ['version', 'scope', 'status', 'root', 'head', 'branch', 'digest', 'files', 'bytes'])
    && typeof v.root === 'string' && v.root.startsWith('/') && v.root.length <= 4096 && !v.root.includes('\0')
    && typeof v.head === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(v.head)
    && (v.branch === null || (typeof v.branch === 'string' && v.branch.startsWith('refs/heads/') && v.branch.length <= 1024))
    && typeof v.digest === 'string' && /^[0-9a-f]{64}$/.test(v.digest)
    && count(v.files, 4096) && count(v.bytes, MAX_SOURCE_BYTES)
}

/** Accept only a complete, supported collector record. Never forward diagnostics or payloads. */
export function parseSourceCapture(result: unknown): SourceSnapshot {
  if (!object(result) || result.exitCode !== 0 || result.stderr !== '' || typeof result.stdout !== 'string'
    || result.stdout.length > 8192 || !result.stdout.endsWith('\n')
    || result.isStdoutTruncated === true || result.isStderrTruncated === true) return unknownSource('invalid_capture')
  try {
    const v: unknown = JSON.parse(result.stdout)
    if (available(v)) return v
    if (object(v) && exactKeys(v, ['version', 'scope', 'status', 'reason'])
      && v.version === 1 && v.scope === SOURCE_SCOPE && v.status === 'unknown'
      && typeof v.reason === 'string' && reasons.has(v.reason)) return unknownSource(v.reason)
  } catch { /* Truncated or malformed capture: no partial identity. */ }
  return unknownSource('invalid_capture')
}

/** Equality of bounded observations, not proof of what the command actually read. */
export function compareSourceSnapshots(before: unknown, after: unknown): SourceMatch {
  if (!available(before) || !available(after)) return 'unknown'
  return ['root', 'head', 'branch', 'digest', 'files', 'bytes'].every(key =>
    before[key as keyof typeof before] === after[key as keyof typeof after]) ? 'matching' : 'changed'
}

/** A capture was attempted and said something: a complete observation or a reason the collector gave.
 * Failures to run the collector at all (`unavailable`, `invalid_capture`) say nothing worth a line. */
export function hasSourceReport(source: unknown): boolean {
  const said = (v: unknown): boolean => available(v)
    || (object(v) && v.status === 'unknown' && typeof v.reason === 'string' && !silent.has(v.reason))
  return object(source) && (said(source.before) || said(source.after))
}

export function sourceRoot(source: unknown): string | undefined {
  return object(source) && available(source.before) && available(source.after)
    && source.before.root === source.after.root ? source.after.root : undefined
}

export function sourceMatchForRun(source: unknown, current: unknown): SourceMatch {
  if (!object(source)) return 'unknown'
  const during = compareSourceSnapshots(source.before, source.after)
  if (during !== 'matching') return during
  return compareSourceSnapshots(source.after, current)
}

// Output filters a test run may be piped through. Each runs in its own process: none can move the test's directory.
const FILTERS = new Set(['head', 'tail', 'grep', 'egrep', 'fgrep', 'rg', 'tee', 'cat', 'sort', 'uniq', 'wc', 'cut', 'tr'])
// Filter flags that make the filter run another program, which could do anything. sort accepts any unambiguous
// prefix of a long option (`--compress-prog`, `--comp`), so its entry is matched as a prefix; rg and pytest refuse
// abbreviations.
const FILTER_EXEC_FLAGS: Record<string, string[]> = { rg: ['--pre', '--pre-glob'], sort: ['--compress-program'] }
const PREFIX_MATCHED = new Set(['sort'])
// Variables that decide which directory a shell command starts in.
const CWD_VARS = new Set(['PWD', 'OLDPWD', 'CDPATH'])
// What may precede cartoon's `-c`: plain `--flag` words only (`--tag=t`), nothing the shell would expand or split.
const CARTOON_HEAD = /^cartoon(?:[ \t]+[\w.=:/@-]+)*[ \t]+$/

// Flags and variables that point a runner at a project other than the directory it starts in. The cwd then names the
// wrong worktree, so a run carrying one gets no source check. A small explicit table, not a parser of every runner:
// PROJECT_* name the project root outright (npm/pnpm/yarn/bun, go, make, cargo, swift, pytest, jest/vitest, uv/poetry).
const PROJECT_FLAGS = new Set(['--prefix', '--dir', '-C', '--cwd', '--chdir', '--directory', '--project', '--manifest-path',
  '--package-path', '--rootdir', '--rootDir', '--root'])
// These select a file or project that is usually a plain name beside the cwd (`--config jest.config.js`,
// `-project App.xcodeproj`): refused only when the value is absolute, `~`, climbs out with `..`, or is missing.
const PATH_FLAGS = new Set(['--config', '-c', '-r', '-project', '-workspace', '--roots', '--projects'])
// Short flags whose value may follow directly (`-C../x`, `-c../x`). `-r` is not one: `-rA` is a pytest report option.
const ATTACHED_FLAGS = ['-C', '-c']
// A short cluster ending in one of them (`-qc ../x`, `-sC dir`, `-qc../x`): up to three letters before it, so long
// single-dash words such as `-scheme` or `-enableCodeCoverage` are not read as clusters.
const CLUSTER = /^-[A-Za-z]{1,3}([cC])(.*)$/
const PROJECT_ENV = new Set(['npm_config_prefix'])
// pytest reads extra options from here, `--rootdir` included.
const FLAGS_ENV = 'PYTEST_ADDOPTS'

const unquoted = (word: string): string => word.replace(/['"]/g, '')
const leavesDirectory = (value: string): boolean => value === '' || /^[/~]/.test(value) || /(?:^|\/)\.\.(?:\/|$)/.test(value)

/** Whether any word is a flag that moves the code under test. Quotes are dropped first: the shell would drop them. */
function movesProject(words: string[]): boolean {
  return words.some((word, i) => {
    const eq = word.startsWith('-') ? word.indexOf('=') : -1
    const [name, value]: [string, string] = eq > 0 ? [word.slice(0, eq), word.slice(eq + 1)] : [word, words[i + 1] ?? '']
    if (PROJECT_FLAGS.has(name)) return true
    if (PATH_FLAGS.has(name)) return leavesDirectory(value)
    const attached = word.length > 2 && !word.startsWith('--') ? ATTACHED_FLAGS.find(f => word.startsWith(f)) : undefined
    if (attached !== undefined) return PROJECT_FLAGS.has(attached) || leavesDirectory(word.slice(attached.length))
    const cluster = CLUSTER.exec(word)
    if (cluster === null) return false
    const rest = cluster[2] ?? ''
    // A cluster with a remainder that is all letters is a long word (`-scheme`), not a flag and its value.
    if (/^[A-Za-z]+$/.test(rest)) return false
    return cluster[1] === 'C' || leavesDirectory(rest === '' ? words[i + 1] ?? '' : rest)
  })
}

/** An environment assignment that sets the directory (`PWD=`), or the project a runner uses (`npm_config_prefix=`). */
function movesDirectoryEnv(assignment: string): boolean {
  const eq = assignment.indexOf('=')
  const name = assignment.slice(0, eq)
  if (CWD_VARS.has(name) || PROJECT_ENV.has(name.toLowerCase())) return true
  return name === FLAGS_ENV && movesProject(unquoted(assignment.slice(eq + 1)).split(/[ \t]+/))
}

/** Shell context we can locate without executing or interpreting shell expansions.
 * The host may show the command before or after cartoon rewrites it to `cartoon -c '<command>'`; both locate alike. */
export function sourceCwd(command: string, base: string): string | undefined {
  // Only space and tab separate words: the shell does not treat NBSP, form feed or U+2028 that way.
  if (/[\0]|[^\S \t]/.test(command)) return undefined
  let rest = command.trim()
  let cwd = base
  // A quote in an unquoted operand would be joined into the path by the shell (`./x'y'` is `./xy`): not a plain name.
  const cd = /^cd[ \t]+(?:"([^"\n]+)"|'([^'\n]+)'|([^ \t'"]+))[ \t]*&&[ \t]*/.exec(rest)
  if (cd) {
    const dir = cd[1] ?? cd[2] ?? cd[3] ?? ''
    // Bare names consult CDPATH even when quoted; `cd -` follows OLDPWD.
    if (!/^(?:\/|\.\.?\/|\.\.?$)/.test(dir)
      || /[\0~$`\;|&<>\r\n*?\[\]{}]/.test(dir)) return undefined
    cwd = resolveDir(base, dir)
    rest = rest.slice(cd[0].length)
  }
  if (!cwd.startsWith('/') || /[\0\r\n]/.test(cwd)) return undefined
  const [first, ...filters] = scanPipeline(rest) ?? []
  if (first === undefined || !filters.every(isPlainFilter)) return undefined
  let env = 0
  for (; env < first.raw.length; env += 1) {
    const word = first.raw[env] ?? ''
    if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) break
    if (movesDirectoryEnv(word)) return undefined
  }
  const joined = first.raw.slice(env).join(' ')
  const wrapped = CARTOON_C.exec(joined)
  if (wrapped) {
    const quoted = wrapped[1] === undefined ? `"${wrapped[2]}"` : `'${wrapped[1]}'`
    const head = joined.slice(0, -quoted.length)
    // The inner text was one quoted word, so it is literal; it gets the same rules as a command typed bare.
    return CARTOON_HEAD.test(head) ? sourceCwd(cartoonInner(wrapped), cwd) : undefined
  }
  const isDirect = isTestCommand(splitCommand(first.plain.join(' ')).normalized)
  return isDirect && !movesProject(first.raw.slice(env).map(unquoted)) ? cwd : undefined
}

const isPlainFilter = (stage: Stage): boolean => {
  const name = stage.plain[0] ?? ''
  const exec = FILTER_EXEC_FLAGS[name] ?? []
  const runsProgram = (w: string, f: string): boolean => {
    const flag = w.split('=')[0] ?? ''
    return flag === f || (PREFIX_MATCHED.has(name) && flag.length > 3 && f.startsWith(flag))
  }
  return FILTERS.has(name) && !stage.raw.slice(1).map(unquoted).some(w => exec.some(f => runsProgram(w, f)))
}
