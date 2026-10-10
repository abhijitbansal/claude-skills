export type Fixture = { input: Record<string, unknown>; result: unknown; isError: boolean }

export const BASH_COMMIT: Fixture = {
  input: { command: 'git commit -m "feat: barcode fallback"' },
  result: {
    stdout: '[feature/scan 1a2b3c4] feat: barcode fallback\n 2 files changed, 40 insertions(+)\n',
    stderr: '',
    interrupted: false,
    gitOperation: { commit: { sha: '1a2b3c4', kind: 'committed', branch: 'feature/scan' } },
  },
  isError: false,
}

export const BASH_COMMIT_DETACHED: Fixture = {
  input: { command: 'git commit -m "wip"' },
  result: {
    stdout: '[detached HEAD 9f8e7d6] wip\n 1 file changed\n',
    stderr: '',
    interrupted: false,
    gitOperation: { commit: { sha: '9f8e7d6', kind: 'committed' } },
  },
  isError: false,
}

export const BASH_COMMIT_FAILED: Fixture = {
  input: { command: 'git commit -m "x"' },
  result: 'Exit code 1\npre-commit hook failed',
  isError: true,
}

export const BASH_PUSH_NEW_BRANCH: Fixture = {
  input: { command: 'git push -u origin feature/scan' },
  result: {
    stdout: '',
    stderr: 'To github.com:me/cubby.git\n * [new branch]      feature/scan -> feature/scan\n',
    interrupted: false,
    gitOperation: { push: { branch: 'feature/scan' } },
  },
  isError: false,
}

export const BASH_PR: Fixture = {
  input: { command: 'gh pr create --fill' },
  result: {
    stdout: 'https://github.com/me/cubby/pull/42\n',
    stderr: '',
    interrupted: false,
    gitOperation: { pr: { number: 42, action: 'created' } },
  },
  isError: false,
}

export const BASH_GH_VIEW: Fixture = {
  input: { command: 'gh pr view 42' },
  result: {
    stdout: 'title: barcode fallback\n',
    stderr: '',
    interrupted: false,
    gitOperation: { pr: { number: 42, action: 'commented' } },
  },
  isError: false,
}

export const ARTIFACT_PUBLISH: Fixture = {
  input: { file_path: '.scratch/compass-report.html' },
  result: { url: 'https://claude.ai/artifact/abc123', title: 'Compass Report', version: '1' },
  isError: false,
}

export const SEND_USER_FILE: Fixture = {
  input: { file_path: '/Users/me/projects/cubby/.scratch/checklist.html' },
  result: { attachments: [{ path: '/Users/me/projects/cubby/.scratch/checklist.html', size: 10, isImage: false }] },
  isError: false,
}
