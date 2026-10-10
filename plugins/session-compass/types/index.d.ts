export type Artifact =
  | { kind: 'artifact'; title: string; url: string; at: number }
  | { kind: 'file'; path: string; at: number }
  | { kind: 'doc'; path: string; at: number }
  | { kind: 'commit'; sha: string; subject: string; branch: string; at: number }
  | { kind: 'push'; branch: string; remote: string; at: number }
  | { kind: 'pr'; url: string; number: number; at: number }

export type SessionRecord = {
  id: string
  repo: string
  worktree: string
  branch: string
  goal?: string
  step?: string
  next?: string
  firstPrompt?: string
  statusAt?: number
  lastActive: number
  artifacts: Artifact[]
}

declare module 'claude-code' {
  interface PluginState {
    'session-compass': {
      record: SessionRecord | null
      tab: 'this' | 'all'
    }
  }
}
