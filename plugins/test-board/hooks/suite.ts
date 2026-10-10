export const SUITE_LABEL_COLUMNS = 48

const LEADING_CD = /^cd\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s*(?:&&|;)\s*/
const ENV_PREFIX = /^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+)+/
const CARTOON_C = /^cartoon\s+-c\s+(?:'([^']*)'|"([^"]*)")\s*$/
const CARTOON_PREFIX = /^cartoon\s+(?:--tag\s+\S+\s+)?(?:--\s+)?/
const TRAILING_PIPE = /\s*\|\s*(?:head|tail|grep|rg)\b.*$/
const STDERR_MERGE = /\s*2>&1/g

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
  rest = wrapped ? (wrapped[1] ?? wrapped[2] ?? '') : rest.replace(CARTOON_PREFIX, '')
  rest = rest.replace(TRAILING_PIPE, '').replace(STDERR_MERGE, '')
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

export function suiteKey(worktreeRoot: string, normalized: string): string {
  return `${worktreeRoot}::${normalized}`
}

export function suiteLabel(normalized: string): string {
  return normalized.slice(0, SUITE_LABEL_COLUMNS)
}
