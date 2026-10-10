import { expect, test } from 'claude-code/testing'
import { gitArtifacts, type GitOperation } from '../hooks/git'
import { BASH_COMMIT, BASH_COMMIT_DETACHED, BASH_GH_VIEW, BASH_PR, BASH_PUSH_NEW_BRANCH, type Fixture } from './fixtures/results'

const run = (f: Fixture) => {
  const r = f.result as { stdout: string; stderr: string; gitOperation?: GitOperation }
  return gitArtifacts(r.gitOperation, `${r.stdout}\n${r.stderr}`, 5)
}

test('commit takes sha and branch from gitOperation, subject from stdout', () => {
  expect(run(BASH_COMMIT)).toEqual([
    { kind: 'commit', sha: '1a2b3c4', subject: 'feat: barcode fallback', branch: 'feature/scan', at: 5 },
  ])
})
test('a detached HEAD commit reads its branch from the commit line', () => {
  expect(run(BASH_COMMIT_DETACHED)[0]).toMatchObject({ kind: 'commit', branch: 'detached HEAD', subject: 'wip' })
})
test('a new-branch push reads the remote from the To line', () => {
  expect(run(BASH_PUSH_NEW_BRANCH)).toEqual([
    { kind: 'push', branch: 'feature/scan', remote: 'github.com:me/cubby.git', at: 5 },
  ])
})
test('a created PR takes its URL from stdout when gitOperation has none', () => {
  expect(run(BASH_PR)).toEqual([{ kind: 'pr', number: 42, url: 'https://github.com/me/cubby/pull/42', at: 5 }])
})
test('a non-create gh call records nothing', () => {
  expect(run(BASH_GH_VIEW)).toEqual([])
})
test('no gitOperation records nothing', () => {
  expect(gitArtifacts(undefined, '[main abc1234] x', 5)).toEqual([])
})
