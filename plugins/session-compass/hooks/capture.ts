import type { Artifact } from '../types'
import { gitArtifacts, type GitOperation } from './git'
import { basename, truncate } from './record'

export type CaptureInput = {
  tool: string
  input: Readonly<Record<string, unknown>>
  result: unknown
  isError: boolean
  now: number
}

const DOC_EXT = /\.(html|md|pdf|png|svg|mp4|gif|webm)$/i
const DOC_DIR = /(^|\/)(\.scratch|docs|reports|test-checklists)\//
const SCRATCHPAD = /\/claude-\d+\/.+\/scratchpad\//
const CLAUDE_URL = /^https:\/\/claude\.ai\//
const TITLE_MAX = 120
// portable-artifacts builders run through Bash and print what they wrote: a
// `wrote <path>` line, a file:// line (bare or after `open: `), the bare output
// path (make-motion render), or with --json a {"ok":true,"out":...} line.
// Only a run of a builder's entry script counts (optionally through node or bun, after env assignments or
// `&&`/`;`), never a command that merely names a make-* folder (find, ls, grep over the skill).
const BUILDER = /(?:^|&&|;|\|\|)\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:(?:node|bun)\s+(?:-\S+\s+)*)?\S*make-(explainer|diagram|dashboard|motion|scene)\/scripts\/(build|render)\.mjs(?:\s|$)/
const MOTION_RENDER = /make-motion\/scripts\/render\.mjs/
const WROTE_LINE = /^wrote (\/.+)$/
const FILE_URL_LINE = /^(?:open: )?(file:\/\/\/\S+)$/
const PATH_LINE = /^(\/\S+)$/

const text = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)
const fields = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}

export function isDeliverable(path: string): boolean {
  return DOC_EXT.test(path) && (DOC_DIR.test(path) || SCRATCHPAD.test(path))
}

function fromFileUrl(url: string): string | undefined {
  try {
    return decodeURIComponent(new URL(url).pathname)
  } catch {
    return undefined
  }
}

function jsonOut(line: string): string | undefined {
  if (!line.startsWith('{')) return undefined
  try {
    const parsed = fields(JSON.parse(line))
    return parsed.ok === true ? text(parsed.out) : undefined
  } catch {
    return undefined
  }
}

// make-motion render prints its output as a bare path line; the other builders' bare lines are not outputs.
function builtPath(line: string, isBarePathOutput: boolean): string | undefined {
  const url = FILE_URL_LINE.exec(line)?.[1]
  return WROTE_LINE.exec(line)?.[1] ?? (url ? fromFileUrl(url) : undefined) ?? jsonOut(line)
    ?? (isBarePathOutput ? PATH_LINE.exec(line)?.[1] : undefined)
}

/** Output files a portable-artifacts builder reported on stdout; nothing for any other command. */
export function builderDocs(command: string, stdout: string, now: number): Artifact[] {
  if (!BUILDER.test(command)) return []
  const isBarePathOutput = MOTION_RENDER.test(command)
  const paths = new Set<string>()
  for (const line of stdout.split('\n')) {
    const path = builtPath(line.trim(), isBarePathOutput)
    if (path !== undefined && path.startsWith('/') && DOC_EXT.test(path)) paths.add(path)
  }
  return [...paths].map((path): Artifact => ({ kind: 'doc', path, at: now }))
}

export function capture(c: CaptureInput): Artifact[] {
  if (c.isError) return []
  const result = fields(c.result)
  switch (c.tool) {
    case 'Artifact': {
      const action = text(c.input.action)
      if ((action !== undefined && action !== 'publish') || result.opened === true) return []
      const url = text(result.url)
      if (url === undefined || !CLAUDE_URL.test(url)) return []
      const filePath = text(c.input.file_path)
      const title = text(result.title) ?? text(c.input.title) ?? (filePath ? basename(filePath) : url)
      return [{ kind: 'artifact', title: truncate(title, TITLE_MAX), url, at: c.now }]
    }
    case 'SendUserFile': {
      const list = Array.isArray(result.attachments) ? result.attachments : []
      return list
        .map(a => (text(fields(a).upload_error) === undefined ? text(fields(a).path) : undefined))
        .filter((p): p is string => p !== undefined)
        .map((path): Artifact => ({ kind: 'file', path, at: c.now }))
    }
    case 'Write': {
      const path = text(c.input.file_path)
      return path !== undefined && isDeliverable(path) ? [{ kind: 'doc', path, at: c.now }] : []
    }
    case 'Bash': {
      const output = `${text(result.stdout) ?? ''}\n${text(result.stderr) ?? ''}`
      return [
        ...gitArtifacts(result.gitOperation as GitOperation | undefined, output, c.now),
        ...builderDocs(text(c.input.command) ?? '', text(result.stdout) ?? '', c.now),
      ]
    }
    default:
      return []
  }
}
