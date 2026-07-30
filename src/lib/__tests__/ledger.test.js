import { describe, it, expect } from 'vitest'
import {
  recordOccurrence,
  addNote,
  patternStats,
  suggestTargets,
  sessionPatternCodes,
  MAX_ACTIVE_TARGETS,
} from '../ledger'

const occ = (date, rung = 3) => ({ sessionId: 's1', date, quote: 'x', rung })

describe('ledger', () => {
  it('recordOccurrence creates entries and appends immutably', () => {
    const l0 = {}
    const l1 = recordOccurrence(l0, 'WO-VF', occ('2026-07-29'))
    const l2 = recordOccurrence(l1, 'WO-VF', occ('2026-07-30', 2))
    expect(l0).toEqual({})
    expect(l1['WO-VF'].occurrences).toHaveLength(1)
    expect(l2['WO-VF'].occurrences).toHaveLength(2)
    expect(l1['WO-VF'].occurrences).toHaveLength(1) // no mutation
  })

  it('addNote trims and skips empty notes', () => {
    let l = addNote({}, 'ADJ-END', '  endings follow the article  ', '2026-07-29')
    expect(l['ADJ-END'].notes).toEqual([{ date: '2026-07-29', text: 'endings follow the article' }])
    expect(addNote({}, 'ADJ-END', '   ', '2026-07-29')).toEqual({})
  })

  it('patternStats reports count, recency, and rung history', () => {
    let l = recordOccurrence({}, 'KAS-DAT', occ('2026-07-01', 4))
    l = recordOccurrence(l, 'KAS-DAT', occ('2026-07-20', 2))
    const s = patternStats(l, 'KAS-DAT')
    expect(s.count).toBe(2)
    expect(s.lastSeen).toBe('2026-07-20')
    expect(s.lastRung).toBe(2)
    expect(s.rungs).toEqual([4, 2])
    expect(patternStats(l, 'WO-V2').count).toBe(0)
  })

  it('suggestTargets ranks by recent frequency and caps at the max', () => {
    const now = new Date('2026-07-29')
    let l = {}
    for (let i = 0; i < 5; i++) l = recordOccurrence(l, 'WO-VF', occ('2026-07-25'))
    for (let i = 0; i < 3; i++) l = recordOccurrence(l, 'ADJ-END', occ('2026-07-26'))
    for (let i = 0; i < 2; i++) l = recordOccurrence(l, 'KAS-2WEG', occ('2026-07-27'))
    l = recordOccurrence(l, 'V-K2', occ('2026-07-28'))
    // Old errors outside the window don't count.
    for (let i = 0; i < 9; i++) l = recordOccurrence(l, 'ORTH', occ('2026-01-01'))

    const targets = suggestTargets(l, { now })
    expect(targets).toHaveLength(MAX_ACTIVE_TARGETS)
    expect(targets).toEqual(['WO-VF', 'ADJ-END', 'KAS-2WEG'])
    expect(targets).not.toContain('ORTH')
  })

  it('suggestTargets honours the processability allow-list', () => {
    const now = new Date('2026-07-29')
    let l = {}
    for (let i = 0; i < 5; i++) l = recordOccurrence(l, 'WO-VF', occ('2026-07-25'))
    for (let i = 0; i < 3; i++) l = recordOccurrence(l, 'ADJ-END', occ('2026-07-26'))
    const allow = new Set(['ADJ-END'])
    expect(suggestTargets(l, { now, allow })).toEqual(['ADJ-END'])
    expect(suggestTargets(l, { now })).toContain('WO-VF')
  })

  it('sessionPatternCodes dedupes in first-seen order', () => {
    const errors = [
      { patternCode: 'WO-VF' },
      { patternCode: 'ADJ-END' },
      { patternCode: 'WO-VF' },
    ]
    expect(sessionPatternCodes(errors)).toEqual(['WO-VF', 'ADJ-END'])
  })
})
