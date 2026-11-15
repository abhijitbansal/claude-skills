import { expect, test } from 'claude-code/testing'
import { START, startWorld } from './fixtures/world'

type Rec = { branch: string; worktree: string }
const quiet = { result: { stdout: '', stderr: '', interrupted: false }, text: '' }
const NEW_WT = '/Users/me/projects/cubby/.claude/worktrees/fix'

for (const tool of ['EnterWorktree', 'ExitWorktree'] as const) {
  test(`${tool} refreshes the worktree and branch`, async ($, on) => {
    const { world } = startWorld(on)
    on('tool.call', { tool: tool as never }, () => ({ result: {}, text: 'ok' }) as never)
    await $.session.start(START)
    world.git['rev-parse --show-toplevel'] = `${NEW_WT}\n`
    world.git['rev-parse --abbrev-ref HEAD'] = 'worktree-fix\n'
    await $.tool.call({ tool, name: 'fix' } as never)
    expect(world.seen.get('record')).toMatchObject({ worktree: NEW_WT, branch: 'worktree-fix' })
    expect(world.data.get('session:sess-1')).toMatchObject({ worktree: NEW_WT, branch: 'worktree-fix' })
  })
}

test('a subagent EnterWorktree does not relocate the session', async ($, on) => {
  const { world } = startWorld(on)
  on('tool.call', { tool: 'EnterWorktree' }, () => ({ result: {}, text: 'ok' }) as never)
  await $.session.start(START)
  world.git['rev-parse --abbrev-ref HEAD'] = 'sub\n'
  await $.tool.call({ tool: 'EnterWorktree', agentId: 'a1' } as never)
  expect((world.seen.get('record') as Rec).branch).toBe('feature/scan')
})

for (const command of ['git -C /Users/me/projects/cubby checkout main', 'gh pr checkout 12']) {
  test(`"${command}" refreshes the branch`, async ($, on) => {
    const { world } = startWorld(on)
    on('tool.call', { tool: 'Bash' }, () => quiet as never)
    await $.session.start(START)
    world.git['rev-parse --abbrev-ref HEAD'] = 'main\n'
    await $.tool.call({ tool: 'Bash', command } as never)
    expect((world.seen.get('record') as Rec).branch).toBe('main')
  })
}

test('a denied EnterWorktree changes nothing', async ($, on) => {
  const { world } = startWorld(on)
  on('tool.call', { tool: 'EnterWorktree' }, () => ({ deny: 'no' }) as never)
  await $.session.start(START)
  world.git['rev-parse --abbrev-ref HEAD'] = 'other\n'
  await $.tool.call({ tool: 'EnterWorktree' } as never)
  expect((world.seen.get('record') as Rec).branch).toBe('feature/scan')
})
