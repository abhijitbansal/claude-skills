import { expect, test } from 'claude-code/testing'
import { capture, isDeliverable } from '../hooks/capture'
import { START, startWorld } from './fixtures/world'

test('a builder run through Bash adds its output to the session record', async ($, on) => {
  const { world } = startWorld(on)
  const stdout = 'wrote /r/.scratch/recap.html\nopen: file:///r/.scratch/recap.html\n'
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout, stderr: '', interrupted: false }, text: stdout }) as never)
  await $.session.start(START)
  await $.tool.call({ tool: 'Bash', command: 'node /p/skills/make-explainer/scripts/build.mjs recap.json' } as never)
  const rec = world.data.get('session:sess-1') as { artifacts: unknown[] }
  expect(rec.artifacts).toEqual([{ kind: 'doc', path: '/r/.scratch/recap.html', at: expect.any(Number) }])
})

const EXPLAINER = 'node /p/portable-artifacts/skills/make-explainer/scripts/build.mjs spec.json'
const bash = (command: string, stdout: string) =>
  capture({ tool: 'Bash', input: { command }, result: { stdout, stderr: '' }, isError: false, now: 7 })

test('a make-* build that prints "wrote <path>" and a file:// line records one doc', () => {
  const out = 'theme: paper\nwrote /Users/me/.agent/diagrams/branch.html\nopen: file:///Users/me/.agent/diagrams/branch.html\n'
  expect(bash(EXPLAINER, out)).toEqual([{ kind: 'doc', path: '/Users/me/.agent/diagrams/branch.html', at: 7 }])
})

test('a bare file:// line is decoded to its path', () => {
  const out = 'file:///Users/me/repo/.scratch/my%20page.html\n'
  expect(bash('node skills/make-diagram/scripts/build.mjs d.json', out))
    .toEqual([{ kind: 'doc', path: '/Users/me/repo/.scratch/my page.html', at: 7 }])
})

test('a --json build records its "out" path', () => {
  const out = `${JSON.stringify({ ok: true, out: '/r/.scratch/dash.html', sources: {} })}\n`
  expect(bash('node skills/make-dashboard/scripts/build.mjs spec.json --json', out))
    .toEqual([{ kind: 'doc', path: '/r/.scratch/dash.html', at: 7 }])
})

test('a make-motion render that prints its .mp4 path records it', () => {
  const out = '50% (60/120 frames)\n/r/.scratch/promo.mp4\n120 frames @ 30 fps, 1280x720\n'
  expect(bash('node skills/make-motion/scripts/render.mjs promo.json', out))
    .toEqual([{ kind: 'doc', path: '/r/.scratch/promo.mp4', at: 7 }])
})

test('a "wrote" line from a command that is not a make-* builder records nothing', () => {
  expect(bash('python3 tools/gen.py', 'wrote /tmp/x.html\n')).toEqual([])
})

test('a command that only names a make-* folder records nothing it prints', () => {
  const listed = '/p/portable-artifacts/skills/make-explainer/SKILL.md\n/p/portable-artifacts/skills/make-explainer/references/a.md\n'
  expect(bash("find /p/portable-artifacts/skills/make-explainer -name '*.md'", listed)).toEqual([])
  expect(bash('ls /p/skills/make-diagram/scripts/build.mjs', '/p/skills/make-diagram/scripts/build.mjs\n')).toEqual([])
})

test('only make-motion render counts a bare path line', () => {
  expect(bash(EXPLAINER, '/r/.scratch/stray.html\n')).toEqual([])
})

test('a builder line naming a file that is not a deliverable type records nothing', () => {
  expect(bash(EXPLAINER, 'wrote /r/.scratch/data.json\n')).toEqual([])
})

test('a failed build records nothing', () => {
  expect(capture({ tool: 'Bash', input: { command: EXPLAINER }, result: 'wrote /r/x.html', isError: true, now: 7 })).toEqual([])
})

test('video and gif files written under a capture dir count as documents', () => {
  expect(isDeliverable('/r/.scratch/demo.mp4')).toBe(true)
  expect(isDeliverable('/r/docs/loop.gif')).toBe(true)
  expect(isDeliverable('/r/reports/clip.webm')).toBe(true)
})
