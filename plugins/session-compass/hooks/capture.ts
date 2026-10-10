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

const DOC_EXT = /\.(html|md|pdf|png|svg)$/i
const DOC_DIR = /(^|\/)(\.scratch|docs|reports|test-checklists)\//
const SCRATCHPAD = /\/claude-\d+\/.+\/scratchpad\//
const CLAUDE_URL = /^https:\/\/claude\.ai\//
const TITLE_MAX = 120

const text = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)
const fields = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}

export function isDeliverable(path: string): boolean {
  return DOC_EXT.test(path) && (DOC_DIR.test(path) || SCRATCHPAD.test(path))
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
      return gitArtifacts(result.gitOperation as GitOperation | undefined, output, c.now)
    }
    default:
      return []
  }
}
