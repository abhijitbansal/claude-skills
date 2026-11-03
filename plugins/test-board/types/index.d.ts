export type SourceSnapshot = {
  version: 1; scope: 'git-tracked+untracked-nonignored'; status: 'available'
  root: string; head: string; branch: string | null; digest: string; files: number; bytes: number
} | { version: 1; scope: 'git-tracked+untracked-nonignored'; status: 'unknown'; reason: string }
export type SourceMatch = 'matching' | 'changed' | 'unknown'
export type RunSource = { before: SourceSnapshot; after: SourceSnapshot }
export type SourceCheck = { status: SourceMatch; at: number }

export type TestFailure = { id: string; loc?: string }

export type TestRun = {
  suite: string           // label, e.g. "xcodebuild test -scheme Cubby"
  key: string             // `${worktreeRoot}::${normalizedCommand}`
  total: number; passed: number; failed: number; skipped: number
  durationS?: number
  failures: TestFailure[] // capped at 20
  exitCode: number | null // null: no structured process status was available
  commandStatus?: 'exited' | 'tool-error' | 'interrupted' | 'unknown'
  countsIssue?: 'invalid' | 'conflicting'
  outputIncomplete?: boolean
  at: number              // epoch ms
  via?: string            // subagent description, "workflow", or undefined for the main loop
  parsed: boolean         // false: looked like a test run, counts unavailable
  source?: RunSource      // bounded observations, not proof of the command's inputs
  sourceCheck?: SourceCheck // latest only: comparison as of an event, never stored
  stale?: boolean         // true only in `latest` for a run loaded from history at
                          // session start; never written to the store
}

declare module 'claude-code' {
  interface PluginState {
    // dismissed: the newest run shown when ✕ was pressed; null when the band is open
    'test-board': { latest: TestRun[]; expanded: boolean; dismissed: { key: string; at: number } | null }
  }
}
