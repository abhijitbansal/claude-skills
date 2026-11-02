// A reader for the one shell shape source checks accept: words (bare or quoted), then plain output plumbing.
// It never interprets the text; anything that could run, expand, chain or background something is refused.

/** One `|`-separated command: `raw` keeps quotes, `plain` has each quoted run replaced by `q`. */
export type Stage = { raw: string[]; plain: string[] }

const METACHARS = new Set([';', '&', '$', '`', '\\', '<', '(', ')', '{', '}'])
// Inside double quotes the shell still expands these; inside single quotes nothing is special.
const DOUBLE_QUOTE_EXPANSION = /[$`\\]/
const MERGE_STDERR_END = /^(?:[ \t]|$|\|)/

/** Split `text` into pipeline stages of words. Redirections (`2>&1`, `>f`, `>>f`, `2>f`) are consumed and dropped.
 * Returns undefined for anything else: `;` `&` `$` backticks, backslashes, `<`, subshells, braces, newlines,
 * expanding or unterminated quotes, empty stages, and redirections without a plain file word. */
export function scanPipeline(text: string): Stage[] | undefined {
  // Only space and tab separate words here; any other whitespace is refused rather than read as part of a word.
  if (/[\0]|[^\S \t]/.test(text)) return undefined
  const stages: Stage[] = [{ raw: [], plain: [] }]
  let raw = ''
  let plain = ''
  let isWord = false
  let isAwaitingTarget = false
  const finish = (): void => {
    if (!isWord) return
    if (isAwaitingTarget) isAwaitingTarget = false
    else {
      stages[stages.length - 1]?.raw.push(raw)
      stages[stages.length - 1]?.plain.push(plain)
    }
    raw = ''
    plain = ''
    isWord = false
  }
  let i = 0
  while (i < text.length) {
    const c = text[i] as string
    if (c === "'" || c === '"') {
      let end = text.indexOf(c, i + 1)
      // POSIX writes a quote inside single quotes as '\'' (close, escaped quote, reopen): one word, literal quote.
      while (c === "'" && end >= 0 && text.startsWith("\\''", end + 1)) end = text.indexOf("'", end + 4)
      if (end < 0 || (c === '"' && DOUBLE_QUOTE_EXPANSION.test(text.slice(i + 1, end)))) return undefined
      raw += text.slice(i, end + 1)
      plain += 'q'
      isWord = true
      i = end + 1
    } else if (c === ' ' || c === '\t') {
      finish()
      i += 1
    } else if (c === '|') {
      finish()
      if (text[i + 1] === '|' || isAwaitingTarget || stages[stages.length - 1]?.raw.length === 0) return undefined
      stages.push({ raw: [], plain: [] })
      i += 1
    } else if (c === '>') {
      // A lone 1 or 2 right before `>` is the descriptor, as in the shell.
      const fd = isWord && /^[12]$/.test(raw) ? raw : undefined
      if (fd === undefined) finish()
      else { raw = ''; plain = ''; isWord = false }
      if (isAwaitingTarget) return undefined
      i += 1
      if (text[i] === '>') i += 1
      else if (text[i] === '&') {
        if (fd !== '2' || !text.startsWith('&1', i) || !MERGE_STDERR_END.test(text.slice(i + 2))) return undefined
        i += 2
        continue
      }
      isAwaitingTarget = true
    } else if (METACHARS.has(c)) {
      return undefined
    } else {
      raw += c
      plain += c
      isWord = true
      i += 1
    }
  }
  finish()
  if (isAwaitingTarget || stages.some(s => s.raw.length === 0)) return undefined
  return stages
}
