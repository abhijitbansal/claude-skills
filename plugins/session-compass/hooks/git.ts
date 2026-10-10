import type { Artifact } from '../types'
import { truncate } from './record'

export type GitOperation = {
  commit?: { sha: string; kind: string; branch?: string }
  push?: { branch: string }
  pr?: { number: number; url?: string; action: string }
}

const COMMIT_LINE = /^\[(.+?)(?: \(root-commit\))? ([0-9a-f]{7,})\] (.+)$/m
const PUSH_REMOTE = /^To (\S+)$/m
const PR_URL = /https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/\d+/
const SUBJECT_MAX = 120

export function gitArtifacts(op: GitOperation | undefined, output: string, now: number): Artifact[] {
  if (op === undefined) return []
  const found: Artifact[] = []
  if (op.commit !== undefined) {
    const line = COMMIT_LINE.exec(output)
    found.push({
      kind: 'commit',
      sha: op.commit.sha,
      subject: truncate(line?.[3] ?? '', SUBJECT_MAX),
      branch: op.commit.branch ?? line?.[1] ?? 'HEAD',
      at: now,
    })
  }
  if (op.push !== undefined) {
    const remote = PUSH_REMOTE.exec(output)?.[1] ?? 'origin'
    found.push({ kind: 'push', branch: op.push.branch, remote, at: now })
  }
  if (op.pr !== undefined && op.pr.action === 'created') {
    const url = op.pr.url ?? PR_URL.exec(output)?.[0] ?? ''
    found.push({ kind: 'pr', number: op.pr.number, url, at: now })
  }
  return found
}
