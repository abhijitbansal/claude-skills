import { describe, expect, test } from 'claude-code/testing'
import type { Artifact } from '../types'
import {
  LIMITS, addArtifact, applyStatus, newRecord, orderIndex, sortByActive, withFirstPrompt, ago,
} from '../hooks/record'

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
  test('every field empty returns an error naming the fields', () => {
    const out = applyStatus(base(), { goal: '  ' }, 2000)
    expect('error' in out && out.error).toContain('goal, step, next')
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
