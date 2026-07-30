import { describe, it, expect } from 'vitest'
import { mergeSessions, draftKey, loadDraft, saveDraft, clearDraft } from '../store'

const s = (id, date, extra = {}) => ({ id, date, errors: [], notes: {}, ...extra })

describe('mergeSessions', () => {
  it('keeps a local session the server never received', () => {
    const server = [s('a', '2026-07-28')]
    const local = [s('a', '2026-07-28'), s('b', '2026-07-30', { pending: true })]
    expect(mergeSessions(server, local).map((x) => x.id)).toEqual(['a', 'b'])
  })

  it('drops local copies the server already has, so the server wins', () => {
    const server = [s('a', '2026-07-28', { finalText: 'server' })]
    const local = [s('a', '2026-07-28', { finalText: 'stale', pending: true })]
    const merged = mergeSessions(server, local)
    expect(merged).toHaveLength(1)
    expect(merged[0].finalText).toBe('server')
  })

  it('ignores non-pending local sessions — those are just cache paint', () => {
    const local = [s('ghost', '2026-07-30')]
    expect(mergeSessions([], local)).toEqual([])
  })

  it('returns sessions oldest-first, which buildLedger depends on', () => {
    const server = [s('a', '2026-07-01'), s('b', '2026-07-20')]
    const local = [s('c', '2026-07-10', { pending: true })]
    expect(mergeSessions(server, local).map((x) => x.id)).toEqual(['a', 'c', 'b'])
  })

  it('survives empty and missing inputs', () => {
    expect(mergeSessions(undefined, undefined)).toEqual([])
    expect(mergeSessions([], null)).toEqual([])
  })
})

function fakeStorage(initial = {}) {
  const data = { ...initial }
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v
    },
    removeItem: (k) => {
      delete data[k]
    },
  }
}

describe('in-progress draft', () => {
  it('round-trips a snapshot', () => {
    const store = fakeStorage()
    saveDraft('u1', { step: 'draft', draft: 'Liebe Frau Berger,' }, store)
    expect(loadDraft('u1', store).draft).toBe('Liebe Frau Berger,')
  })

  it('keys per user so two accounts never see each other in-progress', () => {
    expect(draftKey('a')).not.toBe(draftKey('b'))
    const store = fakeStorage()
    saveDraft('a', { draft: 'meins' }, store)
    expect(loadDraft('b', store)).toBe(null)
  })

  it('ignores an empty draft rather than reopening a stale step', () => {
    const store = fakeStorage()
    saveDraft('u1', { step: 'draft', draft: '   ' }, store)
    expect(loadDraft('u1', store)).toBe(null)
  })

  it('returns null for missing or corrupt entries instead of throwing', () => {
    const store = fakeStorage({ [draftKey('u1')]: '{not json' })
    expect(loadDraft('u1', store)).toBe(null)
    expect(loadDraft('nobody', fakeStorage())).toBe(null)
  })

  it('clearDraft removes it', () => {
    const store = fakeStorage()
    saveDraft('u1', { draft: 'x' }, store)
    clearDraft('u1', store)
    expect(loadDraft('u1', store)).toBe(null)
  })
})
