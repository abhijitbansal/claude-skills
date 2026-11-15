export const SUITE_LABEL_COLUMNS = 48

const LEADING_CD = /^cd\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s*(?:&&|;)\s*/
const ENV_PREFIX = /^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+)+/
// cartoon quotes a single quote inside its single-quoted `-c` word as the POSIX sequence '\'' (close, escaped quote, reopen).
export const CARTOON_C = /^cartoon[ \t]+(?:--\S+[ \t]+)*-c[ \t]+(?:'((?:[^']|'\\'')*)'|"([^"]*)")[ \t]*$/
/** The command text inside a `CARTOON_C` match, as the shell would hand it to cartoon. */
export const cartoonInner = (wrapped: RegExpExecArray): string =>
  wrapped[1] === undefined ? (wrapped[2] ?? '') : wrapped[1].replaceAll("'\\''", "'")
const CARTOON_PREFIX = /^cartoon\s+(?:--tag\s+\S+\s+)?(?:--\s+)?/
const CARTOON_UTILITY = /^cartoon\s+(?:logs|stats|adapters|doctor|ingest|help|version)\b/
// A copy or slice of the output (`| tee log`, `|& tail`) is not part of the suite's identity.
const TRAILING_PIPE = /\s*\|&?\s*(?:head|tail|grep|rg|tee)\b.*$/
const STDERR_MERGE = /\s*2>&1/g
// Trailing output redirects (`> log`, `>> log`, `2> err`, `&> log`), never a `>` inside quotes earlier on.
const TRAILING_REDIRECTS = /(?:\s+(?:&>>?|\d?>>?)\s*[^\s"'&|;<>]+)+\s*$/

function joinDirs(outer: string | undefined, inner: string | undefined): string | undefined {
  if (outer === undefined || inner === undefined) return inner ?? outer
  return inner.startsWith('/') || inner.startsWith('~') ? inner : `${outer}/${inner}`
}

export function splitCommand(command: string): { cdDir?: string; normalized: string } {
  let rest = command.trim()
  let cdDir: string | undefined
  const cd = LEADING_CD.exec(rest)
  if (cd) {
    cdDir = cd[1] ?? cd[2] ?? cd[3]
    rest = rest.slice(cd[0].length)
  }
  rest = rest.replace(ENV_PREFIX, '')
  const wrapped = CARTOON_C.exec(rest)
  if (wrapped) {
    const inner = splitCommand(cartoonInner(wrapped))
    const dir = joinDirs(cdDir, inner.cdDir)
    return dir === undefined ? { normalized: inner.normalized } : { cdDir: dir, normalized: inner.normalized }
  }
  if (!CARTOON_UTILITY.test(rest)) rest = rest.replace(CARTOON_PREFIX, '')
  rest = rest.replace(TRAILING_PIPE, '').replace(STDERR_MERGE, '').replace(TRAILING_REDIRECTS, '')
  const normalized = rest.replace(/\s+/g, ' ').trim()
  return cdDir === undefined ? { normalized } : { cdDir, normalized }
}

export function resolveDir(base: string, dir: string): string {
  if (dir.startsWith('/') || dir.startsWith('~')) return dir
  const parts: string[] = []
  for (const part of `${base}/${dir}`.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return `/${parts.join('/')}`
}

/** A leading `~` or `~/` as the shell expands it, given the home directory; anything else unchanged. */
export function expandHome(dir: string, home: string | undefined): string {
  if (home === undefined || home === '') return dir
  if (dir === '~') return home
  return dir.startsWith('~/') ? `${home}${dir.slice(1)}` : dir
}

export function suiteKey(worktreeRoot: string, normalized: string): string {
  return `${worktreeRoot}::${normalized}`
}

export function suiteLabel(normalized: string): string {
  return normalized.slice(0, SUITE_LABEL_COLUMNS)
}
