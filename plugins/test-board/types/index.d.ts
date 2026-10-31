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
  stale?: boolean         // true only in `latest` for a run loaded from history at
                          // session start; never written to the store
}

declare module 'claude-code' {
  interface PluginState {
    // dismissed: the newest run shown when ✕ was pressed; null when the band is open
    'test-board': { latest: TestRun[]; expanded: boolean; dismissed: { key: string; at: number } | null }
  }
}
