import { expect, test } from 'claude-code/testing'
import { capture, isDeliverable } from '../hooks/capture'
import { ARTIFACT_PUBLISH, BASH_COMMIT, BASH_COMMIT_FAILED, SEND_USER_FILE, type Fixture } from './fixtures/results'

const run = (tool: string, f: Fixture) => capture({ tool, ...f, now: 7 })

test('an Artifact publish records title and URL', () => {
  expect(run('Artifact', ARTIFACT_PUBLISH)).toEqual([
    { kind: 'artifact', title: 'Compass Report', url: 'https://claude.ai/artifact/abc123', at: 7 },
  ])
})
test('an Artifact result with no title falls back to the input title, then the basename', () => {
  const noTitle = { ...ARTIFACT_PUBLISH, result: { url: 'https://claude.ai/artifact/abc123' } }
  expect(run('Artifact', noTitle)[0]).toMatchObject({ title: 'compass-report.html' })
  expect(run('Artifact', { ...noTitle, input: { title: 'Given' } })[0]).toMatchObject({ title: 'Given' })
})
test('SendUserFile records each attachment path', () => {
  expect(run('SendUserFile', SEND_USER_FILE)).toEqual([
    { kind: 'file', path: '/Users/me/projects/cubby/.scratch/checklist.html', at: 7 },
  ])
})
test('a Write of a deliverable under docs/ is a doc', () => {
  expect(run('Write', { input: { file_path: '/r/docs/plan.md' }, result: {}, isError: false })).toEqual([
    { kind: 'doc', path: '/r/docs/plan.md', at: 7 },
  ])
})
test('source code never counts, even under docs/', () => {
  expect(isDeliverable('/r/docs/x.ts')).toBe(false)
  expect(isDeliverable('/r/Sources/App.swift')).toBe(false)
  expect(isDeliverable('/r/README.md')).toBe(false)
})
test('the harness scratchpad counts', () => {
  expect(isDeliverable('/private/tmp/claude-501/-proj/abc/scratchpad/report.html')).toBe(true)
})
test('a Bash commit goes through git mapping; a failed one records nothing', () => {
  expect(run('Bash', BASH_COMMIT)).toHaveLength(1)
  expect(run('Bash', BASH_COMMIT_FAILED)).toEqual([])
})
test('an unrelated tool records nothing', () => {
  expect(run('Read', { input: {}, result: {}, isError: false })).toEqual([])
})
