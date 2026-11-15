import { describe, expect, test } from 'claude-code/testing'
import type { Artifact } from '../types'
import {
  LIMITS, addArtifact, applyStatus, artifactKey, newRecord, orderIndex, sortByActive, withFirstPrompt, ago,
} from '../hooks/record'
import { isRecord } from '../hooks/io'

const WHERE = { repo: 'cubby', worktree: '/w/feature-scan', branch: 'feature/scan' }
const base = () => newRecord('s1', WHERE, 1000)

describe('applyStatus', () => {
  test('fields left out keep their values', () => {
    const first = applyStatus(base(), { goal: 'barcode fallback', step: 'spec' }, 2000)
    if ('error' in first) throw new Error(first.error)
    const second = applyStatus(first, { step: 'implement' }, 3000)
    if ('error' in second) throw new Error(second.error)
    expect(second.goal).toBe('barcode fallback')
    expect(second.step).toBe('implement')
    expect(second.statusAt).toBe(3000)
  })
  test('caps goal at 80 and step at 60 chars', () => {
    const out = applyStatus(base(), { goal: 'g'.repeat(200), step: 's'.repeat(200) }, 2000)
    if ('error' in out) throw new Error(out.error)
    expect(out.goal?.length).toBe(LIMITS.goal)
    expect(out.step?.length).toBe(LIMITS.step)
  })
  test('no field given returns an error naming the fields', () => {
    const out = applyStatus(base(), {}, 2000)
    expect('error' in out && out.error).toContain('goal, step, next')
  })
  test('an empty string clears that field and keeps the others', () => {
    const set = applyStatus(base(), { goal: 'g', step: 's', next: 'review' }, 2000)
    if ('error' in set) throw new Error(set.error)
    const cleared = applyStatus(set, { next: '' }, 3000)
    if ('error' in cleared) throw new Error(cleared.error)
    expect(cleared.next).toBeUndefined()
    expect('next' in cleared).toBe(false)
    expect(cleared).toMatchObject({ goal: 'g', step: 's', statusAt: 3000 })
    const blank = applyStatus(set, { step: '   ' }, 4000)
    if ('error' in blank) throw new Error(blank.error)
    expect(blank.step).toBeUndefined()
  })
})

describe('isRecord', () => {
  const good = { id: 'x', repo: 'r', worktree: '/w', branch: 'b', lastActive: 1, artifacts: [] }
  test('accepts a whole record', () => expect(isRecord(good)).toBe(true))
  test('refuses a record missing its worktree or lastActive', () => {
    expect(isRecord({ ...good, worktree: undefined })).toBe(false)
    expect(isRecord({ ...good, lastActive: 'yesterday' })).toBe(false)
    expect(isRecord({ ...good, lastActive: Number.NaN })).toBe(false)
  })
})

describe('artifactKey', () => {
  test('two PRs with one number in two repos are two entries', () => {
    const a: Artifact = { kind: 'pr', number: 12, url: 'https://github.com/me/one/pull/12', at: 1 }
    const b: Artifact = { kind: 'pr', number: 12, url: 'https://github.com/me/two/pull/12', at: 2 }
    expect(addArtifact(addArtifact(base(), a), b).artifacts).toHaveLength(2)
  })
  test('a PR with no URL falls back to its number', () => {
    const a: Artifact = { kind: 'pr', number: 12, url: '', at: 1 }
    expect(artifactKey(a)).toBe('pr:12')
  })
})

describe('addArtifact', () => {
  const doc = (path: string, at: number): Artifact => ({ kind: 'doc', path, at })
  test('a rewrite of the same path updates the entry in place of a duplicate', () => {
    const rec = addArtifact(addArtifact(base(), doc('docs/a.md', 1)), doc('docs/a.md', 2))
    expect(rec.artifacts).toEqual([doc('docs/a.md', 2)])
  })
  test('a republish to the same URL updates the title', () => {
    const one: Artifact = { kind: 'artifact', title: 'Old', url: 'https://claude.ai/artifact/x', at: 1 }
    const two: Artifact = { ...one, title: 'New', at: 2 }
    expect(addArtifact(addArtifact(base(), one), two).artifacts).toEqual([two])
  })
  test('caps at 100, newest first', () => {
    let rec = base()
    for (let i = 0; i < 105; i += 1) rec = addArtifact(rec, doc(`docs/${i}.md`, i))
    expect(rec.artifacts).toHaveLength(LIMITS.artifacts)
    expect(rec.artifacts[0]).toEqual(doc('docs/104.md', 104))
  })
})

describe('index and helpers', () => {
  test('orderIndex moves the id to the front and reports the dropped ids', () => {
    expect(orderIndex(['a', 'b', 'c'], 'c', 2)).toEqual({ index: ['c', 'a'], dropped: ['b'] })
  })
  test('withFirstPrompt stores the first prompt once', () => {
    const rec = withFirstPrompt(withFirstPrompt(base(), 'first prompt'), 'second')
    expect(rec.firstPrompt).toBe('first prompt')
  })
  test('sortByActive puts the most recent first', () => {
    const a = { ...base(), id: 'a', lastActive: 1 }
    const b = { ...base(), id: 'b', lastActive: 2 }
    expect(sortByActive([a, b]).map(r => r.id)).toEqual(['b', 'a'])
  })
  test('ago reads minutes, hours, days', () => {
    expect(ago(0, 0)).toBe('just now')
    expect(ago(5 * 60_000, 0)).toBe('5m ago')
    expect(ago(2 * 3_600_000, 0)).toBe('2h ago')
    expect(ago(72 * 3_600_000, 0)).toBe('3d ago')
  })
})
